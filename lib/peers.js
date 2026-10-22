/**
 * Host 集合的运行时：内存快照、探活调度、退避、缓存落盘。
 *
 * 每个 Host 一条独立时间线（下一次探活时间、连续失败次数），互不影响。
 */

import { CODE, STATUS } from './codes.js'
import {
  isCacheFresh,
  publicHost,
  readCache,
  readRegistry,
  writeCache,
  writeRegistry,
} from './config.js'
import { groupSessions, hostIdFromOrigin, normalizeOrigin } from './identity.js'
import { nextDelayMs, probeHost } from './probe.js'

const COLORS = ['teal', 'blue', 'purple', 'orange', 'pink', 'green']
const CACHE_FLUSH_MS = 30 * 1000

function nowMs() {
  return Date.now()
}

function publicError(message) {
  return String(message ?? '').slice(0, 300)
}

export function createPeers({ config, logger }) {
  const hosts = new Map()
  const snapshots = new Map()
  const failures = new Map()
  const nextAt = new Map()
  const inflight = new Set()

  let timer = null
  let disposed = false
  let cacheDirty = false
  let lastFlush = 0

  const probeIntervalMs = config.probeIntervalMs
  const requestTimeoutMs = config.requestTimeoutMs

  //#region 装载与落盘

  async function load() {
    const registry = await readRegistry()
    const cache = await readCache()
    for (const [index, raw] of registry.hosts.entries()) {
      let id = raw.id
      if (!id) {
        try {
          id = hostIdFromOrigin(raw.origin)
        } catch {
          continue
        }
      }
      if (hosts.has(id)) continue
      const host = { ...raw, id, order: Number.isFinite(raw.order) ? raw.order : index }
      hosts.set(id, host)
      const entry = cache.hosts?.[id]
      if (entry && isCacheFresh(entry)) {
        snapshots.set(id, {
          hostId: id,
          status: entry.status || STATUS.UNREACHABLE,
          code: entry.code ?? null,
          message: entry.message ?? '',
          latencyMs: Number(entry.latencyMs) || 0,
          fetchedAt: Number(entry.fetchedAt) || 0,
          stale: true,
          workspaces: Array.isArray(entry.workspaces) ? entry.workspaces : [],
        })
      }
      nextAt.set(id, 0)
    }
    logger.info(`[peerbar] 载入 ${hosts.size} 个 Host`)
  }

  function markCacheDirty() {
    cacheDirty = true
  }

  async function flushCache(force = false) {
    if (!cacheDirty) return
    const now = nowMs()
    if (!force && now - lastFlush < CACHE_FLUSH_MS) return
    const hostsCache = {}
    for (const [id, snap] of snapshots) {
      hostsCache[id] = {
        status: snap.status,
        code: snap.code,
        message: snap.message,
        latencyMs: snap.latencyMs,
        fetchedAt: snap.fetchedAt,
        workspaces: snap.workspaces,
      }
    }
    cacheDirty = false
    lastFlush = now
    try {
      await writeCache({ hosts: hostsCache })
    } catch (error) {
      logger.warn(`[peerbar] 写缓存失败：${publicError(error?.message ?? error)}`)
    }
  }

  async function persistHosts() {
    try {
      await writeRegistry({
        version: 1,
        probeIntervalMs,
        hosts: [...hosts.values()].sort(byOrder),
      })
    } catch (error) {
      logger.warn(`[peerbar] 写注册表失败：${publicError(error?.message ?? error)}`)
    }
  }

  //#endregion

  //#region Host 运行时

  function byOrder(a, b) {
    return (Number(a.order) || 0) - (Number(b.order) || 0) || a.name.localeCompare(b.name)
  }

  function snapshotOf(hostId) {
    return (
      snapshots.get(hostId) ?? {
        hostId,
        status: STATUS.UNREACHABLE,
        code: null,
        message: '尚未探活',
        latencyMs: 0,
        fetchedAt: 0,
        stale: true,
        workspaces: [],
      }
    )
  }

  async function runProbe(host) {
    if (inflight.has(host.id)) return
    inflight.add(host.id)
    try {
      const result = await probeHost(host, { timeoutMs: requestTimeoutMs })
      if (disposed) return

      if (result.ok) {
        failures.set(host.id, 0)
        nextAt.set(host.id, nowMs() + probeIntervalMs)
        snapshots.set(host.id, {
          hostId: host.id,
          status: STATUS.ONLINE,
          code: null,
          message: '',
          latencyMs: result.latencyMs,
          fetchedAt: nowMs(),
          stale: false,
          workspaces: groupSessions(host.id, result.items),
        })
        if (result.cookieRefreshed && result.cookie) {
          host.cookie = result.cookie
          await persistHosts()
        }
        markCacheDirty()
        await flushCache()
      } else {
        const count = (failures.get(host.id) ?? 0) + 1
        failures.set(host.id, count)
        nextAt.set(host.id, nowMs() + nextDelayMs(count, { baseMs: probeIntervalMs }))
        if (result.code === CODE.AUTH_REQUIRED) host.cookie = null
        const previous = snapshots.get(host.id)
        snapshots.set(host.id, {
          hostId: host.id,
          status: result.status,
          code: result.code,
          message: publicError(result.message),
          latencyMs: result.latencyMs,
          fetchedAt: previous?.fetchedAt ?? 0,
          stale: true,
          workspaces: previous?.workspaces ?? [],
        })
        if (result.code === CODE.AUTH_REQUIRED) await persistHosts()
        logger.warn(`[peerbar] ${host.name} 探活失败：${result.code} ${publicError(result.message)}`)
      }
    } finally {
      inflight.delete(host.id)
    }
  }

  function tick() {
    if (disposed) return
    const now = nowMs()
    for (const host of hosts.values()) {
      if (!host.enabled) continue
      if ((nextAt.get(host.id) ?? 0) > now) continue
      nextAt.set(host.id, now + requestTimeoutMs) // 防重入：先占位
      void runProbe(host)
    }
    void flushCache()
  }

  function start() {
    if (timer) return
    timer = setInterval(tick, 1000)
    timer.unref?.()
    tick()
    return () => stop()
  }

  function stop() {
    disposed = true
    if (timer) clearInterval(timer)
    timer = null
    void flushCache(true)
  }

  //#endregion

  //#region 对外状态与增删改

  function state() {
    const list = [...hosts.values()].sort(byOrder).map((host) => {
      const snap = snapshotOf(host.id)
      return {
        ...publicHost(host),
        status: host.enabled ? snap.status : STATUS.DISABLED,
        code: snap.code,
        message: snap.message,
        latencyMs: snap.latencyMs,
        fetchedAt: snap.fetchedAt,
        stale: snap.stale,
        workspaces: snap.workspaces,
      }
    })
    return {
      ok: true,
      hosts: list,
    }
  }

  async function addHost(input) {
    const origin = normalizeOrigin(input?.origin)
    const id = hostIdFromOrigin(origin)
    if (hosts.has(id)) {
      const error = new Error('该地址已登记')
      error.code = 'duplicate'
      throw error
    }
    const host = {
      id,
      name: String(input?.name ?? '').trim() || origin,
      origin,
      order: hosts.size,
      enabled: true,
      color: COLORS[hosts.size % COLORS.length],
      tls: {
        allowSelfSigned: input?.allowSelfSigned === true,
        caFile: typeof input?.caFile === 'string' && input.caFile.trim() ? input.caFile.trim() : null,
      },
      token: String(input?.token ?? '').trim(),
      cookie: null,
    }
    hosts.set(id, host)
    failures.set(id, 0)
    nextAt.set(id, 0)
    await persistHosts()
    void runProbe(host)
    return publicHost(host)
  }

  async function updateHost(id, patch) {
    const host = hosts.get(id)
    if (!host) return null
    if (patch?.name != null) host.name = String(patch.name).trim() || host.origin
    if (patch?.color != null) host.color = String(patch.color)
    if (patch?.order != null && Number.isFinite(Number(patch.order))) host.order = Number(patch.order)
    if (patch?.enabled != null) host.enabled = patch.enabled === true
    if (patch?.allowSelfSigned != null) host.tls.allowSelfSigned = patch.allowSelfSigned === true
    if (patch?.caFile !== undefined) {
      host.tls.caFile = typeof patch.caFile === 'string' && patch.caFile.trim() ? patch.caFile.trim() : null
    }
    if (patch?.token != null && String(patch.token).trim() !== host.token) {
      host.token = String(patch.token).trim()
      host.cookie = null
      failures.set(id, 0)
      nextAt.set(id, 0)
    }
    await persistHosts()
    if (patch?.token != null || patch?.enabled === true) void runProbe(host)
    return publicHost(host)
  }

  async function removeHost(id) {
    if (!hosts.delete(id)) return false
    snapshots.delete(id)
    failures.delete(id)
    nextAt.delete(id)
    await persistHosts()
    markCacheDirty()
    await flushCache(true)
    return true
  }

  async function probeNow(id) {
    const host = hosts.get(id)
    if (!host) return null
    failures.set(id, 0)
    await runProbe(host)
    return state()
  }

  return {
    load,
    start,
    stop,
    state,
    addHost,
    updateHost,
    removeHost,
    probeNow,
    hostCount: () => hosts.size,
    getHost: (id) => hosts.get(id) ?? null,
  }
}

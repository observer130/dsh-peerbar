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
  /** 每 Host 上一次拿到的 workspace baseline（workspaceId/archived/pinned/手工序）；流失败时继续用它，避免归档会话重新冒出来。 */
  const registries = new Map()
  /** 每 Host 上一次记过的 baseline 流错误，用来抑制 5s 一条的重复告警。 */
  const archiveNoted = new Map()

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
        registryError: null,
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
        if (result.registry) {
          registries.set(host.id, result.registry)
          archiveNoted.delete(host.id)
        } else if (result.archiveError && archiveNoted.get(host.id) !== result.archiveError) {
          archiveNoted.set(host.id, result.archiveError)
          logger.warn(`[peerbar] ${host.name} workspace baseline 读取失败：${publicError(result.archiveError)}`)
        }
        snapshots.set(host.id, {
          hostId: host.id,
          status: STATUS.ONLINE,
          code: null,
          message: '',
          latencyMs: result.latencyMs,
          fetchedAt: nowMs(),
          stale: false,
          // baseline 读失败的原因（T9）：客户端据此解释「工作区菜单为什么不可用」
          registryError: result.registryError ?? null,
          workspaces: groupSessions(host.id, result.items, registries.get(host.id) ?? null),
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
          registryError: previous?.registryError ?? null,
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
        // 空字符串/undefined 都归一成 null，客户端只判真假
        registryError: snap.registryError ?? null,
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
    registries.delete(id)
    archiveNoted.delete(id)
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

  /**
   * 写操作成功后**就地回写快照**。
   *
   * 验收反馈：「改标题 / 归档 / 删工作区点了要等 5s 以上」。根因不是 RPC 慢，
   * 是 `/state` 的内容来自探活快照，而探活 5s 一轮——客户端操作完重拉 `/state`
   * 拿到的仍是旧快照。
   *
   * 这里在 RPC 成功后直接把结果打到快照上，客户端下一次 `/state` 立刻正确；
   * 随后的探活会用远端真实数据覆盖（幂等，不会跑偏）。
   *
   * @returns {boolean} 是否改动了快照
   */
  function applyLocalEcho(hostId, endpoint, args) {
    const snap = snapshots.get(hostId)
    if (!snap) return false
    const request = args?.request ?? {}
    const sessionId = typeof request.sessionId === 'string' ? request.sessionId : null
    const workspaceId = typeof request.workspaceId === 'string' ? request.workspaceId : null
    let next = null

    const patchSessions = (match, patch) => {
      let touched = false
      const workspaces = (snap.workspaces ?? []).map((ws) => {
        let wsChanged = false
        const sessions = (ws.sessions ?? []).map((s) => {
          if (!match(s)) return s
          wsChanged = true
          return { ...s, ...patch }
        })
        return wsChanged ? { ...ws, sessions } : ws
      })
      if (!workspaces.some((ws, i) => ws !== (snap.workspaces ?? [])[i])) return false
      touched = true
      next = { ...(next ?? snap), workspaces }
      return touched
    }

    const patchWorkspaces = (map) => {
      const workspaces = (snap.workspaces ?? []).map(map)
      if (!workspaces.some((ws, i) => ws !== (snap.workspaces ?? [])[i])) return false
      next = { ...(next ?? snap), workspaces }
      return true
    }

    switch (endpoint) {
      case 'workspace/archiveSession':
        if (sessionId) patchSessions((s) => s.rawId === sessionId, { archived: true })
        break
      case 'workspace/unarchiveSession':
        if (sessionId) patchSessions((s) => s.rawId === sessionId, { archived: false })
        break
      case 'workspace/pinSession':
        if (sessionId) patchSessions((s) => s.rawId === sessionId, { pinned: true })
        break
      case 'workspace/unpinSession':
        if (sessionId) patchSessions((s) => s.rawId === sessionId, { pinned: false })
        break
      case 'session/rename':
        if (sessionId && typeof request.title === 'string') {
          patchSessions((s) => s.rawId === sessionId, { title: request.title })
        }
        break
      case 'workspace/rename':
        if (workspaceId && typeof request.title === 'string') {
          patchWorkspaces((ws) => (ws.workspaceId === workspaceId ? { ...ws, name: request.title } : ws))
        }
        break
      case 'workspace/delete':
        if (workspaceId) {
          const workspaces = (snap.workspaces ?? []).filter((ws) => ws.workspaceId !== workspaceId)
          if (workspaces.length !== (snap.workspaces ?? []).length) next = { ...(next ?? snap), workspaces }
        }
        break
      default:
        return false
    }

    if (!next) return false
    snapshots.set(hostId, { ...next, fetchedAt: nowMs() })
    markCacheDirty()
    return true
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
    applyLocalEcho,
    hostCount: () => hosts.size,
    getHost: (id) => hosts.get(id) ?? null,
  }
}

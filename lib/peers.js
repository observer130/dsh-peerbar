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
import {
  groupSessions,
  hostIdFromOrigin,
  normalizeOrigin,
  virtualSessionId,
  virtualWorkspaceId,
  workspaceName,
} from './identity.js'
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
  /**
   * 每 Host 的版本兼容探测结果（T14）：`'ok'` 或错误串。
   * 探到 ok 就不再重复探测；失败则每轮重试（也可能只是远端正在重启）。
   */
  const compatState = new Map()

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
        compatError: null,
        workspaces: [],
      }
    )
  }

  async function runProbe(host) {
    if (inflight.has(host.id)) return
    inflight.add(host.id)
    try {
      const result = await probeHost(host, {
        timeoutMs: requestTimeoutMs,
        // 只在还没探到 'ok' 时做一次深端点检查，避免每 5s 都多打一次 RPC
        checkCompat: compatState.get(host.id) !== 'ok',
      })
      if (disposed) return

      if (result.ok) {
        if (result.compatError) compatState.set(host.id, result.compatError)
        else if (compatState.get(host.id) !== 'ok') compatState.set(host.id, 'ok')
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
          // 版本兼容探测的结论（T14）：非空时侧栏提示「远端 dsh 可能不兼容」
          compatError: result.compatError ?? null,
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
          compatError: compatState.get(host.id) === 'ok' ? null : (compatState.get(host.id) ?? null),
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
        compatError: snap.compatError ?? null,
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
  function applyLocalEcho(hostId, endpoint, args, value) {
    const snap = snapshots.get(hostId)
    if (!snap) return false
    const next = applyEchoToWorkspaces({
      hostId,
      workspaces: snap.workspaces ?? [],
      endpoint,
      args,
      value,
      now: nowMs(),
    })
    if (!next) return false
    snapshots.set(hostId, { ...snap, workspaces: next, fetchedAt: nowMs() })
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

/**
 * 纯函数：把一次 RPC 的结果映射到工作区快照上。
 *
 * 与 `lib/rpc.js` 的白名单**一一对应**（单测逐端点覆盖，防止新增端点时漏网）。
 * 只处理「侧栏立刻可见」的状态；内容类变化（会话正文、队列、模型）由会话绑定
 * 自己的通道负责，不走这里。
 *
 * @param {{hostId: string, workspaces: Array<object>, endpoint: string, args?: object, value?: object, now?: number}} input
 * @returns {Array<object>|null} 新的工作区数组；无需改动时返回 null
 */
export function applyEchoToWorkspaces({ hostId, workspaces, endpoint, args, value, now = Date.now() }) {
  const request = args?.request ?? {}
  const asString = (v) => (typeof v === 'string' && v ? v : null)
  const sessionId = asString(request.sessionId)
  const workspaceId = asString(request.workspaceId)
  let list = workspaces ?? []
  let changed = false
  const commit = (next) => {
    list = next
    changed = true
  }

  /** 对所有工作区里的会话做补丁（无实际字段变化时不算改动） */
  const patchSessions = (match, patch) => {
    let any = false
    const next = list.map((ws) => {
      let wsChanged = false
      const sessions = (ws.sessions ?? []).map((s) => {
        if (!match(s)) return s
        const merged = { ...s }
        let diff = false
        for (const [key, v] of Object.entries(patch)) {
          if (v === undefined || merged[key] === v) continue
          merged[key] = v
          diff = true
        }
        if (!diff) return s
        wsChanged = true
        return merged
      })
      if (!wsChanged) return ws
      any = true
      return { ...ws, sessions }
    })
    if (any) commit(next)
    return any
  }

  /** 对匹配的工作区做补丁（补丁返回同一对象时不算改动） */
  const patchWorkspace = (match, patch) => {
    let any = false
    const next = list.map((ws) => {
      if (!match(ws)) return ws
      const patched = patch(ws)
      if (patched !== ws) any = true
      return patched
    })
    if (any) commit(next)
    return any
  }

  const makeBlankRow = (rawId) => ({
    id: virtualSessionId(hostId, rawId),
    rawId,
    title: null,
    lastActivityAt: now,
    running: false,
    blank: true,
    archived: false,
    pinned: false,
  })

  /** 往工作区插一行；afterRawId 给出时插在它后面，否则插最前 */
  const insertSession = (wsId, rawId, afterRawId) => {
    if (!wsId || !rawId) return false
    return patchWorkspace(
      (ws) => ws.workspaceId === wsId,
      (ws) => {
        const sessions = ws.sessions ?? []
        if (sessions.some((s) => s.rawId === rawId)) return ws
        const row = makeBlankRow(rawId)
        const index = afterRawId ? sessions.findIndex((s) => s.rawId === afterRawId) : -1
        const nextSessions =
          index >= 0 ? [...sessions.slice(0, index + 1), row, ...sessions.slice(index + 1)] : [row, ...sessions]
        return { ...ws, sessions: nextSessions }
      },
    )
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
    // 发消息 / 停止：侧栏要立刻看到 running 点与「最近活动」排序变化
    case 'session/prompt':
      if (sessionId) patchSessions((s) => s.rawId === sessionId, { running: true, lastActivityAt: now })
      break
    case 'session/cancel':
      if (sessionId) patchSessions((s) => s.rawId === sessionId, { running: false })
      break
    case 'session/create':
      insertSession(workspaceId, asString(value?.sessionId))
      break
    case 'session/fork': {
      // 新会话和原会话同一个工作区，紧跟原会话之后
      const created = asString(value?.sessionId)
      if (created && sessionId) {
        const owner = list.find((ws) => (ws.sessions ?? []).some((s) => s.rawId === sessionId))
        if (owner) insertSession(owner.workspaceId, created, sessionId)
      }
      break
    }
    case 'workspace/rename': {
      const renamed = asString(value?.workspace?.title) ?? (typeof request.title === 'string' ? request.title : null)
      if (workspaceId && renamed) {
        patchWorkspace(
          (ws) => ws.workspaceId === workspaceId,
          (ws) => ({ ...ws, name: renamed }),
        )
      }
      break
    }
    case 'workspace/delete':
      if (workspaceId) {
        const next = list.filter((ws) => ws.workspaceId !== workspaceId)
        if (next.length !== list.length) commit(next)
      }
      break
    case 'workspace/create': {
      // 新建工作区：注册表里的 workspaceId 只有这一步拿得到
      const created = value?.workspace
      const wsId = asString(created?.workspaceId)
      const wsPath = asString(created?.path)
      if (!wsId || !wsPath) break
      if (list.some((ws) => ws.workspaceId === wsId)) break
      commit([
        {
          id: virtualWorkspaceId(hostId, wsPath),
          name: asString(created?.title) || workspaceName(wsPath),
          cwd: wsPath,
          workspaceId: wsId,
          sessions: [],
        },
        ...list,
      ])
      break
    }
    case 'workspace/insertBefore': {
      // 工作区级手工排序：返回完整顺序，照它重排（列表外的追加末尾）
      const order = Array.isArray(value?.workspaceIds) ? value.workspaceIds : null
      if (!order) break
      const byId = new Map(list.map((ws) => [ws.workspaceId, ws]))
      const ordered = order.map((id) => byId.get(id)).filter(Boolean)
      if (ordered.length === 0) break
      commit([...ordered, ...list.filter((ws) => !order.includes(ws.workspaceId))])
      break
    }
    case 'workspace/insertSessionBefore': {
      // 组内手工排序：按返回的 sessionIds 重排（未 accounted 的保持原序追加）
      const updated = value?.workspace
      const targetId = asString(updated?.workspaceId)
      const order = Array.isArray(updated?.sessionIds) ? updated.sessionIds : null
      if (!targetId || !order) break
      patchWorkspace(
        (ws) => ws.workspaceId === targetId,
        (ws) => {
          const sessions = ws.sessions ?? []
          const byRaw = new Map(sessions.map((s) => [s.rawId, s]))
          const ordered = order.map((id) => byRaw.get(id)).filter(Boolean)
          if (ordered.length === 0) return ws
          return { ...ws, sessions: [...ordered, ...sessions.filter((s) => !order.includes(s.rawId))] }
        },
      )
      break
    }
    default:
      return null
  }

  return changed ? list : null
}

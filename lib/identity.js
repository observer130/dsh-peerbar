/**
 * 身份与命名：origin 归一化、hostId 派生、虚拟 ID、cwd → 工作区。
 *
 * 远端不提供 workspaceId（见 docs/spike-S1.md §2.4），工作区由 cwd 合成，
 * 所以 ws 的 rawId 就是 cwd 本身。
 */

import { createHash } from 'node:crypto'
import { basename } from 'node:path'

/** 本机固定 ID；所有 Peer 都是 `h_<8hex>`。 */
export const LOCAL_HOST_ID = 'local'

/** 未记录 cwd 的会话归到这个伪目录。 */
export const UNKNOWN_CWD = '(unknown)'

/**
 * 归一化 origin：补 scheme、去尾斜杠、丢默认端口、拒掉路径与账号密码。
 * 同一台机器的不同写法必须落到同一个 hostId。
 */
export function normalizeOrigin(input) {
  const raw = String(input ?? '').trim()
  if (!raw) throw new Error('origin is required')
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  let url
  try {
    url = new URL(withScheme)
  } catch {
    throw new Error('origin is not a valid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('origin must be http or https')
  }
  if (url.username || url.password) throw new Error('origin must not carry credentials')
  if (url.search || url.hash) throw new Error('origin must not carry a query or fragment')
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('origin must not carry a path')
  }
  return url.origin
}

/** 稳定 hostId：改别名、改颜色都不影响它。 */
export function hostIdFromOrigin(origin) {
  const digest = createHash('sha1').update(normalizeOrigin(origin)).digest('hex')
  return `h_${digest.slice(0, 8)}`
}

export function virtualWorkspaceId(hostId, cwd) {
  return `peerbar:${hostId}:ws:${cwd}`
}

export function virtualSessionId(hostId, rawSessionId) {
  return `peerbar:${hostId}:sess:${rawSessionId}`
}

/** 解析虚拟 ID；rawId 允许含冒号（cwd 里有 Windows 盘符时靠这条）。 */
export function parseVirtualId(id) {
  const match = /^peerbar:([^:]+):(ws|sess):(.+)$/.exec(String(id ?? ''))
  if (!match) return null
  return { hostId: match[1], kind: match[2], rawId: match[3] }
}

/** 工作区显示名：目录 basename；根目录等退化情况回退到完整路径。 */
export function workspaceName(cwd) {
  if (!cwd || cwd === UNKNOWN_CWD) return UNKNOWN_CWD
  const trimmed = cwd.replace(/[\\/]+$/, '')
  const name = basename(trimmed)
  return name || cwd
}

function titleOf(item) {
  const title = item?.projections?.values?.title
  return typeof title === 'string' && title.trim() ? title.trim() : null
}

/**
 * `session/list` 的 items → 工作区数组（每个工作区带排序后的会话）。
 *
 * 分组语义与官方侧栏一致（以 workspace registry 为准）：
 * - registry 有工作区时：注册工作区**全部出组**（没有会话也出，空组由客户端
 *   显示「暂无会话」），会话按 accounted 关系归组；未 accounted 到任何工作区的
 *   会话进「未分组」桶（ungrouped: true，workspaceId 为 null）。
 *   组名用 registry 的 title（改名后即时生效），退回 path 的 basename。
 * - registry 缺失（baseline 读取失败/退化）时：按 cwd 合成（v3 行为），
 *   workspaceId 为空、ungrouped 为 false。
 *
 * 过滤规则：`origin === 'subagent'` 的子代理会话永远不进列表——它们的父会话
 * 在 `subagentCatalog` 里自带入口，铺到树上就是重复行。
 *
 * @param {string} hostId Host 标识。
 * @param {Array<object>} items `session/list` 返回的 items。
 * @param {{ items?: Array<object>, archivedSessionIds?: string[], pinnedSessionIds?: string[] } | null} [registry]
 */
export function groupSessions(hostId, items, registry = null) {
  const archivedSet = new Set(Array.isArray(registry?.archivedSessionIds) ? registry.archivedSessionIds : [])
  const pinnedSet = new Set(Array.isArray(registry?.pinnedSessionIds) ? registry.pinnedSessionIds : [])
  const registered = (Array.isArray(registry?.items) ? registry.items : []).filter(
    (ws) => ws && typeof ws === 'object' && typeof ws.workspaceId === 'string' && ws.workspaceId !== '',
  )

  /** 组内手工序：registry.sessionIds 的下标。 */
  const orderOf = new Map() // workspaceId → Map(sessionId → index)
  /** 注册工作区驱动：workspaceId → group */
  const groups = new Map()
  /** 组的注册顺序。客户端「手动排序」按它排组；默认（最近活动）排序不受影响。 */
  const registeredOrder = new Map(registered.map((ws, index) => [ws.workspaceId, index]))
  let fallbackOrder = 0
  /** cwd 退化模式：cwd → group */
  const byCwd = new Map()
  /** sessionId → 注册工作区 group（accounted 关系） */
  const bySession = new Map()
  const list = []
  let ungroupedGroup = null

  const makeUngrouped = () => {
    if (!ungroupedGroup) {
      ungroupedGroup = {
        id: virtualWorkspaceId(hostId, '(ungrouped)'),
        name: null, // 客户端按 tr('tree.ungrouped') 渲染
        cwd: null,
        workspaceId: null,
        ungrouped: true,
        // 未分组永远排最后：客户端手动排序时按 ungrouped 优先降序
        order: Number.MAX_SAFE_INTEGER,
        sessions: [],
      }
      list.push(ungroupedGroup)
    }
    return ungroupedGroup
  }

  if (registered.length > 0) {
    for (const ws of registered) {
      const path = typeof ws.path === 'string' && ws.path ? ws.path : UNKNOWN_CWD
      const title = typeof ws.title === 'string' && ws.title.trim() ? ws.title.trim() : null
      const group = {
        id: virtualWorkspaceId(hostId, ws.workspaceId),
        name: title || workspaceName(path),
        cwd: path,
        workspaceId: ws.workspaceId,
        ungrouped: false,
        order: registeredOrder.get(ws.workspaceId) ?? fallbackOrder++,
        sessions: [],
        // 远端注册时间：客户端主机分组行/悬停卡片要用，缺了会显示 1970。
        ...(typeof ws.createdAt === 'string' && ws.createdAt ? { createdAt: ws.createdAt } : {}),
      }
      groups.set(ws.workspaceId, group)
      list.push(group)
      const order = new Map()
      ;(Array.isArray(ws.sessionIds) ? ws.sessionIds : []).forEach((sid, index) => {
        if (typeof sid !== 'string' || sid === '') return
        order.set(sid, index)
        bySession.set(sid, group)
      })
      orderOf.set(ws.workspaceId, order)
    }
  }

  for (const item of Array.isArray(items) ? items : []) {
    if (item == null || typeof item !== 'object') continue
    if (item.origin === 'subagent') continue
    const rawId = item.sessionId
    if (typeof rawId !== 'string' || rawId === '') continue
    const cwd = typeof item.cwd === 'string' && item.cwd ? item.cwd : UNKNOWN_CWD

    let group
    if (registered.length > 0) {
      group = bySession.get(rawId) ?? makeUngrouped()
    } else {
      group = byCwd.get(cwd)
      if (!group) {
        group = {
          id: virtualWorkspaceId(hostId, cwd),
          name: workspaceName(cwd),
          cwd,
          workspaceId: null,
          ungrouped: false,
          order: fallbackOrder++,
          sessions: [],
        }
        byCwd.set(cwd, group)
        list.push(group)
      }
    }

    group.sessions.push({
      id: virtualSessionId(hostId, rawId),
      rawId,
      title: titleOf(item),
      lastActivityAt: Number(item.updatedAt) || 0,
      running: item.running === true,
      blank: item.blank === true,
      archived: archivedSet.has(rawId),
      pinned: pinnedSet.has(rawId),
    })
  }

  for (const group of list) {
    const order = group.workspaceId ? orderOf.get(group.workspaceId) : null
    group.sessions.sort((a, b) => {
      const pa = order?.has(a.rawId) ? order.get(a.rawId) : Number.MAX_SAFE_INTEGER
      const pb = order?.has(b.rawId) ? order.get(b.rawId) : Number.MAX_SAFE_INTEGER
      return pa - pb || b.lastActivityAt - a.lastActivityAt
    })
  }
  // 组按最近活动倒序；空组（0 会话）自然沉底，稳定排序保留注册表顺序
  list.sort((a, b) => latestActivity(b) - latestActivity(a))
  return list
}

function latestActivity(group) {
  return group.sessions.length > 0 ? group.sessions[0].lastActivityAt : 0
}

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
 * 组按「最近活动」倒序，组内也按最近活动倒序。
 */
export function groupSessions(hostId, items) {
  const groups = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    if (item == null || typeof item !== 'object') continue
    const rawId = item.sessionId
    if (typeof rawId !== 'string' || rawId === '') continue
    const cwd = typeof item.cwd === 'string' && item.cwd ? item.cwd : UNKNOWN_CWD
    let group = groups.get(cwd)
    if (!group) {
      group = {
        id: virtualWorkspaceId(hostId, cwd),
        name: workspaceName(cwd),
        cwd,
        sessions: [],
      }
      groups.set(cwd, group)
    }
    group.sessions.push({
      id: virtualSessionId(hostId, rawId),
      rawId,
      title: titleOf(item),
      lastActivityAt: Number(item.updatedAt) || 0,
      running: item.running === true,
      blank: item.blank === true,
    })
  }

  const list = [...groups.values()]
  for (const group of list) {
    group.sessions.sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  }
  list.sort((a, b) => latestActivity(b) - latestActivity(a))
  return list
}

function latestActivity(group) {
  return group.sessions.length > 0 ? group.sessions[0].lastActivityAt : 0
}

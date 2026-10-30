/**
 * 远端会话级的普通 HTTP 路由白名单。
 *
 * 官方 `@deepseek-ai/dsh-client-ui-deliverables` 不用 RPC，而是用普通 `fetch`
 * 读两条按会话寻址的路由：
 *
 *   GET /api/changes.summary?sessionId=<id>&seq=<n>          本轮改动摘要
 *   GET /api/changes.diff?sessionId=<id>&seq=<n>&index=<n>   单个文件的对比
 *
 * 摘要与对比只存在**记录它的那个 Host 进程**里（`ctx.workspaceChanges`），
 * 所以联邦视图里看远端会话时，本机这两条路由必然 404，官方「已编辑 N 个文件」
 * 卡片于是完全不出现。`connection.fetch.register` 对同一路径会抛
 * `already registered`（见 lib/index.js 的 asset 路由注释），插件没法覆盖它们，
 * 只能由宿主半按 Host 转发。
 *
 * 这张白名单就是转发面的全部：两条只读路由，不接受任意路径。
 */

export const ASSET_PATHS = new Set(['/api/changes.summary', '/api/changes.diff'])

// 浏览器给的 path 是 pathname + search，正常不到 200 字符；留足余量挡住垃圾输入。
const MAX_TARGET_LENGTH = 2048
const PROBE_ORIGIN = 'http://peerbar.invalid'

/**
 * 校验客户端给的 `?path=`。
 *
 * 只接受「本文件的 pathname + search」：绝对 URL、协议相对地址、别的 origin、
 * 白名单之外的路径、带 hash 的都拒。返回值直接拼到 `host.origin` 后面用。
 *
 * @param {unknown} raw
 * @returns {{ ok: true, value: string } | { ok: false, reason: string }}
 */
export function readAssetTarget(raw) {
  if (typeof raw !== 'string' || raw === '' || raw.length > MAX_TARGET_LENGTH) {
    return { ok: false, reason: 'bad-path' }
  }
  // 显式挡掉协议相对与绝对地址：`new URL` 会把它们解析成别的 origin，
  // 下面虽然也会拒，但先拒一步读起来更清楚。
  if (!raw.startsWith('/') || raw.startsWith('//')) return { ok: false, reason: 'bad-path' }
  let url
  try {
    url = new URL(raw, PROBE_ORIGIN)
  } catch {
    return { ok: false, reason: 'bad-path' }
  }
  if (url.origin !== PROBE_ORIGIN) return { ok: false, reason: 'bad-path' }
  if (url.hash !== '') return { ok: false, reason: 'bad-path' }
  if (!ASSET_PATHS.has(url.pathname)) return { ok: false, reason: 'path-not-allowed' }
  return { ok: true, value: `${url.pathname}${url.search}` }
}

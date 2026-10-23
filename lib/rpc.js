/**
 * 远端 RPC 白名单：`POST /hosts/<id>/rpc` 只放行这张表里的端点。
 *
 * 流式端点（workspace/follow、session/follow、session/control、$events）不在此列——
 * 它们只能走 WS mux（见 remote.js fetchWorkspaceBaseline），HTTP RPC 信封会
 * `gateway/signature-invalid`。directoryPicker 等与多机无关的能力也不放行。
 */

export const RPC_ALLOWLIST = new Set([
  // 会话（读已在 /session 路由，这里放写与模型）
  'session/create',
  'session/prompt',
  'session/cancel',
  'session/updateQueue',
  'session/fork',
  'session/rename',
  'session/selectModel',
  'session/modelCatalog',
  // 工作区
  'workspace/create',
  'workspace/rename',
  'workspace/delete',
  'workspace/archiveSession',
  'workspace/unarchiveSession',
  'workspace/pinSession',
  'workspace/unpinSession',
  'workspace/insertBefore',
  'workspace/insertSessionBefore',
])

export function isAllowedRpc(endpoint) {
  return typeof endpoint === 'string' && RPC_ALLOWLIST.has(endpoint)
}

/** args 必须是普通对象（可省略）；数组、原始值、null 都拒。 */
export function isPlainArgs(args) {
  if (args === undefined) return true
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return false
  const proto = Object.getPrototypeOf(args)
  return proto === Object.prototype || proto === null
}

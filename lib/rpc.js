/**
 * 远端 RPC 白名单：`POST /hosts/<id>/rpc` 只放行这张表里的端点。
 *
 * 流式端点（workspace/follow、session/follow、session/control、$events）不在此列——
 * 它们只能走 WS mux（见 stream.js readWorkspaceBaseline），HTTP RPC 信封会
 * `gateway/signature-invalid`。directoryPicker 只放行只读的 list（选远端目录用），
 * pick（弹远端桌面对话框）与 createDirectory 不放行。
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
  // 远端目录浏览（只读；用于「添加远端工作区」选目录）
  // 注意 pick 会弹远端桌面对话框，不放行；createDirectory 暂未接 UI，也不放行。
  'directoryPicker/list',
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

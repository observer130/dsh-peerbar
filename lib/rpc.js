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
  // 会话附件（只读）：消息里的图片按 attachmentId 取回 base64
  'session/attachment',
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
  // 远端文件上传（非图片附件）。参数是 lookup 形状：
  //   { agentId: <sessionId>, request: { data: <base64>, name } }
  // 返回 { receiptId, file }；receiptId 只在该会话作用域内有效。
  'fileUploads/upload',
  // T4 远端斜杠命令（lookup 参数 agentId）
  'commands/list',
  'commands/execute',
  // T17 远端工作区文件（只读；lookup 参数 workspaceFileScopeId）
  // read 的 range 是严格必填（可 {}）。
  'workspaceFiles/list',
  'workspaceFiles/read',
  // 文本预览走 read；图片/PDF/Office 的字节走 readBytes（multipart → base64）
  'workspaceFiles/readBytes',
  'workspaceFiles/stat',
  // 「@」补全与命令面板的候选源（都只读）：
  //   fileReferences/list                   {agentId, query}  → [{path, kind}]
  //   sessionReferenceResolver/candidates   {agentId, query}  → [{mention, ...}]
  //   skills/list                           {request:{sessionId}} → {skills:[...]}
  'fileReferences/list',
  'sessionReferenceResolver/candidates',
  'skills/list',
  // 远端终端（unary 部分）。双工的 `terminal/attach|retain` 不在这里——
  // 它们只能走 `lib/terminal.js` 的 WS 代理，HTTP 信封会被网关拒绝。
  'terminal/environment',
  'terminal/shells',
  'terminal/list',
  'terminal/create',
  'terminal/rename',
  'terminal/close',
  // 定时任务：右侧栏任务页签按会话读 list/history；update/delete 是详情页操作。
  // 全局 `schedule/catalog` 不代理——它是跨会话视图，路由到哪台 Host 都不对。
  'schedule/catalog',
  'schedule/list',
  'schedule/history',
  'schedule/update',
  'schedule/delete',
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

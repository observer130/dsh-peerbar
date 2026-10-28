/**
 * dsh-peerbar — 浏览器半（ADR-001 路线，v5 现状）。
 *
 * 两个注册点：
 *   1. `sidebar.workspaces`（single，`priority: -1` 影子替换官方）：本机 + 远端混排的同一棵树；
 *   2. `settings.section`：Host 登记 / 探活 / 凭据。
 *
 * 远端会话**不注册自己的 main 面板**：点行时合成 SessionBinding 注册进 ISessions，
 * 再调官方 `uiWorkspace.openSession(rawId)`；中栏、composer、模型座全部复用原生。
 *
 * 本机数据一律走 slot 传入的 `useWorkspaces` / `useSessions`，不另拉接口；
 * 远端数据走同源 `/dsh-peerbar/api/*`。
 */

window.__ModuleLoader__.load({
  id: 'dsh-peerbar',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    // 官方组件（Markdown、图标、按钮）与官方 CSS 类名；不可用时降级。
    let primitives = null
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    } catch (error) {
      console.warn('[peerbar] primitives 不可用，正文回退纯文本', error)
    }

    function prim(name, props) {
      const Component = primitives?.[name]
      return Component ? React.createElement(Component, props) : null
    }

    const NS = 'dsh-peerbar'
    const API = '/dsh-peerbar/api'
    const BUILD = '2026-10-28-a'
    const STYLE_ID = 'dsh-peerbar-style'
    const COLLAPSED_KEY = 'dsh-peerbar.collapsed'
    const VIEW_KEY = 'dsh-peerbar.view'
    const VIEW_DEFAULTS = Object.freeze({ groupBy: 'workspace', orderBy: 'updated', archived: 'default' })


    const HOST_COLORS = ['teal', 'blue', 'purple', 'orange', 'pink', 'green']
    const HOST_PALETTE = {
      teal: '#1f9d8f',
      blue: '#3b82f6',
      purple: '#8b5cf6',
      orange: '#f59e0b',
      pink: '#ec4899',
      green: '#22c55e',
    }

    //#region 文案

    const zh = {
      'tree.title': '工作区',
      'tree.sessions': '会话',
      'tree.search': '搜索会话',
      'tree.searchClear': '清除搜索',
      'tree.searchPlaceholder': '搜索会话名称',
      'tree.empty': '暂无会话',
      'tree.noMatch': '无匹配会话',
      'tree.newSession': '新会话',
      'tree.addWorkspace': '添加工作区',
      'tree.workspaceAdded': '已添加工作区',
      'picker.title': '选择工作区目录',
      'picker.local': '本机',
      'picker.home': '主目录',
      'picker.loading': '正在读取…',
      'picker.empty': '没有子目录',
      'picker.truncated': '目录过多，仅显示前一部分',
      'picker.showHidden': '显示隐藏文件',
      'picker.remoteHint': '在 {host} 上创建工作区',
      'picker.nativeHint': '当前平台使用系统目录对话框，无法在应用内浏览本机目录。',
      'picker.pickFolder': '选择目录…',
      'tree.offline': '{host} 连不上',
      'tree.cached': '缓存',
      'tree.remoteError': '远程工作区数据读取失败',
      'tree.reorderFailed': '排序失败：{reason}',
      'tree.nativeFailed': '原生渲染失败，稍后重试',
      'session.untitled': '未命名',
      'session.new': '新会话',
      'session.running': '运行中',
      'panel.back': '返回对话',
      'panel.loading': '读取正文…',
      'panel.empty': '这个会话还没有可读的消息',
      'panel.loadEarlier': '加载更早的消息',
      'panel.start': '已经到最早的消息了',
      'section.peers': '远程工作区',
      'section.hint': '在这里登记远程 dsh 主机；登记后，本机会用启动令牌换取一个 30 天有效的 cookie，用于读取和管理远程工作区与会话。',
      'section.registered': '已登记',
      'field.name': '名称',
      'field.origin': '地址',
      'field.token': '访问令牌',
      'field.tokenHint': '远端 dsh 启动时打印的 ?token= 后面的那串；只在换 cookie 时用一次。',
      'field.tokenPlaceholder': '粘贴远端打印的令牌',
      'field.insecure': '跳过证书校验（仅内网自签）',
      'field.enabled': '启用',
      'field.color': '颜色',
      'action.add': '添加',
      'action.save': '保存',
      'action.cancel': '取消',
      'action.open': '打开',
      'action.delete': '删除',
      'action.confirmDelete': '确认删除',
      'action.probe': '立即探活',
      'action.showToken': '改令牌',
      'tree.overflow': '展开其余 {n} 个会话',
      'tree.collapse': '收起',
      'tree.ungrouped': '未分组',
      'tree.registryDegraded': '{host} 的工作区信息读取失败（{reason}），重命名/删除暂不可用，下次探活会自动重试',
      'tree.compatMismatch': '{host} 的 dsh 版本可能与插件不兼容（{reason}），部分功能可能不可用',
      'notice.remoteFile': '「{path}」在远端 {host} 上，本机没有这个文件（可在右侧「文件」面板查看）',
      'notice.remoteBrowser': '「{url}」是远端 {host} 上的本地地址，本机打不开；已复制，请在远端浏览器打开',
      'notice.remoteBrowserBlank': '浏览器面板在本机渲染，显示不了 {host} 上的页面；请在远端启动服务后用可直连地址打开（本插件不做端口转发）',
      'action.rename': '重命名',
      'menu.pin': '置顶会话',
      'menu.unpin': '取消置顶',
      'menu.rename': '重命名',
      'menu.fork': '分叉会话',
      'menu.archive': '归档会话',
      'menu.unarchive': '取消归档',
      'menu.copyId': '复制 Session ID',
      'menu.renameWorkspace': '重命名',
      'menu.sessionAria': '会话“{name}”的操作',
      'menu.workspaceAria': '工作区“{name}”的操作',
      'viewOptions.label': '视图选项',
      'groupBy.label': '分组方式',
      'groupBy.workspace': '按工作区',
      'groupBy.flat': '单列表',
      'orderBy.label': '排序方式',
      'orderBy.manual': '手动排序',
      'orderBy.updated': '最近更新',
      'filterBy.label': '筛选会话',
      'viewOptions.hideArchived': '隐藏已归档',
      'viewOptions.showArchived': '全部对话（显示已归档）',
      'viewOptions.onlyArchived': '仅显示已归档',
      'time.now': '刚刚',
      'time.minute': '{n}分钟',
      'time.hour': '{n}小时',
      'time.day': '{n}天',
      'row.pinned': '已置顶',
      'dialog.renameSession': '重命名会话',
      'dialog.renameWorkspace': '重命名工作区',
      'dialog.deleteWorkspace': '删除工作区',
      'dialog.deleteWorkspaceDesc': '将把“{name}”从工作区列表中移除。文件夹与会话记录会保留，其会话将显示在“未分组”下。',
      'field.sessionName': '会话名称',
      'field.workspaceName': '工作区名称',
      'menu.deleteWorkspace': '删除工作区',
      'action.remoteReadOnly': '工作区信息未就绪（baseline 缺失），稍后重试',
      'action.moveUp': '上移',
      'action.moveDown': '下移',
      'state.online': '在线',
      'state.auth-required': '需要令牌',
      'state.unreachable': '连不上',
      'state.tls-error': '证书不受信',
      'state.not-dsh': '不是 dsh',
      'state.incompatible': '版本不兼容',
      'state.timeout': '超时',
      'state.disabled': '已停用',
      'hint.noCookie': '尚未换取 cookie',
      'empty.hosts': '还没有登记任何远程主机',
      'msg.badOrigin': '地址格式不对，示例：https://10.0.0.10:3080',
      'msg.added': '已添加，正在探活',
    }

    const en = {
      'tree.title': 'Workspaces',
      'tree.sessions': 'Sessions',
      'tree.search': 'Search sessions',
      'tree.searchClear': 'Clear search',
      'tree.searchPlaceholder': 'Search session names',
      'tree.empty': 'No sessions yet',
      'tree.noMatch': 'No matching sessions',
      'tree.newSession': 'New session',
      'tree.addWorkspace': 'Add workspace',
      'tree.workspaceAdded': 'Workspace added',
      'picker.title': 'Choose a workspace folder',
      'picker.local': 'This machine',
      'picker.home': 'Home',
      'picker.loading': 'Loading…',
      'picker.empty': 'No subfolders',
      'picker.truncated': 'Too many folders; only the beginning is shown',
      'picker.showHidden': 'Show hidden files',
      'picker.remoteHint': 'Create the workspace on {host}',
      'picker.nativeHint': 'This platform uses the system folder dialog; in-app browsing of local folders is unavailable.',
      'picker.pickFolder': 'Choose folder…',
      'tree.offline': '{host} is unreachable',
      'tree.cached': 'cached',
      'tree.remoteError': 'Failed to read remote workspace data',
      'tree.reorderFailed': 'Reorder failed: {reason}',
      'tree.nativeFailed': 'Native rendering failed, retry later',
      'session.untitled': 'Untitled',
      'session.new': 'New session',
      'session.running': 'Running',
      'panel.back': 'Back to chat',
      'panel.loading': 'Loading transcript…',
      'panel.empty': 'No readable messages in this session',
      'panel.loadEarlier': 'Load earlier messages',
      'panel.start': 'Beginning of the session',
      'section.peers': 'Remote workspaces',
      'section.hint': 'Register remote dsh hosts here. The token printed by a remote host is exchanged for a 30-day cookie used to read and manage its workspaces and sessions.',
      'section.registered': 'Registered',
      'field.name': 'Name',
      'field.origin': 'Origin',
      'field.token': 'Access token',
      'field.tokenHint': 'The part after ?token= in the URL the remote dsh printed. Used once to exchange for a cookie.',
      'field.tokenPlaceholder': 'Paste the token printed by the remote',
      'field.insecure': 'Skip certificate check (self-signed LAN only)',
      'field.enabled': 'Enabled',
      'field.color': 'Color',
      'action.add': 'Add',
      'action.save': 'Save',
      'action.cancel': 'Cancel',
      'action.open': 'Open',
      'action.confirmDelete': 'Confirm',
      'action.probe': 'Probe now',
      'action.showToken': 'Change token',
      'tree.overflow': 'Show {n} more sessions',
      'tree.collapse': 'Collapse',
      'tree.ungrouped': 'Ungrouped',
      'tree.registryDegraded': 'Workspaces on {host} could not be read ({reason}). Rename/delete is unavailable; the next probe retries automatically.',
      'tree.compatMismatch': 'The dsh version on {host} may be incompatible with this plugin ({reason}); some features may not work.',
      'notice.remoteFile': '"{path}" lives on the remote host {host}; this machine has no such file (open it from the Files panel on the right).',
      'notice.remoteBrowser': '"{url}" is a local address on {host} and cannot open here; copied — open it in a browser on that machine',
      'notice.remoteBrowserBlank': 'The browser panel renders locally and cannot show pages on {host}. Start the service there and open an address this machine can reach (no port forwarding).',
      'action.rename': 'Rename',
      'action.delete': 'Delete',
      'menu.pin': 'Pin session',
      'menu.unpin': 'Unpin session',
      'menu.rename': 'Rename',
      'menu.fork': 'Fork session',
      'menu.archive': 'Archive session',
      'menu.unarchive': 'Unarchive',
      'menu.copyId': 'Copy session ID',
      'menu.renameWorkspace': 'Rename',
      'menu.sessionAria': 'Session actions for {name}',
      'menu.workspaceAria': 'Workspace actions for {name}',
      'viewOptions.label': 'View options',
      'groupBy.label': 'Group by',
      'groupBy.workspace': 'By workspace',
      'groupBy.flat': 'Flat list',
      'orderBy.label': 'Sort by',
      'orderBy.manual': 'Manual order',
      'orderBy.updated': 'Recently updated',
      'filterBy.label': 'Filter sessions',
      'viewOptions.hideArchived': 'Hide archived',
      'viewOptions.showArchived': 'Show archived',
      'viewOptions.onlyArchived': 'Only archived',
      'time.now': 'just now',
      'time.minute': '{n} min',
      'time.hour': '{n} h',
      'time.day': '{n} d',
      'row.pinned': 'Pinned',
      'dialog.renameSession': 'Rename session',
      'dialog.renameWorkspace': 'Rename workspace',
      'dialog.deleteWorkspace': 'Delete workspace',
      'dialog.deleteWorkspaceDesc': 'Removes "{name}" from the workspace list. Files and sessions are kept; its sessions appear under “Ungrouped”.',
      'field.sessionName': 'Session name',
      'field.workspaceName': 'Workspace name',
      'menu.deleteWorkspace': 'Delete workspace',
      'action.remoteReadOnly': 'Workspace info not ready (baseline missing), try again',
      'action.moveUp': 'Move up',
      'action.moveDown': 'Move down',
      'state.online': 'Online',
      'state.auth-required': 'Token required',
      'state.unreachable': 'Unreachable',
      'state.tls-error': 'Untrusted certificate',
      'state.not-dsh': 'Not dsh',
      'state.incompatible': 'Incompatible',
      'state.timeout': 'Timeout',
      'state.disabled': 'Disabled',
      'hint.noCookie': 'No cookie yet',
      'empty.hosts': 'No remote hosts registered yet',
      'msg.badOrigin': 'Invalid origin, e.g. https://10.0.0.10:3080',
      'msg.added': 'Added, probing…',
    }

    let translate = (key) => key

    function tr(key, params) {
      let text
      try {
        text = translate(key)
      } catch {
        text = key
      }
      if (typeof text !== 'string' || text === key) text = zh[key] ?? en[key] ?? key
      if (!params) return text
      return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
    }

    //#endregion

    //#region 数据

    async function request(path, options = {}) {
      const response = await fetch(`${API}${path}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        ...options,
        headers: {
          ...(options.body ? { 'content-type': 'application/json', 'x-dsh-peerbar-action': '1' } : {}),
          ...(options.headers ?? {}),
        },
      })
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok || payload?.ok === false) {
        const message = payload?.message || `HTTP ${response.status}`
        throw Object.assign(new Error(message), { code: payload?.code })
      }
      return payload
    }

    /**
     * 带 cookie 自愈的远端取数口（T8）。
     *
     * cookie 过期时宿主半返回 `auth-required`，用户点「发送/归档」会瞬间看到失败
     * （虽然 5s 探活随后会自愈）。这里捕获该码后先**立刻探活换 cookie**再重试一次，
     * 仍失败才把错误交给调用方。只重试一次，避免放大请求。
     */
    async function remoteFetch(hostId, path, options = {}, { retried = false } = {}) {
      try {
        return await request(path, options)
      } catch (error) {
        if (!retried && error?.code === 'auth-required' && hostId) {
          try {
            // 宿主半的探活遇到 AUTH_REQUIRED 会自动 exchangeCookie
            await request(`/hosts/${encodeURIComponent(hostId)}/probe`, { method: 'POST' })
          } catch {
            /* 探活失败就按原错误抛，别把探活的错盖掉真正原因 */
          }
          return remoteFetch(hostId, path, options, { retried: true })
        }
        throw error
      }
    }

    /**
     * 只读端点：不触发「写后同步」（浏览目录时每点一次都探活太重）。
     * 其余端点由宿主半在 RPC 成功后回写快照（peers.applyLocalEcho），
     * 客户端只需重拉 `/state`。
     */
    const REMOTE_READ_ENDPOINTS = new Set([
      'directoryPicker/list',
      'session/modelCatalog',
      // 每次渲染一张远端图片都会读一次，绝不能触发写后同步
      'session/attachment',
    ])

    /** 远端写操作（走白名单 RPC 代理），返回 `value`；失败抛错 */
    async function remoteRpc(hostId, endpoint, args) {
      const result = await remoteFetch(hostId, `/hosts/${encodeURIComponent(hostId)}/rpc`, {
        method: 'POST',
        body: JSON.stringify({ endpoint, args: args ?? {} }),
      })
      return result?.value
    }

    /**
     * 远端会话标题对账（T10）。
     *
     * 主视图标题 / 文档标题读的是 `binding.summary`，它只在 openRemote 时构造一次；
     * `/state` 刷新拿到新名字后如果不回写，标题会停在打开时的旧名，必须重开会话。
     * 这里按 rawId 找到对应 binding，把最新标题写回去。
     */
    const remoteBindings = new Map()

    /**
     * 远端会话的运行/未读状态（对齐官方的 completionUnread 语义）：
     * - 观察 running 的 true → false 转变；转变时不是当前主视图 → 未读
     * - 成为主视图（打开）立即清未读；running=true 也清
     * - 会话从 /state 消失时丢弃记录
     * 官方不持久化未读，这里同样只存内存，刷新后从当前状态重新观察。
     */
    const remoteStatus = new Map()

    const isRemoteMain = (rawId) => {
      const binding = remoteBindings.get(rawId)
      return (binding?.retention?.info?.retainedBy?.mainView ?? 0) > 0
    }

    function syncRemoteStatus(state) {
      const seen = new Set()
      for (const host of state?.hosts ?? []) {
        for (const workspace of host.workspaces ?? []) {
          for (const session of workspace.sessions ?? []) {
            if (session.blank) continue
            const rawId = session.rawId
            if (typeof rawId !== 'string' || !rawId) continue
            seen.add(rawId)
            const running = session.running === true
            const previous = remoteStatus.get(rawId)
            let unread = previous?.unread === true
            if (previous === undefined) {
              unread = false
            } else if (previous.running !== running) {
              if (running) unread = false
              else if (!isRemoteMain(rawId)) unread = true
            }
            if (isRemoteMain(rawId) || running) unread = false
            remoteStatus.set(rawId, { running, unread })
          }
        }
      }
      for (const rawId of [...remoteStatus.keys()]) {
        if (!seen.has(rawId)) remoteStatus.delete(rawId)
      }
    }

    function markRemoteRead(rawId) {
      const status = remoteStatus.get(rawId)
      if (!status || status.unread !== true) return
      status.unread = false
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('peerbar:status'))
    }

    function syncRemoteSummaries(state) {
      if (!state || remoteBindings.size === 0) return
      for (const host of state.hosts ?? []) {
        for (const workspace of host.workspaces ?? []) {
          for (const session of workspace.sessions ?? []) {
            const binding = remoteBindings.get(session.rawId)
            if (!binding || typeof binding.updateSummary !== 'function') continue
            binding.updateSummary({
              title: session.blank ? tr('session.new') : session.title || tr('session.untitled'),
              displayTitle: session.title || workspace.name || session.rawId,
              updatedAt: session.lastActivityAt,
              running: session.running === true,
              blank: session.blank === true,
            })
          }
        }
      }
    }

    /**
     * 解析官方文件地址（`dsh-resource://file/session/<sid>/<path>`）。
     * 见 dsh-client-ui-reference 的 `sessionFileAddress`：sessionId 与路径各自
     * encodeSegment/encodePath，所以这里整体 decode。
     */
    const FILE_ADDRESS_PREFIX = 'dsh-resource://file/session/'
    function parseFileAddress(address) {
      if (typeof address !== 'string' || !address.startsWith(FILE_ADDRESS_PREFIX)) return null
      const rest = address.slice(FILE_ADDRESS_PREFIX.length)
      const slash = rest.indexOf('/')
      const rawSessionId = slash < 0 ? rest : rest.slice(0, slash)
      const rawPath = slash < 0 ? '' : rest.slice(slash + 1)
      const decode = (value) => {
        try {
          return decodeURIComponent(value)
        } catch {
          return value
        }
      }
      if (!rawSessionId) return null
      return { sessionId: decode(rawSessionId), path: decode(rawPath) }
    }

    function usePeerState(intervalMs = 5000) {
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState(null)

      const load = React.useCallback(async () => {
        if (document.visibilityState === 'hidden') return
        try {
          const next = await request('/state')
          syncRemoteSummaries(next)
          syncRemoteStatus(next)
          setState(next)
          setError(null)
          return true
        } catch (cause) {
          setError(cause)
          return false
        }
      }, [])

      React.useEffect(() => {
        let alive = true
        const guarded = async () => {
          if (!alive) return
          await load()
        }
        void guarded()
        const timer = setInterval(guarded, intervalMs)
        const onVisible = () => {
          if (document.visibilityState === 'visible') void guarded()
        }
        // 别处（添加远端工作区对话框）改完远端状态后广播，避免等下一轮 5s 轮询
        const onPeerbarRefresh = () => {
          void guarded()
        }
        document.addEventListener('visibilitychange', onVisible)
        window.addEventListener('peerbar:refresh', onPeerbarRefresh)
        return () => {
          alive = false
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
          window.removeEventListener('peerbar:refresh', onPeerbarRefresh)
        }
      }, [intervalMs, load])

      // 变更操作后立即拉新，不等下一轮轮询
      return { state, error, refresh: load }
    }

    /**
     * 向上翻页的单页预算：与官方 loadOlder 的 turnWindow.minMessages 对齐，
     * 远端会在 Turn 边界收页（实际返回可能略多）。
     */
    const HISTORY_PAGE_SIZE = 50

    /**
     * base64 → 字节数组。
     *
     * 官方图片缓存的契约是 `readAttachment()` 返回 `{attachment, data: number[]}`
     * （它自己做 `Uint8Array.from(data)` 再转 Blob URL），而远端
     * `session/attachment` 给的是 base64 字符串，这里做一次转换。
     */
    function base64ToBytes(base64) {
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      return Array.from(bytes)
    }

    /**
     * File → base64（去掉 data URL 前缀）。
     *
     * 远端 `fileUploads/upload` 收 base64 而不是 multipart；官方 composer 的
     * 上传服务收的是 File，所以这里做一次转换。
     */
    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const text = String(reader.result ?? '')
          const comma = text.indexOf(',')
          resolve(comma >= 0 ? text.slice(comma + 1) : text)
        }
        reader.onerror = () => reject(reader.error ?? new Error('读取待上传文件失败'))
        reader.readAsDataURL(file)
      })
    }

    /**
     * 纯通知：敲一下 list store 让 `useSessions` 订阅者重算。
     * 用于切换会话（retain 路径）——内容由 getSnapshot 重新合并，这里只求一次通知。
     */
    function notifySessionList(ctx) {
      try {
        const sessions = typeof ctx?.get === 'function' ? ctx.get('sessions') : ctx?.sessions
        const listObj = sessions?.list
        if (listObj?.set && listObj?.getSnapshot) listObj.set({ ...listObj.getSnapshot() })
      } catch {
        /* Immer 不接受就跳过，别阻塞交互 */
      }
    }

    /**
     * 触发 `useSessions` 的订阅者（publishMain / ui-layout 的 DocumentTitle）。
     *
     * 远端绑定不走 `publishRetention`，内部的 `list.set` 也就不会发生，
     * 于是 `useSessions(selector)` 的订阅者不会重算——表现为主视图标题 /
     * 浏览器标题冻结在旧值。这里按官方 `publishRetention` 的形状更新那一行
     * （纯数据浅拷贝），Immer 才接受。
     *
     * 返回是否成功落到 store。
     */
    function patchListRow(ctx, sessionId, patch) {
      try {
        const sessions = typeof ctx?.get === 'function' ? ctx.get('sessions') : ctx?.sessions
        const listObj = sessions?.list
        if (!listObj?.set || !listObj?.getSnapshot) return false
        const state = listObj.getSnapshot()
        const row = state.byId?.[sessionId]
        if (!row) return false
        const nextRow = { ...row }
        let changed = false
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined || nextRow[key] === value) continue
          nextRow[key] = value
          changed = true
        }
        if (!changed) return false
        listObj.set({ ...state, byId: { ...state.byId, [sessionId]: nextRow } })
        return true
      } catch {
        return false
      }
    }

    /**
     * 兜底：store 不接受时直接改浏览器标题。
     * ui-layout 的 DocumentTitle 只在 selector 变化时重写，所以这一改能留住。
     */
    function patchDocumentTitle(title) {
      try {
        if (!title) return
        const current = document.title
        const sep = current.indexOf(' — ')
        const product = sep > 0 ? current.slice(sep) : ''
        document.title = `${title}${product}`
      } catch {
        /* 忽略 */
      }
    }

    /**
     * 合成 SessionBinding：records → SessionEventWindow + 可写的 SessionFace。
     *
     * P4：prompt/cancel/updateQueue 走 /hosts/<id>/rpc 白名单代理，发到远端真跑；
     * beginSubmission 按官方语义挂本地 echo（placement 区分 queued/steering/transcript），
     * 轮询观察到对应 user/message 后退役。
     * P5：挂增量轮询（2s，运行中 1s，页面隐藏暂停），新 records 以 append 入窗。
     * P6：faceOf('modelSelection') 喂 projections 的真实投影。
     * v5：窗口维护 firstSeq，实现 loadOlder/loadThrough（prepend 更早的页）。
     */
    function createRemoteBinding({ ctx, hostId, hostName, sessionId, records, summary, values, hasMore }) {
      const toEntries = (list) =>
        (list ?? [])
          .map((record) => (record && record.event ? { type: 'event', event: record.event } : null))
          .filter(Boolean)
      const seqOf = (entry) => Number(entry?.event?.seq) || 0
      const entries = toEntries(records)
      // ---- 事件窗（可变，订阅者通知；缓存对象防 React #185） ----
      const windowListeners = new Set()
      let windowSnapshot = {
        entries,
        hasMore: hasMore === true,
        revision: 1,
        change: { kind: 'replace', entries },
      }
      let lastSeq = entries.reduce((max, entry) => Math.max(max, seqOf(entry)), 0)
      // 窗口里最早的一条（向上翻页的排他上界）；空窗为 null
      let firstSeq = entries.reduce((min, entry) => {
        const seq = seqOf(entry)
        if (!seq) return min
        return min === null ? seq : Math.min(min, seq)
      }, null)
      const notifyWindow = () => {
        for (const fn of [...windowListeners]) fn()
      }
      const replaceEntries = (nextEntries) => {
        const nextFirst = nextEntries.reduce((min, entry) => {
          const seq = seqOf(entry)
          if (!seq) return min
          return min === null ? seq : Math.min(min, seq)
        }, null)
        windowSnapshot = {
          entries: nextEntries,
          // 整窗换成 tail 页后，更早的历史一定还在（除非已到 seq=1）
          hasMore: nextFirst !== null && nextFirst > 1,
          revision: windowSnapshot.revision + 1,
          change: { kind: 'replace', entries: nextEntries },
        }
        lastSeq = nextEntries.reduce((max, entry) => Math.max(max, seqOf(entry)), 0)
        firstSeq = nextFirst
        syncSessionPaging()
        notifyWindow()
      }
      const appendRecords = (newRecords) => {
        const added = toEntries(newRecords)
        if (added.length === 0) return
        windowSnapshot = {
          entries: [...windowSnapshot.entries, ...added],
          hasMore: windowSnapshot.hasMore,
          revision: windowSnapshot.revision + 1,
          change: { kind: 'append', entries: added },
        }
        lastSeq = added.reduce((max, entry) => Math.max(max, seqOf(entry)), lastSeq)
        if (firstSeq === null) firstSeq = added.reduce((min, entry) => Math.min(min, seqOf(entry)), Infinity)
        syncSessionPaging()
        notifyWindow()
      }
      // 向上翻页：older 是**更早**的一页，拼在窗口前面（官方 assembler 的 prepend 语义）
      const prependEntries = (olderEntries, olderHasMore) => {
        if (olderEntries.length === 0) {
          windowSnapshot = {
            ...windowSnapshot,
            hasMore: false,
            revision: windowSnapshot.revision + 1,
            change: { kind: 'prepend', entries: [] },
          }
          syncSessionPaging()
          notifyWindow()
          return
        }
        const nextFirst = olderEntries.reduce((min, entry) => {
          const seq = seqOf(entry)
          if (!seq) return min
          return min === null ? seq : Math.min(min, seq)
        }, null)
        windowSnapshot = {
          entries: [...olderEntries, ...windowSnapshot.entries],
          hasMore: olderHasMore === true,
          revision: windowSnapshot.revision + 1,
          change: { kind: 'prepend', entries: olderEntries },
        }
        firstSeq = nextFirst ?? firstSeq
        syncSessionPaging()
        notifyWindow()
      }
      const eventSource = {
        getSnapshot: () => windowSnapshot,
        subscribe: (fn) => {
          windowListeners.add(fn)
          return () => windowListeners.delete(fn)
        },
      }
      // ---- 投影面（P6：modelSelection 等） ----
      let projectionValues = values ?? null
      const projectionFaces = new Map()
      const projections = {
        faceOf: (key) => {
          if (!projectionFaces.has(key)) {
            const listeners = new Set()
            const face = {
              getSnapshot: () => projectionValues?.[key],
              subscribe: (fn) => {
                listeners.add(fn)
                return () => listeners.delete(fn)
              },
              __listeners: listeners,
            }
            projectionFaces.set(key, face)
          }
          return projectionFaces.get(key)
        },
      }
      const setProjectionValues = (nextValues) => {
        projectionValues = nextValues ?? projectionValues
        for (const face of projectionFaces.values()) {
          for (const fn of [...face.__listeners]) fn()
        }
      }
      // 持有计数必须是「活的」：ui-session 的 publishMain 靠
      // `retainedBy.mainView > 0` 判定主视图属于谁；写死 1 会让主视图永远
      // 锁在第一个打开的会话上（换会话就没反应）。
      // 持有计数用「替换语义」（与官方 retainScope 一致）：每次变更都换一个新的
      // retainedBy 对象。不能原地改——外部 publishRetention 会往 list 里写冻结的
      // EMPTY_RETAIN_INFO.retainedBy，把我们的活对象冻住，原地赋值就静默失败。
      const listeners = new Set()
      const counts = { mainView: 0 }
      // 用 getter 暴露 retainedBy：外部（Immer / list.set）会冻结对象，
      // 如果共享同一个引用，冻结后原地/替换赋值都会静默失败。
      // counts 是唯一真相，getter 每次返回新副本，冻不住计数。
      const info = {}
      Object.defineProperty(info, 'retainedBy', { get: () => ({ ...counts }), configurable: true })
      Object.defineProperty(info, 'referenceCount', {
        get: () => Object.values(counts).reduce((a, b) => a + b, 0),
        configurable: true,
      })
      info.version = 0
      let sessionSnapshot = null
      const sessionListeners = new Set()
      const publishSession = () => {
        sessionSnapshot = { ...sessionSnapshot, retainedBy: { ...counts } }
        for (const fn of [...sessionListeners]) fn()
      }
      const publish = () => {
        info.version += 1
        if (sessionSnapshot) sessionSnapshot.retainedBy = { ...counts }
        if (self.__pbVersion) self.__pbVersion.n += 1
        publishSession()
        for (const fn of [...listeners]) fn()
      }
      const retention = {
        info,
        listeners,
        retain(source) {
          if (source === 'mainView') counts.mainView = (counts.mainView ?? 0) + 1
          else if (source != null) counts[source] = (counts[source] ?? 0) + 1
          publish()
        },
        release(source) {
          if (source === 'mainView') counts.mainView = Math.max(0, (counts.mainView ?? 0) - 1)
          else if (source != null) counts[source] = Math.max(0, (counts[source] ?? 0) - 1)
          publish()
        },
      }
      sessionSnapshot = {
        sessionId,
        retainedBy: info.retainedBy,
        pendingSubmissions: [],
        running: false,
        subagent: null,
        removed: false,
        openState: 'open',
        openError: null,
        hasMore: hasMore === true,
        loadingOlder: false,
        promptError: null,
        blank: false,
        lastAgentError: null,
        promptAttempted: false,
        awaitingFirstTurn: false,
      }
      /** 事件窗的分页状态投影到会话快照（官方上滚触发器读的是 session.hasMore） */
      function syncSessionPaging() {
        if (!sessionSnapshot) return
        const nextHasMore = windowSnapshot.hasMore === true
        if (sessionSnapshot.hasMore !== nextHasMore) {
          sessionSnapshot = { ...sessionSnapshot, hasMore: nextHasMore }
          publishSession()
        }
      }
      // ---- 写操作（P4） ----
      const rpc = async (endpoint, args) => {
        if (!hostId) return { ok: false, error: { code: 'peerbar/no-host', message: '远端会话没有 hostId' } }
        try {
          const value = await remoteRpc(hostId, endpoint, args)
          // 宿主半已在 RPC 成功后回写快照（applyLocalEcho）：广播让侧栏立刻
          // 反映 running 点 / 最近活动排序 / 改名，不必等 5s 探活
          if (!REMOTE_READ_ENDPOINTS.has(endpoint)) {
            window.dispatchEvent(new CustomEvent('peerbar:refresh'))
          }
          return { ok: true, value }
        } catch (error) {
          return { ok: false, error: { code: error?.code ?? 'peerbar/rpc-failed', message: String(error?.message ?? error) } }
        }
      }
      // 结算回调单独放（官方契约：快照里的 pendingSubmissions 是纯数据，
      // onRetire 不进快照，避免序列化消费者踩到函数）
      const settlements = new Map()
      const retireSubmission = (requestId, reason = 'observed') => {
        const current = sessionSnapshot.pendingSubmissions ?? []
        const next = current.filter((item) => item.requestId !== requestId)
        if (next.length !== current.length) {
          sessionSnapshot = { ...sessionSnapshot, pendingSubmissions: next }
          publishSession()
        }
        const onRetire = settlements.get(requestId)
        settlements.delete(requestId)
        // 官方契约：带附件的发送会 await onRetire 的结算（reason==='observed' 才算成功）
        try {
          onRetire?.({ reason, requestId })
        } catch {
          /* 不阻塞 */
        }
      }
      const beginSubmission = (input) => {
        const requestId = crypto.randomUUID()
        const placement = sessionSnapshot.running
          ? input.mode === 'steer' ? 'steering' : 'queued'
          : 'transcript'
        if (typeof input.onRetire === 'function') settlements.set(requestId, input.onRetire)
        sessionSnapshot = {
          ...sessionSnapshot,
          pendingSubmissions: [
            ...(sessionSnapshot.pendingSubmissions ?? []),
            { requestId, placement, time: Date.now(), text: input.text, attachments: input.attachments },
          ],
          promptAttempted: true,
          awaitingFirstTurn: true,
        }
        publishSession()
        return {
          requestId,
          abandon: () => {
            retireSubmission(requestId, 'failed')
            sessionSnapshot = { ...sessionSnapshot, awaitingFirstTurn: false }
            publishSession()
          },
        }
      }
      const prompt = async (content, mode, signal, requestId) => {
        sessionSnapshot = { ...sessionSnapshot, promptError: null, lastAgentError: null, promptAttempted: true }
        publishSession()
        const result = await rpc('session/prompt', {
          request: {
            requestId: requestId ?? crypto.randomUUID(),
            sessionId,
            mode,
            content,
            clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        })
        if (!result.ok) {
          if (requestId != null) retireSubmission(requestId, 'failed')
          sessionSnapshot = {
            ...sessionSnapshot,
            promptError: { op: 'send', error: result.error },
            awaitingFirstTurn: false,
          }
          publishSession()
          return result
        }
        sessionSnapshot = { ...sessionSnapshot, running: true, blank: false, awaitingFirstTurn: false }
        publishSession()
        startPolling(1000)
        return result
      }
      const cancel = async () => {
        const result = await rpc('session/cancel', { request: { sessionId } })
        if (!result.ok) {
          sessionSnapshot = { ...sessionSnapshot, promptError: { op: 'stop', error: result.error } }
          publishSession()
        }
        return result
      }
      const updateQueue = (itemId, action) => rpc('session/updateQueue', { request: { sessionId, itemId, action } })
      const rename = (title) => rpc('session/rename', { request: { sessionId, title } })
      const readOnlyFail = () => ({ ok: false, error: { code: 'peerbar/unsupported', message: '远端暂不支持此操作' } })
      /**
       * 向上翻一页并 prepend 进窗口。
       * 官方 chat 的上滚触发器读 `session.hasMore`，为 true 时调用本方法。
       */
      const loadOlder = async () => {
        if (!hostId) return
        if (!windowSnapshot.hasMore || sessionSnapshot.loadingOlder) return
        const before = firstSeq
        if (before === null || before <= 1) {
          // 已到日志开头：没有更早的了
          windowSnapshot = { ...windowSnapshot, hasMore: false }
          syncSessionPaging()
          notifyWindow()
          return
        }
        sessionSnapshot = { ...sessionSnapshot, loadingOlder: true }
        publishSession()
        try {
          const raw = await remoteFetch(
            hostId,
            `/session?hostId=${encodeURIComponent(hostId)}&id=${encodeURIComponent(sessionId)}` +
              `&limit=${HISTORY_PAGE_SIZE}&before=${before}&raw=1`,
          )
          prependEntries(toEntries(raw.records), raw.hasMore === true)
        } catch (error) {
          sessionSnapshot = {
            ...sessionSnapshot,
            promptError: {
              op: 'history',
              error: { code: error?.code ?? 'peerbar/history-failed', message: String(error?.message ?? error) },
            },
          }
          publishSession()
        } finally {
          sessionSnapshot = { ...sessionSnapshot, loadingOlder: false }
          publishSession()
        }
      }
      /** 逐页向早翻，直到窗口覆盖 seq（尽力而为，不保证一定到达） */
      const loadThrough = async (seq) => {
        const target = Number(seq)
        if (!Number.isFinite(target)) return
        for (let page = 0; page < 40; page += 1) {
          if (firstSeq !== null && firstSeq <= target) return
          if (!windowSnapshot.hasMore || sessionSnapshot.loadingOlder) return
          const before = firstSeq
          await loadOlder()
          if (firstSeq === before) return // 没有前进：防死循环
        }
      }
      /**
       * 读远端附件（T2a）。
       *
       * 官方 `HistoricalImageCache.loadCanonical` 就是调
       * `binding.session.readAttachment(attachmentId)` 拿字节、自己转 Blob URL，
       * 所以实现这个方法就够了——不用 patch `imageUrl`，也不用改渲染器。
       *
       * 契约：`{ok:true, value:{attachment:{mediaType,...}, data:number[]}}`。
       * 远端给的是 base64，这里转成字节数组。
       */
      const readAttachment = async (attachmentId) => {
        if (!hostId) return readOnlyFail()
        if (typeof attachmentId !== 'string' || !attachmentId) {
          return { ok: false, error: { code: 'peerbar/bad-attachment', message: '缺少 attachmentId' } }
        }
        const result = await rpc('session/attachment', { request: { sessionId, attachmentId } })
        if (!result.ok) return result
        const attachment = result.value?.attachment
        const encoded = typeof result.value?.data === 'string' ? result.value.data : ''
        if (!attachment?.attachmentId || !encoded) {
          return { ok: false, error: { code: 'peerbar/bad-attachment', message: '远端附件响应缺 attachment/data' } }
        }
        try {
          return { ok: true, value: { attachment, data: base64ToBytes(encoded) } }
        } catch {
          return { ok: false, error: { code: 'peerbar/bad-attachment', message: '附件 base64 解码失败' } }
        }
      }
      const session = {
        sessionId,
        projections,
        beginSubmission,
        prompt,
        readAttachment,
        updateQueue,
        cancel,
        rename,
        loadOlder,
        loadThrough,
        command: async (line) => {
          console.info('[peerbar] command called:', String(line).slice(0, 60), 'hostId=', hostId)
          if (!hostId) return readOnlyFail()
          try {
            const value = await remoteRpc(hostId, 'commands/execute', {
              agentId: sessionId,
              line: typeof line === 'string' ? line : String(line ?? ''),
              submittedAttachments: [],
            })
            console.info('[peerbar] command result:', JSON.stringify(value)?.slice(0, 100))
            return { ok: true, value: { matched: value !== undefined } }
          } catch (error) {
            console.warn('[peerbar] command failed:', String(error?.message ?? error).slice(0, 100))
            return {
              ok: false,
              error: { code: error?.code ?? 'peerbar/command-failed', message: String(error?.message ?? error) },
            }
          }
        },
        getSnapshot: () => sessionSnapshot,
        subscribe: (fn) => {
          sessionListeners.add(fn)
          return () => sessionListeners.delete(fn)
        },
      }
      // ---- 增量轮询（P5） ----
      let pollTimer = null
      let pollInflight = false
      const poll = async () => {
        if (pollInflight || document.visibilityState === 'hidden') return
        if ((counts.mainView ?? 0) === 0) return // 没在看就不拉
        pollInflight = true
        try {
          const raw = await request(
            `/session?hostId=${encodeURIComponent(hostId)}&id=${encodeURIComponent(sessionId)}&limit=100&raw=1`,
          )
          const fresh = raw.records ?? []
          const freshSeqs = fresh.map((r) => Number(r.event?.seq) || 0)
          const maxSeq = freshSeqs.reduce((a, b) => Math.max(a, b), 0)
          if (raw.values) setProjectionValues(raw.values)
          if (maxSeq <= lastSeq) {
            // 无新事件：远端空闲则退出运行态
            if (sessionSnapshot.running && sessionSnapshot.pendingSubmissions?.length === 0) {
              // 保守：只有窗口尾是明确的收尾事件才停，避免误判长思考
              const tail = windowSnapshot.entries[windowSnapshot.entries.length - 1]?.event?.type
              if (tail === 'turn/end' || tail === 'session/end-seed') {
                sessionSnapshot = { ...sessionSnapshot, running: false }
                publishSession()
                startPolling(2000)
              }
            }
            return
          }
          const minSeq = freshSeqs.reduce((a, b) => Math.min(a, b), maxSeq)
          const newRecords = fresh.filter((r) => (Number(r.event?.seq) || 0) > lastSeq)
          if (minSeq > lastSeq + 1 && windowSnapshot.entries.length > 0) {
            // 中间有缺口（一轮拉不完）：整窗替换
            replaceEntries(
              fresh.map((record) => (record && record.event ? { type: 'event', event: record.event } : null)).filter(Boolean),
            )
          } else {
            appendRecords(newRecords)
          }
          // echo 退役：官方把 requestId 落在 user/message 的 source.rpcId
          // （见 dsh-api-session-controller types/commands.js hasPromptRequest）
          for (const record of newRecords) {
            const event = record?.event
            if (event?.type === 'user/message' && event.data?.source?.kind === 'user') {
              const rpcId = event.data?.source?.rpcId
              if (rpcId) retireSubmission(rpcId, 'observed')
            }
          }
          if (newRecords.some((r) => r.event?.type === 'turn/end' || r.event?.type === 'session/end-seed')) {
            if (sessionSnapshot.pendingSubmissions?.length === 0 && sessionSnapshot.running) {
              sessionSnapshot = { ...sessionSnapshot, running: false }
              publishSession()
              startPolling(2000)
            }
          } else if (sessionSnapshot.running) {
            startPolling(1000)
          }
        } catch (pollError) {
          // 静默吞掉会让「事件不再更新」变成不可诊断的卡死；记一次简短日志再重试
          console.warn('[peerbar] 会话事件轮询失败，下轮重试:', String(pollError?.message ?? pollError).slice(0, 160))
        } finally {
          pollInflight = false
        }
      }
      function startPolling(intervalMs) {
        if (pollTimer) clearInterval(pollTimer)
        pollTimer = setInterval(poll, intervalMs)
      }
      const dispose = () => {
        if (pollTimer) clearInterval(pollTimer)
        pollTimer = null
      }
      startPolling(2000)
      if (summary) summary.retainedBy = info.retainedBy
      const self = { sessionId, hostId, hostName: hostName || hostId || '', session, eventSource, ctx, summary, retention, dispose, __pbVersion: null }
      // 绑定对象会被官方 store / Immer 深冻结（实测 `Object.isFrozen(binding) === true`），
      // 冻结后 `self.summary = next` 在非严格模式下静默失败：改名只更新了浏览器标题，
      // 侧栏与主视图面包屑永远停在旧名。把 summary 的读写放到闭包里，
      // accessor 在冻结后仍可调用，冻结只作用于 data 字段。
      let summaryValue = summary
      Object.defineProperty(self, 'summary', {
        get: () => summaryValue,
        set: (value) => {
          summaryValue = value
        },
        enumerable: true,
        configurable: true,
      })
      /**
       * 回写标题（T10）：/state 刷到新名字后由 syncRemoteSummaries 调用。
       * 用「替换引用」而不是原地改——summary 可能被外部冻结，原地赋值在
       * 非严格模式下会静默失败（与 retainedBy 同一坑）。
       *
       * 还要触发 list 订阅者（document.title 的 DocumentTitle 组件订阅的是
       * `useSessions(selector)`）：远端绑定不走 publishRetention，也就没有
       * `list.set`，订阅者不会重算。手法与 forceSelect 一致。
       */
      self.updateSummary = (patch) => {
        const current = self.summary
        if (!current || !patch) return
        const next = { ...current }
        let changed = false
        let retitled = false
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined || next[key] === value) continue
          next[key] = value
          changed = true
          if (key === 'title' || key === 'displayTitle') retitled = true
        }
        if (!changed) return
        self.summary = next
        patchListRow(ctx, sessionId, {
          title: next.title,
          displayTitle: next.displayTitle,
          updatedAt: next.updatedAt,
          blank: next.blank,
        })
        // `getSnapshot` 的合成行按 versionRef + base 引用做缓存；只换 summary
        // 不敲版本，订阅者拿到的仍是旧缓存 → 面包屑不同步。先拔版本，
        // 再按 forceSelect 的方式 set 一次，让 useSessions 的订阅者重算。
        // 只在标题真的变了时做：running/updatedAt 的变化用不着重算面包屑，
        // 频繁 set 会放大官方 store 的 Immer 噪声。
        if (retitled) {
          const sessions = typeof ctx?.get === 'function' ? ctx.get('sessions') : ctx?.sessions
          if (sessions?.__peerbarVersion) sessions.__peerbarVersion.n += 1
          notifySessionList(ctx)
        }
        // store 通知链路在远端绑定下不可靠（useSessions 的内部订阅拿不到），
        // 直接把浏览器标题也同步一次；只在确实是当前主视图时改。
        if ((counts.mainView ?? 0) > 0) {
          patchDocumentTitle(next.title)
          // 主视图面包屑读的是 uiSession 的主视图投影，敲一下让订阅者重算
          try {
            const uiSession = typeof ctx?.get === 'function' ? ctx.get('uiSession') : ctx?.uiSession
            if (typeof uiSession?.publishMain === 'function') uiSession.publishMain()
          } catch {
            /* 不阻塞 */
          }
        }
        publishSession()
      }
      remoteBindings.set(sessionId, self)
      const baseDispose = dispose
      self.dispose = () => {
        baseDispose()
        // 换绑时旧 binding 也调 dispose：别误删新登记的那条
        if (remoteBindings.get(sessionId) === self) remoteBindings.delete(sessionId)
      }
      return self
    }

    /** 把远端绑定注册进 ISessions（在原型方法上包一层查找，不动内部 store） */
    function installRemoteSessions(ctx) {
      const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : ctx.sessions
      if (!sessions) return null
      const registry = sessions.__peerbarRegistry ?? new Map()
      sessions.__peerbarRegistry = registry
      const versionRef = sessions.__peerbarVersion ?? { n: 0 }
      const restores = sessions.__peerbarRestores ?? (sessions.__peerbarRestores = [])
      const restoreMethod = (target, name, original, patched) => {
        if (target[name] !== patched) return
        if (original === undefined) delete target[name]
        else target[name] = original
      }
      /** 当前主视图的会话 id：供浏览器降级等「按会话归属」的入口使用。 */
      const markActiveSession = (id) => {
        if (typeof id === 'string' && id) sessions.__peerbarActiveSession = id
      }
      sessions.__peerbarVersion = versionRef
      // 触发 list.subscribe 订阅者（publishMain / reconcileStatus）。
      // publishRetention 被跳过后 list.set 不再被调用，订阅者收不到通知。
      const proto = Object.getPrototypeOf(sessions)
      if (proto && !proto.__peerbarPatched) {
        const originalRetain = proto.retain
        const originalBinding = proto.binding
        const originalRetainInfo = proto.retainInfo
        const originalScope = proto.scope
        const originalSessionOf = proto.sessionOf
        const originalRetainScope = proto.retainScope
        const originalPublishRetention = proto.publishRetention
        // mainView 全局互斥：ui-session 的 publishMain 靠
        // `retainedBy.mainView > 0` 认定主视图归属。replaceMain 的
        // `previous.release()` 在 selection.set 抛错时会被跳过，导致旧会话
        // 永远占着 mainView、新会话点不开。这里在 retain 新会话时先收回其他
        // 远端会话的 mainView，不再依赖 release 是否跑到。
        // 注意：这里是箭头函数，`.call(this)` 不会改变它的 this，
        // 所以必须用闭包里的 registry，不能用 this.__peerbarRegistry。
        // 直接设 uiSession.current.value（绕过 publishMain 的 find/currentIsMain）
        // 注意：箭头函数的 this 不跟 .call() 走，必须用闭包变量 registry/sessions
        const forceSelect = (id) => {
          try {
            const uiSession = typeof ctx?.get === 'function' ? ctx.get('uiSession') : ctx?.uiSession
            if (!uiSession) return
            const owner = registry.get(id) ?? originalBinding?.call(sessions, id)
            if (!owner) return
            // P6：记录当前主视图归属的远端 host（modelCatalog 无 sessionId 参数，
            // 只能按「当前会话的归属」路由）
            sessions.__peerbarActiveHost = registry.get(id)?.hostId ?? null
            const source = uiSession.sourceFor?.(owner)
            if (source && uiSession.current) {
              if (uiSession.current.value !== source.value) {
                uiSession.current.value = source.value
                for (const fn of [...(uiSession.current.listeners ?? [])]) fn()
              }
            }
            // 触发 list.subscribe → useSessions 重渲染 → document.title 更新
            notifySessionList(ctx)
          } catch { /* 不阻塞 */ }
        }
        const exclusiveMainView = (keepId) => {
          // 收回所有远端会话的 mainView
          for (const [otherId, other] of registry) {
            if (otherId === keepId) continue
            const held = other.retention?.info.retainedBy.mainView ?? 0
            for (let i = 0; i < held; i += 1) other.retention?.release('mainView')
          }
        }
        const makeReference = (id, binding, source) => {
          if (source === 'mainView') console.info('[peerbar] retainMV', id.slice(0, 12), new Error().stack?.split('\n')[2]?.trim()?.slice(0, 80))
          binding.retention?.retain(source)
          if (source === 'mainView') forceSelect(id)
          let released = false
          return {
            sessionId: id,
            binding,
            ready: Promise.resolve(binding),
            release: () => {
              if (released) return
              released = true
              binding.retention?.release(source)
            },
          }
        }
        if (typeof originalRetain === 'function') {
          proto.retain = function retain(target, options) {
            const id = typeof target === 'string' ? target : target?.sessionId
            markActiveSession(id)
            const binding = this.__peerbarRegistry?.get(id)
            if (binding !== undefined) {
              exclusiveMainView(id)
              // source='mainView' 时释放 mainReference（replaceMain 会再调 previous.release()，幂等安全）
              if (options?.source === 'mainView') {
                try {
                  const uiWs = typeof ctx?.get === 'function' ? ctx.get('uiWorkspace') : ctx?.uiWorkspace
                  const prev = uiWs?.mainReference
                  if (prev && prev.sessionId !== id && typeof prev.release === 'function') prev.release()
                } catch { /* 不阻塞 */ }
              }
              return makeReference(id, binding, options?.source)
            }
            const reference = originalRetain.call(this, target, options)
            exclusiveMainView(null)
            try {
              const localId = typeof target === 'string' ? target : target?.sessionId
              // 释放旧 mainReference（否则 document.title 的 retainedBy.mainView>0
              // 会找到旧会话，标题冻结）
              const uiWs = typeof ctx?.get === 'function' ? ctx.get('uiWorkspace') : ctx?.uiWorkspace
              const prev = uiWs?.mainReference
              if (prev && prev.sessionId !== localId && typeof prev.release === 'function') prev.release()
              if (localId) forceSelect(localId)
            } catch { /* 不阻塞 */ }
            return reference
          }
          const patchedRetain = proto.retain
          restores.push(() => restoreMethod(proto, 'retain', originalRetain, patchedRetain))
        }
        if (typeof originalRetainScope === 'function') {
          // retainAgentScope 等路径直接调 retainScope，不走 retain。
          // 必须同样拦截，否则会造出「真引用」，其 binding 与 registry 里的
          // 合成 binding 不是同一对象，bindingSource 校验直接抛
          // "Session reference is not active in this Controller"。
          proto.retainScope = function retainScope(id, source) {
            markActiveSession(id)
            const binding = this.__peerbarRegistry?.get(id)
            if (binding !== undefined) {
              exclusiveMainView(id)
              return makeReference(id, binding, source)
            }
            const ref = originalRetainScope.call(this, id, source)
            versionRef.n += 1
            return ref
          }
          const patchedRetainScope = proto.retainScope
          restores.push(() => restoreMethod(proto, 'retainScope', originalRetainScope, patchedRetainScope))
        }
        if (typeof originalBinding === 'function') {
          proto.binding = function binding(id) {
            const fromRegistry = this.__peerbarRegistry?.get(id)
            const result = fromRegistry ?? originalBinding.call(this, id)
            return result
          }
          const patchedBinding = proto.binding
          restores.push(() => restoreMethod(proto, 'binding', originalBinding, patchedBinding))
        }
        if (typeof originalRetainInfo === 'function') {
          proto.retainInfo = function retainInfo(id) {
            const binding = this.__peerbarRegistry?.get(id)
            if (binding?.retention) {
              const { info, listeners } = binding.retention
              return {
                getSnapshot: () => info,
                subscribe: (fn) => {
                  listeners.add(fn)
                  return () => listeners.delete(fn)
                },
              }
            }
            return originalRetainInfo.call(this, id)
          }
          const patchedRetainInfo = proto.retainInfo
          restores.push(() => restoreMethod(proto, 'retainInfo', originalRetainInfo, patchedRetainInfo))
        }
        if (typeof originalScope === 'function') {
          proto.scope = function scope(id) {
            return this.__peerbarRegistry?.get(id)?.ctx ?? originalScope.call(this, id)
          }
          const patchedScope = proto.scope
          restores.push(() => restoreMethod(proto, 'scope', originalScope, patchedScope))
        }
        if (typeof originalSessionOf === 'function') {
          proto.sessionOf = function sessionOf(ctx) {
            for (const [id, binding] of this.__peerbarRegistry ?? []) {
              if (binding.ctx === ctx) return binding.session
            }
            return originalSessionOf.call(this, ctx)
          }
          const patchedSessionOf = proto.sessionOf
          restores.push(() => restoreMethod(proto, 'sessionOf', originalSessionOf, patchedSessionOf))
        }
        if (typeof originalPublishRetention === 'function') {
          // publishRetention 会把 retentionSnapshot 的返回写回 list.set。
          // 对远端会话它拿到的是冻结的 EMPTY_RETAIN_INFO，会把我们的行覆盖掉；
          // 而且 list.set 收到含合成行的合并快照后，下游 Immer 订阅者会报错。
          // 远端行由 getSnapshot 合并注入，不需要也不允许写回真 store。
          proto.publishRetention = function publishRetention() {
            // 完全跳过：list.set 会把合并快照回灌 Immer（error nr:2），
            // 而 retainedBy 的实时值由 getSnapshot 合并时从 retentionSnapshot 读取。
          }
          const patchedPublishRetention = proto.publishRetention
          restores.push(() => restoreMethod(proto, 'publishRetention', originalPublishRetention, patchedPublishRetention))
        }
        proto.__peerbarPatched = true
        restores.push(() => {
          delete proto.__peerbarPatched
        })
      }
      // 远端行通过 getSnapshot 合并注入，不写真 store——写真 store 会触发
      // Immer 订阅者报错（合并对象被回灌 list.set）。publishRetention 已在
      // proto 上被拦掉，所以真 store 里永远不会出现合成行。
      const listObj = sessions.list
      if (listObj && typeof listObj.set === 'function' && !listObj.__peerbarSetPatched) {
        const originalSet = listObj.set
        // 真 store（Immer）不能看到合成行：publishRetention 把合并快照回灌
        // list.set 时会触发 "Immer minified error nr:2"，订阅者整个崩掉。
        // 这里在写入前把远端合成行剥掉。
        const originalGetForSet = listObj.getSnapshot
        listObj.set = function set(next) {
          if (next && typeof next === 'object' && next.byId) {
            // publishRetention 会把 getSnapshot() 的返回值（含合成行）回灌
            // list.set，Immer 无法处理合成/冻结对象（error nr:2）。
            // 解法：以真实 store state 为基底，只摘取 next 里非合成行的更新。
            const real = originalGetForSet.call(this)
            // 只纯化 byId/ids（JSON 去掉冻结标记），其余字段保持原引用，
            // 避免 Map/Set 被 JSON.stringify 销毁。
            const clean = { ...real }
            // 合成行不进真 store（Immer 不接受）；渲染由 getSnapshot 合并。
            clean.byId = JSON.parse(JSON.stringify(
              Object.fromEntries(
                Object.entries(next.byId ?? {}).filter(([id]) => !registry.has(id)),
              ),
            ))
            clean.ids = (next.ids ?? []).filter((id) => !registry.has(id))
            return originalSet.call(this, clean)
          }
          return originalSet.call(this, next)
        }
        const patchedSet = listObj.set
        listObj.__peerbarSetPatched = true
        restores.push(() => {
          if (listObj.set !== patchedSet) return
          listObj.set = originalSet
          delete listObj.__peerbarSetPatched
        })
      }
      if (listObj && typeof listObj.getSnapshot === 'function' && !listObj.__peerbarPatched) {
        const originalGet = listObj.getSnapshot
        let cachedBase = null
        let cachedVer = -1
        let cachedMerged = null
        listObj.getSnapshot = function getSnapshot() {
          const base = originalGet.call(this)
          const ver = versionRef.n
          if (base === cachedBase && ver === cachedVer) return cachedMerged ?? base
          cachedBase = base
          cachedVer = ver
          const merged = { ...base }
          merged.byId = {}
          merged.ids = [...(base.ids ?? [])]
          merged.projectionsBySession = { ...(base.projectionsBySession ?? {}) }
          for (const [id, row] of Object.entries(base.byId ?? {})) {
            const live = sessions.retentionSnapshot?.(id)?.retainedBy
            merged.byId[id] = live ? { ...row, retainedBy: { ...live } } : row
          }
          for (const [id, binding] of registry) {
            // __peerbar 标记：这行只为 publishMain / document.title / mainView
            // 判定而注入 useSessions 快照，**不得**进本机侧栏（否则会在
            // 「未分组」里出现远端会话的影子副本，还跟着高亮/染蓝）
            merged.byId[id] = {
              ...binding.summary,
              __peerbar: true,
              retainedBy: binding.retention?.info?.retainedBy ?? {},
            }
            if (!merged.ids.includes(id)) merged.ids.push(id)
          }
          cachedMerged = merged
          return merged
        }
        const patchedGetSnapshot = listObj.getSnapshot
        listObj.__peerbarPatched = true
        restores.push(() => {
          if (listObj.getSnapshot !== patchedGetSnapshot) return
          listObj.getSnapshot = originalGet
          delete listObj.__peerbarPatched
        })
      }
      const restore = () => {
        for (const fn of restores.splice(0).reverse()) {
          try {
            fn()
          } catch (error) {
            console.warn('[peerbar] 还原 ISessions 补丁失败', error)
          }
        }
        registry.clear()
        if (sessions.__peerbarRestore === restore) {
          delete sessions.__peerbarRestore
          delete sessions.__peerbarRestores
        }
      }
      if (typeof sessions.__peerbarRestore !== 'function') sessions.__peerbarRestore = restore
      return sessions
    }

    /**
     * 侧栏视图偏好（分组 / 排序 / 归档过滤）。
     *
     * 官方把这三个选项存在 `dsh.workspace.view.v5` 里；我们影子替换后没有那个 store，
     * 所以自己落 localStorage。拖拽依赖 `orderBy === 'manual'`，不持久化的话刷新即回
     * 「最近更新」，用户会觉得拖了等于没拖。
     */
    function readStoredView() {
      try {
        const raw = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}')
        if (!raw || typeof raw !== 'object') return { ...VIEW_DEFAULTS }
        return {
          groupBy: raw.groupBy === 'flat' ? 'flat' : 'workspace',
          orderBy: raw.orderBy === 'manual' ? 'manual' : 'updated',
          archived: raw.archived === 'show' || raw.archived === 'only' ? raw.archived : 'default',
        }
      } catch {
        return { ...VIEW_DEFAULTS }
      }
    }

    function useFoldState() {
      const [fold, setFold] = React.useState(() => {
        try {
          const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY))
          return raw && typeof raw === 'object' ? new Map(Object.entries(raw)) : new Map()
        } catch {
          return new Map()
        }
      })

      const isOpen = React.useCallback((id, fallback) => (fold.has(id) ? fold.get(id) === true : fallback), [fold])

      const toggle = React.useCallback((id, fallback) => {
        setFold((previous) => {
          const next = new Map(previous)
          const current = next.has(id) ? next.get(id) === true : fallback
          next.set(id, !current)
          try {
            localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Object.fromEntries(next)))
          } catch {
            /* 忽略 */
          }
          return next
        })
      }, [])

      return { isOpen, toggle }
    }

    //#endregion

    //#region 样式

    const CSS = `
.dshp-root { display:flex; flex-direction:column; height:100%; min-height:0; box-sizing:border-box; padding:0 4px 12px; }
/* 拖拽排序：可拖行给 grab 光标；拖动中淡出原行；落点用上/下 2px 指示线（与官方一致） */
.koUx-W_sessionRow[draggable="true"], .koUx-W_projectRow[draggable="true"] { cursor:grab; }
.koUx-W_sessionRow.dshp-dragging, .koUx-W_projectRow.dshp-dragging { opacity:.45; }
.koUx-W_sessionRow.dshp-drop-before, .koUx-W_projectRow.dshp-drop-before { box-shadow:inset 0 2px 0 var(--dsw-alias-state-business-primary, #3b82f6); }
.koUx-W_sessionRow.dshp-drop-after, .koUx-W_projectRow.dshp-drop-after { box-shadow:inset 0 -2px 0 var(--dsw-alias-state-business-primary, #3b82f6); }
/* 原生：.hP3ldq_root:not(.rail) .hP3ldq_sectionHeader{margin-top:2px;margin-right:-4px}
   我们的 root 左右各有 4px padding，所以左边也要 -4 才与原生同一条垂线。 */
.dshp-root > .hP3ldq_sectionHeader { margin-top:2px; margin-left:-4px; margin-right:-4px; }
.dshp-scroll { flex:1 1 auto; overflow-y:auto; min-height:0; padding-bottom:8px; scrollbar-gutter:stable; }
.dshp-note { padding:6px 12px; font-size:12px; color:var(--dsw-alias-label-tertiary); }
.dshp-error { margin:4px 8px; padding:6px 8px; border-radius:var(--dsw-radius-md, 8px); background:rgba(207,34,46,.12); font-size:12px; }
.dshp-tag { font-size:10px; line-height:16px; padding:0 4px; border-radius:4px; border:1px solid currentColor; opacity:.8; white-space:nowrap; flex:0 0 auto; }
.dshp-degraded { display:inline-flex; align-items:center; flex:0 0 auto; color:var(--dsw-alias-state-warning-primary, #d97706); cursor:help; }
.dshp-degraded svg { width:13px; height:13px; }

.dshp-panel { display:flex; flex-direction:column; height:100%; min-height:0; font-size:14px; }
.dshp-panel-head { display:flex; align-items:center; gap:8px; padding:8px 16px; border-bottom:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.18)); flex:none; }
.dshp-panel-title { font-size:14px; font-weight:500; line-height:22px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dshp-panel-sub { font-size:12px; line-height:16px; color:var(--dsw-alias-label-tertiary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dshp-panel-body { flex:1; overflow:auto; padding:16px max(24px, calc((100% - var(--dsh-chat-content-width, 748px)) / 2)) 32px; box-sizing:border-box; }
.dshp-composer { margin:8px; padding:10px 12px; border-radius:12px; border:.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.22)); background:var(--dsw-alias-bg-l1, rgba(128,128,128,.05)); color:var(--dsw-alias-label-tertiary); font-size:13px; }
.dshp-btn { font:inherit; font-size:12px; line-height:1.4; color:var(--dsw-alias-label-secondary, inherit); background:transparent; border:.5px solid var(--dsw-alias-border-l4, rgba(128,128,128,.32)); border-radius:var(--dsw-radius-sm, 6px); padding:3px 9px; cursor:pointer; white-space:nowrap; }
.dshp-btn:hover { background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.1)); }
.dshp-msg { padding:12px 0; }
.dshp-muted { color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:18px; }
.dshp-tools { display:flex; flex-direction:column; gap:6px; margin-top:6px; }
.dshp-tool { font-size:12px; line-height:18px; border:.5px solid var(--dsw-alias-border-l3, rgba(128,128,128,.2)); border-radius:var(--dsw-radius-sm, 6px); padding:1px 8px; background:var(--dsw-alias-bg-l1, rgba(128,128,128,.04)); max-width:100%; }
.dshp-tool[open] { flex:1 1 100%; padding:4px 8px; }
.dshp-tool summary { cursor:pointer; font-family:var(--ds-font-family-code, ui-monospace, monospace); outline:none; color:var(--dsw-alias-label-secondary); list-style:none; }
.dshp-tool summary::-webkit-details-marker { display:none; }
.dshp-tool summary::before { content:'▸'; display:inline-block; margin-right:4px; font-size:10px; opacity:.6; transition:transform .12s; }
.dshp-tool[open] > summary::before { transform:rotate(90deg); }
.dshp-tool pre { margin:6px 0 0; padding:8px; background:var(--dsw-alias-bg-l2, rgba(128,128,128,.1)); border-radius:var(--dsw-radius-sm, 6px); max-height:260px; overflow:auto; white-space:pre-wrap; word-break:break-word; font-size:12px; line-height:18px; }
.dshp-tool-actions { display:flex; justify-content:flex-end; margin-top:4px; }
.dshp-center { display:flex; justify-content:center; padding:6px 0 12px; }
`

    function injectStyles() {
      if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }

    //#endregion

    //#region 小工具

    function ago(timestamp) {
      if (!Number.isFinite(timestamp)) return ''
      const delta = Date.now() - timestamp
      if (delta < 60_000) return 'now'
      const minutes = Math.floor(delta / 60_000)
      if (minutes < 60) return `${minutes}m`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return `${hours}h`
      const days = Math.floor(hours / 24)
      if (days < 30) return `${days}d`
      return new Date(timestamp).toLocaleDateString()
    }

    function statusColor(status) {
      if (status === 'online') return '#2ea043'
      if (status === 'auth-required') return '#d29922'
      if (status === 'disabled') return '#8b949e'
      return '#cf222e'
    }

    function statusLabel(status) {
      return tr(`state.${status}`)
    }

    function hostColor(host) {
      return HOST_PALETTE[host?.color] ?? '#8b949e'
    }

    function basename(path) {
      if (typeof path !== 'string' || path === '') return ''
      const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
      return parts[parts.length - 1] || path
    }

    //#endregion

    //#region 侧栏树

    /** 官方相对时间：刚刚 / N分钟 / N小时 / N天 */
    function timeLabel(timestamp) {
      if (!Number.isFinite(timestamp)) return ''
      const delta = Date.now() - timestamp
      if (delta < 60_000) return tr('time.now')
      const minutes = Math.floor(delta / 60_000)
      if (minutes < 60) return tr('time.minute', { n: minutes })
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return tr('time.hour', { n: hours })
      const days = Math.floor(hours / 24)
      if (days < 30) return tr('time.day', { n: days })
      return new Date(timestamp).toLocaleDateString()
    }

    /** 官方状态点（只有非 idle 才画：原生 idle 行走 `sidebar.session.row.leading` 空槽） */
    function StatusDot({ state }) {
      return prim('StateDot', { state })
    }

    /** 官方会话行：slot(状态点) + title(双击重命名) + time + pinned + rowActions */
    function SessionRow({ title, time, state, pinned, archived, selected, stale, cwd, actions, onOpen, onRename, drag }) {
      const [menuOpen, setMenuOpen] = React.useState(false)
      const rowActions = typeof actions === 'function' ? actions(menuOpen, setMenuOpen) : actions
      return React.createElement(
        'div',
        {
          className:
            'koUx-W_sessionRow'
            + (selected ? ' koUx-W_selected' : '')
            + (archived ? ' koUx-W_archived' : '')
            + (menuOpen ? ' koUx-W_menuOpen' : '')
            + (drag?.dragging ? ' dshp-dragging' : '')
            + (drag?.marker ? ` dshp-drop-${drag.marker}` : ''),
          role: 'treeitem',
          'aria-selected': Boolean(selected),
          title: cwd ? `${title}\n${cwd}` : title,
          draggable: Boolean(drag?.draggable),
          onDragStart: drag?.onStart,
          onDragOver: drag?.onOver,
          onDragLeave: drag?.onLeave,
          onDrop: drag?.onDrop,
          onDragEnd: drag?.onEnd,
          onClick: onOpen,
          style: stale ? { opacity: 0.55 } : undefined,
        },
        React.createElement(
          'span',
          { className: 'koUx-W_slot' },
          // 原生：archived / idle 不画点，slot 仍占 16px 以保持标题对齐
          archived || state === 'idle' ? null : React.createElement(StatusDot, { state }),
        ),
        React.createElement(
          'span',
          { className: 'koUx-W_title', onDoubleClick: onRename ? (event) => { event.stopPropagation(); onRename() } : undefined },
          title,
        ),
        time ? React.createElement('span', { className: 'koUx-W_time' }, time) : null,
        pinned && !archived
          ? React.createElement(
              'span',
              { className: 'koUx-W_pinIndicator', role: 'img', title: tr('row.pinned') },
              prim('IconPinFillRegular', { size: 14 }),
            )
          : null,
        rowActions ? React.createElement('span', { className: 'koUx-W_rowActions', onClick: (event) => event.stopPropagation() }, rowActions) : null,
      )
    }

    /** 官方菜单容器（Menu items/onSelect API） */
    function RowMenu({ items, label, onOpenChange }) {
      const [open, setOpen] = React.useState(false)
      const anchorRef = React.useRef(null)
      const Menu = primitives?.Menu
      const change = (value) => {
        setOpen(value)
        // 官方在菜单打开时给行加 menuOpen 类钉住按钮区（否则指针离开行，
        // rowActions 被 CSS 隐藏，锚点卸载，菜单就崩）。
        const row = anchorRef.current?.closest?.('.koUx-W_sessionRow, .koUx-W_projectRow')
        if (row) row.classList.toggle('koUx-W_menuOpen', value)
        onOpenChange?.(value)
      }
      if (!Menu || !items || items.length === 0) return null
      return React.createElement(Menu, {
        open,
        onClose: () => change(false),
        portal: true,
        items,
        onSelect: (id) => {
          change(false)
          try {
            items.find((item) => item.id === id)?.onSelect?.()
          } catch (error) {
            console.warn('[peerbar] 菜单操作失败', error)
          }
        },
        anchor: React.createElement(
          'button',
          {
            ref: anchorRef,
            type: 'button',
            className: 'koUx-W_iconButton',
            'aria-label': label,
            onClick: (event) => {
              event.stopPropagation()
              change(!open)
            },
          },
          prim('IconEllipsisOutlineRegular'),
        ),
      })
    }

    /**
     * 行内小图标按钮（归档 / 置顶 / 新建会话）。
     *
     * 尺寸必须显式传：官方 `.koUx-W_iconButton` 只有 16×16 的盒子，没有对子 svg 的尺寸约束，
     * 而 `IconArchiveOutlineArtwork` / `IconUnarchiveOutlineArtwork` 的默认 size 是 20
     * （其余图标多为 16）。不传就会在 16px 按钮里被 flex 压成 16×20，纵向拉长 25%。
     * 原生会话行按钮统一用 14（见 ui-workspace `ArchiveSessionRowButton` / `PinSessionRowButton`）。
     */
    function IconAction({ icon, label, onClick, active, size = 16 }) {
      return React.createElement(
        'button',
        {
          type: 'button',
          className: 'koUx-W_iconButton',
          title: label,
          'aria-label': label,
          'aria-pressed': active === undefined ? undefined : Boolean(active),
          onClick: (event) => {
            event.stopPropagation()
            try {
              const result = onClick()
              if (result?.catch) result.catch((error) => console.warn('[peerbar] 操作失败', error))
            } catch (error) {
              console.warn('[peerbar] 操作失败', error)
            }
          },
        },
        prim(icon, { size }),
      )
    }

    /**
     * 官方样式的重命名/删除对话框。
     *
     * 用 primitives 的 Modal + Button：遮罩、标题、footer、Escape、焦点归还与主题色
     * 都交给官方组件（自绘版本固定 rgba 深底，浅色主题下会变成黑卡片）。
     * 输入框沿用官方 `hP3ldq_renameInput`；footer 与原生一致 = 取消 + 主按钮，
     * 删除工作区用 outline + `hP3ldq_deleteAction`（红字）。
     */
    function Dialog({ title, description, value, placeholder, submitLabel, danger, onValue, onSubmit, onClose }) {
      const [busy, setBusy] = React.useState(false)
      const composing = React.useRef(false)
      const Modal = primitives?.Modal
      const Button = primitives?.Button
      const submit = async () => {
        if (busy) return
        setBusy(true)
        try {
          await onSubmit()
          onClose()
        } finally {
          setBusy(false)
        }
      }
      if (!Modal || !Button) return null
      return React.createElement(
        Modal,
        {
          open: true,
          onClose: () => {
            if (!busy) onClose()
          },
          closeLabel: tr('action.cancel'),
          title,
          description,
          footer: React.createElement(
            React.Fragment,
            null,
            React.createElement(Button, { variant: 'outline', disabled: busy, onClick: onClose }, tr('action.cancel')),
            React.createElement(
              Button,
              {
                variant: danger ? 'outline' : 'primary',
                className: danger ? 'hP3ldq_deleteAction' : undefined,
                disabled: busy,
                onClick: submit,
              },
              submitLabel,
            ),
          ),
        },
        value === undefined
          ? null
          : React.createElement('input', {
              className: 'hP3ldq_renameInput',
              'data-modal-autofocus': true,
              value,
              placeholder,
              disabled: busy,
              onFocus: (event) => event.target.select(),
              onChange: (event) => onValue(event.target.value),
              onCompositionStart: () => {
                composing.current = true
              },
              onCompositionEnd: () => {
                composing.current = false
              },
              onKeyDown: (event) => {
                if (event.key === 'Enter' && !composing.current) submit()
              },
            }),
      )
    }

    /**
     * 「添加工作区」目录选择器（本机 / 远端共用）。
     *
     * 官方这套目录流只认本机（`ctx.uiWorkspace.listDirectory`），远端工作区因此
     * 没有入口。这里顶替新会话页的 `conversation.hero.workspace.directoryFlow`
     * 座位，在同一个对话框里加主机切换：
     *
     * - 本机：走官方 `listDirectory`，选中后交回 owner（`onPicked`）建工作区；
     * - 远端：走 RPC 白名单里的只读 `directoryPicker/list`，选中后用幂等的
     *   `workspace/create {path}` 在远端注册，完成后广播 `peerbar:refresh`。
     *
     * 侧栏标题栏的「＋」也用同一个组件（本机分支自己建工作区）。
     */
    function WorkspaceAddDialog(props) {
      const { open, onClose, onLocalPick, onRemoteCreated, createRemote } = props
      // 回调走 ref：父组件每 5s 轮询 /state 会重渲染，内联箭头函数每次都是新 identity。
      // 如果 loadAt 的依赖里带它们，effect 就会重跑 → 远端浏览「几秒后闪回主目录」。
      const apiRef = React.useRef(props)
      apiRef.current = props

      const { state } = usePeerState(5000)
      const hosts = state?.hosts ?? []
      const [hostId, setHostId] = React.useState('local')
      const [listing, setListing] = React.useState(null)
      const [loading, setLoading] = React.useState(false)
      const [error, setError] = React.useState('')
      const [showHidden, setShowHidden] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      // 桌面端合成的目录选择器是 native 能力，没有 list：本机改为「系统对话框选目录」
      const [nativeLocal, setNativeLocal] = React.useState(false)

      const loadAt = React.useCallback(
        async (path) => {
          setLoading(true)
          setError('')
          try {
            const value = hostId === 'local' ? await apiRef.current.listLocal(path) : await apiRef.current.listRemote(hostId, path)
            setListing(value ?? null)
            setNativeLocal(false)
          } catch (cause) {
            const message = String(cause?.message ?? cause)
            setListing(null)
            // native picker 没有 list 能力：不是错误，切到「系统对话框」模式
            if (hostId === 'local' && /browse capability|directory-picker\/unavailable/i.test(message)) {
              setNativeLocal(true)
              setError('')
            } else {
              setError(message)
            }
          } finally {
            setLoading(false)
          }
        },
        [hostId],
      )

      React.useEffect(() => {
        if (!open) return
        setListing(null)
        void loadAt(undefined)
      }, [open, hostId, loadAt])

      if (!open) return null
      const Modal = primitives?.Modal
      const Button = primitives?.Button
      if (!Modal || !Button) return null

      const remote = hostId !== 'local'
      const entries = (listing?.entries ?? []).filter((entry) => showHidden || !entry.hidden)
      const confirm = async () => {
        if (!listing?.path || busy) return
        setBusy(true)
        setError('')
        try {
          if (!remote) {
            await onLocalPick?.(listing.path)
            return
          }
          await createRemote(hostId, listing.path)
          onRemoteCreated?.(hostId, listing.path)
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setBusy(false)
        }
      }

      /** native 能力下没有列表：直接拉系统目录对话框 */
      const pickLocal = async () => {
        if (busy) return
        setBusy(true)
        setError('')
        try {
          const path = await apiRef.current.pickLocal?.()
          if (path) await onLocalPick?.(path)
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setBusy(false)
        }
      }

      const hostTab = (id, label, disabled) =>
        React.createElement(
          'button',
          {
            key: id,
            type: 'button',
            disabled: disabled || busy,
            onClick: () => setHostId(id),
            style: {
              ...styles.smallButton,
              padding: '4px 10px',
              borderRadius: 999,
              border: '1px solid var(--dsw-alias-border-l4)',
              background: hostId === id ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
              color: hostId === id ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
              fontWeight: hostId === id ? 600 : 400,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
            },
          },
          label,
        )

      const crumb = (path, label, key) =>
        React.createElement(
          'button',
          {
            key,
            type: 'button',
            disabled: busy,
            onClick: () => void loadAt(path),
            style: {
              border: 'none',
              background: 'transparent',
              color: 'var(--dsw-alias-label-secondary)',
              cursor: 'pointer',
              padding: '2px 4px',
              borderRadius: 4,
              fontSize: 12,
              whiteSpace: 'nowrap',
            },
          },
          label,
        )

      const row = (entry) =>
        React.createElement(
          'button',
          {
            key: entry.path,
            type: 'button',
            disabled: busy,
            onClick: () => void loadAt(entry.path),
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '7px 8px',
              border: 'none',
              borderRadius: 6,
              background: 'transparent',
              color: 'var(--dsw-alias-label-primary)',
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: 13,
            },
            onMouseEnter: (event) => {
              event.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover)'
            },
            onMouseLeave: (event) => {
              event.currentTarget.style.background = 'transparent'
            },
          },
          prim('IconFolderCloseRegular', { size: 16 }),
          React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, entry.name),
          React.createElement('span', { style: { marginLeft: 'auto', color: 'var(--dsw-alias-label-tertiary)' } }, '›'),
        )

      const localNative = !remote && nativeLocal
      const browserBody = localNative
        ? React.createElement(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 8px', minHeight: 200, justifyContent: 'center', alignItems: 'flex-start' } },
            React.createElement(
              'div',
              { style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' } },
              tr('picker.nativeHint'),
            ),
            React.createElement(Button, { variant: 'primary', disabled: busy, onClick: () => void pickLocal() }, tr('picker.pickFolder')),
          )
        : React.createElement(
            React.Fragment,
            null,
            React.createElement(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  overflowX: 'auto',
                  paddingBottom: 4,
                  borderBottom: '1px solid var(--dsw-alias-border-l4)',
                },
              },
              listing?.home ? crumb(listing.home, tr('picker.home'), 'home') : null,
              ...(listing?.crumbs ?? [])
                .filter((item) => item.path !== listing?.home)
                .map((item, index) => crumb(item.path, item.name, `crumb-${index}`)),
            ),
            React.createElement(
              'div',
              { style: { flex: 1, minHeight: 200, maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 } },
              loading
                ? React.createElement('div', { style: { ...styles.muted, padding: 8 } }, tr('picker.loading'))
                : entries.length > 0
                  ? entries.map(row)
                  : React.createElement('div', { style: { ...styles.muted, padding: 8 } }, tr('picker.empty')),
            ),
            listing?.truncated ? React.createElement('div', { style: { ...styles.muted, fontSize: 12 } }, tr('picker.truncated')) : null,
          )

      return React.createElement(
        Modal,
        {
          open: true,
          onClose: () => {
            if (!busy) onClose?.()
          },
          closeLabel: tr('action.cancel'),
          title: tr('picker.title'),
          description: remote ? tr('picker.remoteHint', { host: hosts.find((h) => h.hostId === hostId)?.name ?? '' }) : undefined,
          footer: React.createElement(
            React.Fragment,
            null,
            localNative
              ? null
              : React.createElement(
                  'label',
                  { style: { marginRight: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
                  React.createElement('input', {
                    type: 'checkbox',
                    checked: showHidden,
                    disabled: busy,
                    onChange: (event) => setShowHidden(event.target.checked),
                  }),
                  tr('picker.showHidden'),
                ),
            React.createElement(Button, { variant: 'outline', disabled: busy, onClick: onClose }, tr('action.cancel')),
            localNative
              ? null
              : React.createElement(
                  Button,
                  { variant: 'primary', disabled: busy || loading || !listing?.path, onClick: () => void confirm() },
                  tr('action.open'),
                ),
          ),
        },
        React.createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 10, minHeight: 320 } },
          React.createElement(
            'div',
            { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            hostTab('local', tr('picker.local'), false),
            ...hosts.map((host) => hostTab(host.hostId, host.name, host.status !== 'online')),
          ),
          browserBody,
          error
            ? React.createElement('div', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, wordBreak: 'break-word' } }, error)
            : null,
        ),
      )
    }

    /** 官方视图选项：分组方式 / 排序方式 / 归档过滤 */
    function ViewOptionsMenu({ view, onChange }) {
      const [open, setOpen] = React.useState(false)
      const Menu = primitives?.Menu
      if (!Menu) return null
      return React.createElement(Menu, {
        open,
        onClose: () => setOpen(false),
        portal: true,
        align: 'end',
        dense: true,
        items: [
          { type: 'label', id: 'group-by', text: tr('groupBy.label') },
          { id: 'workspace', label: tr('groupBy.workspace'), icon: prim('IconFolderCloseRegular') },
          { id: 'flat', label: tr('groupBy.flat'), icon: prim('IconFlatListOutlineRegular') },
          { type: 'separator', id: 'order-sep' },
          { type: 'label', id: 'order-by', text: tr('orderBy.label') },
          { id: 'manual', label: tr('orderBy.manual'), icon: prim('IconChevronsUpDownOutlineRegular') },
          { id: 'updated', label: tr('orderBy.updated'), icon: prim('IconClockOutlineRegular') },
          { type: 'separator', id: 'filter-sep' },
          { type: 'label', id: 'filter-by', text: tr('filterBy.label') },
          { id: 'hide-archived', label: tr('viewOptions.hideArchived'), icon: prim('IconArchiveOffOutlineRegular') },
          { id: 'show-archived', label: tr('viewOptions.showArchived'), icon: prim('IconQueueOutlineRegular') },
          { id: 'only-archived', label: tr('viewOptions.onlyArchived'), icon: prim('IconArchiveCheckOutlineRegular') },
        ],
        selectedIds: [
          view.groupBy === 'flat' ? 'flat' : 'workspace',
          view.orderBy,
          { default: 'hide-archived', show: 'show-archived', only: 'only-archived' }[view.archived],
        ],
        onSelect: (id) => {
          if (id === 'workspace' || id === 'flat') onChange({ groupBy: id })
          else if (id === 'manual' || id === 'updated') onChange({ orderBy: id })
          else if (id === 'hide-archived') onChange({ archived: 'default' })
          else if (id === 'show-archived') onChange({ archived: 'show' })
          else if (id === 'only-archived') onChange({ archived: 'only' })
          setOpen(false)
        },
        anchor: React.createElement(
          'button',
          {
            type: 'button',
            className: 'hP3ldq_iconButton',
            title: tr('viewOptions.label'),
            onClick: (event) => {
              event.stopPropagation()
              setOpen((value) => !value)
            },
          },
          prim('IconSlidersTwoOutlineRegular', { size: 16 }),
        ),
      })
    }

    function WorkspaceTree(props) {
      const { useWorkspaces, useSessions, openSession, openWorkspace, services } = props
      const workspaces = useWorkspaces((state) => state.items)
      const list = useSessions((state) => state)
      const archivedIds = useWorkspaces((state) => state.archivedSessionIds) ?? []
      const pinnedIds = useWorkspaces((state) => state.pinnedSessionIds) ?? []
      const { state, error, refresh } = usePeerState(5000)
      const fold = useFoldState()
      const [query, setQuery] = React.useState('')
      const [searchOpen, setSearchOpen] = React.useState(false)
      const searchInputRef = React.useRef(null)
      React.useEffect(() => {
        if (searchOpen) searchInputRef.current?.focus()
      }, [searchOpen])
      const [notice, setNotice] = React.useState('')
      const [dialog, setDialog] = React.useState(null)
      const [addOpen, setAddOpen] = React.useState(false)
      const [overflowAll, setOverflowAll] = React.useState(() => new Set())
      const [, setStatusTick] = React.useState(0)
      React.useEffect(() => {
        const onStatus = () => setStatusTick((value) => value + 1)
        window.addEventListener('peerbar:status', onStatus)
        return () => window.removeEventListener('peerbar:status', onStatus)
      }, [])
      const [view, setView] = React.useState(readStoredView)
      // 视图偏好落盘；坏值已在 readStoredView 里回退，写入失败不影响渲染。
      React.useEffect(() => {
        try {
          localStorage.setItem(VIEW_KEY, JSON.stringify(view))
        } catch {
          /* 忽略 */
        }
      }, [view])

      React.useEffect(() => {
        if (!notice) return undefined
        const timer = setTimeout(() => setNotice(''), 3500)
        return () => clearTimeout(timer)
      }, [notice])

      // 非组件内部触发的提示（如拦截远端文件引用）通过事件广播到侧栏
      React.useEffect(() => {
        const onNotice = (event) => {
          const text = event?.detail?.message
          if (text) setNotice(String(text))
        }
        window.addEventListener('peerbar:notice', onNotice)
        return () => window.removeEventListener('peerbar:notice', onNotice)
      }, [])

      const lowered = query.trim().toLowerCase()
      const match = (title) => !lowered || String(title ?? '').toLowerCase().includes(lowered)
      const archived = React.useMemo(() => new Set(archivedIds), [archivedIds])
      const pinned = React.useMemo(() => new Set(pinnedIds), [pinnedIds])
      // 原生以 `retainedBy.mainView > 0` 判定当前会话；blank 会话只有“当前选中的那条”可见
      // （见 ui-workspace 的 currentBlank / pinCurrentBlank）。
      const mainSessionId = React.useMemo(
        () => Object.values(list.byId ?? {}).find((session) => (session?.retainedBy?.mainView ?? 0) > 0)?.id,
        [list],
      )
      const currentBlankId = mainSessionId && list.byId?.[mainSessionId]?.blank === true ? mainSessionId : undefined
      // 与官方 sessionVisible 对齐：子代理会话永远不铺到树上（父会话自带入口），
      // blank 会话只显示当前选中的那条，归档会话只受视图过滤控制。
      const visibleSession = (session) => {
        if (!session) return false
        // 远端绑定注入的影子行（__peerbar）不属于本机侧栏，一律不渲染；
        // 真实渲染走 visibleRemoteSession（远端组按 /state 画）
        if (session.__peerbar) return false
        if (session.blank) return session.id === currentBlankId
        if (session.origin === 'subagent') return false
        const isArchived = archived.has(session.id)
        if (view.archived === 'default' && isArchived) return false
        if (view.archived === 'only' && !isArchived) return false
        return match(session.title)
      }
      // 远端同理，归档标记来自宿主半（workspace/follow 的 baseline）。
      const visibleRemoteSession = (session) => {
        if (!session) return false
        if (session.blank) return session.rawId === currentBlankId
        const isArchived = session.archived === true
        if (view.archived === 'default' && isArchived) return false
        if (view.archived === 'only' && !isArchived) return false
        return match(session.title)
      }
      const byRecency = (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
      // 原生 pinCurrentBlank：把当前 blank 会话顶到最前
      const orderRows = (rows) => {
        const ordered = view.orderBy === 'manual' ? rows : rows.slice().sort(byRecency)
        if (currentBlankId === undefined) return ordered
        const index = ordered.findIndex((row) => row?.blank && (row.id === currentBlankId || row.rawId === currentBlankId))
        if (index <= 0) return ordered
        const next = ordered.slice()
        const [blank] = next.splice(index, 1)
        return [blank, ...next]
      }

      //#region 拖拽排序（会话 / 工作区；本机与远端同一套语义）

      const [drag, setDrag] = React.useState(null)
      const [dropHint, setDropHint] = React.useState(null)
      const dragRef = React.useRef(null)

      const isInteractiveTarget = (event) =>
        Boolean(event.target?.closest?.('button, input, textarea, select, [contenteditable="true"]'))

      const startDrag = (event, payload) => {
        // 从 ⋯ / 归档按钮 / 搜索框开始拖会把点击也吞掉，直接让原生行为赢
        if (isInteractiveTarget(event)) {
          event.preventDefault()
          return
        }
        dragRef.current = payload
        setDrag(payload)
        setDropHint(null)
        // 拖拽即切「手动排序」：否则视图按「最近更新」排，落点锚点与手动序对不上，
        // 松手后会跳到意想不到的位置（官方也是拖完就进入手动序）。切完重渲染，
        // 用户接下来看到的顺序就是将被写回的顺序。
        setView((previous) => (previous.orderBy === 'manual' ? previous : { ...previous, orderBy: 'manual' }))
        try {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', payload.id)
        } catch {
          /* 某些合成事件的 dataTransfer 是只读的，不影响 React 内部状态 */
        }
      }

      const endDrag = () => {
        dragRef.current = null
        setDrag(null)
        setDropHint(null)
      }

      const dragFailed = (error) => {
        console.error('[peerbar] 排序失败', error)
        setNotice(tr('tree.reorderFailed', { reason: String(error?.message ?? error) }))
        endDrag()
      }

      /** 拖拽即切「手动排序」（官方同款行为），并落盘（见 useView 的持久化 effect）。 */
      const wantManualOrder = () => {
        setView((previous) => (previous.orderBy === 'manual' ? previous : { ...previous, orderBy: 'manual' }))
      }

      const reorderSession = async (source, beforeId) => {
        wantManualOrder()
        try {
          if (source.hostId) {
            await services.insertRemoteSessionBefore(source.hostId, source.workspaceId, source.id, beforeId)
            await refresh()
          } else {
            const result = services.insertSessionBefore(source.workspaceId, source.id, beforeId)
            if (result === undefined) throw new Error('本机排序服务不可用')
            await result
          }
        } catch (error) {
          dragFailed(error)
        }
      }

      const reorderWorkspace = async (source, beforeId) => {
        wantManualOrder()
        try {
          if (source.hostId) {
            await services.insertRemoteWorkspaceBefore(source.hostId, source.workspaceId, beforeId)
            await refresh()
          } else {
            const result = services.insertBefore(source.workspaceId, beforeId)
            if (result === undefined) throw new Error('本机排序服务不可用')
            await result
          }
        } catch (error) {
          dragFailed(error)
        }
      }

      /** 会话行：只允许同组内拖（跨 Host / 跨组一律不接）。 */
      const sessionDragProps = (session, host, workspace, key, rows) => {
        if (view.groupBy === 'flat' || !workspace?.workspaceId) return null
        const workspaceKey = host ? `remote:${host.hostId}:${workspace.id}` : `local:${workspace.workspaceId}`
        const hostId = host?.hostId ?? null
        const id = host ? session.rawId : session.id
        // accepts 必须在事件里现算：dragstart 只改 ref，目标行要等下一次 React 渲染
        // 才会拿到新 props；把判断烘焙到渲染期会导致「第一次拖永远不生效」。
        const accepts = () => {
          const source = dragRef.current
          return source?.kind === 'session' && source.workspaceKey === workspaceKey && source.key !== key
        }
        return {
          draggable: true,
          dragging: drag?.kind === 'session' && drag.key === key,
          marker: dropHint?.key === key ? dropHint.half : null,
          onStart: (event) => startDrag(event, { kind: 'session', hostId, workspaceKey, workspaceId: workspace.workspaceId, id, key }),
          onOver: (event) => {
            if (!accepts()) return
            event.preventDefault()
            event.stopPropagation()
            const half = event.clientY < event.currentTarget.getBoundingClientRect().top + event.currentTarget.offsetHeight / 2 ? 'before' : 'after'
            try {
              event.dataTransfer.dropEffect = 'move'
            } catch { /* 忽略 */ }
            setDropHint((previous) => (previous?.key === key && previous.half === half ? previous : { key, half }))
          },
          onDrop: (event) => {
            const source = dragRef.current
            if (!accepts()) return
            event.preventDefault()
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()
            const half = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
            const index = rows.findIndex((row) => (host ? row.rawId : row.id) === id)
            const next = index >= 0 ? rows[index + 1] : undefined
            const beforeId = half === 'before' ? id : next ? (host ? next.rawId : next.id) : undefined
            if (beforeId === source.id) {
              endDrag()
              return
            }
            void reorderSession(source, beforeId)
            endDrag()
          },
          onEnd: endDrag,
          onLeave: (event) => {
            if (event.currentTarget.contains(event.relatedTarget)) return
            setDropHint((previous) => (previous?.key === key ? null : previous))
          },
        }
      }

      /** 工作区行：同 Host 内排序；未分组 / 退化组没有 workspaceId，不接。 */
      const workspaceDragProps = (host, workspace, groupKey, siblings) => {
        if (!workspace?.workspaceId) return null
        const hostId = host?.hostId ?? null
        const accepts = () => {
          const source = dragRef.current
          return source?.kind === 'workspace' && source.hostId === hostId && source.groupKey !== groupKey
        }
        return {
          draggable: true,
          dragging: drag?.kind === 'workspace' && drag.groupKey === groupKey,
          marker: dropHint?.key === groupKey ? dropHint.half : null,
          onStart: (event) =>
            startDrag(event, {
              kind: 'workspace',
              hostId,
              workspaceId: workspace.workspaceId,
              groupKey,
            }),
          onOver: (event) => {
            if (!accepts()) return
            event.preventDefault()
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()
            const half = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
            try {
              event.dataTransfer.dropEffect = 'move'
            } catch { /* 忽略 */ }
            setDropHint((previous) => (previous?.key === groupKey && previous.half === half ? previous : { key: groupKey, half }))
          },
          onDrop: (event) => {
            const source = dragRef.current
            if (!accepts()) return
            event.preventDefault()
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()
            const half = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
            const index = siblings.findIndex((sibling) => sibling.key === groupKey)
            const next = index >= 0 ? siblings[index + 1] : undefined
            const beforeId = half === 'before' ? workspace.workspaceId : next?.workspace.workspaceId
            if (beforeId === source.workspaceId) {
              endDrag()
              return
            }
            void reorderWorkspace(source, beforeId)
            endDrag()
          },
          onEnd: endDrag,
          onLeave: (event) => {
            if (event.currentTarget.contains(event.relatedTarget)) return
            setDropHint((previous) => (previous?.key === groupKey ? null : previous))
          },
        }
      }

      //#endregion

      const local = React.useMemo(() => {
        const used = new Set()
        const groups = (workspaces ?? []).map((workspace) => {
          const rows = (workspace.sessionIds ?? [])
            .map((id) => {
              used.add(id)
              return list.byId?.[id]
            })
            .filter(visibleSession)
          return { key: `local:${workspace.workspaceId}`, workspace, rows: orderRows(rows) }
        })
        const ungrouped = orderRows(
          (list.ids ?? [])
            .map((id) => list.byId?.[id])
            .filter((session) => session && !used.has(session.id) && visibleSession(session)),
        )
        return { groups, ungrouped }
      }, [workspaces, list, archived, currentBlankId, lowered, view.archived])

      const remoteGroups = React.useMemo(() => {
        const groups = []
        for (const host of state?.hosts ?? []) {
          // 手动排序按 registry 顺序（宿主半在组上带 order）；默认仍按最近活动。
          const workspaces = (host.workspaces ?? []).slice()
          if (view.orderBy === 'manual') {
            workspaces.sort(
              (a, b) =>
                (a.ungrouped ? 1 : 0) - (b.ungrouped ? 1 : 0)
                || (a.order ?? 0) - (b.order ?? 0)
                || String(a.name ?? '').localeCompare(String(b.name ?? '')),
            )
          }
          for (const workspace of workspaces) {
            const rows = orderRows((workspace.sessions ?? []).filter(visibleRemoteSession))
            // 未分组桶没有可见行时整组不出现（与官方一致；注册工作区即使空也显示）
            if (workspace.ungrouped && rows.length === 0) continue
            groups.push({ key: `remote:${host.hostId}:${workspace.id}`, host, workspace, rows })
          }
        }
        return groups
      }, [state, currentBlankId, lowered, view.archived, view.orderBy])

      /**
       * 把本机 / 远端的原始 session 归一成同一种 TreeSession。
       *
       * 渲染层只认这套字段，不再在 JSX 里散落 `host ? rawId : id`、
       * `host ? lastActivityAt : updatedAt` 之类的分支。数据来源仍保持两份：
       * 本机来自 slot 的 `useSessions`，远端来自 `/state`。
       */
      const toTreeSession = (session, host, workspace) => {
        const remote = Boolean(host)
        const id = remote ? session.rawId : session.id
        const isArchived = remote ? session.archived === true : archived.has(id)
        const isPinned = remote ? session.pinned === true : pinned.has(id)
        const status = remote ? remoteStatus.get(id) : null
        return {
          key: remote ? `r:${id}` : `l:${id}`,
          id,
          raw: session,
          host: host ?? null,
          workspace,
          remote,
          title: session.blank ? tr('session.new') : session.title || tr('session.untitled'),
          time: session.blank ? '' : timeLabel(remote ? session.lastActivityAt : session.updatedAt),
          // 远端：running → ongoing；后台完成未读 → done；其余 idle（不画点）
          state: remote
            ? status?.unread === true
              ? 'done'
              : session.running
                ? 'ongoing'
                : 'idle'
            : session.running
              ? 'ongoing'
              : 'idle',
          selected: id === mainSessionId,
          pinned: isPinned,
          archived: isArchived,
          stale: remote ? host.status !== 'online' : false,
          cwd: workspace.cwd ?? session.cwd,
        }
      }

      const openRemote = async (host, session, workspace) => {
        if (host.status !== 'online') {
          setNotice(tr('tree.offline', { host: host.name }))
          return
        }
        try {
          const raw = await remoteFetch(
            host.hostId,
            `/session?hostId=${encodeURIComponent(host.hostId)}&id=${encodeURIComponent(session.rawId)}&limit=200&raw=1`,
          )
          const binding = createRemoteBinding({
            ctx: props.nativeCtx ?? {},
            hostId: host.hostId,
            hostName: host.name,
            sessionId: session.rawId,
            records: raw.records ?? [],
            values: raw.values ?? null,
            hasMore: raw.hasMore === true,
            summary: {
              id: session.rawId,
              title: session.blank ? tr('session.new') : session.title || tr('session.untitled'),
              displayTitle: session.title || workspace?.name || session.rawId,
              updatedAt: session.lastActivityAt,
              running: session.running === true,
              // 真实空白态：侧栏靠 `list.byId[current].blank` 判定 currentBlankId，
              // 写死 false 会让刚建的会话在侧栏被 blank 过滤掉（要等 5s 探活）
              blank: session.blank === true,
              cwd: workspace?.cwd,
            },
          })
          const sessions = installRemoteSessions(props.nativeCtx ?? {})
          if (sessions?.__peerbarRegistry) {
            // 换绑时释放旧 binding 的轮询定时器
            const previous = sessions.__peerbarRegistry.get(session.rawId)
            if (previous && previous !== binding && typeof previous.dispose === 'function') previous.dispose()
            sessions.__peerbarRegistry.set(session.rawId, binding)
            // 立刻让 uiSession 订阅我们的 retainInfo，这样 publish() 能触发 publishMain
            try {
              const uiSession = typeof props.nativeCtx?.get === 'function' ? props.nativeCtx.get('uiSession') : props.nativeCtx?.uiSession
              if (uiSession) {
                if (typeof uiSession.watchMainRetention === 'function') uiSession.watchMainRetention(session.rawId)
                if (typeof uiSession.publishMain === 'function') uiSession.publishMain()
              }
            } catch { /* 不阻塞 */ }
          }
          props.openSession(session.rawId)
          markRemoteRead(session.rawId)
          return
        } catch (error) {
          console.error('[peerbar] 原生渲染失败', error)
          setNotice(tr('tree.nativeFailed'))
        }
      }

      const toggleOverflow = (key) => {
        setOverflowAll((previous) => {
          const next = new Set(previous)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      }

      const requestRenameSession = (session, host) =>
        setDialog({
          kind: 'session',
          title: tr('dialog.renameSession'),
          value: session.title,
          session,
          host,
        })

      const submitDialog = async () => {
        if (!dialog) return
        const value = String(dialog.value ?? '').trim()
        if (dialog.kind === 'session' && value) {
          if (dialog.host) await services.renameRemoteSession(dialog.host.hostId, dialog.session.rawId, value)
          else await services.renameSession(dialog.session.id, value)
          await refresh()
        }
        if (dialog.kind === 'workspace' && value) {
          if (dialog.host) await services.renameRemoteWorkspace(dialog.host.hostId, dialog.workspace.workspaceId, value)
          else await services.renameWorkspace(dialog.workspace.workspaceId, value)
          await refresh()
        }
        if (dialog.kind === 'delete-workspace') {
          if (dialog.host) await services.deleteRemoteWorkspace(dialog.host.hostId, dialog.workspace.workspaceId)
          else await services.deleteWorkspace(dialog.workspace.workspaceId)
          await refresh()
        }
      }

      /**
       * 会话菜单（本机 / 远端共用一套描述）。
       *
       * 两边只有「用哪个服务、是否刷新 /state」不同；标签、图标、快捷键和
       * 排序都一致，没必要维护两份数组。
       */
      const sessionMenuItems = (row) => {
        const { remote, host, id, raw: session, pinned: isPinned, archived: isArchived } = row
        if (remote && host.status !== 'online') return []
        const run = async (fn) => {
          try {
            await fn()
            if (remote) await refresh()
          } catch (error) {
            console.error('[peerbar] 会话操作失败', error)
            setNotice(String(error?.message ?? error))
          }
        }
        const pin = () =>
          remote
            ? isPinned
              ? services.unpinRemoteSession(host.hostId, id)
              : services.pinRemoteSession(host.hostId, id)
            : isPinned
              ? services.unpinSession(id)
              : services.pinSession(id)
        const fork = () => (remote ? services.forkRemoteSession(host.hostId, id) : services.forkSession(id))
        const archive = () =>
          remote
            ? isArchived
              ? services.unarchiveRemoteSession(host.hostId, id)
              : services.archiveRemoteSession(host.hostId, id)
            : isArchived
              ? services.unarchiveSession(id)
              : services.archiveSession(id)
        const copy = () => services.copySessionId(id)
        const shortcut = (aria, keys) => (remote ? undefined : { aria, keys })
        return [
          {
            id: 'pin',
            label: isPinned ? tr('menu.unpin') : tr('menu.pin'),
            icon: prim(isPinned ? 'IconPinFillRegular' : 'IconPinOutlineRegular'),
            onSelect: () => run(pin),
          },
          {
            id: 'rename',
            label: tr('menu.rename'),
            icon: prim('IconEditOutlineRegular'),
            shortcut: shortcut('Control+Alt+G', ['Ctrl', 'Alt', 'G']),
            onSelect: () => requestRenameSession(session, host),
          },
          {
            id: 'fork',
            label: tr('menu.fork'),
            icon: prim('IconBranchOutlineRegular'),
            shortcut: shortcut('Control+Alt+F', ['Ctrl', 'Alt', 'F']),
            onSelect: () => run(fork),
          },
          {
            id: 'archive',
            label: isArchived ? tr('menu.unarchive') : tr('menu.archive'),
            icon: prim(isArchived ? 'IconUnarchiveOutlineRegular' : 'IconArchiveOutlineRegular'),
            shortcut: shortcut('Control+Shift+A', ['Ctrl', 'Shift', 'A']),
            onSelect: () => run(archive),
          },
          {
            id: 'copy-id',
            label: tr('menu.copyId'),
            icon: prim('IconCopyOutlineRegular'),
            onSelect: () => run(copy),
          },
        ]
      }

      const workspaceMenuItems = (workspace, host) => {
        const remote = Boolean(host)
        if (remote && host.status !== 'online') return []
        // 只有注册工作区有管理操作；未分组桶/无 workspaceId 的组不渲染菜单
        if (remote && !workspace.workspaceId) return []
        const name = remote ? workspace.name : workspace.title
        return [
          {
            id: 'rename',
            label: tr('menu.renameWorkspace'),
            icon: prim('IconEditOutlineRegular'),
            onSelect: () =>
              setDialog({
                kind: 'workspace',
                title: tr('dialog.renameWorkspace'),
                value: name || '',
                workspace,
                host,
              }),
          },
          {
            id: 'delete',
            label: tr('menu.deleteWorkspace'),
            icon: prim('IconTrashOutlineRegular'),
            danger: true,
            onSelect: () =>
              setDialog({
                kind: 'delete-workspace',
                title: tr('dialog.deleteWorkspace'),
                description: tr('dialog.deleteWorkspaceDesc', { name: name || '' }),
                workspace,
                host,
              }),
          },
        ]
      }

      const renderSession = (row, rows) => {
        const { host, workspace, remote, raw: session, id, pinned: isPinned, archived: isArchived } = row
        const runWrite = async (fn) => {
          try {
            await fn()
            if (remote) await refresh()
          } catch (error) {
            console.error('[peerbar] 会话操作失败', error)
            setNotice(String(error?.message ?? error))
          }
        }
        const pin = () =>
          remote
            ? isPinned
              ? services.unpinRemoteSession(host.hostId, id)
              : services.pinRemoteSession(host.hostId, id)
            : isPinned
              ? services.unpinSession(id)
              : services.pinSession(id)
        const archive = () =>
          remote
            ? isArchived
              ? services.unarchiveRemoteSession(host.hostId, id)
              : services.archiveRemoteSession(host.hostId, id)
            : isArchived
              ? services.unarchiveSession(id)
              : services.archiveSession(id)
        const actions = (menuOpen, setMenuOpen) => [
          React.createElement(RowMenu, {
            key: 'menu',
            label: tr('menu.sessionAria', { name: row.title }),
            items: sessionMenuItems(row),
            onOpenChange: setMenuOpen,
          }),
          React.createElement(IconAction, {
            key: 'archive',
            icon: isArchived ? 'IconUnarchiveOutlineRegular' : 'IconArchiveOutlineRegular',
            label: isArchived ? tr('menu.unarchive') : tr('menu.archive'),
            size: 14,
            onClick: () => runWrite(archive),
          }),
          React.createElement(IconAction, {
            key: 'pin',
            icon: isPinned ? 'IconPinFillRegular' : 'IconPinOutlineRegular',
            label: isPinned ? tr('menu.unpin') : tr('menu.pin'),
            active: isPinned,
            size: 14,
            onClick: () => runWrite(pin),
          }),
        ]
        return React.createElement(SessionRow, {
          key: row.key,
          title: row.title,
          time: row.time,
          state: row.state,
          selected: row.selected,
          pinned: row.pinned,
          archived: row.archived,
          stale: row.stale,
          cwd: row.cwd,
          actions,
          onOpen: () => (remote ? openRemote(host, session, workspace) : openSession(id)),
          onRename: () => requestRenameSession(session, host),
          // 归档行不参与排序（与官方一致）
          drag: isArchived ? null : sessionDragProps(session, host, workspace, row.key, rows),
        })
      }

      const renderRows = (key, rows, host, workspace) => {
        const modeled = rows.map((session) => toTreeSession(session, host, workspace))
        const showAll = overflowAll.has(key)
        const shown = showAll ? modeled : modeled.slice(0, 8)
        const parts = shown.map((row) => renderSession(row, modeled))
        // 原生：溢出按钮一直在（展开时变「收起」）；缩进由 depth 决定，顶层工作区下是 0
        if (rows.length > 8) {
          parts.push(
            React.createElement(
              'button',
              {
                key: `${key}:more`,
                type: 'button',
                className: 'hP3ldq_sessionOverflowButton',
                onClick: () => toggleOverflow(key),
              },
              showAll
                ? tr('tree.collapse')
                // 原生传的是 hiddenCount（被折叠的条数），不是总数
                : tr('tree.overflow', { n: rows.length - shown.length }),
            ),
          )
        }
        return React.createElement('div', null, parts)
      }

      /**
       * 工作区行（本机 / 远端共用）。
       *
       * `extra` 放 Host 标签与降级图标，`meta` 放「连不上」这类不可操作状态；
       * 两者都不改行骨架，远端组不再内联复制一份 project row。
       */
      const renderProjectRow = ({ key, label, extra, meta, open, active, onToggle, menuItems, onNew, actionsDisabled, drag }) =>
        React.createElement(
          'div',
          {
            key,
            className:
              'koUx-W_projectRow'
              + (drag?.dragging ? ' dshp-dragging' : '')
              + (drag?.marker ? ` dshp-drop-${drag.marker}` : ''),
            role: 'treeitem',
            'aria-expanded': open,
            draggable: Boolean(drag?.draggable),
            onDragStart: drag?.onStart,
            onDragOver: drag?.onOver,
            onDragLeave: drag?.onLeave,
            onDrop: drag?.onDrop,
            onDragEnd: drag?.onEnd,
            onClick: onToggle,
          },
          React.createElement(
            'span',
            // 原生：当前会话所在、且已展开的工作区，文件夹染成 business-primary
            { className: 'koUx-W_slot koUx-W_folder' + (active ? ' koUx-W_folderActive' : '') },
            prim(open ? 'IconFolderOpenRegular' : 'IconFolderCloseRegular'),
          ),
          React.createElement(
            'span',
            { className: 'koUx-W_slot koUx-W_chevron' },
            React.createElement(
              'span',
              { className: open ? 'koUx-W_arrow koUx-W_arrowOpen' : 'koUx-W_arrow' },
              prim('IconTriangleRightFillRegular'),
            ),
          ),
          React.createElement(
            'span',
            { className: 'koUx-W_projectText' },
            React.createElement(
              'span',
              { style: { display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 } },
              React.createElement('span', { className: 'koUx-W_title' }, label),
              extra ?? null,
            ),
          ),
          meta
            ? meta
            : actionsDisabled
              ? null
              : React.createElement(
                  'span',
                  { className: 'koUx-W_rowActions' },
                  menuItems ? React.createElement(RowMenu, { label: tr('menu.workspaceAria', { name: label }), items: menuItems }) : null,
                  onNew
                    ? React.createElement(IconAction, {
                        icon: 'IconNewChatOutlineRegular',
                        label: tr('tree.newSession'),
                        onClick: onNew,
                      })
                    : null,
                ),
        )

      const renderLocalGroup = (group) => {
        const { workspace, rows, key } = group
        const open = lowered ? true : fold.isOpen(key, true)
        // 原生 ProjectRowItem：active = 展开 && 本组包含当前会话
        const containsCurrent = mainSessionId !== undefined && (workspace.sessionIds ?? []).includes(mainSessionId)
        return React.createElement(
          'div',
          { key, role: 'treeitem' },
          renderProjectRow({
            key,
            label: workspace.title || basename(workspace.path) || workspace.workspaceId,
            open,
            active: open && containsCurrent,
            onToggle: () => fold.toggle(key, true),
            menuItems: workspaceMenuItems(workspace),
            onNew: () => openWorkspace?.(workspace.workspaceId),
            drag: workspaceDragProps(null, workspace, key, local.groups),
          }),
          open
            ? rows.length > 0
              ? renderRows(key, rows, null, workspace)
              : React.createElement('div', { className: 'hP3ldq_empty' }, lowered ? tr('tree.noMatch') : tr('tree.empty'))
            : null,
        )
      }

      const renderRemoteGroup = (group) => {
        const { host, workspace, rows, key } = group
        const offline = host.status !== 'online'
        const open = lowered ? true : fold.isOpen(key, false)
        // 未分组桶 / baseline 缺失（无 workspaceId）的组没有工作区级操作：
        // 不给 ⋯ 菜单也不给 +（否则只能弹「信息未就绪」）
        const manageable = !workspace.ungrouped && Boolean(workspace.workspaceId)
        const label = workspace.ungrouped ? tr('tree.ungrouped') : workspace.name || workspace.cwd || ''
        const containsCurrent =
          mainSessionId !== undefined && (workspace.sessions ?? []).some((session) => session.rawId === mainSessionId)
        // 同 Host 内可排序的组（未分组 / 退化组没有 workspaceId，不参与）
        const sortableSiblings = remoteGroups.filter(
          (candidate) => candidate.host.hostId === host.hostId && candidate.workspace.workspaceId && !candidate.workspace.ungrouped,
        )
        const wsDrag = workspaceDragProps(host, workspace, key, sortableSiblings)
        const newRemoteSession = async () => {
          if (!workspace.workspaceId) return
          try {
            const value = await services.createRemoteSession(host.hostId, workspace.workspaceId)
            const created = value?.sessionId
            await refresh()
            if (created) {
              // 新会话直接打开（原生 composer 可用）
              openRemote(host, { rawId: created, title: null, blank: true }, workspace)
            }
          } catch (error) {
            console.error('[peerbar] 远端新建会话失败', error)
            setNotice(String(error?.message ?? error))
          }
        }
        return React.createElement(
          'div',
          { key, role: 'treeitem', style: offline ? { opacity: 0.55 } : undefined },
          renderProjectRow({
            key,
            label,
            open,
            active: open && containsCurrent,
            onToggle: () => fold.toggle(key, false),
            menuItems: manageable ? workspaceMenuItems(workspace, host) : null,
            onNew: manageable
              ? () => {
                  void newRemoteSession()
                }
              : null,
            actionsDisabled: !manageable,
            meta: offline
              ? React.createElement(
                  'span',
                  { className: 'koUx-W_meta', style: { flex: '0 0 auto', color: statusColor(host.status) } },
                  statusLabel(host.status),
                )
              : null,
            extra: React.createElement(
              React.Fragment,
              null,
              React.createElement('span', { key: 'tag', className: 'dshp-tag', style: { color: hostColor(host) } }, host.name),
              // T9：baseline 读失败时工作区菜单/「+」会静默消失，这里给个明确原因
              host.registryError
                ? React.createElement(
                    'span',
                    {
                      key: 'registry',
                      className: 'dshp-degraded',
                      title: tr('tree.registryDegraded', { host: host.name, reason: host.registryError }),
                    },
                    prim('IconInfoCircleOutlineRegular'),
                  )
                : null,
              // T14：深端点探测失败 → 远端 dsh 版本可能与本插件不兼容
              host.compatError
                ? React.createElement(
                    'span',
                    {
                      key: 'compat',
                      className: 'dshp-degraded',
                      title: tr('tree.compatMismatch', { host: host.name, reason: host.compatError }),
                    },
                    prim('IconWarningOutlineRegular'),
                  )
                : null,
            ),
            drag: wsDrag,
          }),
          open
            ? rows.length > 0
              ? renderRows(key, rows, host, workspace)
              : React.createElement('div', { className: 'hP3ldq_empty' }, lowered ? tr('tree.noMatch') : tr('tree.empty'))
            : null,
        )
      }

      const flatSessions = React.useMemo(
        () => orderRows(local.groups.flatMap((group) => group.rows).concat(local.ungrouped)),
        [local],
      )

      return React.createElement(
        'div',
        { className: 'dshp-root' },
        React.createElement(
          'div',
          { className: 'hP3ldq_sectionHeader' },
          React.createElement(
            'span',
            { className: 'hP3ldq_sectionLabel' + (searchOpen || query ? ' hP3ldq_sectionLabelHidden' : '') },
            view.groupBy === 'flat' ? tr('tree.sessions') : tr('tree.title'),
          ),
          React.createElement(
            'div',
            { className: 'hP3ldq_searchSlot' + (searchOpen || query ? ' hP3ldq_searchSlotExpanded' : '') },
            React.createElement(
              'div',
              {
                className: 'hP3ldq_search' + (searchOpen || query ? ' hP3ldq_searchExpanded' : ''),
                onClick: () => setSearchOpen(true),
              },
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'hP3ldq_searchButton',
                  'aria-label': tr('tree.search'),
                  'aria-expanded': Boolean(searchOpen),
                  onClick: (event) => {
                    event.stopPropagation()
                    setSearchOpen(true)
                  },
                },
                prim('IconSearchOutlineRegular', { size: searchOpen ? 11 : 14 }),
              ),
              React.createElement('input', {
                ref: searchInputRef,
                className: 'hP3ldq_searchInput',
                value: query,
                placeholder: tr('tree.searchPlaceholder'),
                tabIndex: searchOpen || query ? 0 : -1,
                onChange: (event) => setQuery(event.target.value),
                onKeyDown: (event) => {
                  if (event.key !== 'Escape') return
                  setQuery('')
                  setSearchOpen(false)
                },
              }),
              searchOpen || query
                ? React.createElement(
                    'button',
                    {
                      type: 'button',
                      className: 'hP3ldq_clearButton',
                      'aria-label': tr('tree.searchClear'),
                      onClick: (event) => {
                        event.stopPropagation()
                        setQuery('')
                        setSearchOpen(false)
                      },
                    },
                    prim('IconCloseFillRegular'),
                  )
                : null,
            ),
          ),
          React.createElement(
            'div',
            { className: 'hP3ldq_headerActions' + (searchOpen || query ? ' hP3ldq_headerActionsHidden' : '') },
            React.createElement(IconAction, {
              icon: 'IconProjectAddOutlineRegular',
              label: tr('tree.addWorkspace'),
              onClick: () => setAddOpen(true),
            }),
            React.createElement(ViewOptionsMenu, {
              view,
              onChange: (patch) => setView((previous) => ({ ...previous, ...patch })),
            }),
          ),
        ),
        error ? React.createElement('div', { className: 'dshp-error' }, tr('tree.remoteError')) : null,
        notice ? React.createElement('div', { className: 'dshp-notice' }, notice) : null,
        React.createElement(
          'div',
          { className: 'dshp-scroll' },
          view.groupBy === 'flat'
            ? renderRows('local:flat', flatSessions, null, {})
            : local.groups.map(renderLocalGroup),
          view.groupBy === 'flat' ? null : local.ungrouped.length > 0
            ? React.createElement(
                'div',
                { key: 'local:ungrouped', role: 'treeitem' },
                renderProjectRow({
                  key: 'local:ungrouped',
                  label: tr('tree.ungrouped'),
                  open: fold.isOpen('local:ungrouped', true),
                  active:
                    fold.isOpen('local:ungrouped', true)
                    && local.ungrouped.some((session) => session.id === mainSessionId),
                  onToggle: () => fold.toggle('local:ungrouped', true),
                  menuItems: null,
                  onNew: null,
                  actionsDisabled: true,
                }),
                fold.isOpen('local:ungrouped', true) ? renderRows('local:ungrouped', local.ungrouped, null, {}) : null,
              )
            : null,
          remoteGroups.map(renderRemoteGroup),
        ),
        addOpen
          ? React.createElement(WorkspaceAddDialog, {
              open: true,
              onClose: () => setAddOpen(false),
              onLocalPick: async (path) => {
                await services.createLocalWorkspace(path)
                setAddOpen(false)
              },
              onRemoteCreated: async () => {
                setAddOpen(false)
                await refresh()
                setNotice(tr('tree.workspaceAdded'))
              },
              listLocal: (path) => services.listLocalDir(path),
              listRemote: (hostId, path) => services.listRemoteDir(hostId, path),
              pickLocal: () => services.pickLocalDir(),
              createRemote: (hostId, path) => services.createRemoteWorkspace(hostId, path),
            })
          : null,
        dialog
          ? React.createElement(Dialog, {
              title: dialog.title,
              description: dialog.description,
              value: dialog.value,
              placeholder: dialog.kind === 'workspace' ? tr('field.workspaceName') : tr('field.sessionName'),
              // 原生：重命名对话框的确认按钮就是“重命名”，删除对话框是“删除工作区”
              submitLabel: dialog.kind === 'delete-workspace' ? tr('dialog.deleteWorkspace') : tr('action.rename'),
              danger: dialog.kind === 'delete-workspace',
              onValue: (value) => setDialog((previous) => (previous ? { ...previous, value } : previous)),
              onSubmit: submitDialog,
              onClose: () => setDialog(null),
            })
          : null,
      )
    }

    //#region 设置分区

    function usePeerStateForSettings(intervalMs = 5000) {
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [tick, setTick] = React.useState(0)

      React.useEffect(() => {
        let alive = true
        const load = async () => {
          if (document.visibilityState === 'hidden') return
          try {
            const next = await request('/state')
            if (!alive) return
            setState(next)
            setError(null)
          } catch (cause) {
            if (alive) setError(cause)
          }
        }
        void load()
        const timer = setInterval(load, intervalMs)
        const onVisible = () => {
          if (document.visibilityState === 'visible') void load()
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          alive = false
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [intervalMs, tick])

      return { state, error, reload: () => setTick((value) => value + 1) }
    }

    const styles = {
      page: { height: '100%', overflow: 'auto', padding: '18px 20px 40px', color: 'inherit', fontSize: 13, lineHeight: 1.5 },
      title: { fontSize: 15, fontWeight: 600, margin: '0 0 6px' },
      hint: { opacity: 0.62, fontSize: 12, margin: '0 0 14px' },
      subTitle: { fontSize: 13, fontWeight: 600, margin: '0 0 8px', opacity: 0.75 },
      divider: { height: 1, background: 'rgba(128,128,128,0.18)', margin: '18px 0 14px', border: 0 },
      card: { border: '1px solid rgba(128,128,128,0.24)', borderRadius: 10, padding: '10px 12px', marginBottom: 8, background: 'rgba(128,128,128,0.03)' },
      cardTop: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
      cardName: { fontWeight: 600, flex: '0 0 auto' },
      cardMeta: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, minHeight: 24 },
      dot: { width: 8, height: 8, borderRadius: 999, flex: '0 0 auto' },
      origin: { opacity: 0.55, fontSize: 11, fontFamily: 'ui-monospace, monospace' },
      spacer: { flex: 1 },
      badge: { fontSize: 11, padding: '1px 7px', borderRadius: 999, border: '1px solid rgba(128,128,128,0.32)', whiteSpace: 'nowrap' },
      muted: { opacity: 0.55, fontSize: 11 },
      buttonPrimary: { font: 'inherit', fontSize: 12, lineHeight: 1.4, color: '#fff', background: '#2f81f7', border: '1px solid #2f81f7', borderRadius: 6, padding: '5px 14px', cursor: 'pointer', whiteSpace: 'nowrap', boxSizing: 'border-box' },
      smallButton: { font: 'inherit', fontSize: 12, lineHeight: 1.4, color: 'inherit', background: 'transparent', border: '1px solid rgba(128,128,128,0.32)', borderRadius: 6, padding: '3px 9px', cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto' },
      tokenRow: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 },
      colorRow: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 },
      form: { display: 'grid', gap: 12, maxWidth: 560 },
      formGrid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' },
      field: { display: 'grid', gap: 4, minWidth: 0 },
      label: { fontSize: 12, opacity: 0.75 },
      input: { font: 'inherit', fontSize: 13, color: 'inherit', background: 'transparent', border: '1px solid rgba(128,128,128,0.36)', borderRadius: 6, padding: '6px 9px', width: '100%', boxSizing: 'border-box' },
      error: { color: '#cf222e', fontSize: 12 },
      ok: { color: '#2ea043', fontSize: 12 },
      banner: { border: '1px solid rgba(207,34,46,0.4)', background: 'rgba(207,34,46,0.08)', borderRadius: 8, padding: '8px 10px', marginBottom: 12, fontSize: 12 },
      empty: { padding: '10px 12px', opacity: 0.6 },
    }

    function HostCard({
      host,
      pending,
      editing,
      confirming,
      renaming,
      nameDraft,
      colorDraft,
      tokenDraft,
      canUp,
      canDown,
      onNameDraft,
      onColorDraft,
      onToggleRename,
      onSaveName,
      onTokenDraft,
      onProbe,
      onRemove,
      onToggleEdit,
      onSaveToken,
      onToggleEnabled,
      onMoveUp,
      onMoveDown,
    }) {
      const status = host.status ?? 'unreachable'
      const nameRow = renaming
        ? React.createElement(
            'div',
            { style: styles.cardTop },
            React.createElement('span', { style: { ...styles.dot, background: statusColor(status) } }),
            React.createElement('input', {
              style: { ...styles.input, flex: 1, minWidth: 0 },
              value: nameDraft,
              autoFocus: true,
              onChange: (event) => onNameDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') onSaveName()
                if (event.key === 'Escape') onToggleRename()
              },
            }),
            React.createElement('button', { style: styles.buttonPrimary, disabled: pending || !nameDraft.trim(), onClick: onSaveName }, tr('action.save')),
            React.createElement('button', { style: styles.smallButton, disabled: pending, onClick: onToggleRename }, tr('action.cancel')),
          )
        : React.createElement(
            'div',
            { style: styles.cardTop },
            React.createElement('span', { style: { ...styles.dot, background: statusColor(status) } }),
            React.createElement(
              'span',
              { style: { ...styles.cardName, cursor: 'pointer' }, title: tr('action.rename'), onClick: onToggleRename },
              host.name,
            ),
            React.createElement('span', { style: { ...styles.origin, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: host.origin }, host.origin),
            React.createElement('span', { style: styles.spacer }),
            React.createElement('span', { style: { ...styles.badge, color: statusColor(status), borderColor: statusColor(status) } }, statusLabel(status)),
          )

      return React.createElement(
        'div',
        { style: styles.card },
        nameRow,
        renaming
          ? React.createElement(
              'div',
              { style: styles.colorRow },
              React.createElement('span', { style: styles.muted }, tr('field.color')),
              HOST_COLORS.map((color) =>
                React.createElement('button', {
                  key: color,
                  title: color,
                  'aria-label': color,
                  'aria-pressed': (colorDraft ?? host.color) === color,
                  onClick: () => onColorDraft(color),
                  style: {
                    width: 16,
                    height: 16,
                    padding: 0,
                    borderRadius: 999,
                    cursor: 'pointer',
                    background: HOST_PALETTE[color],
                    border: '1px solid rgba(128,128,128,0.4)',
                    boxShadow: (colorDraft ?? host.color) === color ? '0 0 0 2px rgba(47,129,247,0.55)' : 'none',
                  },
                }),
              ),
            )
          : null,
        React.createElement(
          'div',
          { style: styles.cardMeta },
          React.createElement(
            'label',
            { style: { ...styles.muted, display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' } },
            React.createElement('input', { type: 'checkbox', checked: host.enabled !== false, disabled: pending, onChange: onToggleEnabled }),
            tr('field.enabled'),
          ),
          React.createElement('span', { style: styles.muted }, host.hasCookie ? 'cookie ✓' : tr('hint.noCookie')),
          host.status === 'online' && host.latencyMs ? React.createElement('span', { style: styles.muted }, `${host.latencyMs}ms`) : null,
          React.createElement('span', { style: styles.spacer }),
          React.createElement('button', { style: styles.smallButton, disabled: pending || !canUp, title: tr('action.moveUp'), onClick: onMoveUp }, '↑'),
          React.createElement('button', { style: styles.smallButton, disabled: pending || !canDown, title: tr('action.moveDown'), onClick: onMoveDown }, '↓'),
          React.createElement('button', { style: styles.smallButton, disabled: pending, onClick: onProbe }, tr('action.probe')),
          React.createElement('button', { style: styles.smallButton, disabled: pending, onClick: onToggleEdit }, tr('action.showToken')),
          React.createElement(
            'button',
            {
              style: {
                ...styles.smallButton,
                color: '#cf222e',
                borderColor: 'rgba(207,34,46,0.45)',
                background: confirming ? 'rgba(207,34,46,0.14)' : 'transparent',
              },
              disabled: pending,
              onClick: onRemove,
            },
            confirming ? tr('action.confirmDelete') : tr('action.delete'),
          ),
        ),
        editing
          ? React.createElement(
              'div',
              { style: styles.tokenRow },
              React.createElement('input', {
                style: { ...styles.input, flex: 1, minWidth: 0 },
                type: 'password',
                autoFocus: true,
                placeholder: tr('field.tokenPlaceholder'),
                value: tokenDraft,
                onChange: (event) => onTokenDraft(event.target.value),
              }),
              React.createElement('button', { style: styles.buttonPrimary, disabled: pending || !tokenDraft, onClick: onSaveToken }, tr('action.save')),
              React.createElement('button', { style: styles.smallButton, disabled: pending, onClick: onToggleEdit }, tr('action.cancel')),
            )
          : null,
      )
    }

    function PeersSection() {
      const { state, error, reload } = usePeerStateForSettings(5000)
      const [form, setForm] = React.useState({ name: '', origin: '', token: '', allowSelfSigned: false })
      const [message, setMessage] = React.useState(null)
      const [pending, setPending] = React.useState(false)
      const [editing, setEditing] = React.useState(null)
      const [confirming, setConfirming] = React.useState(null)
      const [renaming, setRenaming] = React.useState(null)
      const [nameDraft, setNameDraft] = React.useState('')
      const [colorDraft, setColorDraft] = React.useState(null)
      const [tokenDraft, setTokenDraft] = React.useState('')

      const hosts = state?.hosts ?? []

      React.useEffect(() => {
        if (!confirming) return undefined
        const timer = setTimeout(() => setConfirming(null), 4000)
        return () => clearTimeout(timer)
      }, [confirming])

      const submit = async (event) => {
        event.preventDefault()
        setPending(true)
        setMessage(null)
        try {
          await request('/hosts', { method: 'POST', body: JSON.stringify(form) })
          setForm({ name: '', origin: '', token: '', allowSelfSigned: false })
          setMessage({ kind: 'ok', text: tr('msg.added') })
          reload()
        } catch (cause) {
          const text = cause.code === 'bad-request' && /origin/i.test(cause.message) ? tr('msg.badOrigin') : cause.message
          setMessage({ kind: 'error', text })
        } finally {
          setPending(false)
        }
      }

      const remove = async (id) => {
        setPending(true)
        try {
          await request(`/hosts/${id}`, { method: 'DELETE' })
          reload()
        } catch (cause) {
          setMessage({ kind: 'error', text: cause.message })
        } finally {
          setPending(false)
        }
      }

      const probe = async (id) => {
        setPending(true)
        try {
          await request(`/hosts/${id}/probe`, { method: 'POST', body: '{}' })
          reload()
        } catch (cause) {
          setMessage({ kind: 'error', text: cause.message })
        } finally {
          setPending(false)
        }
      }

      const saveToken = async (id) => {
        setPending(true)
        try {
          await request(`/hosts/${id}`, { method: 'PATCH', body: JSON.stringify({ token: tokenDraft }) })
          setEditing(null)
          setTokenDraft('')
          reload()
        } catch (cause) {
          setMessage({ kind: 'error', text: cause.message })
        } finally {
          setPending(false)
        }
      }

      const toggleRename = (host) => {
        if (renaming === host.hostId) {
          setRenaming(null)
          return
        }
        setRenaming(host.hostId)
        setNameDraft(host.name)
        setColorDraft(host.color ?? HOST_COLORS[0])
      }

      const saveName = async (host) => {
        setPending(true)
        try {
          await request(`/hosts/${host.hostId}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: nameDraft.trim(), color: colorDraft ?? host.color }),
          })
          setRenaming(null)
          reload()
        } catch (cause) {
          setMessage({ kind: 'error', text: cause.message })
        } finally {
          setPending(false)
        }
      }

      const move = async (hostId, delta) => {
        const index = hosts.findIndex((host) => host.hostId === hostId)
        const target = index + delta
        if (index < 0 || target < 0 || target >= hosts.length) return
        const next = [...hosts]
        const [item] = next.splice(index, 1)
        next.splice(target, 0, item)
        setPending(true)
        try {
          await Promise.all(
            next.map((host, position) =>
              Number(host.order) === position
                ? null
                : request(`/hosts/${host.hostId}`, { method: 'PATCH', body: JSON.stringify({ order: position }) }),
            ),
          )
          reload()
        } catch (cause) {
          setMessage({ kind: 'error', text: cause.message })
        } finally {
          setPending(false)
        }
      }

      const toggleEnabled = async (host) => {
        setPending(true)
        try {
          await request(`/hosts/${host.hostId}`, { method: 'PATCH', body: JSON.stringify({ enabled: host.enabled === false }) })
          reload()
        } catch (cause) {
          setMessage({ kind: 'error', text: cause.message })
        } finally {
          setPending(false)
        }
      }

      return React.createElement(
        'div',
        { style: styles.page },
        React.createElement('h1', { style: styles.title }, tr('section.peers')),
        React.createElement('p', { style: styles.hint }, `${tr('section.hint')} · build ${BUILD}`),
        error ? React.createElement('div', { style: styles.banner }, error.message) : null,
        message ? React.createElement('div', { style: message.kind === 'error' ? styles.error : styles.ok }, message.text) : null,
        hosts.length === 0
          ? React.createElement('div', { style: styles.empty }, tr('empty.hosts'))
          : React.createElement(
              'div',
              null,
              React.createElement('h2', { style: styles.subTitle }, tr('section.registered')),
              hosts.map((host, index) =>
                React.createElement(HostCard, {
                  key: host.hostId,
                  host,
                  pending,
                  editing: editing === host.hostId,
                  confirming: confirming === host.hostId,
                  renaming: renaming === host.hostId,
                  nameDraft,
                  colorDraft,
                  canUp: index > 0,
                  canDown: index < hosts.length - 1,
                  tokenDraft,
                  onNameDraft: setNameDraft,
                  onColorDraft: setColorDraft,
                  onToggleRename: () => toggleRename(host),
                  onSaveName: () => saveName(host),
                  onTokenDraft: setTokenDraft,
                  onProbe: () => probe(host.hostId),
                  onToggleEnabled: () => toggleEnabled(host),
                  onMoveUp: () => move(host.hostId, -1),
                  onMoveDown: () => move(host.hostId, 1),
                  onRemove: () => {
                    if (confirming !== host.hostId) {
                      setConfirming(host.hostId)
                      return
                    }
                    setConfirming(null)
                    void remove(host.hostId)
                  },
                  onToggleEdit: () => {
                    setEditing(editing === host.hostId ? null : host.hostId)
                    setTokenDraft('')
                  },
                  onSaveToken: () => saveToken(host.hostId),
                }),
              ),
            ),
        React.createElement('hr', { style: styles.divider }),
        React.createElement(
          'form',
          { style: styles.form, onSubmit: submit },
          React.createElement('h2', { style: { ...styles.subTitle, opacity: 1 } }, tr('action.add')),
          React.createElement(
            'div',
            { style: styles.formGrid },
            React.createElement(
              'div',
              { style: styles.field },
              React.createElement('label', { style: styles.label }, tr('field.name')),
              React.createElement('input', {
                style: styles.input,
                value: form.name,
                placeholder: 'my-host',
                onChange: (event) => setForm({ ...form, name: event.target.value }),
              }),
            ),
            React.createElement(
              'div',
              { style: styles.field },
              React.createElement('label', { style: styles.label }, tr('field.origin')),
              React.createElement('input', {
                style: styles.input,
                value: form.origin,
                placeholder: 'https://10.0.0.10:3080',
                spellCheck: false,
                onChange: (event) => setForm({ ...form, origin: event.target.value }),
              }),
            ),
          ),
          React.createElement(
            'div',
            { style: styles.field },
            React.createElement('label', { style: styles.label }, tr('field.token')),
            React.createElement('input', {
              style: styles.input,
              type: 'password',
              placeholder: tr('field.tokenPlaceholder'),
              value: form.token,
              onChange: (event) => setForm({ ...form, token: event.target.value }),
            }),
            React.createElement('span', { style: styles.muted }, tr('field.tokenHint')),
          ),
          React.createElement(
            'label',
            { style: { ...styles.label, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' } },
            React.createElement('input', {
              type: 'checkbox',
              checked: form.allowSelfSigned,
              onChange: (event) => setForm({ ...form, allowSelfSigned: event.target.checked }),
            }),
            tr('field.insecure'),
          ),
          React.createElement(
            'div',
            null,
            React.createElement('button', { style: { ...styles.buttonPrimary, minWidth: 92 }, type: 'submit', disabled: pending || !form.origin }, tr('action.add')),
          ),
        ),
      )
    }

    //#endregion

    function apply(ctx) {
      console.info('[peerbar] client build', BUILD)

      // 应用级资源账本：补丁、轮询定时器、样式、远端绑定都必须能在卸载时
      // 还原/释放，否则重载插件会留下半残的全局拦截（第二次 apply 还会因为
      // `__peerbarPatched` 直接跳过安装）。
      const disposers = []
      const timers = new Set()
      const onDispose = (fn) => {
        if (typeof fn === 'function') disposers.push(fn)
      }
      /**
       * 服务可能晚于插件就绪：轮询直到 patch 成功，最多 15s。
       * 定时器登记在 timers 里，卸载时统一清掉，不把「等 service」的 interval
       * 留到页面生命周期之外。
       */
      const pollUntil = (patch, label) => {
        let done = false
        try {
          done = patch()
        } catch (error) {
          console.warn(`[peerbar] ${label} 安装失败`, error)
        }
        if (done) return
        let tries = 0
        const timer = setInterval(() => {
          tries += 1
          let installed = false
          try {
            installed = patch()
          } catch (error) {
            console.warn(`[peerbar] ${label} 安装失败`, error)
          }
          if (installed || tries >= 60) {
            clearInterval(timer)
            timers.delete(timer)
            if (!installed && tries >= 60) console.warn(`[peerbar] ${label} 服务一直没就绪`)
          }
        }, 250)
        timers.add(timer)
      }

      ctx.effect(() => {
        injectStyles()
        return () => {
          document.getElementById(STYLE_ID)?.remove()
        }
      }, 'peerbar: styles')

      ctx.effect(() => () => {
        for (const timer of timers) clearInterval(timer)
        timers.clear()
        for (const fn of disposers.splice(0).reverse()) {
          try {
            fn()
          } catch (error) {
            console.warn('[peerbar] 卸载清理失败', error)
          }
        }
        try {
          const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : ctx.sessions
          sessions?.__peerbarRestore?.()
        } catch (error) {
          console.warn('[peerbar] 还原 ISessions 补丁失败', error)
        }
        for (const binding of [...remoteBindings.values()]) {
          try {
            binding.dispose?.()
          } catch (error) {
            console.warn('[peerbar] 远端绑定释放失败', error)
          }
        }
        remoteBindings.clear()
        remoteStatus.clear()
      }, 'peerbar: patches')

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'peerbar: dictionaries')
      try {
        translate = ctx.locale.bind(NS)
      } catch {
        translate = (key) => zh[key] ?? en[key] ?? key
      }

      const serviceOf = (name) => {
        try {
          if (typeof ctx.get === 'function') {
            const found = ctx.get(name)
            if (found) return found
          }
          return ctx[name] ?? null
        } catch {
          return null
        }
      }

      /**
       * T7：远端会话里的文件引用不能走本地打开。
       *
       * 官方 `openFile` 一律调 `sidebarRight.openResource(fileAddress)`，地址里带
       * sessionId。命中远端会话时改成一条提示——否则会拿远端路径去查本机文件库，
       * 轻则打不开，重则在**本机打开同名文件**（比打不开更危险）。
       * 直接 patch 这个唯一入口：会话正文的文件链接、工具行行号引用、文件树行
       * 都收敛到它，比逐个改渲染器可靠。
       */
      const patchRemoteFileLinks = () => {
        const right = serviceOf('sidebarRight')
        if (!right || typeof right.openResource !== 'function') return false
        if (right.__peerbarFileGuard) return true
        const original = right.openResource
        const patched = function openResource(address, options) {
          const parsed = parseFileAddress(address)
          const binding = parsed ? remoteBindings.get(parsed.sessionId) : null
          if (binding) {
            window.dispatchEvent(
              new CustomEvent('peerbar:notice', {
                detail: {
                  message: tr('notice.remoteFile', {
                    path: parsed.path || '/',
                    host: binding.hostName || binding.hostId || '',
                  }),
                },
              }),
            )
            return
          }
          return original.call(this, address, options)
        }
        right.openResource = patched
        right.__peerbarFileGuard = true
        onDispose(() => {
          if (right.openResource === patched) right.openResource = original
          delete right.__peerbarFileGuard
        })
        console.info('[peerbar] 远端文件引用拦截已装')
        return true
      }
      // sidebarRight 可能在插件加载顺序上晚于我们：轮询直到装上（最多 15s）
      pollUntil(patchRemoteFileLinks, '远端文件引用拦截')

      /** 远端会话里的 loopback URL：本机打开会命中本机服务（或空白），改为提示 + 复制。 */
      const isLoopbackUrl = (value) => {
        try {
          const url = new URL(value)
          const host = url.hostname.toLowerCase()
          if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '[::1]') return true
          if (/^127\.\d+\.\d+\.\d+$/.test(host)) return true
          return host === '0.0.0.0'
        } catch {
          return false
        }
      }

      /**
       * V6-8 / V7-2：远端会话的浏览器面板降级。
       *
       * 官方「浏览器」tab 用本机 iframe/webview 打开 URL；远端会话里它预览的永远是
       * 本机，指向远端 localhost 的链接还会打到本机端口。这里不改面板本身，
       * 只在 `sidebarRight.openTab('browser', …)` 上按会话归属拦：
       * - 带 loopback URL → 复制地址 + 提示「去远端打开」；
       * - 不带 URL（引导页/面板入口）→ 提示面板不可用，不再打开空白本机页；
       * - 非 loopback（公网/局域网可达地址）→ 照常打开。
       * 官方快捷键 `openTabFromTarget('browser', …)` 最终也调 `openTab`，
       * 因此走同一条拦截；桌面端的快捷键路径还没单独实测。
       */
      const patchRemoteBrowserPanel = () => {
        const right = serviceOf('sidebarRight')
        if (!right || typeof right.openTab !== 'function') return false
        if (right.__peerbarBrowserGuard) return true
        const original = right.openTab
        const activeSession = () =>
          serviceOf('sessions')?.__peerbarActiveSession ?? right.mounted?.getSnapshot?.()
        const patched = function openTab(kind, options) {
          if (kind !== 'browser') return original.call(this, kind, options)
          const sessionId = activeSession()
          const binding = sessionId ? remoteBindings.get(sessionId) : null
          if (!binding) return original.call(this, kind, options)
          const host = binding.hostName || binding.hostId || ''
          const url = typeof options?.params?.url === 'string' ? options.params.url : ''
          if (!url) {
            window.dispatchEvent(new CustomEvent('peerbar:notice', { detail: { message: tr('notice.remoteBrowserBlank', { host }) } }))
            return
          }
          if (!isLoopbackUrl(url)) return original.call(this, kind, options)
          try {
            void navigator.clipboard?.writeText(url).catch(() => {})
          } catch {
            /* 剪贴板不可用时仍然给提示 */
          }
          window.dispatchEvent(new CustomEvent('peerbar:notice', { detail: { message: tr('notice.remoteBrowser', { url, host }) } }))
        }
        right.openTab = patched
        right.__peerbarBrowserGuard = true
        onDispose(() => {
          if (right.openTab === patched) right.openTab = original
          delete right.__peerbarBrowserGuard
        })
        console.info('[peerbar] 远端浏览器面板降级已装')
        return true
      }
      pollUntil(patchRemoteBrowserPanel, '远端浏览器拦截')

      /**
       * T2b：远端会话的非图片附件上传。
       *
       * 官方 composer 提交前会调 `ctx.fileUpload.upload(sessionId, file, ...)`。
       * 对远端会话，这本机会把文件存进**本机**附件库（错机器），远端会话引用不到，
       * 于是附件发出去就是坏引用。这里按 sessionId 归属改投远端：RPC
       * `fileUploads/upload`（base64 入参、lookup 参数 agentId），拿回该会话
       * 作用域内有效的 receiptId。
       *
       * 图片（kind === 'image'）不走这里——官方用 `encodeImage` 内联 base64 发送，
       * 远端 prompt 直接接受 `{type:'image', mediaType, data}`。
       */
      const patchRemoteFileUpload = () => {
        const service = serviceOf('fileUpload')
        if (!service || typeof service.upload !== 'function') return false
        if (service.__peerbarUpload) return true
        const original = service.upload
        const patched = async function upload(sessionId, file, name, signal, onProgress) {
          const binding = remoteBindings.get(sessionId)
          if (!binding) return original.call(this, sessionId, file, name, signal, onProgress)
          const aborted = () => ({ ok: false, error: { code: 'peerbar/aborted', message: '上传已取消' } })
          try {
            if (signal?.aborted) return aborted()
            const data = await fileToBase64(file)
            if (signal?.aborted) return aborted()
            onProgress?.({ loaded: file.size ?? 0, total: file.size ?? 0 })
            const value = await remoteRpc(binding.hostId, 'fileUploads/upload', {
              agentId: sessionId,
              request: { data, name: name || file.name || 'upload' },
            })
            return { ok: true, value }
          } catch (error) {
            return {
              ok: false,
              error: { code: error?.code ?? 'peerbar/upload-failed', message: String(error?.message ?? error) },
            }
          }
        }
        service.upload = patched
        service.__peerbarUpload = true
        onDispose(() => {
          if (service.upload === patched) service.upload = original
          delete service.__peerbarUpload
        })
        console.info('[peerbar] 远端附件上传已接管')
        return true
      }
      pollUntil(patchRemoteFileUpload, '远端附件上传')

      /**
       * T4 + T17：拦截 `RemoteNamespaceService.invokeRemote`——所有 namespace
       * 方法（commands/*、workspaceFiles/*）调用的共同出口。
       *
       * 这些 namespace 挂在 `ctx.remote`（连接级 face）上，绑定的是本机 host。
       * 远端会话的 sessionId 被传进去后走本机 RPC → 必然失败（T17 调研结论）。
       * 这里按 sessionId 归属把远端调用改投 `/hosts/<id>/rpc`。
       *
       * 为什么 patch `invokeRemote` 而不是逐个 patch 方法：`RemoteNamespaceService`
       * 的方法是 getter（`Object.defineProperty`），每次访问都返回新闭包，直接
       * 覆盖 `service.list` 会被下次 getter 求值打回原形；`invokeRemote` 是
       * 实例属性（构造器里 `this.invokeRemote = invokeRemote`），一换就全拦住。
       */
      const REMOTE_NS_ENDPOINTS = {
        'commands/list': (args) => ({ agentId: args[0] }),
        'commands/execute': (args) => ({ agentId: args[0], line: args[1], submittedAttachments: args[2] ?? [] }),
        'workspaceFiles/list': (args) => ({ workspaceFileScopeId: args[0], path: args[1] }),
        'workspaceFiles/read': (args) => ({ workspaceFileScopeId: args[0], path: args[1], range: args[2] ?? {} }),
        'workspaceFiles/stat': (args) => ({ workspaceFileScopeId: args[0], path: args[1] }),
        // 模型选择（session namespace）。selectModel 的参数是对象（UI 传
        // {sessionId, provider, model, ...}）；modelCatalog 无参数，按当前主视图
        // 会话的归属 host 路由（和 P6 当年同一结论）。
        'session/selectModel': (args) => ({ request: args[0] ?? {} }),
        'session/modelCatalog': () => ({}),
        // 「@」补全：按路径前缀列候选（lookup 参数 agentId + json query）
        'fileReferences/list': (args) => ({ agentId: args[0], query: args[1] }),
        // 「@」里的会话引用候选
        'sessionReferenceResolver/candidates': (args) => ({ agentId: args[0], query: args[1] }),
        // 斜杠命令里的 skill 源（args[0] 是 {sessionId}）
        'skills/list': (args) => ({ request: args[0] ?? {} }),
      }
      // 这两个端点在 args 里拿不到 sessionId，hostId 从当前主视图解析
      const NS_ENDPOINTS_NEED_ACTIVE_HOST = new Set(['session/modelCatalog'])
      // modelCatalog 结果按 host 缓存 60s（沿用旧 P6：模型列表不需要实时性，
      // 且远端 RPC 每次开选择器都打一遍太浪费）
      const catalogCache = new Map()

      const patchRemoteNamespaceInvoker = () => {
        const remote = serviceOf('remote')
        const namespaces = remote?.namespaces
        if (!namespaces || typeof namespaces.get !== 'function') return false
        let patchedCount = 0
        // 每个 namespace 都要拦：这些方法都是 getter（每次访问返回新闭包），
        // 直接给方法赋值会被下次求值打回原形（P6 早期 patch 无效的根因）；
        // 只有构造器里赋值的 `invokeRemote` 实例属性一换就全拦住。
        // 缺一个就会出现「某个入口静默失效」——@ 弹窗（fileReferences/skills/
        // sessionReferenceResolver）和模型（session）就是这么漏掉的。
        const TARGET_NAMESPACES = [
          'commands',
          'workspaceFiles',
          'session',
          'fileReferences',
          'skills',
          'sessionReferenceResolver',
        ]
        let missing = 0
        for (const nsName of TARGET_NAMESPACES) {
          const entry = namespaces.get(nsName)
          const service = entry?.service
          if (!service || typeof service.invokeRemote !== 'function') {
            missing += 1
            continue
          }
          if (service.__peerbarInvoker) { patchedCount += 1; continue }
          const original = service.invokeRemote
          const patched = function invokeRemote(direct, scoped, callerCtx, args) {
            const descriptor = direct?.descriptor ?? scoped?.descriptor
            const endpoint = descriptor ? `${descriptor.namespace}/${descriptor.method}` : null
            const sessionId =
              typeof args?.[0] === 'string'
                ? args[0]
                : typeof args?.[0]?.sessionId === 'string'
                  ? args[0].sessionId
                  : null
            let binding = sessionId ? remoteBindings.get(sessionId) : null
            if (!binding && NS_ENDPOINTS_NEED_ACTIVE_HOST.has(endpoint)) {
              // modelCatalog 无参数：按当前主视图会话的归属 host 路由
              try {
                const sessions = typeof ctx?.get === 'function' ? ctx.get('sessions') : ctx?.sessions
                const activeHost = sessions?.__peerbarActiveHost
                if (activeHost) binding = { hostId: activeHost }
              } catch {
                /* 拿不到就落本机 */
              }
            }

            // 流式端点（descriptor.mode 非空）：unary 拦截不适用。
            // 官方返回 ClientStreamHandle（有 send/end/dispose + asyncIterator，且
            // 构造时就 primed.next()）。之前返回「立即 done 的迷你对象」有两个后果：
            // UI 调 dispose()/send() 直接 TypeError → 「@」弹窗崩溃一闪而过；
            // 迭代立即 done → 文件面板报「Directory watch ended」。
            // 这里给「挂起流」：next() 永不 resolve，接口与 handle 对齐——
            // 目录列表正常显示，只是收不到实时变更（可接受的退化）。
            if (descriptor?.mode !== undefined) {
              if (binding) {
                let consumed = false
                let disposed = false
                let delivered = false
                let es = null
                const queue = []
                const waiters = []
                const finish = () => {
                  for (const resolve of waiters.splice(0)) resolve({ done: true, value: undefined })
                }
                const push = (value) => {
                  if (disposed) return
                  const resolve = waiters.shift()
                  if (resolve) resolve({ done: false, value })
                  else queue.push(value)
                }
                const closeSource = () => {
                  if (!es) return
                  try {
                    es.close()
                  } catch {
                    /* 忽略 */
                  }
                  es = null
                }
                /**
                 * V6-6：`workspaceFiles/changes` 走宿主半的 SSE 转发
                 * （/dsh-peerbar/api/watch → 远端 mux），第一条 ready 由我们合成
                 * （保证目录首屏 list 一定触发），之后只转发 change 帧。
                 */
                const startStream = () => {
                  if (endpoint !== 'workspaceFiles/changes') return
                  if (typeof EventSource === 'undefined') return
                  const scopeId = typeof args?.[0] === 'string' ? args[0] : null
                  const path = typeof args?.[1] === 'string' ? args[1] : ''
                  if (!scopeId) return
                  try {
                    const query =
                      `hostId=${encodeURIComponent(binding.hostId)}`
                      + `&sessionId=${encodeURIComponent(scopeId)}`
                      + `&path=${encodeURIComponent(path)}`
                    es = new EventSource(`${API}/watch?${query}`)
                  } catch {
                    return
                  }
                  es.onmessage = (event) => {
                    let value
                    try {
                      value = JSON.parse(event.data)
                    } catch {
                      return
                    }
                    // ready 已由本地合成；远端断线重连再发 ready 也忽略
                    if (!value || value.kind === 'ready') return
                    push(value)
                  }
                  es.addEventListener('error', () => {
                    closeSource()
                  })
                }
                return {
                  endpoint,
                  get disposed() {
                    return disposed
                  },
                  get consumed() {
                    return consumed
                  },
                  send: () => {
                    throw new Error(`peerbar: ${endpoint} 是远端只读流的占位实现，不支持上行`)
                  },
                  end: () => {},
                  dispose: () => {
                    disposed = true
                    closeSource()
                    finish()
                  },
                  [Symbol.asyncIterator]() {
                    if (consumed) throw new Error(`peerbar: ${endpoint} stream has one consumer`)
                    consumed = true
                    return {
                      next: () => {
                        if (disposed) return Promise.resolve({ done: true, value: undefined })
                        // 第一条必须是 readiness 事件：官方 DirectoryNode 由它触发
                        // 首次 list（「正在读取…」卡死就是漏了这一条）。
                        if (!delivered) {
                          delivered = true
                          startStream()
                          return Promise.resolve({ done: false, value: { kind: 'ready' } })
                        }
                        if (queue.length > 0) return Promise.resolve({ done: false, value: queue.shift() })
                        return new Promise((resolve) => waiters.push(resolve))
                      },
                      return: (value) => {
                        disposed = true
                        closeSource()
                        finish()
                        return Promise.resolve({ done: true, value })
                      },
                      throw: (error) => {
                        disposed = true
                        closeSource()
                        finish()
                        return Promise.reject(error)
                      },
                    }
                  },
                }
              }
              return original.call(this, direct, scoped, callerCtx, args)
            }

            const wireBuilder = endpoint ? REMOTE_NS_ENDPOINTS[endpoint] : null
            if (binding && wireBuilder && endpoint) {
              const wire = wireBuilder(args)
              if (endpoint === 'session/modelCatalog') {
                const cached = catalogCache.get(binding.hostId)
                if (cached && Date.now() - cached.at < 60000) return { ok: true, value: cached.value }
                return remoteRpc(binding.hostId, endpoint, wire)
                  .then((value) => {
                    catalogCache.set(binding.hostId, { at: Date.now(), value })
                    return { ok: true, value }
                  })
                  .catch((error) => ({
                    ok: false,
                    error: { code: error?.code ?? 'peerbar/rpc-failed', message: String(error?.message ?? error) },
                  }))
              }
              return remoteRpc(binding.hostId, endpoint, wire)
                .then((value) => ({ ok: true, value }))
                .catch((error) => ({
                  ok: false,
                  error: { code: error?.code ?? 'peerbar/rpc-failed', message: String(error?.message ?? error) },
                }))
            }
            return original.call(this, direct, scoped, callerCtx, args)
          }
          service.invokeRemote = patched
          service.__peerbarInvoker = true
          onDispose(() => {
            if (service.invokeRemote === patched) service.invokeRemote = original
            delete service.__peerbarInvoker
          })
          patchedCount += 1
          console.info(`[peerbar] ${nsName} namespace 拦截已装`)
        }
        // 全部就位才算成功：namespace 是逐个 mount 的，早到的先装上，
        // 缺的那些继续由外层轮询补齐（不再「装上两个就收工」）。
        return missing === 0 && patchedCount >= 3
      }
      onDispose(() => catalogCache.clear())
      pollUntil(patchRemoteNamespaceInvoker, '远端 namespace 拦截')

      const openSession = (sessionId) => {
        const workspace = serviceOf('uiWorkspace')
        if (!workspace?.openSession) {
          console.warn('[peerbar] uiWorkspace 不可用，无法打开本机会话')
          return
        }
        workspace.openSession(sessionId)
      }

      const openWorkspace = (workspaceId) => {
        const workspace = serviceOf('uiWorkspace')
        if (!workspace?.openWorkspace) return
        workspace.openWorkspace(workspaceId)
      }

      const selectPanel = (panelId) => {
        const layout = serviceOf('layout')
        if (!layout?.selectPanel) {
          console.warn('[peerbar] layout 不可用，无法切换主面板')
          return
        }
        layout.selectPanel(panelId)
      }

      // 原生写操作一律走官方服务，不自己维护一份状态
      const callOn = (service, method, ...args) => {
        const target = serviceOf(service)
        if (!target?.[method]) {
          console.warn(`[peerbar] ${service}.${method} 不可用`)
          return undefined
        }
        return target[method](...args)
      }

      // 远端写操作统一走 /hosts/<id>/rpc 白名单代理
      /**
       * 远端写操作后同步状态。
       *
       * 验收反馈：「改标题 / 归档 / 删工作区点了要等 5s 以上」。根因是 `/state`
       * 的内容来自 5s 一轮的探活快照，重拉拿到的还是旧数据。
       *
       * 现在宿主半在 RPC 成功后已就地回写快照（peers.applyLocalEcho），所以这里
       * 只需要立刻重拉 `/state`；探活丢到后台做（把归档集合等基线信息对齐，
       * 不阻塞用户看到结果）。
       */
      const syncHostStateAfterWrite = (hostId) => {
        window.dispatchEvent(new CustomEvent('peerbar:refresh'))
        // 必须带 body：请求封装只会给「有 body」的请求加 content-type 与
        // x-dsh-peerbar-action，缺了会被 guard 判 415
        void remoteFetch(hostId, `/hosts/${encodeURIComponent(hostId)}/probe`, {
          method: 'POST',
          body: '{}',
        }).catch(() => {})
      }

      // 只读端点不该触发写后同步（浏览目录时每点一次都探活太重）
      // —— 常量在模块级（绑定里的 rpc 也要用）

      const callRemoteRpc = async (hostId, endpoint, args) => {
        const value = await remoteRpc(hostId, endpoint, args)
        if (!REMOTE_READ_ENDPOINTS.has(endpoint)) syncHostStateAfterWrite(hostId)
        return value
      }

      const services = {
        // 官方 ISessions 没有 list-service 级的 rename；正确入口是
        // `binding(id).session.rename(title)`（ui-workspace 也走
        // `sessions.using(...)` 拿引用后调它）。用 `using` 还能保证引用在
        // 异步改名期间保持有效。
        renameSession: async (sessionId, title) => {
          const sessions = serviceOf('sessions')
          if (typeof sessions?.using === 'function') {
            return sessions.using(sessionId, { source: 'workspaceOperation' }, (reference) =>
              reference.binding.session.rename(title),
            )
          }
          const binding = sessions?.binding?.(sessionId)
          if (binding?.session?.rename) return binding.session.rename(title)
          throw new Error('sessions.rename 不可用')
        },
        renameWorkspace: (workspaceId, title) => callOn('workspaces', 'rename', workspaceId, title),
        deleteWorkspace: (workspaceId) => callOn('workspaces', 'delete', workspaceId),
        archiveSession: (sessionId) => callOn('workspaces', 'archiveSession', sessionId),
        unarchiveSession: (sessionId) => callOn('workspaces', 'unarchiveSession', sessionId),
        pinSession: (sessionId) => callOn('workspaces', 'pinSession', sessionId),
        unpinSession: (sessionId) => callOn('workspaces', 'unpinSession', sessionId),
        // 拖拽排序：本机与远端是同一组语义（workspace/insertBefore、insertSessionBefore）
        insertBefore: (workspaceId, beforeWorkspaceId) =>
          callOn('workspaces', 'insertBefore', workspaceId, beforeWorkspaceId),
        insertSessionBefore: (workspaceId, sessionId, beforeSessionId) =>
          callOn('workspaces', 'insertSessionBefore', workspaceId, sessionId, beforeSessionId),
        insertRemoteWorkspaceBefore: (hostId, workspaceId, beforeWorkspaceId) =>
          callRemoteRpc(hostId, 'workspace/insertBefore', { request: { workspaceId, beforeWorkspaceId } }),
        insertRemoteSessionBefore: (hostId, workspaceId, sessionId, beforeSessionId) =>
          callRemoteRpc(hostId, 'workspace/insertSessionBefore', {
            request: { workspaceId, sessionId, beforeSessionId },
          }),
        // 官方 fork 在 ISessions 上；uiWorkspace.forkSession 只是它的一层 UI 包装
        // （带标题递增与 onCreated），直接调前者更稳定。
        forkSession: (sessionId) =>
          serviceOf('sessions')?.fork({ sessionId, increaseTitle: true, allowMigration: false }),
        copySessionId: async (sessionId) => {
          await navigator.clipboard.writeText(sessionId)
        },
        renameRemoteSession: (hostId, sessionId, title) =>
          request(`/hosts/${encodeURIComponent(hostId)}/sessions/${encodeURIComponent(sessionId)}/rename`, {
            method: 'POST',
            body: JSON.stringify({ title }),
          }),
        // 远端会话管理（P2）
        pinRemoteSession: (hostId, sessionId) =>
          callRemoteRpc(hostId, 'workspace/pinSession', { request: { sessionId } }),
        unpinRemoteSession: (hostId, sessionId) =>
          callRemoteRpc(hostId, 'workspace/unpinSession', { request: { sessionId } }),
        archiveRemoteSession: (hostId, sessionId) =>
          callRemoteRpc(hostId, 'workspace/archiveSession', { request: { sessionId, stopActivity: true } }),
        unarchiveRemoteSession: (hostId, sessionId) =>
          callRemoteRpc(hostId, 'workspace/unarchiveSession', { request: { sessionId } }),
        forkRemoteSession: (hostId, sessionId) =>
          callRemoteRpc(hostId, 'session/fork', { request: { sessionId } }),
        // 远端工作区管理（P3）
        renameRemoteWorkspace: (hostId, workspaceId, title) =>
          callRemoteRpc(hostId, 'workspace/rename', { request: { workspaceId, title } }),
        deleteRemoteWorkspace: (hostId, workspaceId) =>
          callRemoteRpc(hostId, 'workspace/delete', { request: { workspaceId } }),
        createRemoteSession: (hostId, workspaceId) =>
          callRemoteRpc(hostId, 'session/create', { request: { workspaceId } }),
        // 目录浏览：本机走官方 uiWorkspace，远端走只读 directoryPicker/list
        listLocalDir: (path) => {
          const uiWorkspace = serviceOf('uiWorkspace')
          if (!uiWorkspace?.listDirectory) throw new Error('本机目录服务不可用')
          return uiWorkspace.listDirectory(path)
        },
        listRemoteDir: (hostId, path) =>
          callRemoteRpc(hostId, 'directoryPicker/list', path ? { path } : {}),
        // 桌面端合成的 picker 是 native 能力（没有 list）：直接弹系统目录对话框
        pickLocalDir: async () => {
          const desktop = globalThis.__DSH_DIRECTORY_PICKER__
          if (desktop?.pick) return desktop.pick()
          const uiWorkspace = serviceOf('uiWorkspace')
          if (!uiWorkspace?.pickDirectory) throw new Error('本机目录选择不可用')
          return uiWorkspace.pickDirectory()
        },
        createLocalWorkspace: (path) => callOn('workspaces', 'create', { path }),
        createRemoteWorkspace: (hostId, path) =>
          callRemoteRpc(hostId, 'workspace/create', { request: { path } }),
      }

      // 1) 影子替换官方工作区浏览器
      //
      // ⚠️ register 里显式写 `priority: -1`，作为「要拿最低渲染位」的意图声明。
      // rc.3 的 runner 会给非 chain 槽自动分配递减的 priority（后注册者更低），
      // 但早期版本/不同加载顺序下曾因与官方同优先级导致 entry 不激活、
      // Electron 启动即退（见 docs/待办-v5.md 事故 2）。保留 -1 是防御，不要删。
      //
      // ⚠️ 子座位声明：rc.3 起**不要声明**（影子替换不替换声明，重复声明是硬报错）；
      // rc.2 曾必须声明，否则目录选择器注入失败、「添加工作区」整项消失。
      // 细节见下面 inject 回调里的注释。
      //
      // ⚠️ ctx.slots.inject 的回调是**延迟执行**的（reconcile 阶段），外层
      // register 的 try-catch 兜不住回调里的错误——必须在回调里自己包。
      ctx.slots.inject('sidebar.workspaces', () => {
        try {
          // ⚠️ 这里**不声明**任何子座位。
          //
          // 官方 ui-workspace 的 entry 即使被我们影子替换，它的 children 声明仍然
          // 生效（声明与渲染分离）；我们再声明同一个 key 会抛
          // `slot ... is already declared`（真实页面报错，ui-check 会拦）。
          // 早前「必须声明」的结论来自 rc.2：那时被影子替换后官方声明会一起消失，
          // 导致 directory-picker 的 inject 失败、「添加工作区」整项消失。
          // rc.3 实测官方声明保留（添加工作区正常），所以这里保持空声明。
          //
          // 若将来某版本又回到 rc.2 的行为（添加工作区消失），再按
          // `ctx.slots.spec('<child>') === undefined` 补声明——但要注意官方可能
          // 比我们晚声明，探测只能放在注册之后（微任务）才可靠。
          return ctx.slots.register(
            {
              name: 'sidebar.workspaces',
              // 必须显式指定与官方不同的 priority 来影子替换（lowest renders）。
              // 去掉它会拿到和官方相同的 priority 0 → 冲突 → entry 不激活 → 启动失败。
              priority: -1,
            },
            (props) =>
              React.createElement(WorkspaceTree, {
                ...props,
                openSession,
                openWorkspace,
                selectPanel,
                services,
                nativeCtx: ctx,
              }),
          )
        } catch (error) {
          console.error('[peerbar] sidebar.workspaces 注册失败', error)
          return undefined
        }
      })

      // 2) 设置分区（同样在 inject 回调里自己包 try-catch）
      ctx.slots.inject('settings.section', () => {
        try {
          return ctx.slots.register(
            { name: 'settings.section', id: 'peers', order: 900, locale: NS, label: () => tr('section.peers') },
            PeersSection,
          )
        } catch (error) {
          console.error('[peerbar] settings.section 注册失败', error)
          return undefined
        }
      })

      console.info('[peerbar] client applied', {
        uiWorkspace: Boolean(serviceOf('uiWorkspace')),
        layout: Boolean(serviceOf('layout')),
        sessions: Boolean(serviceOf('sessions')),
        workspaces: Boolean(serviceOf('workspaces')),
      })
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    return module.exports
  },
})

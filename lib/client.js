/**
 * dsh-peerbar — 浏览器半（ADR-001 路线）。
 *
 * 三个注册点：
 *   1. `sidebar.workspaces`（single，顶替官方浏览器）：本机 + 远端混排的同一棵树；
 *   2. `main` 的 `peerbar-session`：远端会话只读正文；
 *   3. `settings.section`：Host 登记 / 探活 / 凭据。
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
    const BUILD = '2026-10-23-a'
    const STYLE_ID = 'dsh-peerbar-style'
    const COLLAPSED_KEY = 'dsh-peerbar.collapsed'


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
      'tree.search': '搜索会话',
      'tree.empty': '还没有工作区',
      'tree.noMatch': '没有匹配的会话',
      'tree.newSession': '新建会话',
      'tree.offline': '{host} 连不上',
      'tree.cached': '缓存',
      'tree.remoteError': '多机数据读取失败',
      'tree.nativeFailed': '原生渲染失败，稍后重试',
      'session.untitled': '未命名会话',
      'session.running': '运行中',
      'panel.back': '返回对话',
      'panel.loading': '读取正文…',
      'panel.empty': '这个会话还没有可读的消息',
      'panel.loadEarlier': '加载更早的消息',
      'panel.start': '已经到最早的消息了',
      'section.peers': '多机侧栏',
      'section.hint': '登记后，本机会用你粘贴的启动令牌换取一个 30 天有效的 cookie，之后只读远端数据。',
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
      'action.delete': '删除',
      'action.confirmDelete': '确认删除',
      'action.probe': '立即探活',
      'action.showToken': '改令牌',
      'tree.overflow': '展开含 {n} 个会话',
      'tree.ungrouped': '未分组',
      'action.rename': '改名',
      'action.delete': '删除',
      'menu.pin': '置顶会话',
      'menu.unpin': '取消置顶',
      'menu.rename': '重命名',
      'menu.fork': '分叉会话',
      'menu.archive': '归档会话',
      'menu.unarchive': '取消归档',
      'menu.copyId': '复制 Session ID',
      'menu.renameWorkspace': '重命名工作区',
      'menu.more': '更多操作',
      'viewOptions.label': '视图选项',
      'groupBy.label': '分组方式',
      'groupBy.workspace': '按工作区',
      'groupBy.flat': '单列表',
      'orderBy.label': '排序方式',
      'orderBy.manual': '手动排序',
      'orderBy.updated': '最近更新',
      'filterBy.label': '过滤方式',
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
      'empty.hosts': '还没有登记任何机器',
      'msg.badOrigin': '地址格式不对，示例：https://10.0.0.10:3080',
      'msg.added': '已添加，正在探活',
    }

    const en = {
      'tree.title': 'Workspaces',
      'tree.search': 'Search sessions',
      'tree.empty': 'No workspaces yet',
      'tree.noMatch': 'No matching sessions',
      'tree.newSession': 'New session',
      'tree.offline': '{host} is unreachable',
      'tree.cached': 'cached',
      'tree.remoteError': 'Failed to read peer data',
      'tree.nativeFailed': 'Native rendering failed, retry later',
      'session.untitled': 'Untitled session',
      'session.running': 'Running',
      'panel.back': 'Back to chat',
      'panel.empty': 'No readable messages in this session',
      'panel.loadEarlier': 'Load earlier messages',
      'panel.start': 'Beginning of the session',
      'section.peers': 'Peer hosts',
      'section.hint': 'Paste the token printed by the remote dsh once; it is exchanged for a 30-day cookie. Access stays read-only.',
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
      'action.delete': 'Remove',
      'action.confirmDelete': 'Confirm',
      'action.probe': 'Probe now',
      'action.showToken': 'Change token',
      'tree.overflow': '展开含 {n} 个会话',
      'tree.ungrouped': 'Ungrouped',
      'action.rename': 'Rename',
      'action.delete': 'Delete',
      'menu.pin': 'Pin session',
      'menu.unpin': 'Unpin session',
      'menu.rename': 'Rename',
      'menu.fork': 'Fork session',
      'menu.archive': 'Archive session',
      'menu.unarchive': 'Unarchive',
      'menu.copyId': 'Copy session ID',
      'menu.renameWorkspace': 'Rename workspace',
      'menu.more': 'More actions',
      'viewOptions.label': 'View options',
      'groupBy.label': 'Group by',
      'groupBy.workspace': 'By workspace',
      'groupBy.flat': 'Flat list',
      'orderBy.label': 'Sort by',
      'orderBy.manual': 'Manual order',
      'orderBy.updated': 'Recently updated',
      'filterBy.label': 'Filter',
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
      'empty.hosts': 'No hosts registered yet',
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

    function usePeerState(intervalMs = 5000) {
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState(null)

      const load = React.useCallback(async () => {
        if (document.visibilityState === 'hidden') return
        try {
          const next = await request('/state')
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
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          alive = false
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [intervalMs, load])

      // 变更操作后立即拉新，不等下一轮轮询
      return { state, error, refresh: load }
    }

    /** 合成只读 SessionBinding：records → SessionEventWindow 快照 + 只读 SessionFace */
    function createRemoteBinding({ ctx, sessionId, records, summary }) {
      const entries = (records ?? [])
        .map((record) => (record && record.event ? { type: 'event', event: record.event } : null))
        .filter(Boolean)
      const window = {
        entries,
        hasMore: false,
        revision: 1,
        change: { kind: 'replace', entries },
      }
      const eventSource = {
        getSnapshot: () => window,
        subscribe: () => () => {},
      }
      const projectionFaces = new Map()
      const projections = {
        faceOf: (key) => {
          if (!projectionFaces.has(key)) {
            projectionFaces.set(key, { getSnapshot: () => undefined, subscribe: () => () => {} })
          }
          return projectionFaces.get(key)
        },
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
      const publish = () => {
        info.version += 1
        if (sessionSnapshot) sessionSnapshot.retainedBy = { ...counts }
        if (self.__pbVersion) self.__pbVersion.n += 1
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
        hasMore: false,
        loadingOlder: false,
        promptError: null,
        blank: false,
        lastAgentError: null,
        promptAttempted: false,
        awaitingFirstTurn: false,
      }
      const readOnly = () => {
        throw new Error('远端会话只读')
      }
      const session = {
        sessionId,
        projections,
        beginSubmission: readOnly,
        prompt: async () => ({ ok: false, code: 'read-only', message: '远端会话只读' }),
        readAttachment: async () => ({ ok: false, code: 'read-only', message: '远端会话只读' }),
        updateQueue: async () => ({ ok: false, code: 'read-only', message: '远端会话只读' }),
        cancel: async () => ({ ok: false, code: 'read-only', message: '远端会话只读' }),
        rename: async () => ({ ok: false, code: 'read-only', message: '请用行菜单改名' }),
        loadOlder: async () => {},
        loadThrough: async () => {},
        command: async () => ({ ok: false, code: 'read-only', message: '远端会话只读' }),
        getSnapshot: () => sessionSnapshot,
        subscribe: () => () => {},
      }
      if (summary) summary.retainedBy = info.retainedBy
      const self = { sessionId, session, eventSource, ctx, summary, retention, __pbVersion: null }
      return self
    }

    /** 把远端绑定注册进 ISessions（在原型方法上包一层查找，不动内部 store） */
    function installRemoteSessions(ctx) {
      const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : ctx.sessions
      if (!sessions) return null
      const registry = sessions.__peerbarRegistry ?? new Map()
      sessions.__peerbarRegistry = registry
      const versionRef = sessions.__peerbarVersion ?? { n: 0 }
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
            const source = uiSession.sourceFor?.(owner)
            if (source && uiSession.current) {
              if (uiSession.current.value !== source.value) {
                uiSession.current.value = source.value
                for (const fn of [...(uiSession.current.listeners ?? [])]) fn()
              }
            }
            // 触发 list.subscribe → useSessions 重渲染 → document.title 更新
            const listObj = sessions.list
            if (listObj?.set && listObj?.getSnapshot) {
              try { listObj.set({ ...listObj.getSnapshot() }) } catch { /* Immer 不阻塞 */ }
            }
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
        }
        if (typeof originalRetainScope === 'function') {
          // retainAgentScope 等路径直接调 retainScope，不走 retain。
          // 必须同样拦截，否则会造出「真引用」，其 binding 与 registry 里的
          // 合成 binding 不是同一对象，bindingSource 校验直接抛
          // "Session reference is not active in this Controller"。
          proto.retainScope = function retainScope(id, source) {
            const binding = this.__peerbarRegistry?.get(id)
            if (binding !== undefined) {
              exclusiveMainView(id)
              return makeReference(id, binding, source)
            }
            const ref = originalRetainScope.call(this, id, source)
            versionRef.n += 1
            return ref
          }
        }
        if (typeof originalBinding === 'function') {
          proto.binding = function binding(id) {
            const fromRegistry = this.__peerbarRegistry?.get(id)
            const result = fromRegistry ?? originalBinding.call(this, id)
            return result
          }
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
        }
        if (typeof originalScope === 'function') {
          proto.scope = function scope(id) {
            return this.__peerbarRegistry?.get(id)?.ctx ?? originalScope.call(this, id)
          }
        }
        if (typeof originalSessionOf === 'function') {
          proto.sessionOf = function sessionOf(ctx) {
            for (const [id, binding] of this.__peerbarRegistry ?? []) {
              if (binding.ctx === ctx) return binding.session
            }
            return originalSessionOf.call(this, ctx)
          }
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
        }
        proto.__peerbarPatched = true
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
        listObj.__peerbarSetPatched = true
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
            merged.byId[id] = { ...binding.summary, retainedBy: binding.retention?.info?.retainedBy ?? {} }
            if (!merged.ids.includes(id)) merged.ids.push(id)
          }
          cachedMerged = merged
          return merged
        }
        listObj.__peerbarPatched = true
      }
      return sessions
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
.dshp-head { display:flex; align-items:center; gap:4px; height:36px; padding:0 4px; flex:none; }
.dshp-spacer { flex:1; }
.dshp-head-title { font-size:12px; color:var(--dsw-alias-label-tertiary); flex:none; }
.dshp-search { font:inherit; font-size:13px; line-height:18px; color:var(--dsw-alias-label-primary); background:transparent; border:.5px solid var(--dsw-alias-border-l4, rgba(128,128,128,.3)); border-radius:var(--dsw-radius-md, 8px); padding:3px 8px; width:124px; box-sizing:border-box; margin-left:auto; outline:none; }
.dshp-search::placeholder { color:var(--dsw-alias-label-tertiary); }
.dshp-scroll { flex:1 1 auto; overflow-y:auto; min-height:0; padding-bottom:8px; scrollbar-gutter:stable; }
.dshp-note { padding:6px 12px; font-size:12px; color:var(--dsw-alias-label-tertiary); }
.dshp-error { margin:4px 8px; padding:6px 8px; border-radius:var(--dsw-radius-md, 8px); background:rgba(207,34,46,.12); font-size:12px; }
.dshp-tag { font-size:10px; line-height:16px; padding:0 4px; border-radius:4px; border:1px solid currentColor; opacity:.8; white-space:nowrap; flex:0 0 auto; }

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

    /** 官方状态点 */
    function StatusDot({ state }) {
      return prim('StateDot', { state })
    }

    /** 官方会话行：slot(状态点) + title(双击重命名) + time + pinned + rowActions */
    function SessionRow({ title, time, state, pinned, archived, selected, stale, cwd, actions, onOpen, onRename }) {
      const [menuOpen, setMenuOpen] = React.useState(false)
      const rowActions = typeof actions === 'function' ? actions(menuOpen, setMenuOpen) : actions
      return React.createElement(
        'div',
        {
          className:
            'koUx-W_sessionRow'
            + (selected ? ' koUx-W_selected' : '')
            + (archived ? ' koUx-W_archived' : '')
            + (menuOpen ? ' koUx-W_menuOpen' : ''),
          role: 'treeitem',
          title: cwd ? `${title}\n${cwd}` : title,
          onClick: () => { console.info('[peerbar] rowClick', String(title).slice(0, 16)); onOpen() },
          style: stale ? { opacity: 0.55 } : undefined,
        },
        React.createElement(
          'span',
          { className: 'koUx-W_slot' },
          archived ? null : React.createElement(StatusDot, { state }),
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

    /** 行内小图标按钮（归档 / 置顶 / 新建会话） */
    function IconAction({ icon, label, onClick, active }) {
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
        prim(icon),
      )
    }

    /** 官方样式的重命名/删除对话框 */
    function Dialog({ title, description, value, placeholder, submitLabel, danger, onValue, onSubmit, onClose }) {
      const [busy, setBusy] = React.useState(false)
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
      return React.createElement(
        'div',
        {
          role: 'dialog',
          'aria-modal': 'true',
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,.32)',
          },
          onClick: (event) => {
            if (event.target === event.currentTarget) onClose()
          },
        },
        React.createElement(
          'div',
          {
            style: {
              width: 420,
              maxWidth: '90vw',
              borderRadius: 12,
              padding: 18,
              background: 'var(--dsw-alias-bg-elevated, #2a2a2e)',
              boxShadow: '0 12px 40px rgba(0,0,0,.35)',
              color: 'var(--dsw-alias-label-primary, inherit)',
            },
          },
          React.createElement('div', { style: { fontSize: 15, fontWeight: 600, marginBottom: 8 } }, title),
          description ? React.createElement('div', { style: { fontSize: 13, opacity: 0.7, marginBottom: 12 } }, description) : null,
          value === undefined
            ? null
            : React.createElement('input', {
                autoFocus: true,
                value,
                placeholder,
                onChange: (event) => onValue(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') submit()
                  if (event.key === 'Escape') onClose()
                },
                style: {
                  width: '100%',
                  boxSizing: 'border-box',
                  font: 'inherit',
                  fontSize: 14,
                  padding: '8px 10px',
                  borderRadius: 8,
                  color: 'inherit',
                  background: 'transparent',
                  border: '.5px solid var(--dsw-alias-border-l4, rgba(128,128,128,.4))',
                  marginBottom: 16,
                  outline: 'none',
                },
              }),
          React.createElement(
            'div',
            { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: onClose,
                style: {
                  font: 'inherit',
                  fontSize: 13,
                  padding: '6px 14px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  color: 'inherit',
                  background: 'transparent',
                  border: '.5px solid var(--dsw-alias-border-l4, rgba(128,128,128,.4))',
                },
              },
              tr('action.cancel'),
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                disabled: busy,
                onClick: submit,
                style: {
                  font: 'inherit',
                  fontSize: 13,
                  padding: '6px 14px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  color: '#fff',
                  background: danger ? '#cf222e' : '#2f81f7',
                  border: 'none',
                },
              },
              submitLabel,
            ),
          ),
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
      const [notice, setNotice] = React.useState('')
      const [dialog, setDialog] = React.useState(null)
      const [overflowAll, setOverflowAll] = React.useState(() => new Set())
      const [view, setView] = React.useState({ groupBy: 'workspace', orderBy: 'updated', archived: 'default' })

      React.useEffect(() => {
        if (!notice) return undefined
        const timer = setTimeout(() => setNotice(''), 3500)
        return () => clearTimeout(timer)
      }, [notice])

      const lowered = query.trim().toLowerCase()
      const match = (title) => !lowered || String(title ?? '').toLowerCase().includes(lowered)
      const archived = React.useMemo(() => new Set(archivedIds), [archivedIds])
      const pinned = React.useMemo(() => new Set(pinnedIds), [pinnedIds])
      // 与官方 sessionVisible 对齐：子代理会话永远不铺到树上（父会话自带入口），
      // blank 会话不占位，归档会话只受视图过滤控制。
      const visibleSession = (session) => {
        if (!session || session.blank) return false
        if (session.origin === 'subagent') return false
        const isArchived = archived.has(session.id)
        if (view.archived === 'default' && isArchived) return false
        if (view.archived === 'only' && !isArchived) return false
        return match(session.title)
      }
      // 远端同理，归档标记来自宿主半（workspace/follow 的 baseline）。
      const visibleRemoteSession = (session) => {
        if (!session || session.blank) return false
        const isArchived = session.archived === true
        if (view.archived === 'default' && isArchived) return false
        if (view.archived === 'only' && !isArchived) return false
        return match(session.title)
      }
      const byRecency = (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
      const orderRows = (rows) => (view.orderBy === 'manual' ? rows : rows.slice().sort(byRecency))

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
      }, [workspaces, list, archived, lowered, view.archived])

      const remoteGroups = React.useMemo(() => {
        const groups = []
        for (const host of state?.hosts ?? []) {
          for (const workspace of host.workspaces ?? []) {
            const rows = orderRows((workspace.sessions ?? []).filter(visibleRemoteSession))
            groups.push({ key: `remote:${host.hostId}:${workspace.id}`, host, workspace, rows })
          }
        }
        return groups
      }, [state, lowered, view.archived])

      const openRemote = async (host, session, workspace) => {
        if (host.status !== 'online') {
          setNotice(tr('tree.offline', { host: host.name }))
          return
        }
        try {
          const raw = await request(`/session?hostId=${encodeURIComponent(host.hostId)}&id=${encodeURIComponent(session.rawId)}&limit=200&raw=1`)
          const binding = createRemoteBinding({
            ctx: props.nativeCtx ?? {},
            sessionId: session.rawId,
            records: raw.records ?? [],
            summary: {
              id: session.rawId,
              title: session.title || tr('session.untitled'),
              displayTitle: session.title || workspace?.name || session.rawId,
              updatedAt: session.lastActivityAt,
              running: session.running === true,
              blank: false,
              cwd: workspace?.cwd,
            },
          })
          const sessions = installRemoteSessions(props.nativeCtx ?? {})
          if (sessions?.__peerbarRegistry) {
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

      const sessionMenuItems = (session, host) => {
        const run = async (fn) => {
          try {
            await fn()
            await refresh()
          } catch (error) {
            console.error('[peerbar] 远端操作失败', error)
            setNotice(String(error?.message ?? error))
          }
        }
        if (host) {
          if (host.status !== 'online') return []
          const hostId = host.hostId
          const rawId = session.rawId
          const isPinned = session.pinned === true
          const isArchived = session.archived === true
          return [
            {
              id: 'pin',
              label: isPinned ? tr('menu.unpin') : tr('menu.pin'),
              icon: prim(isPinned ? 'IconPinFillRegular' : 'IconPinOutlineRegular'),
              onSelect: () =>
                run(() =>
                  isPinned ? services.unpinRemoteSession(hostId, rawId) : services.pinRemoteSession(hostId, rawId),
                ),
            },
            {
              id: 'rename',
              label: tr('menu.rename'),
              icon: prim('IconEditOutlineRegular'),
              onSelect: () => requestRenameSession(session, host),
            },
            {
              id: 'fork',
              label: tr('menu.fork'),
              icon: prim('IconBranchOutlineRegular'),
              onSelect: () => run(() => services.forkRemoteSession(hostId, rawId)),
            },
            {
              id: 'archive',
              label: isArchived ? tr('menu.unarchive') : tr('menu.archive'),
              icon: prim(isArchived ? 'IconUnarchiveOutlineRegular' : 'IconArchiveOutlineRegular'),
              onSelect: () =>
                run(() =>
                  isArchived
                    ? services.unarchiveRemoteSession(hostId, rawId)
                    : services.archiveRemoteSession(hostId, rawId),
                ),
            },
            {
              id: 'copy-id',
              label: tr('menu.copyId'),
              icon: prim('IconCopyOutlineRegular'),
              onSelect: () => services.copySessionId(session.rawId),
            },
          ]
        }
        const isPinned = pinned.has(session.id)
        return [
          {
            id: 'pin',
            label: isPinned ? tr('menu.unpin') : tr('menu.pin'),
            icon: prim(isPinned ? 'IconPinFillRegular' : 'IconPinOutlineRegular'),
            onSelect: () => (isPinned ? services.unpinSession(session.id) : services.pinSession(session.id)),
          },
          {
            id: 'rename',
            label: tr('menu.rename'),
            icon: prim('IconEditOutlineRegular'),
            shortcut: { aria: 'Control+Alt+G', keys: ['Ctrl', 'Alt', 'G'] },
            onSelect: () => requestRenameSession(session, null),
          },
          {
            id: 'fork',
            label: tr('menu.fork'),
            icon: prim('IconBranchOutlineRegular'),
            shortcut: { aria: 'Control+Alt+F', keys: ['Ctrl', 'Alt', 'F'] },
            onSelect: () => services.forkSession(session.id),
          },
          {
            id: 'archive',
            label: tr('menu.archive'),
            icon: prim('IconArchiveOutlineRegular'),
            shortcut: { aria: 'Control+Shift+A', keys: ['Ctrl', 'Shift', 'A'] },
            onSelect: () => services.archiveSession(session.id),
          },
          {
            id: 'copy-id',
            label: tr('menu.copyId'),
            icon: prim('IconCopyOutlineRegular'),
            onSelect: () => services.copySessionId(session.id),
          },
        ]
      }

      const workspaceMenuItems = (workspace, host) => {
        if (host) {
          if (host.status !== 'online') return []
          if (!workspace.workspaceId) {
            // baseline 缺失时工作区管理不可用
            return [
              {
                id: 'readonly',
                label: tr('action.remoteReadOnly'),
                icon: prim('IconInfoCircleOutlineRegular'),
                onSelect: () => {},
                disabled: true,
              },
            ]
          }
          return [
            {
              id: 'rename',
              label: tr('menu.renameWorkspace'),
              icon: prim('IconEditOutlineRegular'),
              onSelect: () =>
                setDialog({
                  kind: 'workspace',
                  title: tr('dialog.renameWorkspace'),
                  value: workspace.name || '',
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
                  description: tr('dialog.deleteWorkspaceDesc', { name: workspace.name || '' }),
                  workspace,
                  host,
                }),
            },
          ]
        }
        return [
          {
            id: 'rename',
            label: tr('menu.renameWorkspace'),
            icon: prim('IconEditOutlineRegular'),
            onSelect: () =>
              setDialog({ kind: 'workspace', title: tr('dialog.renameWorkspace'), value: workspace.title || '', workspace }),
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
                description: tr('dialog.deleteWorkspaceDesc', { name: workspace.title || '' }),
                workspace,
              }),
          },
        ]
      }

      const renderSession = (session, host, workspace) => {
        const key = host ? `r:${session.rawId}` : `l:${session.id}`
        const isArchived = host ? session.archived === true : archived.has(session.id)
        const isPinned = host ? session.pinned === true : pinned.has(session.id)
        const runRemote = (fn) => async () => {
          try {
            await fn()
            await refresh()
          } catch (error) {
            console.error('[peerbar] 远端操作失败', error)
            setNotice(String(error?.message ?? error))
          }
        }
        const actions = (menuOpen, setMenuOpen) => {
          const nodes = [
            React.createElement(RowMenu, {
              key: 'menu',
              label: tr('menu.more'),
              items: sessionMenuItems(session, host),
              onOpenChange: setMenuOpen,
            }),
          ]
          nodes.push(
            React.createElement(IconAction, {
              key: 'archive',
              icon: isArchived ? 'IconUnarchiveOutlineRegular' : 'IconArchiveOutlineRegular',
              label: isArchived ? tr('menu.unarchive') : tr('menu.archive'),
              onClick: host
                ? runRemote(() =>
                    isArchived
                      ? services.unarchiveRemoteSession(host.hostId, session.rawId)
                      : services.archiveRemoteSession(host.hostId, session.rawId),
                  )
                : () => (isArchived ? services.unarchiveSession(session.id) : services.archiveSession(session.id)),
            }),
            React.createElement(IconAction, {
              key: 'pin',
              icon: isPinned ? 'IconPinFillRegular' : 'IconPinOutlineRegular',
              label: isPinned ? tr('menu.unpin') : tr('menu.pin'),
              active: isPinned,
              onClick: host
                ? runRemote(() =>
                    isPinned
                      ? services.unpinRemoteSession(host.hostId, session.rawId)
                      : services.pinRemoteSession(host.hostId, session.rawId),
                  )
                : () => (isPinned ? services.unpinSession(session.id) : services.pinSession(session.id)),
            }),
          )
          return nodes
        }
        return React.createElement(SessionRow, {
          key,
          title: session.title || tr('session.untitled'),
          time: session.blank ? '' : timeLabel(host ? session.lastActivityAt : session.updatedAt),
          state: session.running ? 'ongoing' : 'idle',
          pinned: isPinned,
          archived: isArchived,
          stale: host ? host.status !== 'online' : false,
          cwd: workspace.cwd ?? session.cwd,
          actions,
          onOpen: () => (host ? openRemote(host, session, workspace) : openSession(session.id)),
          onRename: () => requestRenameSession(session, host),
        })
      }

      const renderRows = (key, rows, host, workspace) => {
        const showAll = overflowAll.has(key)
        const shown = showAll ? rows : rows.slice(0, 8)
        const parts = shown.map((session) => renderSession(session, host, workspace))
        if (!showAll && rows.length > 8) {
          parts.push(
            React.createElement(
              'button',
              {
                key: `${key}:more`,
                type: 'button',
                className: 'hP3ldq_sessionOverflowButton',
                onClick: () => toggleOverflow(key),
              },
              tr('tree.overflow', { n: rows.length }),
            ),
          )
        }
        return React.createElement('div', { style: { '--dsh-workspace-indent': '20px' } }, parts)
      }

      const renderProjectRow = ({ key, label, open, onToggle, menuItems, onNew, actionsDisabled }) =>
        React.createElement(
          'div',
          {
            className: 'koUx-W_projectRow',
            role: 'treeitem',
            'aria-expanded': open,
            onClick: onToggle,
          },
          React.createElement(
            'span',
            { className: 'koUx-W_slot koUx-W_folder' },
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
            React.createElement('span', { className: 'koUx-W_title' }, label),
          ),
          actionsDisabled
            ? null
            : React.createElement(
                'span',
                { className: 'koUx-W_rowActions' },
                menuItems ? React.createElement(RowMenu, { label: tr('menu.more'), items: menuItems }) : null,
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
        return React.createElement(
          'div',
          { key, role: 'treeitem' },
          renderProjectRow({
            key,
            label: workspace.title || basename(workspace.path) || workspace.workspaceId,
            open,
            onToggle: () => fold.toggle(key, true),
            menuItems: workspaceMenuItems(workspace),
            onNew: () => openWorkspace?.(workspace.workspaceId),
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
        const newRemoteSession = async () => {
          if (!workspace.workspaceId) {
            setNotice(tr('action.remoteReadOnly'))
            return
          }
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
          React.createElement(
            'div',
            { className: 'koUx-W_projectRow', role: 'treeitem', 'aria-expanded': open, onClick: () => fold.toggle(key, false) },
            React.createElement(
              'span',
              { className: 'koUx-W_slot koUx-W_folder' },
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
                React.createElement('span', { className: 'koUx-W_title' }, workspace.name),
                React.createElement('span', { className: 'dshp-tag', style: { color: hostColor(host) } }, host.name),
              ),
            ),
            offline
              ? React.createElement(
                  'span',
                  { className: 'koUx-W_meta', style: { flex: '0 0 auto', color: statusColor(host.status) } },
                  statusLabel(host.status),
                )
              : React.createElement(
                  'span',
                  { className: 'koUx-W_rowActions' },
                  React.createElement(RowMenu, {
                    label: tr('menu.more'),
                    items: workspaceMenuItems(workspace, host),
                  }),
                  React.createElement(IconAction, {
                    icon: 'IconNewChatOutlineRegular',
                    label: tr('tree.newSession'),
                    onClick: (event) => {
                      event.stopPropagation()
                      void newRemoteSession()
                    },
                  }),
                ),
          ),
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
          { className: 'dshp-head' },
          React.createElement('span', { className: 'dshp-head-title' }, tr('tree.title')),
          React.createElement('span', { className: 'dshp-spacer' }),
          searchOpen || query
            ? React.createElement('input', {
                className: 'dshp-search',
                value: query,
                placeholder: tr('tree.search'),
                autoFocus: true,
                onChange: (event) => setQuery(event.target.value),
                onBlur: () => {
                  if (!query) setSearchOpen(false)
                },
              })
            : React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'hP3ldq_iconButton',
                  title: tr('tree.search'),
                  onClick: () => setSearchOpen(true),
                },
                prim('IconSearchOutlineRegular', { size: 16 }),
              ),
          React.createElement(ViewOptionsMenu, {
            view,
            onChange: (patch) => setView((previous) => ({ ...previous, ...patch })),
          }),
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
        dialog
          ? React.createElement(Dialog, {
              title: dialog.title,
              description: dialog.description,
              value: dialog.value,
              placeholder: dialog.kind === 'workspace' ? tr('field.workspaceName') : tr('field.sessionName'),
              submitLabel: dialog.kind === 'delete-workspace' ? tr('action.delete') : tr('action.save'),
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
      injectStyles()
      console.info('[peerbar] client build', BUILD)
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
      const callRemoteRpc = async (hostId, endpoint, args) => {
        const result = await request(`/hosts/${encodeURIComponent(hostId)}/rpc`, {
          method: 'POST',
          body: JSON.stringify({ endpoint, args: args ?? {} }),
        })
        return result?.value
      }

      const services = {
        renameSession: (sessionId, title) => callOn('sessions', 'rename', sessionId, title),
        renameWorkspace: (workspaceId, title) => callOn('workspaces', 'rename', workspaceId, title),
        deleteWorkspace: (workspaceId) => callOn('workspaces', 'delete', workspaceId),
        archiveSession: (sessionId) => callOn('workspaces', 'archiveSession', sessionId),
        unarchiveSession: (sessionId) => callOn('workspaces', 'unarchiveSession', sessionId),
        pinSession: (sessionId) => callOn('workspaces', 'pinSession', sessionId),
        unpinSession: (sessionId) => callOn('workspaces', 'unpinSession', sessionId),
        forkSession: (sessionId) => callOn('uiWorkspace', 'forkSession', sessionId),
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
      }

      const register = (label, fn) => {
        try {
          fn()
        } catch (error) {
          console.error(`[peerbar] ${label} 注册失败`, error)
        }
      }

      // 1) 顶替官方工作区浏览器
      register('sidebar.workspaces', () =>
        ctx.slots.inject('sidebar.workspaces', () =>
          ctx.slots.register({ name: 'sidebar.workspaces' }, (props) =>
            React.createElement(WorkspaceTree, { ...props, openSession, openWorkspace, selectPanel, services, nativeCtx: ctx }),
          ),
        ),
      )

      // 3) 设置分区
      register('settings.section', () =>
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'peers', order: 900, locale: NS, label: () => tr('section.peers') },
            PeersSection,
          ),
        ),
      )

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

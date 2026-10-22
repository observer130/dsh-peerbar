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
    const MarkdownText = primitives?.MarkdownText ?? null

    function prim(name, props) {
      const Component = primitives?.[name]
      return Component ? React.createElement(Component, props) : null
    }

    const NS = 'dsh-peerbar'
    const API = '/dsh-peerbar/api'
    const STYLE_ID = 'dsh-peerbar-style'
    const COLLAPSED_KEY = 'dsh-peerbar.collapsed'

    const PANEL_ID = 'peerbar-session'

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
      'session.untitled': '未命名会话',
      'session.running': '运行中',
      'panel.readonly': '只读，请在远端继续',
      'panel.back': '返回对话',
      'panel.loading': '读取正文…',
      'panel.empty': '这个会话还没有可读的消息',
      'panel.loadEarlier': '加载更早的消息',
      'panel.start': '已经到最早的消息了',
      'panel.copy': '复制',
      'panel.copied': '已复制',
      'md.copy': '复制',
      'md.copied': '已复制',
      'md.code': '代码',
      'md.wrap': '自动换行',
      'md.unwrap': '取消换行',
      'md.footnotes': '脚注',
      'role.user': '你',
      'role.assistant': '助手',
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
      'action.pin': '置顶',
      'action.unpin': '取消置顶',
      'action.archive': '归档',
      'action.remoteReadOnly': '远端工作区只读（远端不返回 workspaceId）',
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
      'session.untitled': 'Untitled session',
      'session.running': 'Running',
      'panel.readonly': 'Read-only — continue on the remote host',
      'panel.back': 'Back to chat',
      'panel.loading': 'Loading transcript…',
      'panel.empty': 'No readable messages in this session',
      'panel.loadEarlier': 'Load earlier messages',
      'panel.start': 'Beginning of the session',
      'panel.copy': 'Copy',
      'panel.copied': 'Copied',
      'md.copy': 'Copy',
      'md.copied': 'Copied',
      'md.code': 'Code',
      'md.wrap': 'Wrap lines',
      'md.unwrap': 'No wrap',
      'md.footnotes': 'Footnotes',
      'role.user': 'You',
      'role.assistant': 'Assistant',
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
      'action.pin': 'Pin',
      'action.unpin': 'Unpin',
      'action.archive': 'Archive',
      'action.remoteReadOnly': 'Remote workspaces are read-only (no workspaceId)',
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
      }, [intervalMs])

      return { state, error }
    }

    /** 远端正文的目标：模块级存储，点击时写入，面板订阅。 */
    const targetListeners = new Set()
    let remoteTarget = null

    function setRemoteTarget(next) {
      remoteTarget = next
      for (const listener of targetListeners) listener()
    }

    function useRemoteTarget() {
      const [, force] = React.useState(0)
      React.useEffect(() => {
        const listener = () => force((value) => value + 1)
        targetListeners.add(listener)
        return () => targetListeners.delete(listener)
      }, [])
      return remoteTarget
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
.dshp-panel-foot { border-top:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.18)); padding:8px 16px; font-size:12px; line-height:18px; color:var(--dsw-alias-label-tertiary); flex:none; }
.dshp-btn { font:inherit; font-size:12px; line-height:1.4; color:var(--dsw-alias-label-secondary, inherit); background:transparent; border:.5px solid var(--dsw-alias-border-l4, rgba(128,128,128,.32)); border-radius:var(--dsw-radius-sm, 6px); padding:3px 9px; cursor:pointer; white-space:nowrap; }
.dshp-btn:hover { background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.1)); }
.dshp-msg { padding:10px 0; }
.dshp-muted { color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:18px; }
.dshp-tools { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
.dshp-tool { font-size:12px; line-height:18px; border:.5px solid var(--dsw-alias-border-l3, rgba(128,128,128,.2)); border-radius:var(--dsw-radius-sm, 6px); padding:1px 8px; background:var(--dsw-alias-bg-l1, rgba(128,128,128,.04)); max-width:100%; }
.dshp-tool[open] { flex:1 1 100%; padding:4px 8px; }
.dshp-tool summary { cursor:pointer; font-family:var(--ds-font-family-code, ui-monospace, monospace); outline:none; color:var(--dsw-alias-label-secondary); }
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

    function SessionRow({ session, time, running, selected, stale, cwd, menu, renaming, draft, onDraft, onRenameCommit, onRenameCancel, onClick }) {
      if (renaming) {
        return React.createElement(
          'div',
          { className: 'koUx-W_sessionRow' },
          React.createElement('span', { className: 'koUx-W_slot' }),
          React.createElement('input', {
            className: 'koUx-W_renameInput',
            value: draft,
            autoFocus: true,
            onChange: (event) => onDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') onRenameCommit()
              if (event.key === 'Escape') onRenameCancel()
            },
            onBlur: onRenameCommit,
          }),
        )
      }
      return React.createElement(
        'div',
        {
          className: 'koUx-W_sessionRow' + (selected ? ' koUx-W_selected' : ''),
          role: 'treeitem',
          title: cwd ? `${session.title}\n${cwd}` : session.title,
          onClick,
          style: stale ? { opacity: 0.55 } : undefined,
        },
        React.createElement(
          'span',
          { className: 'koUx-W_slot' },
          running
            ? React.createElement('span', {
                className: 'koUx-W_dot',
                style: { width: 6, height: 6, borderRadius: 999, background: 'var(--dsw-alias-state-success-primary, #2ea043)' },
              })
            : null,
        ),
        React.createElement('span', { className: 'koUx-W_title' }, session.title),
        React.createElement('span', { className: 'koUx-W_time' }, time),
        menu
          ? React.createElement('span', { className: 'koUx-W_rowActions', onClick: (event) => event.stopPropagation() }, menu)
          : null,
      )
    }

    /** 官方行菜单（Menu + MenuItemButton），items: [{label, icon, onSelect}] */
    function RowMenu({ items, label }) {
      const [open, setOpen] = React.useState(false)
      const Menu = primitives?.Menu
      const MenuItemButton = primitives?.MenuItemButton
      if (!Menu || !MenuItemButton || !items.length) return null
      return React.createElement(Menu, {
        open,
        onClose: () => setOpen(false),
        portal: true,
        closeOnPointerLeave: true,
        anchor: React.createElement(
          'button',
          {
            type: 'button',
            className: 'koUx-W_iconButton',
            'aria-label': label,
            onClick: (event) => {
              event.stopPropagation()
              setOpen((value) => !value)
            },
          },
          prim('IconEllipsisOutlineRegular', { size: 14 }),
        ),
        children: items.map((item, index) =>
          React.createElement(
            MenuItemButton,
            {
              key: item.label,
              icon: item.icon ? prim(item.icon, { size: 14 }) : undefined,
              onSelect: () => {
                setOpen(false)
                try {
                  const result = item.onSelect()
                  if (result && typeof result.catch === 'function') result.catch((error) => console.warn('[peerbar] 操作失败', error))
                } catch (error) {
                  console.warn('[peerbar] 操作失败', error)
                }
              },
            },
            item.label,
          ),
        ),
      })
    }

    const OVERFLOW_LIMIT = 8

    function WorkspaceTree(props) {
      const { useWorkspaces, useSessions, openSession, openWorkspace, services } = props
      const workspaces = useWorkspaces((state) => state.items)
      const list = useSessions((state) => state)
      const archivedIds = useWorkspaces((state) => state.archivedSessionIds) ?? []
      const pinnedIds = useWorkspaces((state) => state.pinnedSessionIds) ?? []
      const { state, error } = usePeerState(5000)
      const fold = useFoldState()
      const [query, setQuery] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [rename, setRename] = React.useState(null)
      const [overflowAll, setOverflowAll] = React.useState(() => new Set())
      const [searchOpen, setSearchOpen] = React.useState(false)

      React.useEffect(() => {
        if (!notice) return undefined
        const timer = setTimeout(() => setNotice(''), 3500)
        return () => clearTimeout(timer)
      }, [notice])

      const lowered = query.trim().toLowerCase()
      const match = (title) => !lowered || String(title ?? '').toLowerCase().includes(lowered)
      const archived = React.useMemo(() => new Set(archivedIds), [archivedIds])
      const pinned = React.useMemo(() => new Set(pinnedIds), [pinnedIds])
      const visibleSession = (session) => Boolean(session) && !session.blank && !archived.has(session.id) && match(session.title)
      const byRecency = (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)

      const local = React.useMemo(() => {
        const used = new Set()
        const groups = (workspaces ?? []).map((workspace) => {
          const rows = (workspace.sessionIds ?? [])
            .map((id) => {
              used.add(id)
              return list.byId?.[id]
            })
            .filter(visibleSession)
            .sort(byRecency)
          return { key: `local:${workspace.workspaceId}`, workspace, rows }
        })
        const ungrouped = (list.ids ?? [])
          .map((id) => list.byId?.[id])
          .filter((session) => session && !used.has(session.id) && visibleSession(session))
          .sort(byRecency)
        return { groups, ungrouped }
      }, [workspaces, list, archived, lowered])

      const remoteGroups = React.useMemo(() => {
        const groups = []
        for (const host of state?.hosts ?? []) {
          for (const workspace of host.workspaces ?? []) {
            const rows = (workspace.sessions ?? [])
              .filter((session) => session && !session.blank && match(session.title))
              .sort(byRecency)
            groups.push({ key: `remote:${host.hostId}:${workspace.id}`, host, workspace, rows })
          }
        }
        return groups
      }, [state, lowered])

      const openRemote = (host, session) => {
        if (host.status !== 'online') {
          setNotice(tr('tree.offline', { host: host.name }))
          return
        }
        setRemoteTarget({
          hostId: host.hostId,
          hostName: host.name,
          sessionId: session.rawId,
          title: session.title,
        })
        props.selectPanel(PANEL_ID)
      }

      const toggleOverflow = (key) => {
        setOverflowAll((previous) => {
          const next = new Set(previous)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      }

      const startRename = (kind, id, title) => setRename({ kind, id, draft: title })
      const commitRename = async () => {
        if (!rename) return
        const title = rename.draft.trim()
        setRename(null)
        if (!title) return
        try {
          if (rename.kind === 'local-session') await services.renameSession(rename.id, title)
          else if (rename.kind === 'local-workspace') await services.renameWorkspace(rename.id, title)
          else if (rename.kind === 'remote-session') await services.renameRemoteSession(rename.hostId, rename.id, title)
        } catch (cause) {
          setNotice(String(cause?.message ?? cause))
        }
      }

      const sessionMenu = (session, host) => {
        const items = []
        if (host) {
          if (host.status === 'online') {
            items.push({ label: tr('action.rename'), icon: 'IconEditOutlineRegular', onSelect: () => startRename('remote-session', session.rawId, session.title) })
          }
          return items
        }
        items.push({ label: tr('action.rename'), icon: 'IconEditOutlineRegular', onSelect: () => startRename('local-session', session.id, session.title) })
        items.push(
          pinned.has(session.id)
            ? { label: tr('action.unpin'), icon: 'IconPinFillRegular', onSelect: () => services.unpinSession(session.id) }
            : { label: tr('action.pin'), icon: 'IconPinFillRegular', onSelect: () => services.pinSession(session.id) },
        )
        items.push({
          label: tr('action.archive'),
          icon: 'IconArchiveOutlineRegular',
          onSelect: () => services.archiveSession(session.id),
        })
        return items
      }

      const workspaceMenu = (workspace, host) => {
        if (host) {
          return [{ label: tr('action.remoteReadOnly'), icon: undefined, onSelect: () => setNotice(tr('action.remoteReadOnly')) }]
        }
        return [
          { label: tr('action.rename'), icon: 'IconEditOutlineRegular', onSelect: () => startRename('local-workspace', workspace.workspaceId, workspace.title || '') },
          {
            label: tr('action.delete'),
            icon: undefined,
            onSelect: () => services.deleteWorkspace(workspace.workspaceId),
          },
        ]
      }

      const renderSession = (session, host, workspace) => {
        const id = host ? `r:${session.rawId}` : `l:${session.id}`
        const renaming = rename && rename.kind === (host ? 'remote-session' : 'local-session') && rename.id === (host ? session.rawId : session.id)
        return React.createElement(SessionRow, {
          key: id,
          session: { id: session.id, title: session.title || tr('session.untitled') },
          time: ago(host ? session.lastActivityAt : session.updatedAt),
          running: session.running === true,
          selected: false,
          stale: host ? host.status !== 'online' : false,
          cwd: workspace.cwd ?? session.cwd,
          menu: React.createElement(RowMenu, {
            label: tr('action.rename'),
            items: sessionMenu(session, host),
          }),
          renaming,
          draft: rename?.draft ?? '',
          onDraft: (value) => setRename((previous) => (previous ? { ...previous, draft: value } : previous)),
          onRenameCommit: commitRename,
          onRenameCancel: () => setRename(null),
          onClick: () => (host ? openRemote(host, session) : openSession(session.id)),
        })
      }

      const renderRows = (key, rows, host, workspace) => {
        const showAll = overflowAll.has(key)
        const shown = showAll ? rows : rows.slice(0, OVERFLOW_LIMIT)
        const parts = shown.map((session) => renderSession(session, host, workspace))
        if (!showAll && rows.length > OVERFLOW_LIMIT) {
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
        return parts
      }

      const renderRowBlock = (key, rows, host, workspace) =>
        React.createElement('div', { style: { '--dsh-workspace-indent': '20px' } }, renderRows(key, rows, host, workspace))

      const renderLocalGroup = (group) => {
        const { workspace, rows, key } = group
        const open = lowered ? true : fold.isOpen(key, true)
        const title = workspace.title || basename(workspace.path) || workspace.workspaceId
        const renaming = rename?.kind === 'local-workspace' && rename.id === workspace.workspaceId
        return React.createElement(
          'div',
          { key, role: 'treeitem' },
          React.createElement(
            'div',
            { className: 'koUx-W_projectRow' + (renaming ? ' koUx-W_menuOpen' : ''), onClick: () => fold.toggle(key, true) },
            React.createElement(
              'span',
              { className: 'koUx-W_slot' },
              React.createElement(
                'span',
                { className: open ? 'koUx-W_arrow koUx-W_arrowOpen' : 'koUx-W_arrow' },
                prim('IconChevronRightOutlineRegular', { size: 14 }),
              ),
            ),
            React.createElement(
              'span',
              { className: 'koUx-W_projectText' },
              renaming
                ? React.createElement('input', {
                    className: 'koUx-W_renameInput',
                    value: rename.draft,
                    autoFocus: true,
                    onChange: (event) => setRename((previous) => ({ ...previous, draft: event.target.value })),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter') commitRename()
                      if (event.key === 'Escape') setRename(null)
                    },
                    onBlur: commitRename,
                    onClick: (event) => event.stopPropagation(),
                  })
                : React.createElement('span', { className: 'koUx-W_title' }, title),
            ),
            React.createElement(
              'span',
              { className: 'koUx-W_rowActions' },
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'koUx-W_iconButton',
                  title: tr('tree.newSession'),
                  onClick: (event) => {
                    event.stopPropagation()
                    openWorkspace?.(workspace.workspaceId)
                  },
                },
                prim('IconNewChatOutlineRegular', { size: 14 }),
              ),
              React.createElement(RowMenu, {
                label: tr('action.rename'),
                items: workspaceMenu(workspace, null),
              }),
            ),
          ),
          open
            ? rows.length > 0
              ? renderRowBlock(key, rows, null, workspace)
              : React.createElement('div', { className: 'dshp-note' }, lowered ? tr('tree.noMatch') : tr('tree.empty'))
            : null,
        )
      }

      const renderRemoteGroup = (group) => {
        const { host, workspace, rows, key } = group
        const offline = host.status !== 'online'
        const open = lowered ? true : fold.isOpen(key, false)
        return React.createElement(
          'div',
          { key, role: 'treeitem', style: offline ? { opacity: 0.55 } : undefined },
          React.createElement(
            'div',
            { className: 'koUx-W_projectRow', onClick: () => fold.toggle(key, false) },
            React.createElement(
              'span',
              { className: 'koUx-W_slot' },
              React.createElement(
                'span',
                { className: open ? 'koUx-W_arrow koUx-W_arrowOpen' : 'koUx-W_arrow' },
                prim('IconChevronRightOutlineRegular', { size: 14 }),
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
              ? React.createElement('span', { className: 'koUx-W_meta', style: { flex: '0 0 auto', color: statusColor(host.status) } }, statusLabel(host.status))
              : React.createElement(
                  'span',
                  { className: 'koUx-W_rowActions' },
                  React.createElement(RowMenu, {
                    label: tr('action.rename'),
                    items: workspaceMenu(workspace, host),
                  }),
                ),
          ),
          open
            ? rows.length > 0
              ? renderRowBlock(key, rows, host, workspace)
              : React.createElement('div', { className: 'dshp-note' }, lowered ? tr('tree.noMatch') : tr('tree.empty'))
            : null,
        )
      }

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
        ),
        error ? React.createElement('div', { className: 'dshp-error' }, tr('tree.remoteError')) : null,
        notice ? React.createElement('div', { className: 'dshp-notice' }, notice) : null,
        React.createElement(
          'div',
          { className: 'dshp-scroll' },
          local.groups.map(renderLocalGroup),
          local.ungrouped.length > 0
            ? React.createElement(
                'div',
                { key: 'local:ungrouped', role: 'treeitem' },
                React.createElement(
                  'div',
                  { className: 'koUx-W_projectRow', onClick: () => fold.toggle('local:ungrouped', true) },
                  React.createElement(
                    'span',
                    { className: 'koUx-W_slot' },
                    React.createElement(
                      'span',
                      {
                        className: fold.isOpen('local:ungrouped', true) ? 'koUx-W_arrow koUx-W_arrowOpen' : 'koUx-W_arrow',
                      },
                      prim('IconChevronRightOutlineRegular', { size: 14 }),
                    ),
                  ),
                  React.createElement(
                    'span',
                    { className: 'koUx-W_projectText' },
                    React.createElement('span', { className: 'koUx-W_title' }, tr('tree.ungrouped')),
                  ),
                ),
                fold.isOpen('local:ungrouped', true)
                  ? renderRowBlock('local:ungrouped', local.ungrouped, null, {})
                  : null,
              )
            : null,
          remoteGroups.map(renderRemoteGroup),
        ),
      )
    }

    //#endregion

    //#region 远端正文面板

    function CopyButton({ text }) {
      const [copied, setCopied] = React.useState(false)

      React.useEffect(() => {
        if (!copied) return undefined
        const timer = setTimeout(() => setCopied(false), 1500)
        return () => clearTimeout(timer)
      }, [copied])

      const copy = async (event) => {
        event.preventDefault()
        event.stopPropagation()
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
        } catch {
          /* 剪贴板不可用时静默失败 */
        }
      }

      return React.createElement('button', { className: 'dshp-btn', type: 'button', onClick: copy }, copied ? tr('panel.copied') : tr('panel.copy'))
    }

    function RemoteSessionPanel(props) {
      const target = useRemoteTarget()
      const [messages, setMessages] = React.useState(null)
      const [hasMore, setHasMore] = React.useState(false)
      const [cursor, setCursor] = React.useState(null)
      const [loading, setLoading] = React.useState(false)
      const [loadingMore, setLoadingMore] = React.useState(false)
      const [error, setError] = React.useState(null)

      const base = target
        ? `?hostId=${encodeURIComponent(target.hostId)}&id=${encodeURIComponent(target.sessionId)}&limit=30`
        : ''

      React.useEffect(() => {
        if (!target) return undefined
        let alive = true
        setMessages(null)
        setError(null)
        setLoading(true)
        setHasMore(false)
        setCursor(null)
        request(`/session${base}`)
          .then((result) => {
            if (!alive) return
            setMessages(Array.isArray(result.messages) ? result.messages : [])
            setHasMore(result.hasMore === true && Number.isFinite(result.nextBeforeSeq))
            setCursor(Number.isFinite(result.nextBeforeSeq) ? result.nextBeforeSeq : null)
          })
          .catch((cause) => {
            if (alive) setError(cause)
          })
          .finally(() => {
            if (alive) setLoading(false)
          })
        return () => {
          alive = false
        }
      }, [base, target])

      const loadOlder = async () => {
        if (cursor == null || loadingMore) return
        setLoadingMore(true)
        try {
          const result = await request(`/session${base}&before=${cursor}`)
          setMessages((previous) => {
            const seen = new Set((previous ?? []).map((message) => message.seq))
            const older = (result.messages ?? []).filter((message) => !seen.has(message.seq))
            return [...older, ...(previous ?? [])]
          })
          setHasMore(result.hasMore === true && Number.isFinite(result.nextBeforeSeq))
          setCursor(Number.isFinite(result.nextBeforeSeq) ? result.nextBeforeSeq : null)
        } catch (cause) {
          setError(cause)
        } finally {
          setLoadingMore(false)
        }
      }

      const markdownLabels = React.useMemo(
        () => ({
          code: {
            copyLabel: tr('md.copy'),
            copiedLabel: tr('md.copied'),
            toolbarLabels: { codeLabel: tr('md.code'), wrapLabel: tr('md.wrap'), unwrapLabel: tr('md.unwrap') },
          },
          footnotes: tr('md.footnotes'),
        }),
        [],
      )

      if (!target) {
        return React.createElement('div', { className: 'dshp-panel' })
      }

      const list = messages ?? []

      return React.createElement(
        'div',
        { className: 'dshp-panel' },
        React.createElement(
          'div',
          { className: 'dshp-panel-head' },
          React.createElement(
            'button',
            { className: 'dshp-btn', onClick: () => props.selectPanel(null) },
            `← ${tr('panel.back')}`,
          ),
          React.createElement(
            'div',
            { style: { minWidth: 0 } },
            React.createElement('div', { className: 'dshp-panel-title' }, target.title || tr('session.untitled')),
            React.createElement('div', { className: 'dshp-panel-sub' }, `${target.hostName} · ${target.sessionId}`),
          ),
        ),
        React.createElement(
          'div',
          { className: 'dshp-panel-body' },
          error ? React.createElement('div', { className: 'dshp-error' }, error.message) : null,
          loading && messages == null ? React.createElement('div', { className: 'dshp-muted' }, tr('panel.loading')) : null,
          messages != null && list.length === 0 ? React.createElement('div', { className: 'dshp-muted' }, tr('panel.empty')) : null,
          messages != null && hasMore && cursor != null
            ? React.createElement(
                'div',
                { className: 'dshp-center' },
                React.createElement('button', { className: 'dshp-btn', onClick: loadOlder, disabled: loadingMore }, loadingMore ? tr('panel.loading') : tr('panel.loadEarlier')),
              )
            : null,
          messages != null && !hasMore && list.length > 0
            ? React.createElement('div', { className: 'dshp-center dshp-muted' }, tr('panel.start'))
            : null,
          list.map((message) => {
            if (message.role === 'user') {
              return React.createElement(
                'div',
                { key: message.seq, className: 'vq-vBq_userRow' },
                React.createElement(
                  'div',
                  { className: 'vq-vBq_userStack' },
                  React.createElement('div', { className: 'vq-vBq_bubble' }, message.text),
                ),
              )
            }
            return React.createElement(
              'div',
              { key: message.seq, className: 'dshp-msg' },
              message.text && MarkdownText
                ? React.createElement(MarkdownText, { text: message.text, variant: 'body', labels: markdownLabels })
                : message.text
                  ? React.createElement(
                      'div',
                      { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14, lineHeight: '22px' } },
                      message.text,
                    )
                  : null,
              (message.tools ?? []).length
                ? React.createElement(
                    'div',
                    { className: 'dshp-tools' },
                    (message.tools ?? []).map((tool, index) =>
                      React.createElement(
                        'details',
                        { key: tool.callId || `${message.seq}-${index}`, className: 'dshp-tool' },
                        React.createElement(
                          'summary',
                          { style: { color: tool.isError ? '#cf222e' : 'inherit' } },
                          `${tool.name}${tool.result == null ? ' …' : ''}`,
                        ),
                        tool.args ? React.createElement('pre', null, tool.args) : null,
                        tool.result ? React.createElement('pre', null, tool.result) : null,
                        tool.result
                          ? React.createElement(
                              'div',
                              { className: 'dshp-tool-actions' },
                              React.createElement(CopyButton, { text: tool.result }),
                            )
                          : null,
                      ),
                    ),
                  )
                : null,
            )
          }),
        ),
        React.createElement('div', { className: 'dshp-panel-foot' }, tr('panel.readonly')),
      )
    }

    //#endregion

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
        React.createElement('p', { style: styles.hint }, tr('section.hint')),
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

      const services = {
        renameSession: (sessionId, title) => callOn('sessions', 'rename', sessionId, title),
        renameWorkspace: (workspaceId, title) => callOn('workspaces', 'rename', workspaceId, title),
        deleteWorkspace: (workspaceId) => callOn('workspaces', 'delete', workspaceId),
        archiveSession: (sessionId) => callOn('workspaces', 'archiveSession', sessionId),
        unarchiveSession: (sessionId) => callOn('workspaces', 'unarchiveSession', sessionId),
        pinSession: (sessionId) => callOn('workspaces', 'pinSession', sessionId),
        unpinSession: (sessionId) => callOn('workspaces', 'unpinSession', sessionId),
        renameRemoteSession: (hostId, sessionId, title) =>
          request(`/hosts/${encodeURIComponent(hostId)}/sessions/${encodeURIComponent(sessionId)}/rename`, {
            method: 'POST',
            body: JSON.stringify({ title }),
          }),
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
            React.createElement(WorkspaceTree, { ...props, openSession, openWorkspace, selectPanel, services }),
          ),
        ),
      )

      // 2) 远端正文面板（keyed main，不占侧栏图标）
      register('main:peerbar-session', () =>
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, () => React.createElement(RemoteSessionPanel, { selectPanel })),
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

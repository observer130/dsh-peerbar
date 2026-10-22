/**
 * dsh-peerbar — 浏览器半。
 *
 * 手写 `__ModuleLoader__` bundle（无构建）：侧栏图标 + 中栏聚合页 + 设置分区。
 * 数据全部来自同源 `/dsh-peerbar/api/*`，不直连任何远端。
 */

window.__ModuleLoader__.load({
  id: 'dsh-peerbar',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    const NS = 'dsh-peerbar'
    const API = '/dsh-peerbar/api'

    //#region 文案

    const zh = {
      'panel.label': '多机',
      'section.peers': '多机侧栏',
      'section.hint': '登记后，本机会用你粘贴的启动令牌换取一个 30 天有效的 cookie，之后只读远端数据。',
      'field.name': '名称',
      'field.origin': '地址',
      'field.token': '访问令牌',
      'field.tokenHint': '远端 dsh 启动时打印的 ?token= 后面的那串；只在换 cookie 时用一次。',
      'field.insecure': '跳过证书校验（仅内网自签）',
      'action.add': '添加',
      'action.save': '保存',
      'action.cancel': '取消',
      'action.delete': '删除',
      'action.confirmDelete': '确认删除',
      'action.probe': '立即探活',
      'action.refresh': '刷新',
      'action.showToken': '改令牌',
      'section.registered': '已登记',
      'hint.noCookie': '尚未换取 cookie',
      'field.tokenPlaceholder': '粘贴远端打印的令牌',
      'msg.added': '已添加，正在探活',
      'state.online': '在线',
      'state.auth-required': '需要令牌',
      'state.unreachable': '连不上',
      'state.tls-error': '证书不受信',
      'state.not-dsh': '不是 dsh',
      'state.incompatible': '版本不兼容',
      'state.timeout': '超时',
      'state.disabled': '已停用',
      'badge.cached': '缓存',
      'empty.hosts': '还没有登记任何机器',
      'empty.local': '本机暂无会话',
      'empty.peer': '暂无会话',
      'hint.loading': '加载中…',
      'hint.failed': '读取失败',
      'hint.noToken': '未配置令牌',
      'sessions.count': '{n} 个会话',
      'session.unnamed': '（未命名）',
      'session.running': '运行中',
      'msg.duplicate': '该地址已登记',
      'msg.badOrigin': '地址格式不对，示例：https://10.0.0.10:3080',
      'msg.failed': '操作失败',
      'local.label': '本机',
      'host.origin': '来源',
      'filter.all': '全部',
      'filter.label': '按来源过滤',
      'search.placeholder': '搜索会话标题',
      'hint.stale': '断线中，显示的是上次的快照',
      'hint.noMatch': '没有匹配的会话',
      'detail.back': '返回',
      'detail.loading': '读取正文…',
      'detail.empty': '这个会话还没有可读的消息',
      'detail.loadEarlier': '加载更早的消息',
      'detail.start': '已经到最早的消息了',
      'detail.tools': '调用了',
      'role.user': '你',
      'role.assistant': '助手',
    }

    const en = {
      'panel.label': 'Peers',
      'section.peers': 'Peer hosts',
      'section.hint': 'Paste the token printed by the remote dsh once; it is exchanged for a 30-day cookie. Access stays read-only.',
      'field.name': 'Name',
      'field.origin': 'Origin',
      'field.token': 'Access token',
      'field.tokenHint': 'The part after ?token= in the URL the remote dsh printed. Used once to exchange for a cookie.',
      'field.insecure': 'Skip certificate check (self-signed LAN only)',
      'action.add': 'Add',
      'action.save': 'Save',
      'action.cancel': 'Cancel',
      'action.delete': 'Remove',
      'action.confirmDelete': 'Confirm',
      'action.probe': 'Probe now',
      'action.refresh': 'Refresh',
      'action.showToken': 'Change token',
      'section.registered': 'Registered',
      'hint.noCookie': 'No cookie yet',
      'field.tokenPlaceholder': 'Paste the token printed by the remote',
      'msg.added': 'Added, probing…',
      'state.online': 'Online',
      'state.auth-required': 'Token required',
      'state.unreachable': 'Unreachable',
      'state.tls-error': 'Untrusted certificate',
      'state.not-dsh': 'Not dsh',
      'state.incompatible': 'Incompatible',
      'state.timeout': 'Timeout',
      'state.disabled': 'Disabled',
      'badge.cached': 'cached',
      'empty.hosts': 'No hosts registered yet',
      'empty.local': 'No local sessions',
      'empty.peer': 'No sessions',
      'hint.loading': 'Loading…',
      'hint.failed': 'Failed to load',
      'hint.noToken': 'No token configured',
      'sessions.count': '{n} sessions',
      'session.unnamed': '(untitled)',
      'session.running': 'running',
      'msg.duplicate': 'This origin is already registered',
      'msg.badOrigin': 'Invalid origin, e.g. https://10.0.0.10:3080',
      'msg.failed': 'Request failed',
      'local.label': 'Local',
      'host.origin': 'Origin',
      'filter.all': 'All',
      'filter.label': 'Filter by host',
      'search.placeholder': 'Search session titles',
      'hint.stale': 'Offline — showing the last snapshot',
      'hint.noMatch': 'No matching sessions',
      'detail.back': 'Back',
      'detail.loading': 'Loading transcript…',
      'detail.empty': 'No readable messages in this session',
      'detail.loadEarlier': 'Load earlier messages',
      'detail.start': 'Beginning of the session',
      'detail.tools': 'called',
      'role.user': 'You',
      'role.assistant': 'Assistant',
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

    //#endregion

    //#region 小工具

    function useMediaQuery(query) {
      const [matches, setMatches] = React.useState(
        () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
      )
      React.useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
        const mql = window.matchMedia(query)
        const onChange = () => setMatches(mql.matches)
        onChange()
        mql.addEventListener('change', onChange)
        return () => mql.removeEventListener('change', onChange)
      }, [query])
      return matches
    }

    function statusLabel(status) {
      return tr(`state.${status}`)
    }

    function statusColor(status) {
      if (status === 'online') return '#2ea043'
      if (status === 'auth-required') return '#d29922'
      if (status === 'disabled') return '#8b949e'
      return '#cf222e'
    }

    function formatAgo(timestamp) {
      if (!timestamp) return ''
      const delta = Date.now() - timestamp
      if (delta < 60_000) return 'now'
      const minutes = Math.floor(delta / 60_000)
      if (minutes < 60) return `${minutes}m`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return `${hours}h`
      return `${Math.floor(hours / 24)}d`
    }

    function hostColor(host) {
      const palette = {
        teal: '#1f9d8f',
        blue: '#3b82f6',
        purple: '#8b5cf6',
        orange: '#f59e0b',
        pink: '#ec4899',
        green: '#22c55e',
      }
      return palette[host.color] ?? '#8b949e'
    }

    const styles = {
      page: {
        height: '100%',
        overflow: 'auto',
        padding: '18px 20px 40px',
        color: 'inherit',
        fontSize: 13,
        lineHeight: 1.5,
      },
      header: {
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 12,
      },
      title: { fontSize: 15, fontWeight: 600, margin: 0 },
      hint: { opacity: 0.62, fontSize: 12 },
      group: {
        border: '1px solid rgba(128,128,128,0.24)',
        borderRadius: 10,
        marginBottom: 12,
        overflow: 'hidden',
      },
      groupHead: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '9px 12px',
        background: 'rgba(128,128,128,0.06)',
      },
      dot: { width: 8, height: 8, borderRadius: 999, flex: '0 0 auto' },
      groupName: { fontWeight: 600 },
      origin: { opacity: 0.55, fontSize: 11, fontFamily: 'ui-monospace, monospace' },
      badge: {
        fontSize: 11,
        padding: '1px 7px',
        borderRadius: 999,
        border: '1px solid rgba(128,128,128,0.32)',
        opacity: 0.85,
      },
      spacer: { flex: 1 },
      button: {
        font: 'inherit',
        fontSize: 12,
        lineHeight: 1.4,
        color: 'inherit',
        background: 'transparent',
        border: '1px solid rgba(128,128,128,0.36)',
        borderRadius: 6,
        padding: '4px 10px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
      },
      smallButton: {
        font: 'inherit',
        fontSize: 12,
        lineHeight: 1.4,
        color: 'inherit',
        background: 'transparent',
        border: '1px solid rgba(128,128,128,0.32)',
        borderRadius: 6,
        padding: '3px 9px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flex: '0 0 auto',
      },
      buttonPrimary: {
        font: 'inherit',
        fontSize: 12,
        lineHeight: 1.4,
        color: '#fff',
        background: '#2f81f7',
        border: '1px solid #2f81f7',
        borderRadius: 6,
        padding: '5px 14px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
      },
      ws: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 12px',
        cursor: 'pointer',
        userSelect: 'none',
        borderTop: '1px solid rgba(128,128,128,0.14)',
      },
      wsName: { fontWeight: 500 },
      caret: { width: 12, opacity: 0.6, fontSize: 10 },
      session: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 12px 5px 34px',
        borderTop: '1px solid rgba(128,128,128,0.1)',
      },
      sessionTitle: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      muted: { opacity: 0.55, fontSize: 11 },
      empty: { padding: '10px 12px', opacity: 0.6 },
      detailHead: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 },
      message: { padding: '9px 0', borderTop: '1px solid rgba(128,128,128,0.14)' },
      msgHead: { display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 3 },
      role: { fontSize: 11, fontWeight: 600 },
      msgText: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12.5 },
      form: { display: 'grid', gap: 12, maxWidth: 560 },
      row: { display: 'grid', gap: 4 },
      formGrid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' },
      field: { display: 'grid', gap: 4, minWidth: 0 },
      subTitle: { fontSize: 13, fontWeight: 600, margin: 0 },
      divider: { height: 1, background: 'rgba(128,128,128,0.18)', margin: '18px 0 14px', border: 0 },
      card: {
        border: '1px solid rgba(128,128,128,0.24)',
        borderRadius: 10,
        padding: '10px 12px',
        marginBottom: 8,
        background: 'rgba(128,128,128,0.03)',
      },
      cardTop: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
      cardName: { fontWeight: 600, flex: '0 0 auto' },
      cardMeta: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, minHeight: 24 },
      tokenRow: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 },
      input: {
        font: 'inherit',
        fontSize: 13,
        color: 'inherit',
        background: 'transparent',
        border: '1px solid rgba(128,128,128,0.36)',
        borderRadius: 6,
        padding: '6px 9px',
        width: '100%',
        boxSizing: 'border-box',
      },
      label: { fontSize: 12, opacity: 0.75 },
      error: { color: '#cf222e', fontSize: 12 },
      ok: { color: '#2ea043', fontSize: 12 },
      banner: {
        border: '1px solid rgba(207,34,46,0.4)',
        background: 'rgba(207,34,46,0.08)',
        borderRadius: 8,
        padding: '8px 10px',
        marginBottom: 12,
        fontSize: 12,
      },
      sessionRow: { display: 'flex', alignItems: 'center', gap: 6 },
    }

    //#endregion

    //#region 组件

    function PeerbarIcon({ size = 16, active = false }) {
      const edge = active ? 2 : 1.6
      return React.createElement(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: edge,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        React.createElement('rect', { x: 1.6, y: 2.2, width: 12.8, height: 4.2, rx: 1.2 }),
        React.createElement('rect', { x: 1.6, y: 9.6, width: 12.8, height: 4.2, rx: 1.2 }),
        React.createElement('circle', { cx: 4, cy: 4.3, r: 0.55, fill: 'currentColor', stroke: 'none' }),
        React.createElement('circle', { cx: 4, cy: 11.7, r: 0.55, fill: 'currentColor', stroke: 'none' }),
      )
    }

    function matchSession(session, query) {
      if (!query) return true
      return (session.title ?? '').toLowerCase().includes(query) || session.rawId.toLowerCase().includes(query)
    }

    function SessionRow({ session, stale, onNotice, onOpen }) {
      const notice = () => {
        if (stale) {
          if (onNotice) onNotice(tr('hint.stale'))
          return
        }
        if (onOpen) onOpen(session)
      }
      return React.createElement(
        'div',
        {
          style: { ...styles.session, cursor: 'pointer' },
          title: session.rawId,
          onClick: notice,
        },
        React.createElement(
          'div',
          { style: styles.sessionTitle },
          session.title || React.createElement('span', { style: styles.muted }, tr('session.unnamed')),
        ),
        session.running
          ? React.createElement(
              'span',
              { style: { ...styles.muted, color: '#2ea043' }, title: tr('session.running') },
              '●',
            )
          : null,
        React.createElement('span', { style: styles.muted }, formatAgo(session.lastActivityAt)),
      )
    }

    function WorkspaceRow({ workspace, expanded, onToggle, query, stale, onNotice, onOpen }) {
      const sessions = query ? workspace.sessions.filter((session) => matchSession(session, query)) : workspace.sessions
      if (query && sessions.length === 0) return null
      const open = query ? true : expanded
      return React.createElement(
        'div',
        null,
        React.createElement(
          'div',
          { style: styles.ws, onClick: onToggle, role: 'button', tabIndex: 0 },
          React.createElement('span', { style: styles.caret }, open ? '▾' : '▸'),
          React.createElement('span', { style: styles.wsName }, workspace.name),
          React.createElement('span', { style: styles.muted }, workspace.cwd),
          React.createElement('span', { style: styles.spacer }),
          React.createElement('span', { style: styles.muted }, tr('sessions.count', { n: sessions.length })),
        ),
        open
          ? sessions.length > 0
            ? sessions.map((session) =>
                React.createElement(SessionRow, { key: session.id, session, stale, onNotice, onOpen }),
              )
            : React.createElement('div', { style: styles.empty }, tr('empty.peer'))
          : null,
      )
    }

    function HostGroup({ host, label, query = '', onNotice, onOpen }) {
      const [expanded, setExpanded] = React.useState(() => new Set())
      const workspaces = Array.isArray(host.workspaces) ? host.workspaces : []
      const status = host.status ?? 'unreachable'
      const visible = query
        ? workspaces.filter((workspace) => workspace.sessions.some((session) => matchSession(session, query)))
        : workspaces

      const toggle = (id) => {
        setExpanded((previous) => {
          const next = new Set(previous)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }

      return React.createElement(
        'section',
        { style: { ...styles.group, opacity: status === 'online' ? 1 : 0.72 } },
        React.createElement(
          'div',
          { style: styles.groupHead },
          React.createElement('span', { style: { ...styles.dot, background: statusColor(status) } }),
          React.createElement('span', { style: styles.groupName }, label ?? host.name),
          React.createElement('span', { style: styles.origin }, host.origin ?? ''),
          React.createElement('span', { style: styles.spacer }),
          host.stale && workspaces.length > 0
            ? React.createElement('span', { style: styles.badge }, tr('badge.cached'))
            : null,
          status === 'online'
            ? host.latencyMs
              ? React.createElement('span', { style: styles.muted }, `${host.latencyMs}ms`)
              : null
            : React.createElement('span', { style: { ...styles.badge, color: statusColor(status) } }, statusLabel(status)),
          host.message
            ? React.createElement('span', { style: { ...styles.muted, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: host.message }, host.message)
            : null,
        ),
        visible.length === 0
          ? React.createElement(
              'div',
              { style: styles.empty },
              query ? tr('hint.noMatch') : status === 'online' ? tr('empty.peer') : tr('hint.failed'),
            )
          : visible.map((workspace) =>
              React.createElement(WorkspaceRow, {
                key: workspace.id,
                workspace,
                expanded: expanded.has(workspace.id),
                onToggle: () => toggle(workspace.id),
                query,
                stale: status !== 'online',
                onNotice,
                onOpen,
              }),
            ),
      )
    }

    function TranscriptView({ target, onBack }) {
      const [messages, setMessages] = React.useState(null)
      const [hasMore, setHasMore] = React.useState(false)
      const [cursor, setCursor] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [loadingMore, setLoadingMore] = React.useState(false)
      const [error, setError] = React.useState(null)

      const base = `?hostId=${encodeURIComponent(target.hostId)}&id=${encodeURIComponent(target.sessionId)}&limit=30`

      React.useEffect(() => {
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
      }, [base])

      const loadOlder = async () => {
        if (cursor == null || loadingMore) return
        setLoadingMore(true)
        setError(null)
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

      const list = messages ?? []

      return React.createElement(
        'div',
        { style: styles.page },
        React.createElement(
          'header',
          { style: styles.detailHead },
          React.createElement('button', { style: styles.button, onClick: onBack }, `← ${tr('detail.back')}`),
          React.createElement(
            'div',
            { style: { minWidth: 0 } },
            React.createElement(
              'div',
              { style: { ...styles.title, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              target.title || tr('session.unnamed'),
            ),
            React.createElement('div', { style: styles.muted }, `${target.hostName} · ${target.sessionId}`),
          ),
        ),
        error
          ? React.createElement('div', { style: styles.banner }, `${tr('hint.failed')}：${error.message}`)
          : null,
        loading && messages == null ? React.createElement('div', { style: styles.empty }, tr('detail.loading')) : null,
        messages != null && list.length === 0 ? React.createElement('div', { style: styles.empty }, tr('detail.empty')) : null,
        messages != null && hasMore && cursor != null
          ? React.createElement(
              'div',
              { style: { display: 'flex', justifyContent: 'center', padding: '4px 0 10px' } },
              React.createElement(
                'button',
                { style: styles.button, onClick: loadOlder, disabled: loadingMore },
                loadingMore ? tr('detail.loading') : tr('detail.loadEarlier'),
              ),
            )
          : null,
        messages != null && !hasMore && list.length > 0
          ? React.createElement('div', { style: { ...styles.muted, textAlign: 'center', padding: '4px 0 10px' } }, tr('detail.start'))
          : null,
        list.map((message) =>
          React.createElement(
            'div',
            { key: message.seq, style: styles.message },
            React.createElement(
              'div',
              { style: styles.msgHead },
              React.createElement(
                'span',
                { style: { ...styles.role, color: message.role === 'user' ? '#2f81f7' : '#2ea043' } },
                tr(`role.${message.role}`),
              ),
              React.createElement('span', { style: styles.muted }, formatAgo(message.time)),
            ),
            message.text ? React.createElement('div', { style: styles.msgText }, message.text) : null,
            message.tools?.length
              ? React.createElement('div', { style: styles.muted }, `${tr('detail.tools')} ${message.tools.join(', ')}`)
              : null,
          ),
        ),
      )
    }

    function PeerbarPage() {
      const { state, error, reload } = usePeerState(5000)
      const [busy, setBusy] = React.useState(false)
      const [filter, setFilter] = React.useState(() => {
        try {
          return localStorage.getItem('dsh-peerbar.filter') || 'all'
        } catch {
          return 'all'
        }
      })
      const [query, setQuery] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [selected, setSelected] = React.useState(null)
      const narrow = useMediaQuery('(max-width: 900px)')

      const hosts = state?.hosts ?? []
      const local = state?.local
      const lowered = query.trim().toLowerCase()

      React.useEffect(() => {
        try {
          localStorage.setItem('dsh-peerbar.filter', filter)
        } catch {
          /* localStorage 不可用时只是不记忆 */
        }
      }, [filter])

      React.useEffect(() => {
        if (!notice) return undefined
        const timer = setTimeout(() => setNotice(''), 4000)
        return () => clearTimeout(timer)
      }, [notice])

      const refresh = async () => {
        setBusy(true)
        try {
          await request('/state')
          reload()
        } finally {
          setBusy(false)
        }
      }

      const showLocal = filter === 'all' || filter === 'local'
      const visibleHosts = filter === 'all' ? hosts : hosts.filter((host) => host.hostId === filter)
      const localHost = local ? { ...local, name: tr('local.label'), origin: '' } : null
      const openSession = (host, session) =>
        setSelected({
          hostId: host.hostId,
          hostName: host.name || host.hostId,
          sessionId: session.rawId,
          title: session.title,
        })
      const chips = [
        { id: 'all', label: tr('filter.all') },
        { id: 'local', label: tr('local.label') },
        ...hosts.map((host) => ({ id: host.hostId, label: host.name })),
      ]

      if (selected) {
        return React.createElement(TranscriptView, { target: selected, onBack: () => setSelected(null) })
      }

      const filterBar = narrow
        ? React.createElement(
            'select',
            {
              style: { ...styles.input, width: 'auto', padding: '4px 8px' },
              value: filter,
              onChange: (event) => setFilter(event.target.value),
              'aria-label': tr('filter.label'),
            },
            chips.map((chip) => React.createElement('option', { key: chip.id, value: chip.id }, chip.label)),
          )
        : React.createElement(
            'div',
            { style: { display: 'flex', gap: 6, flexWrap: 'wrap' }, role: 'tablist', 'aria-label': tr('filter.label') },
            chips.map((chip) =>
              React.createElement(
                'button',
                {
                  key: chip.id,
                  role: 'tab',
                  'aria-selected': filter === chip.id,
                  onClick: () => setFilter(chip.id),
                  style: {
                    ...styles.button,
                    padding: '2px 10px',
                    borderColor: filter === chip.id ? '#2f81f7' : 'rgba(128,128,128,0.36)',
                    color: filter === chip.id ? '#2f81f7' : 'inherit',
                  },
                },
                chip.label,
              ),
            ),
          )

      return React.createElement(
        'div',
        { style: styles.page },
        React.createElement(
          'header',
          { style: styles.header },
          React.createElement('h1', { style: styles.title }, tr('panel.label')),
          React.createElement(
            'div',
            { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            React.createElement('span', { style: styles.hint }, `${hosts.length} · ${local?.workspaces?.length ?? 0}`),
            React.createElement('button', { style: styles.button, onClick: refresh, disabled: busy }, tr('action.refresh')),
          ),
        ),
        React.createElement(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' } },
          filterBar,
          React.createElement('input', {
            style: { ...styles.input, flex: '1 1 180px', maxWidth: 320, padding: '4px 8px' },
            value: query,
            placeholder: tr('search.placeholder'),
            onChange: (event) => setQuery(event.target.value),
            'aria-label': tr('search.placeholder'),
          }),
        ),
        error
          ? React.createElement('div', { style: styles.banner }, `${tr('hint.failed')}：${error.message}`)
          : null,
        notice ? React.createElement('div', { style: styles.banner }, notice) : null,
        !state && !error ? React.createElement('div', { style: styles.empty }, tr('hint.loading')) : null,
        showLocal && localHost
          ? React.createElement(HostGroup, {
              key: 'local',
              host: localHost,
              label: tr('local.label'),
              query: lowered,
              onNotice: setNotice,
              onOpen: (session) => openSession(localHost, session),
            })
          : null,
        visibleHosts.map((host) =>
          React.createElement(HostGroup, {
            key: host.hostId,
            host,
            query: lowered,
            onNotice: setNotice,
            onOpen: (session) => openSession(host, session),
          }),
        ),
        hosts.length === 0
          ? React.createElement('div', { style: styles.empty }, tr('empty.hosts'))
          : null,
      )
    }

    function HostCard({ host, pending, editing, confirming, tokenDraft, onTokenDraft, onProbe, onRemove, onToggleEdit, onSaveToken }) {
      const status = host.status ?? 'unreachable'
      return React.createElement(
        'div',
        { style: styles.card },
        React.createElement(
          'div',
          { style: styles.cardTop },
          React.createElement('span', { style: { ...styles.dot, background: statusColor(status) } }),
          React.createElement('span', { style: styles.cardName }, host.name),
          React.createElement('span', { style: { ...styles.origin, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: host.origin }, host.origin),
          React.createElement('span', { style: styles.spacer }),
          React.createElement(
            'span',
            { style: { ...styles.badge, color: statusColor(status), borderColor: statusColor(status) } },
            statusLabel(status),
          ),
        ),
        React.createElement(
          'div',
          { style: styles.cardMeta },
          React.createElement('span', { style: styles.muted }, host.hasCookie ? 'cookie ✓' : tr('hint.noCookie')),
          host.stale ? React.createElement('span', { style: styles.muted }, `· ${tr('badge.cached')}`) : null,
          React.createElement('span', { style: styles.spacer }),
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
              React.createElement(
                'button',
                { style: styles.buttonPrimary, disabled: pending || !tokenDraft, onClick: onSaveToken },
                tr('action.save'),
              ),
              React.createElement('button', { style: styles.smallButton, disabled: pending, onClick: onToggleEdit }, tr('action.cancel')),
            )
          : null,
      )
    }

    function PeersSection() {
      const { state, error, reload } = usePeerState(5000)
      const [form, setForm] = React.useState({ name: '', origin: '', token: '', allowSelfSigned: false })
      const [message, setMessage] = React.useState(null)
      const [pending, setPending] = React.useState(false)
      const [editing, setEditing] = React.useState(null)
      const [confirming, setConfirming] = React.useState(null)
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
          setMessage({ kind: 'ok', text: tr('action.add') })
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

      return React.createElement(
        'div',
        { style: styles.page },
        React.createElement('h1', { style: styles.title }, tr('section.peers')),
        React.createElement('p', { style: styles.hint }, tr('section.hint')),
        error ? React.createElement('div', { style: styles.banner }, error.message) : null,
        message
          ? React.createElement('div', { style: message.kind === 'error' ? styles.error : styles.ok }, message.text)
          : null,
        hosts.length === 0
          ? React.createElement('div', { style: styles.empty }, tr('empty.hosts'))
          : React.createElement(
              'div',
              null,
              React.createElement('h2', { style: { ...styles.subTitle, marginBottom: 8, opacity: 0.75 } }, tr('section.registered')),
              hosts.map((host) =>
                React.createElement(HostCard, {
                  key: host.hostId,
                  host,
                  pending,
                  editing: editing === host.hostId,
                  confirming: confirming === host.hostId,
                  tokenDraft,
                  onTokenDraft: setTokenDraft,
                  onProbe: () => probe(host.hostId),
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
          React.createElement('h2', { style: styles.subTitle }, tr('action.add')),
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
            { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            React.createElement(
              'button',
              { style: { ...styles.buttonPrimary, minWidth: 92 }, type: 'submit', disabled: pending || !form.origin },
              tr('action.add'),
            ),
          ),
        ),
      )
    }

    //#endregion

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'peerbar: dictionaries')
      try {
        translate = ctx.locale.bind(NS)
      } catch {
        translate = (key) => zh[key] ?? en[key] ?? key
      }

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          { name: 'sidebar.panellist', id: 'peerbar', order: 120, locale: NS, label: () => tr('panel.label') },
          PeerbarIcon,
        ),
      )

      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: 'peerbar' }, PeerbarPage),
      )

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          { name: 'settings.section', id: 'peers', order: 900, locale: NS, label: () => tr('section.peers') },
          PeersSection,
        ),
      )
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    return module.exports
  },
})

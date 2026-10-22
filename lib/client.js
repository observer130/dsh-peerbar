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
      'action.probe': '立即探活',
      'action.refresh': '刷新',
      'action.showToken': '改令牌',
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
      'msg.badOrigin': '地址格式不对，示例：https://192.168.3.50:3080',
      'msg.failed': '操作失败',
      'local.label': '本机',
      'host.origin': '来源',
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
      'action.probe': 'Probe now',
      'action.refresh': 'Refresh',
      'action.showToken': 'Change token',
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
      'msg.badOrigin': 'Invalid origin, e.g. https://192.168.3.50:3080',
      'msg.failed': 'Request failed',
      'local.label': 'Local',
      'host.origin': 'Origin',
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
        color: 'inherit',
        background: 'transparent',
        border: '1px solid rgba(128,128,128,0.36)',
        borderRadius: 6,
        padding: '3px 9px',
        cursor: 'pointer',
      },
      buttonPrimary: {
        font: 'inherit',
        fontSize: 12,
        color: '#fff',
        background: '#2f81f7',
        border: '1px solid #2f81f7',
        borderRadius: 6,
        padding: '4px 12px',
        cursor: 'pointer',
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
      form: { display: 'grid', gap: 10, maxWidth: 560 },
      row: { display: 'grid', gap: 4 },
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

    function SessionRow({ session }) {
      return React.createElement(
        'div',
        { style: styles.session, title: session.rawId },
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

    function WorkspaceRow({ workspace, expanded, onToggle }) {
      return React.createElement(
        'div',
        null,
        React.createElement(
          'div',
          { style: styles.ws, onClick: onToggle, role: 'button', tabIndex: 0 },
          React.createElement('span', { style: styles.caret }, expanded ? '▾' : '▸'),
          React.createElement('span', { style: styles.wsName }, workspace.name),
          React.createElement('span', { style: styles.muted }, workspace.cwd),
          React.createElement('span', { style: styles.spacer }),
          React.createElement('span', { style: styles.muted }, tr('sessions.count', { n: workspace.sessions.length })),
        ),
        expanded
          ? workspace.sessions.length > 0
            ? workspace.sessions.map((session) =>
                React.createElement(SessionRow, { key: session.id, session }),
              )
            : React.createElement('div', { style: styles.empty }, tr('empty.peer'))
          : null,
      )
    }

    function HostGroup({ host, label }) {
      const [expanded, setExpanded] = React.useState(() => new Set())
      const workspaces = Array.isArray(host.workspaces) ? host.workspaces : []
      const status = host.status ?? 'unreachable'

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
            ? null
            : React.createElement('span', { style: { ...styles.badge, color: statusColor(status) } }, statusLabel(status)),
          host.message
            ? React.createElement('span', { style: { ...styles.muted, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: host.message }, host.message)
            : null,
        ),
        workspaces.length === 0
          ? React.createElement(
              'div',
              { style: styles.empty },
              status === 'online' ? tr('empty.peer') : tr('hint.failed'),
            )
          : workspaces.map((workspace) =>
              React.createElement(WorkspaceRow, {
                key: workspace.id,
                workspace,
                expanded: expanded.has(workspace.id),
                onToggle: () => toggle(workspace.id),
              }),
            ),
      )
    }

    function PeerbarPage() {
      const { state, error, reload } = usePeerState(5000)
      const [busy, setBusy] = React.useState(false)

      const hosts = state?.hosts ?? []
      const local = state?.local

      const refresh = async () => {
        setBusy(true)
        try {
          await request('/state')
          reload()
        } finally {
          setBusy(false)
        }
      }

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
        error
          ? React.createElement('div', { style: styles.banner }, `${tr('hint.failed')}：${error.message}`)
          : null,
        !state && !error ? React.createElement('div', { style: styles.empty }, tr('hint.loading')) : null,
        local
          ? React.createElement(HostGroup, {
              key: 'local',
              host: { ...local, name: tr('local.label'), origin: '' },
              label: tr('local.label'),
            })
          : null,
        hosts.map((host) => React.createElement(HostGroup, { key: host.hostId, host })),
        hosts.length === 0
          ? React.createElement('div', { style: styles.empty }, tr('empty.hosts'))
          : null,
      )
    }

    function PeersSection() {
      const { state, error, reload } = usePeerState(5000)
      const [form, setForm] = React.useState({ name: '', origin: '', token: '', allowSelfSigned: false })
      const [message, setMessage] = React.useState(null)
      const [pending, setPending] = React.useState(false)
      const [editing, setEditing] = React.useState(null)
      const [tokenDraft, setTokenDraft] = React.useState('')

      const hosts = state?.hosts ?? []

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
        React.createElement(
          'div',
          { style: { margin: '14px 0 18px' } },
          hosts.length === 0
            ? React.createElement('div', { style: styles.empty }, tr('empty.hosts'))
            : hosts.map((host) =>
                React.createElement(
                  'div',
                  {
                    key: host.hostId,
                    style: {
                      border: '1px solid rgba(128,128,128,0.24)',
                      borderRadius: 8,
                      padding: '9px 11px',
                      marginBottom: 8,
                    },
                  },
                  React.createElement(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                    React.createElement('span', { style: { ...styles.dot, background: statusColor(host.status) } }),
                    React.createElement('strong', null, host.name),
                    React.createElement('span', { style: styles.origin }, host.origin),
                    React.createElement('span', { style: styles.spacer }),
                    React.createElement('span', { style: { ...styles.muted, color: statusColor(host.status) } }, statusLabel(host.status)),
                    React.createElement('button', { style: styles.button, onClick: () => probe(host.hostId), disabled: pending }, tr('action.probe')),
                    React.createElement('button', { style: styles.button, onClick: () => remove(host.hostId), disabled: pending }, tr('action.delete')),
                  ),
                  React.createElement(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 } },
                    React.createElement('span', { style: styles.muted }, host.hasCookie ? 'cookie ✓' : tr('hint.noToken')),
                    React.createElement('span', { style: styles.spacer }),
                    React.createElement('button', { style: styles.button, onClick: () => setEditing(editing === host.hostId ? null : host.hostId) }, tr('action.showToken')),
                  ),
                  editing === host.hostId
                    ? React.createElement(
                        'div',
                        { style: { display: 'flex', gap: 8, marginTop: 6 } },
                        React.createElement('input', {
                          style: styles.input,
                          placeholder: 'token',
                          value: tokenDraft,
                          onChange: (event) => setTokenDraft(event.target.value),
                        }),
                        React.createElement('button', { style: styles.buttonPrimary, onClick: () => saveToken(host.hostId), disabled: pending || !tokenDraft }, tr('action.save')),
                      )
                    : null,
                ),
              ),
        ),
        React.createElement(
          'form',
          { style: styles.form, onSubmit: submit },
          React.createElement('h2', { style: { ...styles.title, fontSize: 13 } }, tr('action.add')),
          React.createElement(
            'div',
            { style: styles.row },
            React.createElement('label', { style: styles.label }, tr('field.name')),
            React.createElement('input', {
              style: styles.input,
              value: form.name,
              placeholder: 'nv50',
              onChange: (event) => setForm({ ...form, name: event.target.value }),
            }),
          ),
          React.createElement(
            'div',
            { style: styles.row },
            React.createElement('label', { style: styles.label }, tr('field.origin')),
            React.createElement('input', {
              style: styles.input,
              value: form.origin,
              placeholder: 'https://192.168.3.50:3080',
              onChange: (event) => setForm({ ...form, origin: event.target.value }),
            }),
          ),
          React.createElement(
            'div',
            { style: styles.row },
            React.createElement('label', { style: styles.label }, tr('field.token')),
            React.createElement('input', {
              style: styles.input,
              type: 'password',
              value: form.token,
              onChange: (event) => setForm({ ...form, token: event.target.value }),
            }),
            React.createElement('span', { style: styles.muted }, tr('field.tokenHint')),
          ),
          React.createElement(
            'label',
            { style: { ...styles.label, display: 'flex', gap: 6, alignItems: 'center' } },
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
            React.createElement('button', { style: styles.buttonPrimary, type: 'submit', disabled: pending || !form.origin }, tr('action.add')),
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
        ctx.slots.register({ name: 'main', key: 'peerbar', locale: NS }, PeerbarPage),
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

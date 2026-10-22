/**
 * dsh-peerbar — 浏览器半。
 *
 * 手写 `__ModuleLoader__` bundle（无构建）。
 * 2026-10-22 范围变更：v0.1 不做聚合视图，只保留「设置 → 多机侧栏」里的
 * Host 登记、探活与凭据管理。
 */

window.__ModuleLoader__.load({
  id: 'dsh-peerbar',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    const NS = 'dsh-peerbar'
    const API = '/dsh-peerbar/api'

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
      'action.rename': '改名',
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
      'action.rename': 'Rename',
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

    const styles = {
      page: {
        height: '100%',
        overflow: 'auto',
        padding: '18px 20px 40px',
        color: 'inherit',
        fontSize: 13,
        lineHeight: 1.5,
      },
      title: { fontSize: 15, fontWeight: 600, margin: '0 0 6px' },
      hint: { opacity: 0.62, fontSize: 12, margin: '0 0 14px' },
      subTitle: { fontSize: 13, fontWeight: 600, margin: '0 0 8px', opacity: 0.75 },
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
      dot: { width: 8, height: 8, borderRadius: 999, flex: '0 0 auto' },
      origin: { opacity: 0.55, fontSize: 11, fontFamily: 'ui-monospace, monospace' },
      spacer: { flex: 1 },
      badge: {
        fontSize: 11,
        padding: '1px 7px',
        borderRadius: 999,
        border: '1px solid rgba(128,128,128,0.32)',
        whiteSpace: 'nowrap',
      },
      muted: { opacity: 0.55, fontSize: 11 },
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
      tokenRow: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 },
      colorRow: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 },
      form: { display: 'grid', gap: 12, maxWidth: 560 },
      formGrid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' },
      field: { display: 'grid', gap: 4, minWidth: 0 },
      label: { fontSize: 12, opacity: 0.75 },
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
      empty: { padding: '10px 12px', opacity: 0.6 },
    }

    //#endregion

    //#region 组件

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
            React.createElement(
              'button',
              { style: styles.buttonPrimary, disabled: pending || !nameDraft.trim(), onClick: onSaveName },
              tr('action.save'),
            ),
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
            React.createElement(
              'span',
              { style: { ...styles.origin, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: host.origin },
              host.origin,
            ),
            React.createElement('span', { style: styles.spacer }),
            React.createElement(
              'span',
              { style: { ...styles.badge, color: statusColor(status), borderColor: statusColor(status) } },
              statusLabel(status),
            ),
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
            React.createElement('input', {
              type: 'checkbox',
              checked: host.enabled !== false,
              disabled: pending,
              onChange: onToggleEnabled,
            }),
            tr('field.enabled'),
          ),
          React.createElement('span', { style: styles.muted }, host.hasCookie ? 'cookie ✓' : tr('hint.noCookie')),
          host.status === 'online' && host.latencyMs
            ? React.createElement('span', { style: styles.muted }, `${host.latencyMs}ms`)
            : null,
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
          await request(`/hosts/${host.hostId}`, {
            method: 'PATCH',
            body: JSON.stringify({ enabled: host.enabled === false }),
          })
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

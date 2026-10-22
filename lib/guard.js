/**
 * 本机接口的栅栏。
 *
 * dsh 的浏览器认证与 Host/Origin 信任只挂在 `/api` 上，插件自己注册的路由
 * 没有任何认证（见 docs/插件开发规范.md §3.3），所以这里必须自己判：
 *
 *   1. 对端地址必须是回环（`req.socket.remoteAddress`，不看可伪造的 Host）
 *   2. Host 头必须是 localhost 或回环地址
 *   3. 带 Origin 时，必须与 Host 同源
 *   4. `sec-fetch-site: cross-site` 一律拒
 *   5. 变更类请求额外要求 JSON + 自定义头（迫使跨源请求走预检）
 */

const LOOPBACK_V4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/

export function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false
  const value = address.toLowerCase()
  if (value === '::1') return true
  const ipv4 = value.startsWith('::ffff:') ? value.slice(7) : value
  return LOOPBACK_V4.test(ipv4)
}

/** 解析 Host 头，兼容 `[::1]:3080`、`localhost:3080`、`127.0.0.1:3080`。 */
export function hostNameOf(header) {
  if (typeof header !== 'string') return null
  const value = header.trim().toLowerCase()
  if (!value) return null
  if (value.startsWith('[')) {
    const close = value.indexOf(']')
    if (close <= 1) return null
    const suffix = value.slice(close + 1)
    if (suffix !== '' && !/^:\d+$/.test(suffix)) return null
    return value.slice(1, close)
  }
  const first = value.indexOf(':')
  const last = value.lastIndexOf(':')
  if (first !== last) return null // 裸 IPv6 带多个冒号：不接受
  if (last === -1) return value
  if (!/^\d+$/.test(value.slice(last + 1))) return null
  return value.slice(0, last)
}

export function isLoopbackHostHeader(header) {
  const name = hostNameOf(header)
  return name === 'localhost' || (name != null && isLoopbackAddress(name))
}

function sameOriginAsHost(originHeader, hostHeader) {
  if (typeof originHeader !== 'string' || !originHeader) return false
  let origin
  try {
    origin = new URL(originHeader)
  } catch {
    return false
  }
  return origin.host.toLowerCase() === String(hostHeader ?? '').trim().toLowerCase()
}

/**
 * @param {object} req Node IncomingMessage（只读 headers / method / socket）
 * @param {object} options
 * @param {string[]} options.methods 允许的方法
 * @param {boolean} [options.requireJson] 是否要求 application/json
 * @param {string|null} [options.actionHeader] 变更类请求要求出现的自定义头
 */
export function checkRequest(req, { methods = ['GET'], requireJson = false, actionHeader = null } = {}) {
  const method = String(req?.method ?? 'GET').toUpperCase()
  if (!methods.includes(method)) {
    return { ok: false, status: 405, reason: 'method-not-allowed' }
  }

  const peer = req?.socket?.remoteAddress
  if (!isLoopbackAddress(peer)) {
    return { ok: false, status: 403, reason: 'not-loopback' }
  }

  const hostHeader = req?.headers?.host
  if (!isLoopbackHostHeader(hostHeader)) {
    return { ok: false, status: 403, reason: 'untrusted-host' }
  }

  const site = req?.headers?.['sec-fetch-site']
  if (typeof site === 'string' && site.toLowerCase() === 'cross-site') {
    return { ok: false, status: 403, reason: 'cross-site' }
  }

  const origin = req?.headers?.origin
  if (origin != null && !sameOriginAsHost(origin, hostHeader)) {
    return { ok: false, status: 403, reason: 'cross-origin' }
  }

  if (requireJson) {
    const type = String(req?.headers?.['content-type'] ?? '').toLowerCase()
    if (!type.startsWith('application/json')) {
      return { ok: false, status: 415, reason: 'json-required' }
    }
  }

  if (actionHeader) {
    const value = req?.headers?.[actionHeader.toLowerCase()]
    if (typeof value !== 'string' || value === '') {
      return { ok: false, status: 403, reason: 'action-header-required' }
    }
  }

  return { ok: true }
}

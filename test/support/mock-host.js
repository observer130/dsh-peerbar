/**
 * 假远端 dsh：给 `node --test` 用的最小契约服务器。
 *
 * 只实现插件真正调用的几层：
 *   GET  /                     → 带 dsh 标记的页面（probePage）
 *   GET  /connect?token=       → 303 + Set-Cookie（exchangeCookie）
 *   POST /api/<endpoint>       → 网关信封 `{ result: { ok, value } }`
 *   GET  /api/remote.mux       → WebSocket 升级 + 第一帧 baseline（readWorkspaceBaseline）
 *
 * 目的不是复刻 dsh，而是把「信封 / cookie / 分页 / baseline」这几条**跨机契约**钉死：
 * 远端升级后字段一变，这里会先红，而不是等真机 ui-check 偶发失败。
 *
 * 零依赖：只 import `node:*` 与 `lib/stream.js` 的帧解码。
 */

import http from 'node:http'
import { createHash } from 'node:crypto'
import { decodeFrames } from '../../lib/stream.js'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const MAX_BODY_BYTES = 1024 * 1024

/** 拼一帧服务端帧（不加掩码）。 */
function serverFrame(opcode, payload, { fin = true } = {}) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8')
  const length = body.length
  let header
  if (length < 126) {
    header = Buffer.alloc(2)
    header[1] = length
  } else if (length < 65536) {
    header = Buffer.alloc(4)
    header[1] = 126
    header.writeUInt16BE(length, 2)
  } else {
    header = Buffer.alloc(10)
    header[1] = 127
    header.writeBigUInt64BE(BigInt(length), 2)
  }
  header[0] = (fin ? 0x80 : 0) | (opcode & 0x0f)
  return Buffer.concat([header, body])
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** 一条会话摘要，形状与 `session/list` 的 items 对齐。 */
export function sessionItem({ id = 's1', title = '会话', cwd = '/work/a', updatedAt = 1, running = false, projections = {} } = {}) {
  return {
    sessionId: id,
    cwd,
    updatedAt,
    running,
    projections: { values: { title, ...projections } },
  }
}

/**
 * 起一个假远端。
 *
 * @param {object} [options]
 * @param {string} [options.token] 合法启动令牌。
 * @param {Array<object>} [options.items] `session/list` 返回的 items。
 * @param {Array<object>} [options.workspaces] baseline 的注册工作区。
 * @param {string[]} [options.archivedSessionIds]
 * @param {string[]} [options.pinnedSessionIds]
 * @param {number} [options.asOfSeq] `session/projections` 的 asOfSeq，默认 120。
 * @param {boolean} [options.baselineError] mux 首帧改发 error 帧。
 * @param {boolean} [options.compatError] `session/modelCatalog` 返回 gateway 错误。
 * @param {boolean} [options.rejectApi] `/api/*` 一律 403。
 * @param {string} [options.pageBody] `/` 的响应体，默认带 dsh 字样。
 * @param {string} [options.pageType] `/` 的 content-type。
 * @param {number} [options.listStatus] `session/list` 的 HTTP 状态，默认 200。
 * @param {object} [options.listValue] 覆盖 `session/list` 的 value。
 * @param {(ctx: object) => boolean|Promise<boolean>} [options.handle] 先于内置路由的钩子；返回 true 表示已处理。
 * @returns {Promise<object>} 服务器句柄。
 */
export async function createMockHost(options = {}) {
  const token = options.token ?? 'test-token'
  const cookieName = 'dsh-auth-mock'
  /** 发过就认：真实 dsh 允许多条连接各自的 cookie 并存。 */
  const issued = new Set()
  let serial = 0
  let expired = false
  let closed = false

  const calls = {
    connect: 0,
    api: [],
    mux: 0,
    pages: [],
  }

  const items = options.items ?? [sessionItem({ id: 's1' }), sessionItem({ id: 's2', title: '第二个会话' })]
  const workspaces =
    options.workspaces ?? [
      { workspaceId: 'ws-a', path: '/work/a', title: 'a', sessionIds: ['s1', 's2'] },
    ]
  const asOfSeq = Number.isFinite(options.asOfSeq) ? options.asOfSeq : 120

  /** 每个会话默认造 asOfSeq 条记录（seq 1..asOfSeq），分页逻辑在下面实现。 */
  function recordsFor(sessionId) {
    if (Array.isArray(options.records?.[sessionId])) return options.records[sessionId]
    return Array.from({ length: asOfSeq }, (_, index) => ({
      event: { seq: index + 1, type: 'message', sessionId },
      message: { text: `m${index + 1}` },
    }))
  }

  function cookieValueOf(req) {
    const raw = String(req.headers.cookie ?? '')
    for (const part of raw.split(';')) {
      const [name, value] = part.trim().split('=')
      if (name === cookieName) return value
    }
    return null
  }

  function authorized(req) {
    if (expired) return false
    const value = cookieValueOf(req)
    return value !== null && issued.has(value)
  }

  const server = http.createServer(async (req, res) => {
    if (closed) return
    let url
    try {
      url = new URL(req.url ?? '/', 'http://mock')
    } catch {
      res.writeHead(400).end()
      return
    }

    if (options.handle) {
      const handled = await options.handle({ req, res, url, calls, mock })
      if (handled) return
    }

    // 1) 探活页面：必须带 dsh 标记，否则 probePage 判定 not-dsh
    if (req.method === 'GET' && url.pathname === '/') {
      const body = options.pageBody ?? '<!doctype html><title>dsh</title><div>dsh web</div>'
      res.writeHead(200, {
        'content-type': options.pageType ?? 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(body),
      })
      res.end(body)
      return
    }

    // 2) 换 cookie
    if (req.method === 'GET' && url.pathname === '/connect') {
      calls.connect += 1
      if (url.searchParams.get('token') !== token) {
        res.writeHead(401, { 'content-type': 'text/plain' }).end('invalid token')
        return
      }
      expired = false
      serial += 1
      const value = `mock-${serial}`
      issued.add(value)
      res.writeHead(303, {
        location: '/',
        'set-cookie': `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict`,
      })
      res.end()
      return
    }

    // 3) 流式通道：先做 WebSocket 握手，等 open 帧后回一帧 baseline
    if (url.pathname === '/api/remote.mux') {
      return // 由 upgrade 事件处理
    }

    // 4) RPC 信封
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      const endpoint = url.pathname.slice('/api/'.length)
      if (options.rejectApi) {
        res.writeHead(403, { 'content-type': 'text/plain' }).end('origin not trusted')
        return
      }
      if (!authorized(req)) {
        res.writeHead(401, { 'content-type': 'text/plain' }).end('unauthorized')
        return
      }
      let body
      try {
        body = JSON.parse(await readBody(req))
      } catch {
        res.writeHead(400, { 'content-type': 'text/plain' }).end('bad json')
        return
      }
      const badEnvelope =
        body?.type !== 'client-request' || body?.method !== endpoint || typeof body?.payload?.args !== 'object'
      calls.api.push({ endpoint, args: body?.payload?.args, envelope: body, badEnvelope })
      if (badEnvelope) {
        res.writeHead(400, { 'content-type': 'text/plain' }).end('bad envelope')
        return
      }
      const args = body.payload.args

      if (endpoint === 'session/list') {
        if (options.listStatus && options.listStatus >= 400) {
          res.writeHead(options.listStatus, { 'content-type': 'text/plain' }).end('list failed')
          return
        }
        const value = options.listValue ?? { items, asOfSeq }
        sendJson(res, 200, { result: { ok: true, value } })
        return
      }

      if (endpoint === 'session/projections') {
        const sessionId = args?.request?.sessionId
        sendJson(res, 200, {
          result: { ok: true, value: { asOfSeq, values: { sessionId, title: '远端会话' } } },
        })
        return
      }

      if (endpoint === 'session/page') {
        const request = args?.request ?? {}
        calls.pages.push(request)
        const all = recordsFor(request?.address?.sessionId ?? 's1')
        const through = Number.isFinite(request.throughSeq) ? request.throughSeq : Number.MAX_SAFE_INTEGER
        const before = Number.isFinite(request.beforeSeq) ? request.beforeSeq : Number.MAX_SAFE_INTEGER
        const limit = Number.isFinite(request.maxMessages) ? request.maxMessages : 200
        const eligible = all.filter((record) => {
          const seq = Number(record?.event?.seq)
          return Number.isFinite(seq) && seq <= through && seq < before
        })
        const records = eligible.slice(-limit)
        const first = Number(records[0]?.event?.seq ?? Infinity)
        const hasMore = eligible.some((record) => Number(record?.event?.seq) < first)
        sendJson(res, 200, { result: { ok: true, value: { records, hasMore } } })
        return
      }

      if (endpoint === 'session/modelCatalog') {
        if (options.compatError) {
          sendJson(res, 200, {
            result: { ok: false, error: { code: 'gateway/unknown-method', message: 'no such method' } },
          })
          return
        }
        sendJson(res, 200, { result: { ok: true, value: { models: [{ id: 'mock-model' }] } } })
        return
      }

      sendJson(res, 404, { error: { code: 'gateway/not-found', message: `unknown endpoint ${endpoint}` } })
      return
    }

    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
  })

  server.on('upgrade', (req, socket, head) => {
    if (closed) {
      socket.destroy()
      return
    }
    const url = new URL(req.url ?? '/', 'http://mock')
    if (url.pathname !== '/api/remote.mux') {
      socket.destroy()
      return
    }
    calls.mux += 1
    if (!authorized(req)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\ncontent-length: 0\r\n\r\n')
      return
    }
    const key = String(req.headers['sec-websocket-key'] ?? '')
    const accept = createHash('sha1').update(`${key}${WS_GUID}`).digest('base64')
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        '',
      ].join('\r\n'),
    )

    let buffered = head?.length ? Buffer.from(head) : Buffer.alloc(0)
    let opened = false

    const consume = () => {
      let decoded
      try {
        decoded = decodeFrames(buffered)
      } catch {
        socket.destroy()
        return
      }
      buffered = decoded.rest
      for (const frame of decoded.frames) {
        if (frame.opcode === 0x8) {
          socket.end()
          return
        }
        if (frame.opcode !== 0x1) continue
        let message
        try {
          message = JSON.parse(frame.payload.toString('utf8'))
        } catch {
          continue
        }
        if (message?.type !== 'open' || opened) continue
        opened = true
        calls.open = message
        if (options.baselineError) {
          socket.write(
            serverFrame(
              0x1,
              JSON.stringify({
                type: 'error',
                streamId: message.streamId,
                error: { code: 'gateway/unsupported', message: 'baseline unavailable' },
              }),
            ),
          )
          return
        }
        socket.write(
          serverFrame(
            0x1,
            JSON.stringify({
              type: 'item',
              streamId: message.streamId,
              value: {
                type: 'baseline',
                value: {
                  items: workspaces,
                  archivedSessionIds: options.archivedSessionIds ?? [],
                  pinnedSessionIds: options.pinnedSessionIds ?? [],
                },
              },
            }),
          ),
        )
      }
    }

    socket.on('data', (chunk) => {
      buffered = buffered.length ? Buffer.concat([buffered, chunk]) : chunk
      consume()
    })
    socket.on('error', () => {})
    if (buffered.length) consume()
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const origin = `http://127.0.0.1:${port}`

  const mock = {
    origin,
    token,
    calls,
    /** 直接给 probeHost / callRemote 用的 host 描述（无 cookie）。 */
    host(extra = {}) {
      return { origin, token, tls: {}, ...extra }
    },
    /** 让已发出去的 cookie 全部失效，模拟 30 天到期/远端重启。 */
    expireCookie() {
      expired = true
      issued.clear()
    },
    /** 已发出的 cookie 值（断言用）。 */
    issuedCookies() {
      return [...issued]
    },
    async close() {
      if (closed) return
      closed = true
      await new Promise((resolve) => {
        server.close(resolve)
        server.closeAllConnections?.()
      })
    },
  }

  return mock
}

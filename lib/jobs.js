/**
 * 远端后台任务流桥：把一个远端 Host 的 `job/list` / `job/follow` 流接到本机浏览器。
 *
 * 为什么需要它：官方中栏标题栏的「N 个后台任务运行中」和任务列表由
 * `ctx.jobs` 客户端服务驱动，它只认本机 Host——`job/list` 是**流**端点，
 * 不带会话数据走 `/api` 普通路由，于是远端会话那一条永远是空的。
 *
 *   浏览器 ──WS /dsh-peerbar/api/jobs?hostId=&endpoint=job/list&sessionId=──▶ 本机插件
 *          ──mux `job/list`──▶ 远端
 *
 * 只转发两个**只读**端点：
 *   - `job/list`：该会话的后台任务名册（`{type:'rows', jobs:[…]}`）；
 *   - `job/follow`：单个任务的打开快照与输出（`opened` / `output` / `settled`）。
 *
 * 终止（`job/kill`）不走这里：它是对远端的写操作，由 `/hosts/<id>/rpc` 白名单
 * 单独放行（见 rpc.js），并且只会在用户亲手点「终止」时发生。
 */

import { createHash } from 'node:crypto'

import { CODE } from './codes.js'
import { checkRequest } from './guard.js'
import { decodeFrames, encodeServerFrame, encodeServerText, openRemoteStream } from './stream.js'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const OPCODE_TEXT = 0x1
const OPCODE_BINARY = 0x2
const OPCODE_CLOSE = 0x8
const OPCODE_PING = 0x9
const OPCODE_PONG = 0xa
const MAX_INCOMING_TEXT = 1024 * 1024
const MAX_ID_LENGTH = 200
/** 白名单：只认这两个只读流端点。 */
const STREAM_ENDPOINTS = new Set(['job/list', 'job/follow'])

function writeHttpError(socket, status, reason) {
  try {
    const body = `${reason}\n`
    socket.write(
      `HTTP/1.1 ${status} ${reason}\r\n`
      + 'content-type: text/plain; charset=utf-8\r\n'
      + `content-length: ${Buffer.byteLength(body)}\r\n`
      + 'connection: close\r\n\r\n'
      + body,
    )
  } catch {
    /* 对端已断 */
  }
  socket.destroy()
}

/** 远端裸 id：只允许可见 ASCII，避免把奇怪的东西拼进 args。 */
function cleanId(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_ID_LENGTH) return null
  if (!/^[A-Za-z0-9_.:-]+$/.test(trimmed)) return null
  return trimmed
}

/**
 * 查询参数 → mux `open` 帧的 payload。
 *
 * 单独导出是为了单测：端点不在白名单、或必填 id 缺失时必须返回 null
 * （拒绝），而不是把半成品请求转给远端。
 *
 * @param {URLSearchParams} params 查询参数。
 * @returns {{ endpoint: string, payload: { request: object } } | null}
 */
export function buildJobsRequest(params) {
  const endpoint = params.get('endpoint') ?? ''
  if (!STREAM_ENDPOINTS.has(endpoint)) return null
  const sessionId = cleanId(params.get('sessionId'))
  if (endpoint === 'job/list') {
    if (!sessionId) return null
    return { endpoint, payload: { request: { sessionId } } }
  }
  const jobId = cleanId(params.get('jobId'))
  if (!jobId) return null
  const request = { jobId }
  if (sessionId) request.sessionId = sessionId
  const fromRaw = params.get('from')
  if (fromRaw !== null && fromRaw !== '') {
    const from = Number(fromRaw)
    if (Number.isFinite(from) && from >= 0) request.from = from
  }
  return { endpoint, payload: { request } }
}

/**
 * 生成 upgrade handler。
 *
 * @param {{ getHost: (id: string) => object|null }} peers Host 注册表。
 * @param {{ requestTimeoutMs?: number }} config 插件配置。
 * @returns {(req: import('node:http').IncomingMessage, socket: import('node:net').Socket, head: Buffer) => Promise<void>}
 */
export function createJobsUpgrade(peers, config) {
  const timeoutMs = Number(config?.requestTimeoutMs) || 8000

  return async function jobsUpgrade(req, socket, head) {
    const guard = checkRequest(req, { methods: ['GET'] })
    if (!guard.ok) return writeHttpError(socket, guard.status ?? 403, guard.reason ?? 'denied')

    let url
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1')
    } catch {
      return writeHttpError(socket, 400, 'bad-url')
    }
    const host = peers.getHost(url.searchParams.get('hostId') ?? '')
    if (!host) return writeHttpError(socket, 404, 'unknown-host')
    const built = buildJobsRequest(url.searchParams)
    if (!built) return writeHttpError(socket, 400, 'bad-request')

    const key = req?.headers?.['sec-websocket-key']
    if (typeof key !== 'string' || key.length === 0) return writeHttpError(socket, 400, 'bad-websocket-key')
    const accept = createHash('sha1').update(`${key}${WS_GUID}`).digest('base64')
    socket.setNoDelay?.(true)
    try {
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n'
        + 'Upgrade: websocket\r\n'
        + 'Connection: Upgrade\r\n'
        + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      )
    } catch {
      socket.destroy()
      return
    }

    let buffered = Buffer.alloc(0)
    let closed = false
    let stream = null

    const send = (message) => {
      if (closed) return
      try {
        socket.write(encodeServerText(JSON.stringify(message)))
      } catch {
        /* 交给 close 收尾 */
      }
    }
    const finish = (code, message) => {
      if (closed) return
      closed = true
      try {
        stream?.close()
      } catch {
        /* 忽略 */
      }
      stream = null
      if (message) {
        try {
          socket.write(encodeServerText(JSON.stringify({ type: 'error', error: { code, message } })))
        } catch {
          /* 忽略 */
        }
      }
      try {
        socket.write(encodeServerFrame(OPCODE_CLOSE, Buffer.alloc(0)))
      } catch {
        /* 忽略 */
      }
      socket.destroy()
    }

    try {
      stream = await openRemoteStream(host, built.endpoint, built.payload, {
        timeoutMs,
        // 只读名册/输出：不需要 answer 交互
        interactions: 'none',
        onItem: (value) => send({ type: 'item', value }),
        onError: (error) => finish(error?.code ?? CODE.UNREACHABLE, String(error?.message ?? error)),
      })
    } catch (error) {
      return finish(error?.code ?? CODE.UNREACHABLE, String(error?.message ?? error))
    }
    if (closed) {
      stream?.close()
      return
    }

    const consume = () => {
      let decoded
      try {
        decoded = decodeFrames(buffered)
      } catch (error) {
        finish(CODE.INCOMPATIBLE, String(error?.message ?? error))
        return
      }
      buffered = decoded.rest
      for (const frame of decoded.frames) {
        if (closed) return
        if (frame.opcode === OPCODE_PING) {
          if (!closed) socket.write(encodeServerFrame(OPCODE_PONG, frame.payload))
          continue
        }
        if (frame.opcode === OPCODE_CLOSE) {
          finish(CODE.UNREACHABLE, '')
          return
        }
        // 单向流：浏览器不会发消息，收到文本一律忽略（只保留 ping/pong/close）。
        if (frame.opcode !== OPCODE_TEXT && frame.opcode !== OPCODE_BINARY) continue
      }
    }

    socket.on('data', (chunk) => {
      if (closed) return
      if (Buffer.byteLength(chunk) > MAX_INCOMING_TEXT) return finish(CODE.DENIED, '帧过大')
      buffered = buffered.length ? Buffer.concat([buffered, chunk]) : chunk
      consume()
    })
    socket.on('error', () => finish(CODE.UNREACHABLE, ''))
    socket.on('close', () => finish(CODE.UNREACHABLE, ''))

    if (head?.length) {
      buffered = head
      consume()
    }
  }
}

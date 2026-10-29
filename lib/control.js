/**
 * 远端会话控制流桥：把一个远端 Host 的 `session/control` 流接到本机浏览器。
 *
 * 为什么需要它：计划审阅、用户提问、工具审批这些「会话级交互」不在 `$events`
 * （转发事件）上，而在 `session/control` 的 baseline/replacement 帧里——投影键
 * `userQuestions`、`inbox`、`plan` 都由它推进。官方客户端只为**本机** Connection
 * 开一条这个流，远端会话的投影因此永远是空的。
 *
 *   浏览器 ──WS /dsh-peerbar/api/control?hostId=──▶ 本机插件 ──mux `session/control`──▶ 远端
 *
 * 只转发 `session/control` 这一个端点；单向（远端 → 浏览器），不上行、不写远端。
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

/**
 * 生成 upgrade handler。
 *
 * @param {{ getHost: (id: string) => object|null }} peers Host 注册表。
 * @param {{ requestTimeoutMs?: number }} config 插件配置。
 * @returns {(req: import('node:http').IncomingMessage, socket: import('node:net').Socket, head: Buffer) => Promise<void>}
 */
export function createControlUpgrade(peers, config) {
  const timeoutMs = Number(config?.requestTimeoutMs) || 8000

  return async function controlUpgrade(req, socket, head) {
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
      stream = await openRemoteStream(host, 'session/control', {}, {
        timeoutMs,
        // 只读快照流：不需要 answer 交互，别把这条 Connection 升级成可回答方
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

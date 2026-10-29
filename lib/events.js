/**
 * 远端转发事件桥：把一个远端 Host 的 `$events` 流（审批、用户问题、
 * 定时任务变更……）接到本机浏览器。
 *
 * 官方客户端的 `ctx.remote.$on(event, handler)` 只能听**本机** Connection 的
 * 转发事件；远端会话里的 `approval/request`、`user-question/request` 等
 * waterfall 请求不会自己过来。这里补上传输层：
 *
 *   浏览器 ──WS /dsh-peerbar/api/events?hostId=──▶ 本机插件 ──mux `$events`──▶ 远端
 *
 * 帧：
 *   宿主 → 浏览器 `{type:'item', value}`          远端事件帧（ready / emit / request）
 *   浏览器 → 宿主 `{type:'result', value}`        回传 `$events/result`
 *                  `{type:'ping'}`                保活（可选）
 *
 * 只转发 `$events` 这一个端点；不做任意流/帧转发。
 */

import { createHash } from 'node:crypto'

import { CODE } from './codes.js'
import { checkRequest } from './guard.js'
import { callRpc } from './remote.js'
import { decodeFrames, encodeServerFrame, encodeServerText, openRemoteStream } from './stream.js'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const OPCODE_TEXT = 0x1
const OPCODE_BINARY = 0x2
const OPCODE_CLOSE = 0x8
const OPCODE_PING = 0x9
const OPCODE_PONG = 0xa
const MAX_INCOMING_TEXT = 4 * 1024 * 1024

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
 * 生成 upgrade handler（与终端同构，但只承载 `$events`）。
 *
 * @param {{ getHost: (id: string) => object|null }} peers Host 注册表。
 * @param {{ requestTimeoutMs?: number }} config 插件配置。
 * @returns {(req: import('node:http').IncomingMessage, socket: import('node:net').Socket, head: Buffer) => Promise<void>}
 */
export function createEventsUpgrade(peers, config) {
  const timeoutMs = Number(config?.requestTimeoutMs) || 8000

  return async function eventsUpgrade(req, socket, head) {
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
      stream = await openRemoteStream(host, '$events', {}, {
        timeoutMs,
        // `$events` 只发给声明 answer 的 Connection；这条 peer 随浏览器 socket 消亡
        interactions: 'answer',
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

    const handleMessage = (message) => {
      if (closed) return
      if (message?.type === 'result') {
        void callRpc(host, '$events/result', message.value ?? {}, { timeoutMs }).then((result) => {
          if (!result.ok) finish(result.code ?? CODE.UNREACHABLE, result.message)
        }, (error) => finish(error?.code ?? CODE.UNREACHABLE, String(error?.message ?? error)))
        return
      }
      if (message?.type === 'cancel') finish(CODE.UNREACHABLE, '')
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
        if (frame.opcode !== OPCODE_TEXT && frame.opcode !== OPCODE_BINARY) continue
        let message
        try {
          message = JSON.parse(frame.payload.toString('utf8'))
        } catch {
          continue
        }
        handleMessage(message)
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

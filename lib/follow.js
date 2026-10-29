/**
 * 远端会话历史流桥：把一个远端 Host 的 `session/follow` 流接到本机浏览器。
 *
 * 为什么需要它：官方右侧栏的「计划」页签靠 `remote.follow()` 读 opening
 * snapshot（`{type:'snapshot', records, hasMore, cursor}`），再用
 * `session/page` 往前翻页找提交的那份计划。`follow` 是**流**端点，不能走
 * `/hosts/<id>/rpc` 的 HTTP 信封；不代理它，页面就永远停在「正在读取计划…」。
 *
 *   浏览器 ──WS /dsh-peerbar/api/follow?hostId=&sessionId=──▶ 本机插件
 *          ──mux `session/follow`──▶ 远端
 *
 * 只转发 `session/follow` 这一个端点；单向（远端 → 浏览器），不上行、不写远端。
 * 地址只接受两种形状（与官方 `parsePlanAddress` 一致）：
 *   - 顶层会话：`sessionId`
 *   - 子代理会话：`parent` + `child` + `mode`
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
const SUBAGENT_MODES = new Set(['one-shot', 'continuable', 'unknown'])
const MAX_ID_LENGTH = 200

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
 * 从查询参数拼出 `session/follow` 的请求体（`request` 那一个命名参数）。
 *
 * 单独导出是为了单测：地址形状不对时必须返回 null（拒绝），而不是把
 * 半成品地址转给远端。
 *
 * @param {URLSearchParams} params 查询参数。
 * @returns {{ request: object } | null} args，或 null 表示拒绝。
 */
export function buildFollowArgs(params) {
  const sessionId = cleanId(params.get('sessionId'))
  if (sessionId) return { request: { address: { kind: 'session', sessionId } } }
  const parentSessionId = cleanId(params.get('parent'))
  const childSessionId = cleanId(params.get('child'))
  const mode = params.get('mode')
  if (!parentSessionId || !childSessionId || !mode || !SUBAGENT_MODES.has(mode)) return null
  return { request: { address: { kind: 'subagent', parentSessionId, childSessionId, mode } } }
}

/**
 * 生成 upgrade handler。
 *
 * @param {{ getHost: (id: string) => object|null }} peers Host 注册表。
 * @param {{ requestTimeoutMs?: number }} config 插件配置。
 * @returns {(req: import('node:http').IncomingMessage, socket: import('node:net').Socket, head: Buffer) => Promise<void>}
 */
export function createFollowUpgrade(peers, config) {
  const timeoutMs = Number(config?.requestTimeoutMs) || 8000

  return async function followUpgrade(req, socket, head) {
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
    const args = buildFollowArgs(url.searchParams)
    if (!args) return writeHttpError(socket, 400, 'bad-address')

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
      stream = await openRemoteStream(host, 'session/follow', args, {
        timeoutMs,
        // 只读历史流：不需要 answer 交互
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

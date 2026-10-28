/**
 * 远端终端代理：浏览器 ↔ 本机插件 ↔ 远端 `/api/remote.mux`。
 *
 * 官方右侧栏终端（`dsh-client-ui-sidebar-terminal`）已经是完整的
 * xterm + 会话恢复 + 输入窗口 + ack 实现，浏览器半只需要把
 * `ctx.remote.terminal` 的调用改投本插件；本文件负责宿主半的最后一跳：
 *
 *   1. 用 `ctx.webServer.registerUpgrade` 认领 `/dsh-peerbar/api/terminal`，
 *      自己完成 WS 握手（服务端帧不加掩码，见 stream.js `encodeServerFrame`）。
 *   2. 只接受 `terminal/attach` 与 `terminal/retain` 两个流端点——终端是本插件
 *      唯一需要的双工通道，白名单外的流一律拒绝（不做任意 WS 帧转发）。
 *   3. 把浏览器发来的虚拟会话 ID 换成远端裸 ID（`peerbar:<host>:sess:<raw>`），
 *      再用一次性的远端 cookie 打开 mux 流，逐帧双向转发。
 *
 * 帧协议与 `/api/remote.mux` 同构，浏览器半因此可以原样复用官方客户端的
 * `open` / `item` / `cancel` / `end` 语义：
 *
 *   浏览器 → 宿主  `{type:'open', streamId, endpoint, payload:{args}}`
 *                  `{type:'item', streamId, value}` / `{type:'cancel'|'end', streamId}`
 *   宿主 → 浏览器 `{type:'item', streamId, value}` / `{type:'end', streamId}`
 *                  `{type:'error', streamId, error:{code,message}}`
 *
 * 一个 WS 只承载一条逻辑流（客户端每开一个终端就新建一条），互不串帧。
 */

import { createHash, randomUUID } from 'node:crypto'

import { CODE } from './codes.js'
import { checkRequest } from './guard.js'
import { parseVirtualId } from './identity.js'
import { decodeFrames, encodeServerFrame, encodeServerText, openRemoteStream } from './stream.js'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const OPCODE_TEXT = 0x1
const OPCODE_BINARY = 0x2
const OPCODE_CLOSE = 0x8
const OPCODE_PING = 0x9
const OPCODE_PONG = 0xa
const MAX_OPEN_STREAMS = 1
const MAX_INCOMING_TEXT = 4 * 1024 * 1024

/** 允许跨机代理的终端流端点。其余端点（含未来新增）一律拒绝。 */
export const TERMINAL_STREAMS = Object.freeze(new Set(['terminal/attach', 'terminal/retain']))

/**
 * 虚拟会话 ID + 端点 → 远端 mux 的 args。
 *
 * `attach` 的归属参数是 `agentId`（Gateway 用它解析 Agent），`retain` 是
 * `sessionId`（只认保留关系，不激活 Agent）。两者都在远端侧使用裸 ID。
 *
 * @param {string} endpoint 流端点。
 * @param {{ rawId: string }} parsed 解析后的虚拟 ID。
 * @param {string} id 终端 ID。
 * @returns {object} 远端 mux open 的 args。
 */
export function terminalRemoteArgs(endpoint, rawSessionId, id) {
  return endpoint === 'terminal/attach'
    ? { agentId: rawSessionId, id }
    : { sessionId: rawSessionId, id }
}

/**
 * 从 open 帧里取 Host、会话与终端 ID；形状不符返回 null。
 *
 * 会话既可能是虚拟 ID（`peerbar:<host>:sess:<raw>`），也可能是裸 ID——
 * 本插件打开远端会话时传给 `openSession` 的就是远端裸 ID（见客户端
 * `openRemote`），所以两种都接受；hostId 由浏览器显式给出。
 */
function parseOpen(message) {
  const endpoint = typeof message?.endpoint === 'string' ? message.endpoint : ''
  if (!TERMINAL_STREAMS.has(endpoint)) return null
  const args = message?.payload?.args
  if (!args || typeof args !== 'object') return null
  const hostId = typeof args.hostId === 'string' ? args.hostId : ''
  let session = typeof args.sessionId === 'string' ? args.sessionId : typeof args.agentId === 'string' ? args.agentId : ''
  const id = typeof args.id === 'string' ? args.id : ''
  if (!hostId || !session || !id) return null
  const virtual = parseVirtualId(session)
  if (virtual) {
    if (virtual.kind !== 'sess' || virtual.hostId !== hostId) return null
    session = virtual.rawId
  }
  return { endpoint, hostId, rawId: session, id, streamId: typeof message?.streamId === 'string' ? message.streamId : randomUUID() }
}

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
    /* 对端可能已断 */
  }
  socket.destroy()
}

/**
 * 生成 upgrade handler；`peers` 只用 `getHost`，`config` 只用 `requestTimeoutMs`。
 *
 * @param {{ getHost: (id: string) => object|null }} peers Host 注册表。
 * @param {{ requestTimeoutMs?: number }} config 插件配置。
 * @returns {(req: import('node:http').IncomingMessage, socket: import('node:net').Socket, head: Buffer) => Promise<void>}
 */
export function createTerminalUpgrade(peers, config) {
  const timeoutMs = Number(config?.requestTimeoutMs) || 8000

  return async function terminalUpgrade(req, socket, head) {
    const guard = checkRequest(req, { methods: ['GET'] })
    if (!guard.ok) return writeHttpError(socket, guard.status ?? 403, guard.reason ?? 'denied')

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
    let opened = 0
    let currentStreamId = ''
    const uplink = []

    const sendFrame = (opcode, payload) => {
      if (closed) return
      try {
        socket.write(encodeServerFrame(opcode, payload))
      } catch {
        /* 对端已断，交给 close 收尾 */
      }
    }
    const send = (message) => {
      if (closed) return
      const text = JSON.stringify(message)
      if (Buffer.byteLength(text) > MAX_INCOMING_TEXT) {
        finish(CODE.UNREACHABLE, '帧过大')
        return
      }
      sendFrame(OPCODE_TEXT, Buffer.from(text, 'utf8'))
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
          socket.write(encodeServerText(JSON.stringify({ type: 'error', streamId: currentStreamId, error: { code, message } })))
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

    const handleOpen = async (message) => {
      opened += 1
      if (opened > MAX_OPEN_STREAMS) return finish(CODE.DENIED, '一个连接只承载一条终端流')
      const open = parseOpen(message)
      if (!open) return finish(CODE.BAD_REQUEST, '终端流端点或参数不合法')
      currentStreamId = open.streamId
      const host = peers.getHost(open.hostId)
      if (!host) return finish(CODE.BAD_REQUEST, 'Host 不存在')
      if (!host.cookie?.header) return finish(CODE.AUTH_REQUIRED, '还没有 cookie，先探活一次')

      try {
        stream = await openRemoteStream(
          host,
          open.endpoint,
          terminalRemoteArgs(open.endpoint, open.rawId, open.id),
          {
            timeoutMs,
            onItem: (value) => send({ type: 'item', streamId: open.streamId, value }),
            onError: (error) => finish(error?.code ?? CODE.UNREACHABLE, String(error?.message ?? error)),
          },
        )
      } catch (error) {
        return finish(error?.code ?? CODE.UNREACHABLE, String(error?.message ?? error))
      }
      if (closed) {
        stream.close()
        return
      }
      for (const value of uplink.splice(0)) {
        try {
          stream.send(value)
        } catch (error) {
          finish(CODE.UNREACHABLE, String(error?.message ?? error))
          return
        }
      }
    }

    const handleMessage = (message) => {
      if (closed) return
      if (message?.type === 'open') {
        void handleOpen(message)
        return
      }
      if (message?.type === 'item') {
        if (!stream) {
          if (uplink.length >= 256) finish(CODE.DENIED, '上行缓冲溢出')
          else uplink.push(message.value)
          return
        }
        try {
          stream.send(message.value)
        } catch (error) {
          finish(CODE.UNREACHABLE, String(error?.message ?? error))
        }
        return
      }
      if (message?.type === 'end') {
        stream?.end()
        return
      }
      if (message?.type === 'cancel') {
        finish(CODE.UNREACHABLE, '')
      }
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
          sendFrame(OPCODE_PONG, frame.payload)
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

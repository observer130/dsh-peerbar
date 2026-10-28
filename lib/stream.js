/**
 * Remote 流通道：dsh 的「流式」方法只走 WebSocket `/api/remote.mux`，
 * 普通 `POST /api/<endpoint>` 会被网关拒掉（`gateway/signature-invalid`：
 * "stream Remote methods must be opened through the stream carrier"）。
 *
 * 三条用途：
 *
 * 1. `workspace/follow`：baseline 里带 `archivedSessionIds` / `pinnedSessionIds`
 *    —— `session/list` 不返回归档状态，这是远端归档集的唯一来源；
 * 2. `workspaceFiles/changes`：常驻只读订阅，经 SSE 转给浏览器（`openRemoteStream`）；
 * 3. `terminal/attach|retain`：双工。宿主半用 `openRemoteStream` 的 `send()` 上行
 *    write/resize，浏览器那半由 `lib/terminal.js` 的 WS 代理承接。
 *
 * 帧格式（`dsh-api-gateway/lib/index.js:236-251` 的
 * `parseRemoteStreamClientMessage` / `parseRemoteStreamServerMessage`）：
 *
 *   客户端 → 宿主  { type:'open', streamId, endpoint, payload:{ args } }
 *                  { type:'cancel' | 'end', streamId }
 *   宿主 → 客户端  { type:'item', streamId, value } / { type:'end', streamId }
 *                  { type:'error', streamId, error:{ code, message, details } }
 *
 * `readWorkspaceBaseline` 只做握手 → 发一帧 open → 读第一帧 baseline → 关连接；
 * `openRemoteStream` 保持连接并把下行 item 交给回调，同时暴露 `send()` 上行。
 *
 * **cookie 用专用的**（每次现换）：`dsh-client-connection/lib/index.js:759`
 * 的 `admitConnection` 会把升级的 socket 记成 peer 的所有者，socket 一关
 * 就 `peers.delete(peer.id)` —— 拿探活那个 cookie 去升级，等于探活 cookie
 * 当场作废，后续 `session/list` 全部 401。专用 cookie 的 peer 随 socket
 * 一起消亡，既不污染探活，也不会在远端攒垃圾。
 *
 * 零依赖：按 RFC 6455 手写帧编解码（客户端帧必须加掩码，服务端帧不加）。
 */

import http from 'node:http'
import https from 'node:https'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { CODE } from './codes.js'
import { agentFor, classifyNetworkError, exchangeCookie } from './remote.js'

/** 所有 Remote 流共用的唯一升级路径。 */
export const MUX_PATH = '/api/remote.mux'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const OPCODE_CONTINUATION = 0x0
const OPCODE_TEXT = 0x1
const OPCODE_BINARY = 0x2
const OPCODE_CLOSE = 0x8
const OPCODE_PING = 0x9
const OPCODE_PONG = 0xa
const MAX_FRAME_BYTES = 4 * 1024 * 1024
const MAX_IDS = 20000

/**
 * 编一帧客户端帧（FIN=1，带掩码）。
 * @param {number} opcode RFC 6455 操作码。
 * @param {Buffer} payload 载荷。
 * @param {Buffer} [maskKey] 4 字节掩码；默认随机，单测可固定。
 * @returns {Buffer} 可直接写进 socket 的字节。
 */
export function encodeFrame(opcode, payload, maskKey = randomBytes(4)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload ?? ''), 'utf8')
  const length = body.length
  let header
  if (length < 126) {
    header = Buffer.alloc(2)
    header[1] = 0x80 | length
  } else if (length < 65536) {
    header = Buffer.alloc(4)
    header[1] = 0x80 | 126
    header.writeUInt16BE(length, 2)
  } else {
    header = Buffer.alloc(10)
    header[1] = 0x80 | 127
    header.writeBigUInt64BE(BigInt(length), 2)
  }
  header[0] = 0x80 | (opcode & 0x0f)
  const masked = Buffer.alloc(length)
  for (let index = 0; index < length; index += 1) masked[index] = body[index] ^ maskKey[index % 4]
  return Buffer.concat([header, maskKey, masked])
}

/** 编一帧文本帧。 */
export function encodeTextFrame(text, maskKey) {
  return encodeFrame(OPCODE_TEXT, Buffer.from(String(text), 'utf8'), maskKey)
}

/**
 * 编一帧**服务端**帧（FIN=1，不加掩码）。
 *
 * 浏览器 → 本机插件的终端代理走的是反向方向：本插件此时是 WS 服务端，
 * RFC 6455 规定服务端帧不得加掩码，否则浏览器直接断连。
 *
 * @param {number} opcode RFC 6455 操作码。
 * @param {Buffer|string} payload 载荷。
 * @returns {Buffer} 可直接写进 socket 的字节。
 */
export function encodeServerFrame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload ?? ''), 'utf8')
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
  header[0] = 0x80 | (opcode & 0x0f)
  return Buffer.concat([header, body])
}

/** 编一帧服务端文本帧。 */
export function encodeServerText(text) {
  return encodeServerFrame(OPCODE_TEXT, Buffer.from(String(text), 'utf8'))
}

/**
 * 从缓冲区里切出完整帧；不完整的尾巴留在 `rest` 里等下一块数据。
 * @param {Buffer} buffer 已收到的字节。
 * @returns {{ frames: Array<{ fin: boolean, opcode: number, payload: Buffer }>, rest: Buffer }}
 */
export function decodeFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset]
    const second = buffer[offset + 1]
    const fin = (first & 0x80) !== 0
    const opcode = first & 0x0f
    const masked = (second & 0x80) !== 0
    let length = second & 0x7f
    let cursor = offset + 2
    if (length === 126) {
      if (cursor + 2 > buffer.length) break
      length = buffer.readUInt16BE(cursor)
      cursor += 2
    } else if (length === 127) {
      if (cursor + 8 > buffer.length) break
      length = Number(buffer.readBigUInt64BE(cursor))
      cursor += 8
    }
    if (length > MAX_FRAME_BYTES) throw new RangeError('WebSocket 帧过大')
    let maskKey = null
    if (masked) {
      if (cursor + 4 > buffer.length) break
      maskKey = buffer.subarray(cursor, cursor + 4)
      cursor += 4
    }
    if (cursor + length > buffer.length) break
    let payload = buffer.subarray(cursor, cursor + length)
    if (maskKey) {
      const unmasked = Buffer.alloc(length)
      for (let index = 0; index < length; index += 1) unmasked[index] = payload[index] ^ maskKey[index % 4]
      payload = unmasked
    }
    frames.push({ fin, opcode, payload })
    offset = cursor + length
  }
  return { frames, rest: buffer.subarray(offset) }
}

function idList(value) {
  if (!Array.isArray(value)) return []
  const list = []
  for (const item of value) {
    if (typeof item === 'string' && item !== '') list.push(item)
    if (list.length >= MAX_IDS) break
  }
  return list
}

/**
 * 读远端 `workspace/follow` 的第一帧 baseline，取归档/置顶会话集。
 *
 * 自己换一张一次性 cookie（见文件头注释），用完随 socket 一起作废。
 * 失败不是致命错误：调用方保留上一次的已知结果即可（归档集变化很慢）。
 * @param {object} host 已登记 Host（含 origin / token / tls）。
 * @param {{ timeoutMs?: number }} [options] 总超时。
 * @returns {Promise<{ ok: true, items: Array<object>, archivedSessionIds: string[], pinnedSessionIds: string[] }
 *   | { ok: false, code: string, message: string }>}
 */
export async function readWorkspaceBaseline(host, { timeoutMs = 2500 } = {}) {
  const issued = await exchangeCookie(host, { timeoutMs })
  if (!issued.ok) return { ok: false, code: issued.code, message: issued.message }

  let url
  try {
    url = new URL(MUX_PATH, host.origin)
  } catch {
    return { ok: false, code: CODE.BAD_REQUEST, message: `非法 origin：${host.origin}` }
  }
  const transport = url.protocol === 'https:' ? https : http
  const key = randomBytes(16).toString('base64')
  const streamId = randomUUID()
  const cookie = issued.cookie.header

  return await new Promise((resolve) => {
    let settled = false
    let socket = null
    let buffered = Buffer.alloc(0)
    let timer = null

    const finish = (value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (socket) {
        try {
          socket.write(encodeFrame(OPCODE_CLOSE, Buffer.alloc(0)))
        } catch {
          // 对端已经关了，忽略
        }
        socket.destroy()
        socket = null
      }
      resolve(value)
    }

    const fail = (code, message) => finish({ ok: false, code, message })

    timer = setTimeout(() => fail(CODE.TIMEOUT, `读 ${MUX_PATH} 超时`), Math.max(500, Number(timeoutMs) || 2500))

    const req = transport.request(url, {
      method: 'GET',
      agent: agentFor(url, host),
      timeout: Math.max(500, Number(timeoutMs) || 2500),
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-key': key,
        'sec-websocket-version': '13',
        origin: host.origin,
        cookie,
      },
    })

    /** 分片消息的暂存：FIN=0 的起始帧 + 后续 continuation 帧。 */
    let pendingChunks = null

    const onMessage = (payload) => {
      let message
      try {
        message = JSON.parse(payload.toString('utf8'))
      } catch {
        return
      }
      if (message?.type === 'error') {
        const code = String(message.error?.code ?? '')
        fail(code.startsWith('gateway/') ? CODE.INCOMPATIBLE : CODE.UNREACHABLE, String(message.error?.message ?? code))
        return
      }
      if (message?.type !== 'item') return
      if (message.value?.type !== 'baseline') return
      const value = message.value.value ?? {}
      finish({
        ok: true,
        // items：完整 workspace registry（workspaceId/path/title/sessionIds 手工序），
        // 供 identity.groupSessions 反查 workspaceId 与手工序。
        items: Array.isArray(value.items) ? value.items : [],
        archivedSessionIds: idList(value.archivedSessionIds),
        pinnedSessionIds: idList(value.pinnedSessionIds),
      })
    }

    const consume = () => {
      let decoded
      try {
        decoded = decodeFrames(buffered)
      } catch (error) {
        fail(CODE.INCOMPATIBLE, String(error?.message ?? error))
        return
      }
      buffered = decoded.rest
      for (const frame of decoded.frames) {
        if (frame.opcode === OPCODE_PING) {
          try {
            socket?.write(encodeFrame(OPCODE_PONG, frame.payload))
          } catch {
            // 握手期掉线，交给 error/close 处理
          }
          continue
        }
        if (frame.opcode === OPCODE_CLOSE) {
          fail(CODE.UNREACHABLE, '远端在基线帧之前关闭了流')
          return
        }
        if (frame.opcode === OPCODE_CONTINUATION) {
          if (pendingChunks === null) continue
          pendingChunks.push(frame.payload)
          if (frame.fin) {
            const joined = Buffer.concat(pendingChunks)
            pendingChunks = null
            onMessage(joined)
          }
        } else if (frame.opcode === OPCODE_TEXT || frame.opcode === OPCODE_BINARY) {
          if (frame.fin) onMessage(frame.payload)
          else pendingChunks = [frame.payload]
        }
        if (settled) return
      }
    }

    req.on('upgrade', (res, upgraded, head) => {
      if (settled) {
        upgraded.destroy()
        return
      }
      const accept = createHash('sha1').update(`${key}${WS_GUID}`).digest('base64')
      if (res.headers['sec-websocket-accept'] !== accept) {
        upgraded.destroy()
        fail(CODE.INCOMPATIBLE, 'WebSocket 握手校验失败')
        return
      }
      socket = upgraded
      socket.setNoDelay?.(true)
      socket.on('data', (chunk) => {
        if (settled) return
        buffered = buffered.length ? Buffer.concat([buffered, chunk]) : chunk
        consume()
      })
      socket.on('error', (error) => fail(classifyNetworkError(error), String(error?.message ?? error)))
      socket.on('close', () => {
        if (!settled) fail(CODE.UNREACHABLE, '流在基线帧之前断开')
      })
      try {
        socket.write(
          encodeTextFrame(JSON.stringify({ type: 'open', streamId, endpoint: 'workspace/follow', payload: { args: {} } })),
        )
      } catch (error) {
        fail(CODE.UNREACHABLE, String(error?.message ?? error))
        return
      }
      if (head?.length) {
        buffered = head
        consume()
      }
    })

    req.on('response', (res) => {
      const status = res.statusCode ?? 0
      res.resume()
      if (status === 401) return fail(CODE.AUTH_REQUIRED, 'cookie 已失效')
      if (status === 403) return fail(CODE.INCOMPATIBLE, '远端拒绝升级：Host/Origin 不在信任列表内')
      if (status === 404) return fail(CODE.NOT_DSH, '远端没有 Remote 流端点')
      return fail(CODE.INCOMPATIBLE, `升级失败：HTTP ${status}`)
    })

    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('upgrade timeout'), { code: 'ETIMEDOUT' }))
    })
    req.on('error', (error) => fail(classifyNetworkError(error), String(error?.message ?? error)))
    req.end()
  })
}

/**
 * 打开一条**常驻** Remote 流（目前只给 `workspaceFiles/changes` 用）。
 *
 * 与 `readWorkspaceBaseline` 的区别：拿到帧后不关连接，持续把 `item` 帧交给
 * `onItem`，直到调用方 `close()` 或远端结束。每次连接仍换一张专用 cookie
 * （见文件头注释），避免污染探活 cookie。
 *
 * 只做「宿主 → 远端」的订阅；客户端那半通过本文件的 SSE 路由转发（见 index.js）。
 *
 * @param {object} host 已登记 Host（含 origin / token / tls）。
 * @param {string} endpoint Remote 流端点（`namespace/method`）。
 * @param {object} args open 帧的 args。
 * @param {{ onItem: (value:any)=>void, onError: (error:{code?:string,message:string})=>void, timeoutMs?:number }} options
 * @returns {Promise<{ close: () => void }>} 连接建立后 resolve；失败 reject（带 code）。
 */
export async function openRemoteStream(host, endpoint, args, { onItem, onError, timeoutMs = 8000 } = {}) {
  const issued = await exchangeCookie(host, { timeoutMs })
  if (!issued.ok) {
    const error = new Error(issued.message)
    error.code = issued.code
    throw error
  }
  let url
  try {
    url = new URL(MUX_PATH, host.origin)
  } catch {
    const error = new Error(`非法 origin：${host.origin}`)
    error.code = CODE.BAD_REQUEST
    throw error
  }
  const transport = url.protocol === 'https:' ? https : http
  const key = randomBytes(16).toString('base64')
  const streamId = randomUUID()
  const cookie = issued.cookie.header

  return await new Promise((resolve, reject) => {
    let settled = false
    let closed = false
    let socket = null
    let buffered = Buffer.alloc(0)
    let timer = null
    let pendingChunks = null

    const stop = () => {
      if (closed) return
      closed = true
      if (timer) clearTimeout(timer)
      if (socket) {
        try {
          socket.write(encodeFrame(OPCODE_CLOSE, Buffer.alloc(0)))
        } catch {
          /* 对端已关，忽略 */
        }
        socket.destroy()
        socket = null
      }
    }

    const fail = (error) => {
      stop()
      const normalized = error instanceof Error ? error : new Error(String(error))
      if (!normalized.code) normalized.code = CODE.UNREACHABLE
      if (!settled) {
        settled = true
        reject(normalized)
        return
      }
      try {
        onError?.({ code: normalized.code, message: normalized.message })
      } catch {
        /* 回调异常不拖垮连接清理 */
      }
    }

    const handleMessage = (message) => {
      if (message?.type === 'error') {
        const code = String(message.error?.code ?? '')
        fail(Object.assign(new Error(String((message.error?.message ?? code) || 'remote stream error')), {
          code: code.startsWith('gateway/') ? CODE.INCOMPATIBLE : CODE.UNREACHABLE,
        }))
        return
      }
      if (message?.type === 'end') {
        stop()
        if (settled) {
          try {
            onError?.({ code: CODE.UNREACHABLE, message: '远端流已结束' })
          } catch {
            /* 忽略 */
          }
        }
        return
      }
      if (message?.type !== 'item') return
      if (!settled) return // baseline 前的帧由调用方约定，这里只按 item 透传
      try {
        onItem?.(message.value)
      } catch {
        /* 消费方异常不影响连接 */
      }
    }

    const consume = () => {
      let decoded
      try {
        decoded = decodeFrames(buffered)
      } catch (error) {
        fail(error)
        return
      }
      buffered = decoded.rest
      for (const frame of decoded.frames) {
        if (frame.opcode === OPCODE_PING) {
          try {
            socket?.write(encodeFrame(OPCODE_PONG, frame.payload))
          } catch {
            /* 忽略 */
          }
          continue
        }
        if (frame.opcode === OPCODE_CLOSE) {
          stop()
          return
        }
        if (frame.opcode === OPCODE_CONTINUATION) {
          if (pendingChunks === null) continue
          pendingChunks.push(frame.payload)
          if (frame.fin) {
            const joined = Buffer.concat(pendingChunks)
            pendingChunks = null
            try {
              handleMessage(JSON.parse(joined.toString('utf8')))
            } catch {
              /* 非法帧忽略 */
            }
          }
        } else if (frame.opcode === OPCODE_TEXT || frame.opcode === OPCODE_BINARY) {
          if (frame.fin) {
            let message
            try {
              message = JSON.parse(frame.payload.toString('utf8'))
            } catch {
              continue
            }
            handleMessage(message)
          } else {
            pendingChunks = [frame.payload]
          }
        }
        if (closed) return
      }
    }

    timer = setTimeout(() => {
      fail(Object.assign(new Error(`打开 ${endpoint} 流超时`), { code: CODE.TIMEOUT }))
    }, Math.max(500, Number(timeoutMs) || 8000))

    const req = transport.request(url, {
      method: 'GET',
      agent: agentFor(url, host),
      timeout: Math.max(500, Number(timeoutMs) || 8000),
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-key': key,
        'sec-websocket-version': '13',
        origin: host.origin,
        cookie,
      },
    })

    req.on('upgrade', (res, upgraded, head) => {
      if (closed) {
        upgraded.destroy()
        return
      }
      const accept = createHash('sha1').update(`${key}${WS_GUID}`).digest('base64')
      if (res.headers['sec-websocket-accept'] !== accept) {
        upgraded.destroy()
        fail(Object.assign(new Error('WebSocket 握手校验失败'), { code: CODE.INCOMPATIBLE }))
        return
      }
      socket = upgraded
      socket.setNoDelay?.(true)
      socket.on('data', (chunk) => {
        if (closed) return
        buffered = buffered.length ? Buffer.concat([buffered, chunk]) : chunk
        consume()
      })
      socket.on('error', (error) => fail(Object.assign(error, { code: classifyNetworkError(error) })))
      socket.on('close', () => {
        if (closed) return
        stop()
        if (settled) {
          try {
            onError?.({ code: CODE.UNREACHABLE, message: '远端流连接已断开' })
          } catch {
            /* 忽略 */
          }
        }
      })
      try {
        socket.write(
          encodeTextFrame(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args: args ?? {} } })),
        )
      } catch (error) {
        fail(error)
        return
      }
      if (timer) clearTimeout(timer)
      timer = null
      settled = true
      resolve({
        /**
         * 上行一帧（`terminal/attach|retain` 的 write / resize / retain ack）。
         * @param {any} value 帧值，必须是无损 JSON。
         */
        send: (value) => {
          if (closed) throw Object.assign(new Error('远端流已关闭'), { code: CODE.UNREACHABLE })
          socket?.write(encodeTextFrame(JSON.stringify({ type: 'item', streamId, value })))
        },
        /** 上行 end（半关；服务端据此结束生成器）。 */
        end: () => {
          if (closed) return
          try {
            socket?.write(encodeTextFrame(JSON.stringify({ type: 'end', streamId })))
          } catch {
            /* 忽略 */
          }
        },
        close: () => {
          if (closed) return
          try {
            socket?.write(encodeTextFrame(JSON.stringify({ type: 'cancel', streamId })))
          } catch {
            /* 忽略 */
          }
          stop()
        },
      })
      if (head?.length) {
        buffered = head
        consume()
      }
    })

    req.on('response', (res) => {
      const status = res.statusCode ?? 0
      res.resume()
      const code =
        status === 401 ? CODE.AUTH_REQUIRED : status === 403 ? CODE.INCOMPATIBLE : status === 404 ? CODE.NOT_DSH : CODE.INCOMPATIBLE
      fail(Object.assign(new Error(`打开流失败：HTTP ${status}`), { code }))
    })

    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('upgrade timeout'), { code: 'ETIMEDOUT' }))
    })
    req.on('error', (error) => fail(Object.assign(error, { code: classifyNetworkError(error) })))
    req.end()
  })
}

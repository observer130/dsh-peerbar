/**
 * 远端 dsh 的读取通道。
 *
 * 两步（见 docs/spike-S1.md）：
 *   1. `GET /connect?token=…&interactions=none` 换一个绑定 origin 的 API cookie
 *   2. `POST /api/<endpoint>`，body 是 Connection 的 RPC 信封
 *
 * 只用 node:http/https，不依赖 undici —— 因为需要 per-host 的
 * `rejectUnauthorized` 与 `ca`，全局 fetch 给不了。
 */

import http from 'node:http'
import https from 'node:https'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { CODE } from './codes.js'

const MAX_BODY_BYTES = 8 * 1024 * 1024

const TLS_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_UNTRUSTED',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
])

/** 把远端响应/网络错误归到 dsh-peerbar 的错误码。 */
export function classifyNetworkError(error) {
  const code = String(error?.code ?? '')
  if (TLS_ERROR_CODES.has(code)) return CODE.TLS_ERROR
  if (code === 'ETIMEDOUT' || code === 'ERR_CANCELED') return CODE.TIMEOUT
  return CODE.UNREACHABLE
}

class RemoteError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const agentCache = new Map()
const caCache = new Map()

export function agentFor(url, host) {
  const allowSelfSigned = host?.tls?.allowSelfSigned === true
  const caFile = host?.tls?.caFile || null
  if (!allowSelfSigned && !caFile) return undefined // 默认 agent 即可
  const key = `${url.protocol}//${allowSelfSigned ? 'insecure' : 'ca'}:${caFile ?? ''}`
  const cached = agentCache.get(key)
  if (cached) return cached
  const Agent = url.protocol === 'https:' ? https.Agent : http.Agent
  const options = { keepAlive: true }
  if (url.protocol === 'https:') {
    if (allowSelfSigned) options.rejectUnauthorized = false
    if (caFile && caCache.has(caFile)) options.ca = caCache.get(caFile)
  }
  const agent = new Agent(options)
  agentCache.set(key, agent)
  return agent
}

async function primeCa(host) {
  const caFile = host?.tls?.caFile
  if (!caFile || caCache.has(caFile)) return
  try {
    caCache.set(caFile, await readFile(caFile, 'utf8'))
  } catch (error) {
    throw new RemoteError(CODE.TLS_ERROR, `读取 CA 文件失败：${caFile}（${String(error?.code ?? error)}）`)
  }
}

/** 发一个请求，返回 `{ status, headers, body }`；网络层错误抛 RemoteError。 */
function request(urlString, { method = 'GET', headers = {}, body = null, host, timeoutMs = 8000, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    let url
    try {
      url = new URL(urlString)
    } catch {
      reject(new RemoteError(CODE.BAD_REQUEST, `非法地址：${urlString}`))
      return
    }
    const transport = url.protocol === 'https:' ? https : url.protocol === 'http:' ? http : null
    if (!transport) {
      reject(new RemoteError(CODE.BAD_REQUEST, `只支持 http(s)：${urlString}`))
      return
    }
    const payload = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
    const finalHeaders = { ...headers }
    if (payload) finalHeaders['content-length'] = String(payload.length)

    const req = transport.request(
      url,
      { method, headers: finalHeaders, agent: agentFor(url, host), timeout: timeoutMs },
      (res) => {
        const chunks = []
        let size = 0
        res.on('data', (chunk) => {
          size += chunk.length
          if (size > MAX_BODY_BYTES) {
            req.destroy(new RemoteError(CODE.INCOMPATIBLE, '远端响应过大'))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => {
          const buffer = Buffer.concat(chunks)
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: raw ? buffer : buffer.toString('utf8'),
          })
        })
      },
    )

    req.on('timeout', () => {
      const error = new Error('request timeout')
      error.code = 'ETIMEDOUT'
      req.destroy(error)
    })
    req.on('error', (error) => {
      if (error instanceof RemoteError) reject(error)
      else reject(new RemoteError(classifyNetworkError(error), `${error?.code ?? 'error'}: ${error?.message ?? ''}`.trim()))
    })
    if (payload) req.write(payload)
    req.end()
  })
}

/** Connection 的 RPC 信封；`method` 必须等于路径尾部。 */
export function buildEnvelope(endpoint, args = {}, rpcId = randomUUID()) {
  return { type: 'client-request', rpcId, method: endpoint, payload: { args } }
}

function firstSetCookie(headers) {
  const raw = headers?.['set-cookie']
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  for (const item of list) {
    const pair = String(item).split(';')[0].trim()
    if (pair.includes('=')) return pair
  }
  return null
}

/** 用启动令牌换 API cookie。 */
export async function exchangeCookie(host, { timeoutMs = 8000, interactions = 'none' } = {}) {
  const token = String(host?.token ?? '')
  if (!token) return { ok: false, code: CODE.AUTH_REQUIRED, message: '没有配置令牌' }
  await primeCa(host)
  const mode = interactions === 'answer' ? 'answer' : 'none'
  const url = `${host.origin}/connect?token=${encodeURIComponent(token)}&interactions=${mode}`
  let res
  try {
    res = await request(url, { host, timeoutMs })
  } catch (error) {
    return { ok: false, code: error.code ?? CODE.UNREACHABLE, message: error.message }
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, code: CODE.AUTH_REQUIRED, message: '令牌无效或已过期' }
  }
  if (res.status >= 400) {
    return { ok: false, code: CODE.INCOMPATIBLE, message: `换 cookie 失败：HTTP ${res.status}` }
  }
  const header = firstSetCookie(res.headers)
  if (!header) {
    return { ok: false, code: CODE.INCOMPATIBLE, message: '远端没有下发 cookie' }
  }
  return { ok: true, cookie: { header, savedAt: Date.now() } }
}

function errorFromGateway(result) {
  const code = String(result?.error?.code ?? '')
  return {
    ok: false,
    code: code.startsWith('gateway/') ? CODE.INCOMPATIBLE : CODE.INCOMPATIBLE,
    message: result?.error?.message || code || '远端返回失败',
  }
}

/** 调一个 Remote 端点。cookie 失效由调用方决定是否重换。 */
export async function callRemote(host, endpoint, args = {}, { timeoutMs = 8000, cookie: cookieOverride = null } = {}) {
  const rawCookie = cookieOverride ?? host?.cookie?.header
  // 调用方可能传 cookie 对象（stream 里叫 `issued.cookie`）而不是 header 字符串
  const cookie = typeof rawCookie === 'string' ? rawCookie : rawCookie?.header ?? null
  if (!cookie) return { ok: false, code: CODE.AUTH_REQUIRED, message: '还没有 cookie' }
  await primeCa(host)
  const body = buildEnvelope(endpoint, args)
  let res
  try {
    res = await request(`${host.origin}/api/${endpoint}`, {
      method: 'POST',
      host,
      timeoutMs,
      headers: { 'content-type': 'application/json', cookie },
      body,
    })
  } catch (error) {
    return { ok: false, code: error.code ?? CODE.UNREACHABLE, message: error.message }
  }
  if (res.status === 401) return { ok: false, code: CODE.AUTH_REQUIRED, message: 'cookie 已失效' }
  if (res.status === 403) {
    return { ok: false, code: CODE.INCOMPATIBLE, message: '远端拒绝请求：Host/Origin 不在信任列表内' }
  }
  if (res.status === 404) return { ok: false, code: CODE.NOT_DSH, message: '远端没有该端点' }
  if (res.status >= 400) {
    return { ok: false, code: CODE.INCOMPATIBLE, message: `HTTP ${res.status}` }
  }
  let parsed
  try {
    parsed = JSON.parse(res.body)
  } catch {
    return { ok: false, code: CODE.NOT_DSH, message: '响应不是 JSON' }
  }
  const result = parsed?.result
  if (result == null || typeof result !== 'object') {
    return { ok: false, code: CODE.INCOMPATIBLE, message: '响应缺少 result' }
  }
  if (result.ok !== true) return errorFromGateway(result)
  return { ok: true, value: result.value }
}

/** 读全部会话摘要。v0.1 不分页（远端一次返回）。 */
export async function listSessions(host, options = {}) {
  return callRemote(host, 'session/list', { _request: {} }, options)
}

/**
 * 单页消息上限。
 * 官方 `session/page` 允许到 500；我们取 200 —— 首屏能覆盖绝大多数会话，
 * 又不会让一次响应过大（每条事件可能带完整 content）。
 */
export const MAX_PAGE_LIMIT = 200

/** limit 收口到 1..MAX_PAGE_LIMIT */
export function clampLimit(value, fallback = 20, max = MAX_PAGE_LIMIT) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(max, n)
}

/**
 * 构造 `session/page` 的 request（纯函数，便于单测翻页语义）。
 * - 首屏：不带 beforeSeq，取「截至 throughSeq 的最新一页」。
 * - 翻页：`beforeSeq` 是排他上界，并带 turnWindow 让远端在 Turn 边界收页。
 */
export function buildPageRequest({ sessionId, throughSeq, limit = MAX_PAGE_LIMIT, beforeSeq }) {
  const request = {
    address: { kind: 'session', sessionId },
    throughSeq,
    maxMessages: limit,
  }
  if (Number.isFinite(beforeSeq) && beforeSeq > 0) {
    request.beforeSeq = beforeSeq
    // minMessages 不得超过 maxMessages（远端会校验）
    request.turnWindow = { minMessages: Math.min(limit, 50), minTurns: 2 }
  }
  return request
}

/**
 * 读原始会话记录（供客户端喂原生 Conversation 管线）。
 *
 * `beforeSeq` 是**向上翻页的排他上界**（返回 seq < beforeSeq 的历史），
 * 不是增量游标——增量靠轮询 + seq 比对（见 client.js 的 poll）。
 */
export async function readRawPage(host, sessionId, limit = MAX_PAGE_LIMIT, options = {}) {
  const { beforeSeq, ...rest } = options
  const projections = await callRemote(host, 'session/projections', { request: { sessionId } }, rest)
  if (!projections.ok) return projections
  const throughSeq = Number(projections.value?.asOfSeq)
  if (!Number.isFinite(throughSeq)) {
    return { ok: false, code: CODE.INCOMPATIBLE, message: 'projections 里没有 asOfSeq' }
  }
  const request = buildPageRequest({ sessionId, throughSeq, limit, beforeSeq })
  const page = await callRemote(host, 'session/page', { request }, rest)
  if (!page.ok) return page
  const records = page.value?.records ?? []
  return {
    ok: true,
    throughSeq,
    hasMore: page.value?.hasMore === true,
    // 本页最早的 seq（无记录时为 null），客户端据此向上翻页
    firstSeq: records.reduce((min, record) => {
      const seq = Number(record?.event?.seq)
      if (!Number.isFinite(seq)) return min
      return min === null ? seq : Math.min(min, seq)
    }, null),
    records,
    values: projections.value?.values ?? null,
  }
}

/** 远端会话改名（`session/rename`）。 */
export async function renameRemoteSession(host, sessionId, title, options = {}) {
  return callRemote(host, 'session/rename', { request: { sessionId, title } }, options)
}

/**
 * 通用 RPC 转发（白名单由调用方把持，见 rpc.js）。
 * args 形状按端点而定：多数是 `{ request: {...} }`，modelCatalog 是 `{}`。
 */
export async function callRpc(host, endpoint, args, options = {}) {
  return callRemote(host, endpoint, args ?? {}, options)
}

/**
 * GET 一条远端的**普通** `/api/...` 路由，原样带回状态与正文。
 *
 * 与 {@link callRemote} 的区别：那条走 RPC 信封（`POST /api/<ns>/<method>`），
 * 这条走 dsh 的普通路由（`/api/changes.summary` 之类，参数在 query 里）。
 * 路径白名单由调用方把持（见 lib/assets.js），这里只管带 cookie 发出去。
 *
 * @param {object} host 注册表里的 Host（`origin` + `cookie.header`）
 * @param {string} pathAndQuery 形如 `/api/changes.summary?sessionId=…&seq=…`
 * @returns {Promise<{ ok: true, status: number, headers: object, body: string }
 *   | { ok: false, code: string, message: string }>}
 */
export async function readRemoteRoute(host, pathAndQuery, { timeoutMs = 8000, cookie: cookieOverride = null } = {}) {
  const rawCookie = cookieOverride ?? host?.cookie?.header
  const cookie = typeof rawCookie === 'string' ? rawCookie : rawCookie?.header ?? null
  if (!cookie) return { ok: false, code: CODE.AUTH_REQUIRED, message: '还没有 cookie' }
  await primeCa(host)
  let res
  try {
    res = await request(`${host.origin}${pathAndQuery}`, {
      host,
      timeoutMs,
      headers: { cookie, accept: 'application/json' },
    })
  } catch (error) {
    return { ok: false, code: error.code ?? CODE.UNREACHABLE, message: error.message }
  }
  if (res.status === 401) return { ok: false, code: CODE.AUTH_REQUIRED, message: 'cookie 已失效' }
  if (res.status === 403) {
    return { ok: false, code: CODE.INCOMPATIBLE, message: '远端拒绝请求：Host/Origin 不在信任列表内' }
  }
  // 404/409 这类是远端自己的回答，原样交回去（卡片据此"没有摘要"而不是报错）。
  return { ok: true, status: res.status, headers: res.headers, body: res.body }
}

/**
 * 解析 `multipart/form-data`（只覆盖网关的二进制结果载体）。
 *
 * 网关把 `Uint8Array` 从 JSON 里摘出来放进独立 part（`dsh-client-connection/lib/index.js`
 * 的 `fullResponse`：`metadata` + `bytes-N`），这里按 boundary 切开，
 * 返回 `{ name, body }` 列表，供调用方按 `attachments[].part` 取字节。
 *
 * @param {Buffer} buffer 完整响应体。
 * @param {string} boundary boundary 值（不含前缀 `--`）。
 * @returns {Array<{ name: string, body: Buffer }>}
 */
export function parseMultipart(buffer, boundary) {
  const parts = []
  if (!Buffer.isBuffer(buffer) || typeof boundary !== 'string' || !boundary) return parts
  const delimiter = Buffer.from(`--${boundary}`)
  let index = buffer.indexOf(delimiter)
  while (index !== -1) {
    let cursor = index + delimiter.length
    if (buffer[cursor] === 0x2d && buffer[cursor + 1] === 0x2d) break // 结束标记 --boundary--
    if (buffer[cursor] === 0x0d && buffer[cursor + 1] === 0x0a) cursor += 2
    const next = buffer.indexOf(delimiter, cursor)
    if (next === -1) break
    let end = next
    if (end >= 2 && buffer[end - 2] === 0x0d && buffer[end - 1] === 0x0a) end -= 2
    const part = buffer.subarray(cursor, end)
    const split = part.indexOf('\r\n\r\n')
    if (split !== -1) {
      const headers = part.subarray(0, split).toString('utf8')
      parts.push({
        name: /name="([^"]*)"/.exec(headers)?.[1] ?? '',
        body: part.subarray(split + 4),
      })
    }
    index = next
  }
  return parts
}

/**
 * 调一个结果是二进制附件的 Remote 端点（`workspaceFiles/readBytes` 等）。
 *
 * 与 `callRemote` 的区别：响应是 `multipart/form-data`，字节在独立 part 里；
 * 返回的 `value` 仍带占位（`data: null`），`attachments` 给出 `{ path, bytes }`，
 * 由调用方决定怎么送回浏览器（本插件转 base64）。
 */
export async function callRemoteBinary(host, endpoint, args = {}, { timeoutMs = 8000 } = {}) {
  const cookie = host?.cookie?.header
  if (!cookie) return { ok: false, code: CODE.AUTH_REQUIRED, message: '还没有 cookie' }
  await primeCa(host)
  const body = buildEnvelope(endpoint, args)
  let res
  try {
    res = await request(`${host.origin}/api/${endpoint}`, {
      method: 'POST',
      host,
      timeoutMs,
      raw: true,
      headers: { 'content-type': 'application/json', cookie },
      body,
    })
  } catch (error) {
    return { ok: false, code: error.code ?? CODE.UNREACHABLE, message: error.message }
  }
  if (res.status === 401) return { ok: false, code: CODE.AUTH_REQUIRED, message: 'cookie 已失效' }
  if (res.status === 403) return { ok: false, code: CODE.INCOMPATIBLE, message: '远端拒绝请求：Host/Origin 不在信任列表内' }
  if (res.status === 404) return { ok: false, code: CODE.NOT_DSH, message: '远端没有该端点' }
  if (res.status >= 400) return { ok: false, code: CODE.INCOMPATIBLE, message: `HTTP ${res.status}` }
  const type = String(res.headers['content-type'] ?? '')
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type)
  const boundary = match?.[1] ?? match?.[2]?.trim()
  if (!boundary) return { ok: false, code: CODE.NOT_DSH, message: '二进制端点没有返回 multipart（可能是旧版宿主）' }
  const parts = parseMultipart(res.body, boundary)
  const metadata = parts.find((part) => part.name === 'metadata')
  if (!metadata) return { ok: false, code: CODE.INCOMPATIBLE, message: 'multipart 缺少 metadata' }
  let parsed
  try {
    parsed = JSON.parse(metadata.body.toString('utf8'))
  } catch {
    return { ok: false, code: CODE.NOT_DSH, message: 'multipart metadata 不是 JSON' }
  }
  const result = parsed?.result
  if (result == null || typeof result !== 'object') return { ok: false, code: CODE.INCOMPATIBLE, message: '响应缺少 result' }
  if (result.ok !== true) return errorFromGateway(result)
  const attachments = []
  for (const attachment of Array.isArray(parsed.attachments) ? parsed.attachments : []) {
    if (!Array.isArray(attachment?.path) || typeof attachment.part !== 'string') continue
    const part = parts.find((item) => item.name === attachment.part)
    if (!part) continue
    attachments.push({ path: attachment.path.map(String), bytes: part.body })
  }
  return { ok: true, value: result.value, attachments }
}

/**
 * 页面探测：确认「是 dsh」。401 是 dsh 的登录门，不是故障。
 * 返回 `{ ok, needsAuth }`；网络/TLS 错误抛给调用方归类。
 */
export async function probePage(host, { timeoutMs = 8000 } = {}) {
  await primeCa(host)
  const res = await request(`${host.origin}/`, { host, timeoutMs })
  const body = res.body.slice(0, 400)
  const looksDsh = /dsh web authentication required|deepseek-harness|\bdsh\b/i.test(body)
  if (res.status === 401 || res.status === 403) {
    return looksDsh
      ? { ok: true, needsAuth: true }
      : { ok: false, code: CODE.NOT_DSH, message: '需要认证，但不像 dsh' }
  }
  if (res.status === 0 || res.status >= 500) {
    return { ok: false, code: CODE.UNREACHABLE, message: `HTTP ${res.status}` }
  }
  const type = String(res.headers['content-type'] ?? '')
  if (!looksDsh && !type.includes('text/html')) {
    return { ok: false, code: CODE.NOT_DSH, message: '响应不像 dsh 页面' }
  }
  return { ok: true, needsAuth: false }
}

/** 释放 keep-alive 连接（插件卸载时调用）。 */
export function disposeAgents() {
  for (const agent of agentCache.values()) agent.destroy()
  agentCache.clear()
  caCache.clear()
}

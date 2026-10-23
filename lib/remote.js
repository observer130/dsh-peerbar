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
function classify(error) {
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

function agentFor(url, host) {
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
function request(urlString, { method = 'GET', headers = {}, body = null, host, timeoutMs = 8000 } = {}) {
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
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
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
      else reject(new RemoteError(classify(error), `${error?.code ?? 'error'}: ${error?.message ?? ''}`.trim()))
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
export async function exchangeCookie(host, { timeoutMs = 8000 } = {}) {
  const token = String(host?.token ?? '')
  if (!token) return { ok: false, code: CODE.AUTH_REQUIRED, message: '没有配置令牌' }
  await primeCa(host)
  const url = `${host.origin}/connect?token=${encodeURIComponent(token)}&interactions=none`
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
export async function callRemote(host, endpoint, args = {}, { timeoutMs = 8000 } = {}) {
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

/** limit 收口到 1..50 */
export function clampLimit(value, fallback = 20) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(50, n)
}

/** 读原始会话记录（供客户端喂原生 Conversation 管线）。 */
export async function readRawPage(host, sessionId, limit = 200, options = {}) {
  const projections = await callRemote(host, 'session/projections', { request: { sessionId } }, options)
  if (!projections.ok) return projections
  const throughSeq = Number(projections.value?.asOfSeq)
  if (!Number.isFinite(throughSeq)) {
    return { ok: false, code: CODE.INCOMPATIBLE, message: 'projections 里没有 asOfSeq' }
  }
  const page = await callRemote(
    host,
    'session/page',
    { request: { address: { kind: 'session', sessionId }, throughSeq, maxMessages: limit } },
    options,
  )
  if (!page.ok) return page
  return { ok: true, throughSeq, hasMore: page.value?.hasMore === true, records: page.value?.records ?? [] }
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

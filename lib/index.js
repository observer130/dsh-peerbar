/**
 * dsh-peerbar 宿主半入口。
 *
 * 只做装配：校验配置、注册路由、启动调度器。业务在 peers.js / remote.js。
 */

import { failure, CODE } from './codes.js'
import { checkRequest } from './guard.js'
import { LOCAL_HOST_ID } from './identity.js'
import { createPeers } from './peers.js'
import { disposeAgents, readRawPage, readTranscript, renameRemoteSession } from './remote.js'
import { clampLimit, readTranscriptFrom } from './transcript.js'

export const name = 'dsh-peerbar'
export const inject = ['webServer', 'sessionController']

const PREFIX = '/dsh-peerbar/api'
const ACTION_HEADER = 'x-dsh-peerbar-action'
const MAX_BODY = 1024 * 1024

function normalizeConfig(raw) {
  const probe = Number(raw?.probeIntervalMs)
  const request = Number(raw?.requestTimeoutMs)
  return {
    probeIntervalMs: Number.isFinite(probe) ? Math.min(60000, Math.max(2000, probe)) : 5000,
    requestTimeoutMs: Number.isFinite(request) ? Math.min(30000, Math.max(1000, request)) : 8000,
  }
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('请求体过大'), { code: CODE.BAD_REQUEST }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { code: CODE.BAD_REQUEST }))
      }
    })
    req.on('error', reject)
  })
}

function pathOf(req) {
  try {
    return new URL(req.url ?? '/', 'http://127.0.0.1').pathname
  } catch {
    return '/'
  }
}

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const peers = createPeers({ config, logger: ctx.logger })

  const deny = (res, result) => {
    sendJson(res, result.status, failure(CODE.DENIED, result.reason))
  }

  ctx.effect(() => {
    let stopped = false
    peers
      .load()
      .then(() => {
        if (!stopped) peers.start()
      })
      .catch((error) => ctx.logger.warn(`[peerbar] 初始化失败：${String(error?.message ?? error)}`))
    return () => {
      stopped = true
      peers.stop()
      disposeAgents()
    }
  }, 'peerbar: lifecycle')

  // 安装自检：无鉴权，只回版本，不碰数据。
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/health`,
        handler: (req, res) => {
          if (req.method !== 'GET') return sendJson(res, 405, failure(CODE.DENIED, 'method-not-allowed'))
          sendJson(res, 200, { ok: true, product: 'dsh-peerbar', version: '0.1.0', hosts: peers.hostCount() })
        },
      }),
    'peerbar: health route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/state`,
        handler: (req, res) => {
          const guard = checkRequest(req, { methods: ['GET'] })
          if (!guard.ok) return deny(res, guard)
          sendJson(res, 200, peers.state())
        },
      }),
    'peerbar: state route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/session`,
        handler: async (req, res) => {
          const guard = checkRequest(req, { methods: ['GET'] })
          if (!guard.ok) return deny(res, guard)

          let url
          try {
            url = new URL(req.url ?? '/', 'http://127.0.0.1')
          } catch {
            return sendJson(res, 400, failure(CODE.BAD_REQUEST, '非法请求'))
          }
          const hostId = url.searchParams.get('hostId') ?? ''
          const sessionId = url.searchParams.get('id') ?? ''
          const raw = url.searchParams.get('raw') === '1'
          const limit = clampLimit(url.searchParams.get('limit'))
          const before = Number(url.searchParams.get('before'))
          const beforeSeq = Number.isFinite(before) && before > 0 ? before : undefined
          if (!hostId || !sessionId) {
            return sendJson(res, 400, failure(CODE.BAD_REQUEST, 'hostId 与 id 必填'))
          }

          try {
            if (hostId === LOCAL_HOST_ID) {
              const result = await readTranscriptFrom(ctx.sessionController, sessionId, limit, { beforeSeq })
              return sendJson(res, 200, { ok: true, hostId, sessionId, ...result })
            }
            const host = peers.getHost(hostId)
            if (!host) return sendJson(res, 404, failure(CODE.BAD_REQUEST, 'Host 不存在'))
            if (!host.cookie?.header) {
              return sendJson(res, 401, failure(CODE.AUTH_REQUIRED, '还没有 cookie，先探活一次'))
            }
            if (raw) {
              const page = await readRawPage(host, sessionId, limit, { timeoutMs: config.requestTimeoutMs })
              if (!page.ok) {
                return sendJson(res, page.code === CODE.AUTH_REQUIRED ? 401 : 502, failure(page.code, page.message))
              }
              return sendJson(res, 200, {
                ok: true,
                hostId,
                sessionId,
                throughSeq: page.throughSeq,
                hasMore: page.hasMore,
                records: page.records,
              })
            }
            const result = await readTranscript(host, sessionId, limit, {
              timeoutMs: config.requestTimeoutMs,
              beforeSeq,
            })
            if (!result.ok) {
              return sendJson(res, result.code === CODE.AUTH_REQUIRED ? 401 : 502, failure(result.code, result.message))
            }
            return sendJson(res, 200, {
              ok: true,
              hostId,
              sessionId,
              throughSeq: result.throughSeq,
              hasMore: result.hasMore,
              nextBeforeSeq: result.nextBeforeSeq,
              messages: result.messages,
            })
          } catch (error) {
            const raw = String(error?.code ?? '')
            const code = raw === 'AbortError' ? CODE.TIMEOUT : raw.startsWith('gateway/') ? CODE.INCOMPATIBLE : CODE.UNREACHABLE
            return sendJson(res, code === CODE.INCOMPATIBLE ? 400 : 502, failure(code, String(error?.message ?? error)))
          }
        },
      }),
    'peerbar: session route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: `${PREFIX}/hosts`,
        handler: async (req, res) => {
          const guard = checkRequest(req, {
            methods: ['POST', 'PATCH', 'DELETE'],
            requireJson: true,
            actionHeader: ACTION_HEADER,
          })
          if (!guard.ok) return deny(res, guard)

          const tail = pathOf(req).slice(`${PREFIX}/hosts`.length).replace(/^\/+/, '')
          const parts = tail ? tail.split('/') : []
          const id = parts[0]
          const action = parts[1]
          try {
            // 远端会话改名：/hosts/<id>/sessions/<rawId>/rename
            if (action === 'sessions' && parts[2] && parts[3] === 'rename') {
              if (req.method !== 'POST') return sendJson(res, 405, failure(CODE.DENIED, 'method-not-allowed'))
              const host = peers.getHost(id)
              if (!host) return sendJson(res, 404, failure(CODE.BAD_REQUEST, 'Host 不存在'))
              if (!host.cookie?.header) return sendJson(res, 401, failure(CODE.AUTH_REQUIRED, '还没有 cookie，先探活一次'))
              const body = await readBody(req)
              const title = String(body?.title ?? '').trim()
              if (!title) return sendJson(res, 400, failure(CODE.BAD_REQUEST, 'title 不能为空'))
              const result = await renameRemoteSession(host, decodeURIComponent(parts[2]), title, {
                timeoutMs: config.requestTimeoutMs,
              })
              if (!result.ok) {
                return sendJson(res, result.code === CODE.AUTH_REQUIRED ? 401 : 502, failure(result.code, result.message))
              }
              return sendJson(res, 200, { ok: true })
            }
            if (!id) {
              if (req.method !== 'POST') return sendJson(res, 405, failure(CODE.DENIED, 'method-not-allowed'))
              const body = await readBody(req)
              const host = await peers.addHost(body)
              return sendJson(res, 200, { ok: true, host, state: peers.state() })
            }
            if (action === 'probe') {
              if (req.method !== 'POST') return sendJson(res, 405, failure(CODE.DENIED, 'method-not-allowed'))
              const state = await peers.probeNow(id)
              if (!state) return sendJson(res, 404, failure(CODE.BAD_REQUEST, 'Host 不存在'))
              return sendJson(res, 200, state)
            }
            if (action) return sendJson(res, 404, failure(CODE.BAD_REQUEST, '未知操作'))

            if (req.method === 'PATCH') {
              const body = await readBody(req)
              const host = await peers.updateHost(id, body)
              if (!host) return sendJson(res, 404, failure(CODE.BAD_REQUEST, 'Host 不存在'))
              return sendJson(res, 200, { ok: true, host, state: peers.state() })
            }
            if (req.method === 'DELETE') {
              const removed = await peers.removeHost(id)
              if (!removed) return sendJson(res, 404, failure(CODE.BAD_REQUEST, 'Host 不存在'))
              return sendJson(res, 200, peers.state())
            }
            return sendJson(res, 405, failure(CODE.DENIED, 'method-not-allowed'))
          } catch (error) {
            const code = error?.code === 'duplicate' ? CODE.BAD_REQUEST : (error?.code ?? CODE.BAD_REQUEST)
            return sendJson(res, 400, failure(code, String(error?.message ?? error)))
          }
        },
      }),
    'peerbar: hosts route',
  )

  ctx.logger.info(`[peerbar] 已加载，探活间隔 ${config.probeIntervalMs}ms`)
}

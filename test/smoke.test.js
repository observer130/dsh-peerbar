import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * 冒烟：真实 import 全部宿主半模块。
 *
 * `node --check` 只查语法，查不出「import 的导出名不存在」——那要到运行时才炸，
 * 表现为插件整个不激活、侧栏退回官方树。这条测试在 CI 里就能拦住。
 */
test('宿主半模块可被真实导入，导出齐全', async () => {
  const index = await import('../lib/index.js')
  assert.equal(typeof index.apply, 'function')

  const remote = await import('../lib/remote.js')
  for (const name of [
    'buildEnvelope',
    'exchangeCookie',
    'callRemote',
    'callRpc',
    'readStreamFirst',
    'readWorkspaceBaseline',
    'listSessions',
    'clampLimit',
    'readRawPage',
    'renameRemoteSession',
    'probePage',
    'disposeAgents',
  ]) {
    assert.equal(typeof remote[name], 'function', `remote.js 缺少导出 ${name}`)
  }

  const rpc = await import('../lib/rpc.js')
  assert.equal(typeof rpc.isAllowedRpc, 'function')
  assert.equal(typeof rpc.isPlainArgs, 'function')

  const peers = await import('../lib/peers.js')
  assert.equal(typeof peers.createPeers, 'function')

  const config = await import('../lib/config.js')
  for (const name of ['readRegistry', 'writeRegistry', 'readCache', 'writeCache']) {
    assert.equal(typeof config[name], 'function', `config.js 缺少导出 ${name}`)
  }

  const guard = await import('../lib/guard.js')
  assert.equal(typeof guard.checkRequest, 'function')

  const identity = await import('../lib/identity.js')
  assert.equal(typeof identity.groupSessions, 'function')
})

/**
 * 把 /session 路由真跑一遍（假 ctx + 假 req/res）。
 *
 * 上一次事故：清理时误删 `import { LOCAL_HOST_ID }`，模块能导入、但路由一执行就
 * ReferenceError，服务端 502、客户端显示「原生渲染失败」。只做 import 检查抓不到
 * 函数体内的引用，所以这里真的调用一次处理器。
 */
test('session 路由处理器可执行，不抛引用错误', async () => {
  const { apply } = await import('../lib/index.js')
  const routes = []
  const ctx = {
    logger: { info() {}, warn() {} },
    effect(fn) {
      fn()
      return () => {}
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    sessionController: { async list() { return { items: [] } } },
  }
  apply(ctx, { probeIntervalMs: 60000 })

  const sessionRoute = routes.find((r) => r.path === '/dsh-peerbar/api/session')
  assert.ok(sessionRoute, '没有注册 /session 路由')

  const call = (url) =>
    new Promise((resolve, reject) => {
      const req = {
        method: 'GET',
        url,
        headers: { host: '127.0.0.1:0', origin: 'http://127.0.0.1:0' },
        socket: { remoteAddress: '127.0.0.1' },
        on(event, fn) {
          if (event === 'data' || event === 'end') fn()
        },
      }
      const res = {
        statusCode: 0,
        body: '',
        setHeader() {},
        writeHead(code) {
          this.statusCode = code
        },
        end(chunk) {
          this.body = String(chunk ?? '')
          resolve(this)
        },
      }
      Promise.resolve(sessionRoute.handler(req, res)).catch(reject)
    })

  // 本机分支：必须走 LOCAL_HOST_ID 比较（这行曾经抛 ReferenceError）
  const local = await call('/dsh-peerbar/api/session?hostId=local&id=x&limit=5')
  assert.ok([200, 400, 502].includes(local.statusCode), `本机 session 路由状态异常: ${local.statusCode}`)

  // 不存在的 Host：走远端分支的查找
  const missing = await call('/dsh-peerbar/api/session?hostId=h_nope&id=x&limit=5')
  assert.equal(missing.statusCode, 404)
})

/**
 * /hosts/<id>/rpc 路由真跑一遍：白名单拒绝必须在转发前返回 400，
 * 未知 Host 返回 404。防止「白名单形同虚设 / 路由引用错误」回归。
 */
test('rpc 路由处理器可执行，白名单生效', async () => {
  const { apply } = await import('../lib/index.js')
  const routes = []
  const ctx = {
    logger: { info() {}, warn() {} },
    effect(fn) {
      fn()
      return () => {}
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    sessionController: { async list() { return { items: [] } } },
  }
  apply(ctx, { probeIntervalMs: 60000 })

  const hostsRoute = routes.find((r) => r.path === '/dsh-peerbar/api/hosts' && r.kind === 'prefix')
  assert.ok(hostsRoute, '没有注册 /hosts 前缀路由')

  const post = (url, body) =>
    new Promise((resolve, reject) => {
      const chunks = [Buffer.from(JSON.stringify(body))]
      const req = {
        method: 'POST',
        url,
        headers: {
          host: '127.0.0.1:0',
          origin: 'http://127.0.0.1:0',
          'x-dsh-peerbar-action': '1',
          'content-type': 'application/json',
        },
        socket: { remoteAddress: '127.0.0.1' },
        on(event, fn) {
          if (event === 'data') fn(chunks[0])
          if (event === 'end') fn()
        },
        destroy() {},
      }
      const res = {
        statusCode: 0,
        body: '',
        setHeader() {},
        writeHead(code) {
          this.statusCode = code
        },
        end(chunk) {
          this.body = String(chunk ?? '')
          resolve(this)
        },
      }
      Promise.resolve(hostsRoute.handler(req, res)).catch(reject)
    })

  // 白名单外端点：400（且不会去碰远端）
  const denied = await post('/dsh-peerbar/api/hosts/h_nope/rpc', { endpoint: 'workspace/follow', args: {} })
  assert.equal(denied.statusCode, 400, `流式端点应被白名单拒绝: ${denied.statusCode}`)
  assert.match(denied.body, /白名单/)

  const denied2 = await post('/dsh-peerbar/api/hosts/h_nope/rpc', { endpoint: 'settings/mutate', args: {} })
  assert.equal(denied2.statusCode, 400)

  // 白名单内但 Host 不存在：404
  const missing = await post('/dsh-peerbar/api/hosts/h_nope/rpc', { endpoint: 'session/prompt', args: {} })
  assert.equal(missing.statusCode, 404)
})

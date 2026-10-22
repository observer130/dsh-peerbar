import test from 'node:test'
import assert from 'node:assert/strict'

import { checkRequest, hostNameOf, isLoopbackAddress } from '../lib/guard.js'

function req({ method = 'GET', headers = {}, remoteAddress = '127.0.0.1' } = {}) {
  return { method, headers, socket: { remoteAddress } }
}

test('isLoopbackAddress 认 IPv4 / IPv6 / IPv4-mapped', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true)
  assert.equal(isLoopbackAddress('127.5.6.7'), true)
  assert.equal(isLoopbackAddress('::1'), true)
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true)
  assert.equal(isLoopbackAddress('192.168.3.50'), false)
  assert.equal(isLoopbackAddress('localhost'), false)
  assert.equal(isLoopbackAddress(undefined), false)
})

test('hostNameOf 兼容端口与括号写法', () => {
  assert.equal(hostNameOf('127.0.0.1:3080'), '127.0.0.1')
  assert.equal(hostNameOf('localhost'), 'localhost')
  assert.equal(hostNameOf('[::1]:3080'), '::1')
  assert.equal(hostNameOf('evil.test:80'), 'evil.test')
  assert.equal(hostNameOf('::1'), null)
})

test('回环 GET 放行', () => {
  const result = checkRequest(req({ headers: { host: '127.0.0.1:3080' } }), { methods: ['GET'] })
  assert.deepEqual(result, { ok: true })
})

test('非回环对端一律拒', () => {
  const result = checkRequest(
    req({ headers: { host: '127.0.0.1:3080' }, remoteAddress: '192.168.3.9' }),
    { methods: ['GET'] },
  )
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'not-loopback')
})

test('Host 头不是回环也拒（防 DNS rebinding）', () => {
  const result = checkRequest(req({ headers: { host: 'evil.test:3080' } }), { methods: ['GET'] })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'untrusted-host')
})

test('跨源 Origin 拒', () => {
  const result = checkRequest(
    req({ method: 'POST', headers: { host: '127.0.0.1:3080', origin: 'http://evil' } }),
    { methods: ['POST'], requireJson: true, actionHeader: 'x-dsh-peerbar-action' },
  )
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'cross-origin')
})

test('同源 Origin 放行（缺 JSON 时继续报下一个问题）', () => {
  const result = checkRequest(
    req({ method: 'POST', headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' } }),
    { methods: ['POST'], requireJson: true, actionHeader: 'x-dsh-peerbar-action' },
  )
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'json-required')
})

test('sec-fetch-site: cross-site 拒', () => {
  const result = checkRequest(
    req({ headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' } }),
    { methods: ['GET'] },
  )
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'cross-site')
})

test('变更类要求 JSON 与自定义头', () => {
  const base = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }
  const noJson = checkRequest(req({ method: 'POST', headers: base }), {
    methods: ['POST'],
    requireJson: true,
    actionHeader: 'x-dsh-peerbar-action',
  })
  assert.equal(noJson.reason, 'json-required')

  const noAction = checkRequest(
    req({ method: 'POST', headers: { ...base, 'content-type': 'application/json' } }),
    { methods: ['POST'], requireJson: true, actionHeader: 'x-dsh-peerbar-action' },
  )
  assert.equal(noAction.reason, 'action-header-required')

  const ok = checkRequest(
    req({
      method: 'POST',
      headers: { ...base, 'content-type': 'application/json', 'x-dsh-peerbar-action': '1' },
    }),
    { methods: ['POST'], requireJson: true, actionHeader: 'x-dsh-peerbar-action' },
  )
  assert.deepEqual(ok, { ok: true })
})

test('方法不在白名单 → 405', () => {
  const result = checkRequest(req({ method: 'PUT', headers: { host: '127.0.0.1:3080' } }), {
    methods: ['GET'],
  })
  assert.equal(result.status, 405)
})

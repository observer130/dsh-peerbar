import test from 'node:test'
import assert from 'node:assert/strict'

import { buildEnvelope } from '../lib/remote.js'
import { nextDelayMs } from '../lib/probe.js'

test('RPC 信封是 Connection 的 client-request 四件套', () => {
  const envelope = buildEnvelope('session/list', { _request: {} }, 'r1')
  assert.deepEqual(envelope, {
    type: 'client-request',
    rpcId: 'r1',
    method: 'session/list',
    payload: { args: { _request: {} } },
  })
})

test('信封的 method 与端点字符串一致（协议要求）', () => {
  const envelope = buildEnvelope('session/projections', { sessionId: 's1' })
  assert.equal(envelope.method, 'session/projections')
  assert.deepEqual(envelope.payload.args, { sessionId: 's1' })
  assert.equal(typeof envelope.rpcId, 'string')
  assert.ok(envelope.rpcId.length > 0)
})

test('默认 args 是空对象，不是 undefined', () => {
  const envelope = buildEnvelope('session/list')
  assert.deepEqual(envelope.payload, { args: {} })
})

test('退避：5→10→20→40→60 封顶', () => {
  const options = { jitter: 0 }
  assert.equal(nextDelayMs(1, options), 5000)
  assert.equal(nextDelayMs(2, options), 10000)
  assert.equal(nextDelayMs(3, options), 20000)
  assert.equal(nextDelayMs(4, options), 40000)
  assert.equal(nextDelayMs(5, options), 60000)
  assert.equal(nextDelayMs(50, options), 60000)
})

test('退避带抖动但不越界', () => {
  assert.equal(nextDelayMs(1, { jitter: 0.2, random: () => 0 }), 4000)
  assert.equal(nextDelayMs(1, { jitter: 0.2, random: () => 1 }), 6000)
  assert.equal(nextDelayMs(1, { jitter: 0.2, random: () => 0.5 }), 5000)
})

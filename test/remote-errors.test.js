import test from 'node:test'
import assert from 'node:assert/strict'

import { CODE } from '../lib/codes.js'
import { classifyGatewayError } from '../lib/remote.js'

test('gateway 请求形状错误归为 bad-request', () => {
  assert.equal(classifyGatewayError('gateway/bad-request'), CODE.BAD_REQUEST)
  assert.equal(classifyGatewayError('gateway/arguments-invalid'), CODE.BAD_REQUEST)
  assert.equal(classifyGatewayError('gateway/input-invalid'), CODE.BAD_REQUEST)
  assert.equal(classifyGatewayError('gateway/interactions-forbidden'), CODE.BAD_REQUEST)
})

test('gateway 取消归为 timeout，便于复用可重试路径', () => {
  assert.equal(classifyGatewayError('gateway/cancelled'), CODE.TIMEOUT)
})

test('其余 gateway/* 仍是 incompatible', () => {
  assert.equal(classifyGatewayError('gateway/signature-invalid'), CODE.INCOMPATIBLE)
  assert.equal(classifyGatewayError('gateway/method-unavailable'), CODE.INCOMPATIBLE)
  assert.equal(classifyGatewayError('gateway/not-a-real-code'), CODE.INCOMPATIBLE)
  assert.equal(classifyGatewayError(''), CODE.INCOMPATIBLE)
})

test('非 gateway 的远端业务错误不再冒充版本不兼容', () => {
  assert.equal(classifyGatewayError('session/not-found'), CODE.REMOTE_ERROR)
  assert.equal(classifyGatewayError('workspace/invalid-path'), CODE.REMOTE_ERROR)
})

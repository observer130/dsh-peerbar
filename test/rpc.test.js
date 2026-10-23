import test from 'node:test'
import assert from 'node:assert/strict'

import { isAllowedRpc, isPlainArgs, RPC_ALLOWLIST } from '../lib/rpc.js'

test('白名单放行已知端点', () => {
  for (const endpoint of [
    'session/prompt',
    'session/create',
    'session/cancel',
    'session/updateQueue',
    'session/fork',
    'session/selectModel',
    'session/modelCatalog',
    'workspace/rename',
    'workspace/delete',
    'workspace/archiveSession',
    'workspace/pinSession',
  ]) {
    assert.equal(isAllowedRpc(endpoint), true, endpoint + ' 应放行')
  }
})

test('白名单拒绝流式与未知端点', () => {
  for (const endpoint of [
    'workspace/follow', // 流式，只走 WS mux
    'session/follow',
    'session/control',
    '$events',
    'session/page', // 读走 /session 路由，不开双通道
    'workspace/initializeDefault',
    'directoryPicker/pick',
    'settings/mutate',
    'credentials/set',
    '',
    null,
    undefined,
  ]) {
    assert.equal(isAllowedRpc(endpoint), false, String(endpoint) + ' 应拒绝')
  }
})

test('白名单不含读端点与危险端点', () => {
  assert.ok(!RPC_ALLOWLIST.has('session/list'))
  assert.ok(!RPC_ALLOWLIST.has('workspace/follow'))
  assert.ok(!RPC_ALLOWLIST.has('settings/replace'))
})

test('isPlainArgs 只收普通对象', () => {
  assert.equal(isPlainArgs(undefined), true)
  assert.equal(isPlainArgs({}), true)
  assert.equal(isPlainArgs({ request: { sessionId: 's' } }), true)
  assert.equal(isPlainArgs([]), false)
  assert.equal(isPlainArgs(null), false)
  assert.equal(isPlainArgs('x'), false)
  assert.equal(isPlainArgs(3), false)
})

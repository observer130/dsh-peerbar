import test from 'node:test'
import assert from 'node:assert/strict'

import { buildFollowArgs } from '../lib/follow.js'

/**
 * `session/follow` 桥只接受两种地址形状（与官方 `parsePlanAddress` 一致）。
 * 形状不对时必须拒绝，不能把半成品地址转给远端——那会换回一个看不出原因的
 * 「正在读取计划…」。
 */

test('顶层会话地址：sessionId → session/follow 的 request', () => {
  assert.deepEqual(buildFollowArgs(new URLSearchParams('sessionId=session-abc-123')), {
    request: { address: { kind: 'session', sessionId: 'session-abc-123' } },
  })
})

test('子代理地址：parent/child/mode 组合', () => {
  const params = new URLSearchParams('parent=session-p&child=session-c&mode=one-shot')
  assert.deepEqual(buildFollowArgs(params), {
    request: {
      address: {
        kind: 'subagent',
        parentSessionId: 'session-p',
        childSessionId: 'session-c',
        mode: 'one-shot',
      },
    },
  })
})

test('拒绝缺字段、非法 mode 与空查询', () => {
  for (const query of [
    '',
    'sessionId=',
    'sessionId=%20',
    'parent=session-p&child=session-c', // 缺 mode
    'parent=session-p&child=session-c&mode=bogus', // 非法 mode
    'child=session-c&mode=unknown', // 缺 parent
    'sessionId=<script>',
    'sessionId=' + 'a'.repeat(201),
  ]) {
    assert.equal(buildFollowArgs(new URLSearchParams(query)), null, query)
  }
})

test('顶层会话优先：同时带 subagent 字段时只取 sessionId', () => {
  const params = new URLSearchParams('sessionId=session-top&parent=session-p&child=session-c&mode=unknown')
  assert.deepEqual(buildFollowArgs(params), {
    request: { address: { kind: 'session', sessionId: 'session-top' } },
  })
})

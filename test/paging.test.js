/**
 * T1：远端历史分页语义。
 *
 * `beforeSeq` 是向上翻页的**排他上界**（返回 seq < beforeSeq 的历史），
 * 不是增量游标（增量靠轮询 + seq 比对）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { MAX_PAGE_LIMIT, buildPageRequest, clampLimit } from '../lib/remote.js'

test('clampLimit 默认上限是 200（不再是 50）', () => {
  assert.equal(MAX_PAGE_LIMIT, 200)
  assert.equal(clampLimit('200'), 200)
  assert.equal(clampLimit('1000'), 200)
  assert.equal(clampLimit(0, 20), 20)
  assert.equal(clampLimit('abc', 20), 20)
})

test('clampLimit 可指定更小的上限（翻页页宽）', () => {
  assert.equal(clampLimit('200', 20, 50), 50)
  assert.equal(clampLimit('30', 20, 50), 30)
})

test('buildPageRequest 首屏：不带 beforeSeq，也不带 turnWindow', () => {
  const request = buildPageRequest({ sessionId: 's1', throughSeq: 900, limit: 200 })
  assert.deepEqual(request.address, { kind: 'session', sessionId: 's1' })
  assert.equal(request.throughSeq, 900)
  assert.equal(request.maxMessages, 200)
  assert.ok(!('beforeSeq' in request), '首屏不应带 beforeSeq')
  assert.ok(!('turnWindow' in request), '首屏不应带 turnWindow')
})

test('buildPageRequest 翻页：透传 beforeSeq 并带 Turn 对齐窗口', () => {
  const request = buildPageRequest({ sessionId: 's1', throughSeq: 900, limit: 50, beforeSeq: 400 })
  assert.equal(request.beforeSeq, 400)
  assert.deepEqual(request.turnWindow, { minMessages: 50, minTurns: 2 })
})

test('buildPageRequest：minMessages 不得超过 maxMessages', () => {
  // 远端会校验这条；页宽小于 50 时必须跟着缩小
  const request = buildPageRequest({ sessionId: 's1', throughSeq: 900, limit: 10, beforeSeq: 400 })
  assert.equal(request.maxMessages, 10)
  assert.equal(request.turnWindow.minMessages, 10)
})

test('buildPageRequest 忽略非法的 beforeSeq（0 / 负数 / NaN）', () => {
  for (const beforeSeq of [0, -5, Number.NaN, undefined, null, 'x']) {
    const request = buildPageRequest({ sessionId: 's1', throughSeq: 10, limit: 50, beforeSeq })
    assert.ok(!('beforeSeq' in request), `beforeSeq=${String(beforeSeq)} 应被忽略`)
    assert.ok(!('turnWindow' in request))
  }
})

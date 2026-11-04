/**
 * 联邦投影的变更检测。
 *
 * 置顶/归档是集合状态：只比较长度会漏掉“先置顶 A、再置顶 B”或
 * “归档 A 同时取消归档 B”这类等长变化；长度相同但成员变了也必须 notify。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { loadClientModule } from './support/client-module.js'

test('sameIdSet: 忽略顺序与重复，但成员变化必须为 false', async () => {
  const { sameIdSet } = await loadClientModule()
  assert.equal(sameIdSet(['a', 'b'], ['b', 'a']), true)
  assert.equal(sameIdSet(['a', 'b', 'a'], ['a', 'b']), true)
  assert.equal(sameIdSet([], []), true)
  assert.equal(sameIdSet(undefined, []), true)
  assert.equal(sameIdSet(['a', 'b'], ['a', 'c']), false, '等长但成员不同要判为变化')
  assert.equal(sameIdSet(['a'], ['a', 'b']), false)
})

test('sameFederation: blank 变化也算变化（否则 list 行停在旧空态）', async () => {
  const { sameFederation } = await loadClientModule()
  const workspaces = [{ workspaceId: 'w1', title: 'w', path: '/w', createdAt: '2026-01-01T00:00:00.000Z', sessionIds: ['s1'] }]
  const base = {
    workspaces,
    sessions: new Map([['s1', { title: 't', displayTitle: 't', running: false, updatedAt: 1, blank: true }]]),
  }
  const next = {
    workspaces,
    sessions: new Map([['s1', { title: 't', displayTitle: 't', running: false, updatedAt: 1, blank: false }]]),
  }
  assert.equal(sameFederation(next, base), false)
})

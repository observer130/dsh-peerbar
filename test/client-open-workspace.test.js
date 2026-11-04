/**
 * 远端“新建会话”应复用同工作区的 blank，而不是每次新建一个空会话。
 * 归档的 blank 不能复用；非 blank 也不行。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { loadClientModule } from './support/client-module.js'

const sessions = new Map([
  ['done', { id: 'done', blank: false }],
  ['blank-archived', { id: 'blank-archived', blank: true }],
  ['blank-ok', { id: 'blank-ok', blank: true }],
])
const archived = ['blank-archived']

test('findReusableBlank: 跳过非 blank 与已归档 blank', async () => {
  const { findReusableBlank } = await loadClientModule()
  assert.equal(findReusableBlank(['done', 'blank-archived', 'blank-ok'], sessions, archived), 'blank-ok')
  assert.equal(findReusableBlank(['done'], sessions, archived), null)
  assert.equal(findReusableBlank(undefined, sessions, archived), null)
})

test('findReusableBlank: 保持 sessionIds 顺序', async () => {
  const { findReusableBlank } = await loadClientModule()
  assert.equal(findReusableBlank(['blank-ok', 'blank-archived'], sessions, archived), 'blank-ok')
})

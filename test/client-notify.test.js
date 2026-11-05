import assert from 'node:assert/strict'
import test from 'node:test'

import { loadClientModule } from './support/client-module.js'

test('控制流连续通知合并为一次 list.set', async () => {
  const { notifySessionList } = await loadClientModule()
  const snapshot = { ids: ['s1'], byId: { s1: { id: 's1' } } }
  let sets = 0
  const sessions = {
    list: {
      getSnapshot: () => snapshot,
      set: () => {
        sets += 1
      },
    },
  }
  const ctx = { get: (name) => (name === 'sessions' ? sessions : null) }

  notifySessionList(ctx)
  notifySessionList(ctx)
  notifySessionList(ctx)
  assert.equal(sets, 0, '同一批通知不应同步写 store')

  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(sets, 1, '一批 control 帧只触发一次 list.set')

  notifySessionList(ctx)
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(sets, 2, '下一批仍能正常通知')
})

import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeRemoteScheduleRecord } from '../lib/schedule.js'

test('旧版 catalog 记录补齐 involvedSessionIds 与 target', () => {
  const record = { id: 'schedule-1', sessionId: 'session-1', peerbarHostId: 'h1' }
  const normalized = normalizeRemoteScheduleRecord(record, 'h1')
  assert.deepEqual(normalized.involvedSessionIds, [])
  assert.deepEqual(normalized.target, { kind: 'session', sessionId: 'session-1' })
  assert.equal(normalized.peerbarHostId, 'h1')
  assert.equal(normalized.id, 'schedule-1')
})

test('新式 catalog 记录保留原始字段与参与集合', () => {
  const record = {
    id: 'schedule-2',
    involvedSessionIds: ['session-1', 'session-2'],
    target: { kind: 'new' },
    peerbarHostId: 'from-remote',
  }
  const normalized = normalizeRemoteScheduleRecord(record, 'h1')
  assert.deepEqual(normalized.involvedSessionIds, ['session-1', 'session-2'])
  assert.deepEqual(normalized.target, { kind: 'new' })
  assert.equal(normalized.peerbarHostId, 'h1')
})

test('无 sessionId 的旧记录 target 退回 new，非法记录返回 null', () => {
  const normalized = normalizeRemoteScheduleRecord({ id: 'schedule-3' }, 'h1')
  assert.deepEqual(normalized.target, { kind: 'new' })
  assert.equal(normalizeRemoteScheduleRecord(null, 'h1'), null)
  assert.equal(normalizeRemoteScheduleRecord([], 'h1'), null)
})

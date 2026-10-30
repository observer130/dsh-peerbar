import test from 'node:test'
import assert from 'node:assert/strict'

import { ASSET_PATHS, readAssetTarget } from '../lib/assets.js'

test('白名单只有交付物卡片的两条只读路由', () => {
  assert.deepEqual([...ASSET_PATHS].sort(), ['/api/changes.diff', '/api/changes.summary'])
})

test('摘要与对比的 pathname+search 原样放行', () => {
  const summary = readAssetTarget('/api/changes.summary?sessionId=session-abc&seq=12')
  assert.deepEqual(summary, { ok: true, value: '/api/changes.summary?sessionId=session-abc&seq=12' })

  const diff = readAssetTarget('/api/changes.diff?sessionId=session-abc&seq=12&index=0')
  assert.deepEqual(diff, { ok: true, value: '/api/changes.diff?sessionId=session-abc&seq=12&index=0' })
})

test('白名单之外的路径一律拒绝', () => {
  for (const raw of [
    '/api/changes.open?sessionId=session-abc&seq=12',
    '/api/present.open?sessionId=session-abc&seq=12&index=0',
    '/api/session/prompt',
    '/api/changes.summary.evil',
    '/dsh-peerbar/api/state',
    '/api/changes.summaryX',
  ]) {
    const result = readAssetTarget(raw)
    assert.equal(result.ok, false, raw)
    assert.equal(result.reason, 'path-not-allowed', raw)
  }
})

test('不是「本站内的 pathname+search」的一律拒绝', () => {
  for (const raw of [
    '',
    'changes.summary?seq=1',
    '//evil.example/api/changes.summary?seq=1',
    'https://evil.example/api/changes.summary?seq=1',
    '/api/changes.summary?seq=1#frag',
    '  /api/changes.summary?seq=1',
  ]) {
    const result = readAssetTarget(raw)
    assert.equal(result.ok, false, JSON.stringify(raw))
    assert.ok(['bad-path', 'path-not-allowed'].includes(result.reason), raw)
  }
})

test('非字符串与超长输入拒绝（不抛异常）', () => {
  for (const raw of [null, undefined, 42, {}, [], true]) {
    assert.equal(readAssetTarget(raw).ok, false)
  }
  const long = `/api/changes.summary?sessionId=${'x'.repeat(4096)}`
  assert.equal(readAssetTarget(long).ok, false)
  assert.equal(readAssetTarget(long).reason, 'bad-path')
})

test('编码过的 query 保留原样，不做二次编码', () => {
  const raw = '/api/changes.diff?sessionId=session-abc&seq=7&index=0&label=%E4%B8%AD%E6%96%87'
  const result = readAssetTarget(raw)
  assert.equal(result.ok, true)
  assert.equal(result.value, raw)
})

/**
 * 已从 /state 消失的远端会话，必须释放对应 binding。
 *
 * 旧实现只在官方调用 dispose 时删 remoteBindings，registry 永远留着；
 * getSnapshot 又无条件注入 registry 行，主机删除后会话会以「未分组」幽灵
 * 行出现，轮询也会继续跑。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { loadClientModule } from './support/client-module.js'

test('pruneStaleBindings 只释放已消失的会话', async () => {
  const { pruneStaleBindings } = await loadClientModule()
  const disposed = []
  const registry = new Map([
    ['keep', { dispose: () => disposed.push('keep') }],
    ['gone', { dispose: () => disposed.push('gone') }],
  ])
  const sessionsService = { __peerbarRegistry: registry }
  const ctx = { get: (name) => (name === 'sessions' ? sessionsService : null) }
  const nextSessions = new Map([['keep', { id: 'keep' }]])

  pruneStaleBindings(ctx, nextSessions)

  assert.deepEqual(disposed, ['gone'], '只应释放 next.sessions 里不存在的 binding')
})

test('没有 registry 或没有 ctx 时安全退出', async () => {
  const { pruneStaleBindings } = await loadClientModule()
  assert.doesNotThrow(() => pruneStaleBindings({}, new Map()))
  assert.doesNotThrow(() => pruneStaleBindings({ get: () => null }, new Map()))
})

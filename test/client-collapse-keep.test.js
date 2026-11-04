/**
 * 默认收起远端组时，当前会话所在的工作区组和它的父主机根都不能收。
 *
 * 旧实现只 keep 工作区组 id；主机分组模式下真正可折叠的父行是 hostroot，
 * 于是重载后当前会话仍被藏起来。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { loadClientModule } from './support/client-module.js'

test('当前远端会话：keep 工作区组 + 父主机根', async () => {
  const { keepGroupsForCurrent } = await loadClientModule()
  const workspaces = [
    { workspaceId: 'peerbar:h_1:ws:/a', __peerbarHostId: 'h_1', sessionIds: ['s1', 's2'] },
    { workspaceId: 'peerbar:h_2:ws:/b', __peerbarHostId: 'h_2', sessionIds: ['s3'] },
  ]
  const keep = keepGroupsForCurrent(workspaces, 's2')
  assert.deepEqual([...keep].sort(), ['peerbar:h_1:hostroot', 'peerbar:h_1:ws:/a'])
})

test('当前本机会话：keep 本机根', async () => {
  const { keepGroupsForCurrent } = await loadClientModule()
  const keep = keepGroupsForCurrent(
    [{ workspaceId: 'peerbar:h_1:ws:/a', __peerbarHostId: 'h_1', sessionIds: ['remote'] }],
    'local-session',
  )
  assert.deepEqual([...keep], ['peerbar:local:hostroot'])
})

test('没有当前会话：keep 为空', async () => {
  const { keepGroupsForCurrent } = await loadClientModule()
  assert.equal(keepGroupsForCurrent([], undefined).size, 0)
})

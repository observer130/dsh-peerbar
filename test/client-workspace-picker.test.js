/**
 * 新会话工作区下拉的数据分组。
 *
 * 官方 picker 把 `workspaces.list` 的每一项都当可选工作区；合成 hostroot
 * 必须从可选行里剔除，作为不可点的主机标题出现，其工作区缩进在下面。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { loadClientModule } from './support/client-module.js'

const localRoot = {
  workspaceId: 'peerbar:local:hostroot',
  title: '本机',
  __peerbarLocalRoot: true,
  __peerbarHostId: 'local',
}
const localWorkspace = { workspaceId: 'local-ws', title: '本地项目' }
const remoteWorkspace = {
  workspaceId: 'peerbar:nv50:ws:/data2/nwj/meeting_eval',
  title: 'meeting_eval',
  __peerbarHostId: 'nv50',
}
const remoteRoot = {
  workspaceId: 'peerbar:nv50:hostroot',
  title: 'nv50',
  __peerbarHostId: 'nv50',
  __peerbarHostRoot: true,
}

test('主机根不进入可选行，工作区按主机归组且标题在前', async () => {
  const { groupWorkspacePicks } = await loadClientModule()
  // 远端 hostroot 在 federationSnapshot 里排在该主机工作区之后，分组不能依赖数组顺序。
  const groups = groupWorkspacePicks([localRoot, localWorkspace, remoteWorkspace, remoteRoot], true)
  assert.deepEqual(
    groups.map((group) => ({ hostId: group.hostId, title: group.title })),
    [
      { hostId: 'local', title: '本机' },
      { hostId: 'nv50', title: 'nv50' },
    ],
  )
  assert.deepEqual(groups[0].rows.map((row) => row.workspaceId), ['local-ws'])
  assert.deepEqual(groups[1].rows.map((row) => row.workspaceId), [
    'peerbar:nv50:ws:/data2/nwj/meeting_eval',
  ])
  const all = groups.flatMap((group) => group.rows)
  assert.ok(all.every((row) => !row.__peerbarHostRoot && !row.__peerbarLocalRoot))
})

test('没有 hostroot 时仍按 hostId 分组，不会把主机行混进工作区', async () => {
  const { groupWorkspacePicks } = await loadClientModule()
  const groups = groupWorkspacePicks([localWorkspace, remoteWorkspace], true)
  assert.deepEqual(
    groups.map((group) => [group.title, group.rows.map((row) => row.workspaceId)]),
    [
      ['本机', ['local-ws']],
      ['nv50', ['peerbar:nv50:ws:/data2/nwj/meeting_eval']],
    ],
  )
})

test('平铺模式退回单组，且依然剔除 hostroot', async () => {
  const { groupWorkspacePicks } = await loadClientModule()
  const groups = groupWorkspacePicks([localRoot, localWorkspace, remoteRoot, remoteWorkspace], false)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].title, '')
  assert.deepEqual(groups[0].rows.map((row) => row.workspaceId), [
    'local-ws',
    'peerbar:nv50:ws:/data2/nwj/meeting_eval',
  ])
})

test('只有主机根时返回空列表，由调用方走添加工作区', async () => {
  const { groupWorkspacePicks } = await loadClientModule()
  assert.deepEqual(groupWorkspacePicks([localRoot, remoteRoot], true), [])
  assert.deepEqual(groupWorkspacePicks([], true), [])
})

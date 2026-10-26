/**
 * 远端写操作的本地回写映射（`peers.applyEchoToWorkspaces`）。
 *
 * 与 `lib/rpc.js` 的白名单一一对应：验收反馈「操作要等 5s」，根因是 `/state`
 * 来自 5s 一轮的探活快照。这里逐端点锁住映射，避免新增端点时又漏一条。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { applyEchoToWorkspaces } from '../lib/peers.js'
import { RPC_ALLOWLIST } from '../lib/rpc.js'

const NOW = 1_700_000_000_000
const HOST = 'h_1'

function fixture() {
  return [
    {
      id: 'peerbar:h_1:ws:/a',
      name: 'alpha',
      cwd: '/a',
      workspaceId: 'ws-a',
      sessions: [
        { id: 'peerbar:h_1:sess:s1', rawId: 's1', title: 'one', lastActivityAt: 10, running: false, blank: false, archived: false, pinned: false },
        { id: 'peerbar:h_1:sess:s2', rawId: 's2', title: 'two', lastActivityAt: 20, running: false, blank: false, archived: false, pinned: true },
        // 已归档 + 运行中：用来验证「取消归档 / 停止」这两个反向操作
        { id: 'peerbar:h_1:sess:s4', rawId: 's4', title: 'four', lastActivityAt: 5, running: true, blank: false, archived: true, pinned: false },
      ],
    },
    {
      id: 'peerbar:h_1:ws:/b',
      name: 'beta',
      cwd: '/b',
      workspaceId: 'ws-b',
      sessions: [{ id: 'peerbar:h_1:sess:s3', rawId: 's3', title: 'three', lastActivityAt: 30, running: false, blank: false, archived: false, pinned: false }],
    },
  ]
}

const apply = (endpoint, args, value) =>
  applyEchoToWorkspaces({ hostId: HOST, workspaces: fixture(), endpoint, args, value, now: NOW })

const row = (list, rawId) => list.flatMap((ws) => ws.sessions ?? []).find((s) => s.rawId === rawId)
const wsOf = (list, workspaceId) => list.find((ws) => ws.workspaceId === workspaceId)

test('会话标记类：归档 / 取消归档 / 置顶 / 取消置顶', () => {
  // 每个操作都挑「初值相反」的那条，才能真正观察到变更（同值是幂等的 null）
  const cases = [
    ['workspace/archiveSession', 's1', 'archived', true],
    ['workspace/unarchiveSession', 's4', 'archived', false],
    ['workspace/pinSession', 's1', 'pinned', true],
    ['workspace/unpinSession', 's2', 'pinned', false],
  ]
  for (const [endpoint, target, key, expected] of cases) {
    const next = apply(endpoint, { request: { sessionId: target } })
    assert.ok(next, `${endpoint} 应产生变更`)
    assert.equal(row(next, target)[key], expected, `${endpoint} 应把 ${key} 置为 ${expected}`)
    // 行数与其它会话的标题不受影响
    assert.equal(next.flatMap((ws) => ws.sessions).length, 4)
    assert.equal(row(next, 's2').title, 'two')
  }
  // 同值再下一次是幂等的
  assert.equal(apply('workspace/archiveSession', { request: { sessionId: 's4' } }), null)
})

test('会话改名直接落到快照', () => {
  const next = apply('session/rename', { request: { sessionId: 's2', title: '新名字' } })
  assert.equal(row(next, 's2').title, '新名字')
})

test('发消息 / 停止：running 与最近活动立刻可见', () => {
  const started = apply('session/prompt', { request: { sessionId: 's1' } })
  assert.equal(row(started, 's1').running, true)
  assert.equal(row(started, 's1').lastActivityAt, NOW)

  // s4 初值是运行中 → 停止才有变化
  const stopped = apply('session/cancel', { request: { sessionId: 's4' } })
  assert.equal(row(stopped, 's4').running, false)
})

test('新建会话插到目标工作区最前，且是空白态', () => {
  const next = apply('session/create', { request: { workspaceId: 'ws-b' } }, { sessionId: 's9' })
  const beta = wsOf(next, 'ws-b')
  assert.deepEqual(
    beta.sessions.map((s) => s.rawId),
    ['s9', 's3'],
  )
  const created = row(next, 's9')
  assert.equal(created.blank, true)
  assert.equal(created.title, null)
  assert.equal(created.id, `peerbar:${HOST}:sess:s9`)
})

test('session/create 幂等（同一 id 重复回写不会插两行）', () => {
  const once = apply('session/create', { request: { workspaceId: 'ws-b' } }, { sessionId: 's9' })
  const twice = applyEchoToWorkspaces({
    hostId: HOST,
    workspaces: once,
    endpoint: 'session/create',
    args: { request: { workspaceId: 'ws-b' } },
    value: { sessionId: 's9' },
    now: NOW,
  })
  assert.equal(twice, null, '没有变化时返回 null')
})

test('分叉：新会话紧跟原会话之后，同一工作区', () => {
  const next = apply('session/fork', { request: { sessionId: 's1' } }, { sessionId: 's9' })
  assert.deepEqual(
    wsOf(next, 'ws-a').sessions.map((s) => s.rawId),
    ['s1', 's9', 's2', 's4'],
  )
})

test('工作区改名优先用远端返回的 title', () => {
  const next = apply('workspace/rename', { request: { workspaceId: 'ws-a', title: '请求里的' } }, { workspace: { workspaceId: 'ws-a', title: '返回的' } })
  assert.equal(wsOf(next, 'ws-a').name, '返回的')
})

test('删工作区：整组移除', () => {
  const next = apply('workspace/delete', { request: { workspaceId: 'ws-a' } })
  assert.equal(wsOf(next, 'ws-a'), undefined)
  assert.equal(next.length, 1)
})

test('新建工作区：插到最前，带 workspaceId 与目录名', () => {
  const next = apply('workspace/create', { request: { path: '/c' } }, {
    workspace: { workspaceId: 'ws-c', path: '/c', title: 'charlie', sessionIds: [] },
  })
  assert.equal(next[0].workspaceId, 'ws-c')
  assert.equal(next[0].name, 'charlie')
  assert.equal(next[0].cwd, '/c')
  assert.deepEqual(next[0].sessions, [])
  // 已存在则不重复插入
  const again = applyEchoToWorkspaces({
    hostId: HOST,
    workspaces: next,
    endpoint: 'workspace/create',
    args: { request: { path: '/c' } },
    value: { workspace: { workspaceId: 'ws-c', path: '/c', title: 'charlie' } },
    now: NOW,
  })
  assert.equal(again, null)
})

test('工作区手工排序按返回的 workspaceIds 重排，列表外的追加末尾', () => {
  const next = apply('workspace/insertBefore', { request: { workspaceId: 'ws-b' } }, { workspaceIds: ['ws-b'] })
  assert.deepEqual(
    next.map((ws) => ws.workspaceId),
    ['ws-b', 'ws-a'],
  )
})

test('组内手工排序按返回的 sessionIds 重排，未 accounted 的保持原序追加', () => {
  const next = apply('workspace/insertSessionBefore', { request: { sessionId: 's2' } }, {
    workspace: { workspaceId: 'ws-a', sessionIds: ['s2'] },
  })
  assert.deepEqual(
    wsOf(next, 'ws-a').sessions.map((s) => s.rawId),
    ['s2', 's1', 's4'],
  )
})

test('无侧栏影响 / 未命中的调用返回 null（不产生无谓快照重写）', () => {
  const noop = [
    ['session/selectModel', { request: { sessionId: 's1', model: 'x' } }],
    ['session/updateQueue', { request: { sessionId: 's1', itemId: 'q', action: 'remove' } }],
    ['session/modelCatalog', {}],
    ['directoryPicker/list', { path: '/a' }],
    ['workspace/archiveSession', { request: { sessionId: 'nope' } }],
    ['workspace/rename', { request: { workspaceId: 'nope', title: 'x' } }],
  ]
  for (const [endpoint, args] of noop) {
    assert.equal(apply(endpoint, args), null, `${endpoint} 不该改动快照`)
  }
})

test('白名单里的每个端点都要有明确归属（回写 or 已知无需回写）', () => {
  // 新增端点时这条会失败，提醒回来决定「要不要立刻反映到侧栏」
  const handled = new Set([
    'workspace/archiveSession',
    'workspace/unarchiveSession',
    'workspace/pinSession',
    'workspace/unpinSession',
    'session/rename',
    'session/prompt',
    'session/cancel',
    'session/create',
    'session/fork',
    'workspace/rename',
    'workspace/delete',
    'workspace/create',
    'workspace/insertBefore',
    'workspace/insertSessionBefore',
  ])
  // 明确不需要回写的：内容类（走会话绑定）与只读端点
  const byDesign = new Set(['session/updateQueue', 'session/selectModel', 'session/modelCatalog', 'directoryPicker/list'])
  const unaccounted = [...RPC_ALLOWLIST].filter((endpoint) => !handled.has(endpoint) && !byDesign.has(endpoint))
  assert.deepEqual(unaccounted, [], `这些端点在 applyEchoToWorkspaces 里没有归属：${unaccounted.join(', ')}`)
})

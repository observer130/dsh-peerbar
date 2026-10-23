import test from 'node:test'
import assert from 'node:assert/strict'

import {
  groupSessions,
  hostIdFromOrigin,
  normalizeOrigin,
  parseVirtualId,
  virtualSessionId,
  workspaceName,
} from '../lib/identity.js'

test('normalizeOrigin 补 scheme、去尾斜杠、去默认端口', () => {
  assert.equal(normalizeOrigin('192.168.3.50:3080'), 'https://192.168.3.50:3080')
  assert.equal(normalizeOrigin('https://192.168.3.50:3080/'), 'https://192.168.3.50:3080')
  assert.equal(normalizeOrigin('http://example.test:80'), 'http://example.test')
  assert.equal(normalizeOrigin('  https://EXAMPLE.test  '), 'https://example.test')
})

test('normalizeOrigin 拒掉路径、查询、账号密码', () => {
  assert.throws(() => normalizeOrigin('https://a.test/x'), /path/)
  assert.throws(() => normalizeOrigin('https://a.test/?token=1'), /query/)
  assert.throws(() => normalizeOrigin('https://u:p@a.test'), /credentials/)
  assert.throws(() => normalizeOrigin('ftp://a.test'), /http/)
  assert.throws(() => normalizeOrigin(''), /required/)
})

test('hostId 对同一 origin 的不同写法稳定', () => {
  const a = hostIdFromOrigin('https://192.168.3.50:3080')
  const b = hostIdFromOrigin('https://192.168.3.50:3080/')
  assert.equal(a, b)
  assert.match(a, /^h_[0-9a-f]{8}$/)
  assert.notEqual(a, hostIdFromOrigin('http://192.168.3.50:3080'))
})

test('虚拟 ID 可往返，rawId 里允许冒号', () => {
  const id = virtualSessionId('h_1234abcd', 'sess:1')
  const parsed = parseVirtualId(id)
  assert.deepEqual(parsed, { hostId: 'h_1234abcd', kind: 'sess', rawId: 'sess:1' })
  assert.equal(parseVirtualId('not-a-peerbar-id'), null)
})

test('workspaceName 取 basename，未知 cwd 有兜底', () => {
  assert.equal(workspaceName('/home/nwj/Projects/dsh-peerbar'), 'dsh-peerbar')
  assert.equal(workspaceName('/home/nwj/Projects/dsh-peerbar/'), 'dsh-peerbar')
  assert.equal(workspaceName('(unknown)'), '(unknown)')
  assert.equal(workspaceName('/'), '/')
})

test('groupSessions 按 cwd 分组并按活动时间排序', () => {
  const items = [
    { sessionId: 's1', cwd: '/a', updatedAt: 10, running: false, blank: false, projections: { values: { title: '一' } } },
    { sessionId: 's2', cwd: '/a', updatedAt: 30, running: true, blank: false, projections: { values: { title: '二' } } },
    { sessionId: 's3', cwd: '/b', updatedAt: 20, blank: true },
    { sessionId: 's4', cwd: '/b', updatedAt: 40, projections: { values: { title: '   ' } } },
    { sessionId: '', cwd: '/a', updatedAt: 1 },
    null,
  ]
  const groups = groupSessions('h_1', items)
  assert.equal(groups.length, 2)
  assert.equal(groups[0].cwd, '/b')
  assert.equal(groups[0].sessions[0].rawId, 's4')
  assert.equal(groups[0].sessions[0].title, null)
  assert.equal(groups[0].sessions[1].blank, true)
  assert.equal(groups[1].sessions[0].rawId, 's2')
  assert.equal(groups[1].sessions[0].running, true)
  assert.equal(groups[1].sessions[0].title, '二')
  assert.equal(groups[1].id, 'peerbar:h_1:ws:/a')
})

test('groupSessions 把缺失 cwd 归到 (unknown)', () => {
  const groups = groupSessions('h_1', [{ sessionId: 's1', updatedAt: 1 }])
  assert.equal(groups[0].cwd, '(unknown)')
  assert.equal(groups[0].name, '(unknown)')
})

test('groupSessions 带 registry：workspaceId/archived/pinned 与手工序', () => {
  const registry = {
    items: [
      {
        workspaceId: 'ws-real-1',
        path: '/a',
        title: '改过名的工作区',
        sessionIds: ['s2', 's1'],
      },
    ],
    archivedSessionIds: ['s1'],
    pinnedSessionIds: ['s2'],
  }
  const items = [
    { sessionId: 's1', cwd: '/a', updatedAt: 10, projections: { values: { title: '一' } } },
    { sessionId: 's2', cwd: '/a', updatedAt: 30, projections: { values: { title: '二' } } },
    { sessionId: 's3', cwd: '/b', updatedAt: 50, projections: { values: { title: '三' } } },
  ]
  const groups = groupSessions('h_1', items, registry)
  // /b 组无 registry → workspaceId 为 null，行为退回 cwd 合成
  const gb = groups.find((g) => g.cwd === '/b')
  assert.equal(gb.workspaceId, null)
  assert.equal(gb.sessions[0].archived, false)
  // /a 组带真实 workspaceId，s2 手工序在前（updatedAt 反序被压过）
  const ga = groups.find((g) => g.cwd === '/a')
  assert.equal(ga.workspaceId, 'ws-real-1')
  assert.deepEqual(ga.sessions.map((s) => s.rawId), ['s2', 's1'])
  assert.equal(ga.sessions[0].pinned, true)
  assert.equal(ga.sessions[1].archived, true)
})

test('groupSessions 无 registry 时 archived/pinned 全 false', () => {
  const groups = groupSessions('h_1', [{ sessionId: 's1', cwd: '/a', updatedAt: 1 }])
  assert.equal(groups[0].sessions[0].archived, false)
  assert.equal(groups[0].sessions[0].pinned, false)
  assert.equal(groups[0].workspaceId, null)
})

test('groupSessions 丢掉子代理会话（origin=subagent）', () => {
  const items = [
    { sessionId: 'parent', cwd: '/a', updatedAt: 20 },
    {
      sessionId: 'child',
      cwd: '/a',
      updatedAt: 30,
      origin: 'subagent',
      parentSessionId: 'parent',
      projections: { values: { title: '子任务' } },
    },
  ]
  const groups = groupSessions('h_1', items)
  assert.equal(groups.length, 1)
  assert.deepEqual(
    groups[0].sessions.map((session) => session.rawId),
    ['parent'],
  )
})

test('groupSessions 按传入归档集打 archived 标记（兼容 {archivedSessionIds} 形状）', () => {
  const items = [
    { sessionId: 's1', cwd: '/a', updatedAt: 20 },
    { sessionId: 's2', cwd: '/a', updatedAt: 10 },
  ]
  const groups = groupSessions('h_1', items, { archivedSessionIds: ['s2'] })
  assert.deepEqual(
    groups[0].sessions.map((session) => [session.rawId, session.archived]),
    [
      ['s1', false],
      ['s2', true],
    ],
  )
  const none = groupSessions('h_1', items)
  assert.deepEqual(
    none[0].sessions.map((session) => session.archived),
    [false, false],
  )
})

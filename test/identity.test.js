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

test('groupSessions 带 registry：注册表驱动分组/改名标题/未分组桶/手工序', () => {
  const registry = {
    items: [
      {
        workspaceId: 'ws-real-1',
        path: '/a',
        title: '改过名的工作区',
        sessionIds: ['s2', 's1'],
      },
      {
        workspaceId: 'ws-empty',
        path: '/empty',
        title: '还没有会话的工作区',
        sessionIds: [],
      },
    ],
    archivedSessionIds: ['s1'],
    pinnedSessionIds: ['s2'],
  }
  const items = [
    { sessionId: 's1', cwd: '/a', updatedAt: 10, projections: { values: { title: '一' } } },
    { sessionId: 's2', cwd: '/a', updatedAt: 30, projections: { values: { title: '二' } } },
    // 未归属任何注册工作区 → 未分组桶（不再按 cwd 造伪工作区）
    { sessionId: 's3', cwd: '/home/loose', updatedAt: 50, projections: { values: { title: '三' } } },
  ]
  const groups = groupSessions('h_1', items, registry)

  // 注册工作区全部出组（含 0 会话的空组），组名用 registry title
  const ga = groups.find((g) => g.workspaceId === 'ws-real-1')
  assert.equal(ga.name, '改过名的工作区')
  // 组顺序：registry 下标；未分组永远最后（客户端「手动排序」按它排组）
  assert.equal(ga.order, 0)
  assert.deepEqual(ga.sessions.map((s) => s.rawId), ['s2', 's1'])
  assert.equal(ga.sessions[0].pinned, true)
  assert.equal(ga.sessions[1].archived, true)
  const gEmpty = groups.find((g) => g.workspaceId === 'ws-empty')
  assert.ok(gEmpty, '没有会话的注册工作区也要出组')
  assert.equal(gEmpty.sessions.length, 0)
  assert.equal(gEmpty.order, 1)

  // 未归属会话进未分组桶：workspaceId 为 null、ungrouped 标记、不按 cwd 分组
  const bucket = groups.find((g) => g.ungrouped)
  assert.ok(bucket, '未归属会话应进未分组桶')
  assert.equal(bucket.workspaceId, null)
  assert.equal(bucket.name, null)
  assert.equal(bucket.order, Number.MAX_SAFE_INTEGER)
  assert.deepEqual(bucket.sessions.map((s) => s.rawId), ['s3'])
  assert.equal(groups.filter((g) => g.cwd === '/home/loose').length, 0)
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

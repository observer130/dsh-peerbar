/**
 * 跨机契约测试：用 `test/support/mock-host.js` 的假远端把
 * 「换 cookie → 信封 → 分页 → baseline → 兼容探测」整条链路跑起来。
 *
 * 这些用例不起 dsh、不碰网络、不需要真实模型和 Chrome：
 * 目的就是替掉 ui-check 里那 3 分钟长链路，让升级 dsh 后的契约漂移先在这里红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { groupSessions } from '../lib/identity.js'
import { callRemote, probePage, readRawPage } from '../lib/remote.js'
import { probeHost } from '../lib/probe.js'
import { createMockHost, sessionItem } from './support/mock-host.js'

/** 先用一次探活拿到 cookie，后续直接调 RPC。 */
async function onlineHost(mock, options = {}) {
  const result = await probeHost(mock.host(), { timeoutMs: 3000, ...options })
  assert.equal(result.ok, true, result.message)
  return mock.host({ cookie: result.cookie })
}

test('探活全链路：换 cookie、拉 session/list、读 baseline 注册表', async (t) => {
  const mock = await createMockHost({
    items: [sessionItem({ id: 's1', updatedAt: 10 }), sessionItem({ id: 's2', title: '第二个', updatedAt: 20 })],
    workspaces: [{ workspaceId: 'ws-a', path: '/work/a', title: '项目 a', sessionIds: ['s2', 's1'] }],
    archivedSessionIds: ['s2'],
    pinnedSessionIds: ['s1'],
  })
  t.after(() => mock.close())

  const result = await probeHost(mock.host(), { timeoutMs: 3000 })
  assert.equal(result.ok, true, result.message)
  assert.equal(result.status, 'online')
  assert.equal(result.cookieRefreshed, true, '首次探活应换 cookie')
  assert.equal(result.items.length, 2)
  assert.equal(result.registryError, null)
  assert.deepEqual(result.registry.items[0].sessionIds, ['s2', 's1'])
  assert.deepEqual(result.registry.archivedSessionIds, ['s2'])
  assert.deepEqual(result.registry.pinnedSessionIds, ['s1'])

  // 注册表驱动分组 + 组内手工序 + 归档/置顶标记
  const groups = groupSessions('h_1', result.items, result.registry)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].workspaceId, 'ws-a')
  assert.equal(groups[0].name, '项目 a')
  assert.deepEqual(
    groups[0].sessions.map((session) => session.rawId),
    ['s2', 's1'],
    '会话顺序应取 registry.sessionIds（手工序），不是最近活动',
  )
  assert.equal(groups[0].sessions[0].archived, true)
  assert.equal(groups[0].sessions[1].pinned, true)

  // 信封校验：mock 只接受 type=client-request 且 method 与路径一致
  assert.ok(mock.calls.api.length >= 1)
  assert.equal(
    mock.calls.api.some((call) => call.badEnvelope),
    false,
    '插件发出的信封不符合 dsh 契约',
  )
  // baseline 走独立的一次性 cookie（stream.js 的既定策略），所以首轮探活换两次
  assert.equal(mock.calls.connect, 2, '首轮探活：主 cookie + baseline 专用 cookie')
})

test('cookie 复用与 401 自愈：失效后只重换一次就恢复', async (t) => {
  const mock = await createMockHost()
  t.after(() => mock.close())

  const first = await probeHost(mock.host(), { timeoutMs: 3000 })
  assert.equal(first.cookieRefreshed, true)

  const beforeReuse = mock.calls.connect
  const reused = await probeHost(mock.host({ cookie: first.cookie }), { timeoutMs: 3000 })
  assert.equal(reused.ok, true)
  assert.equal(reused.cookieRefreshed, false, 'cookie 有效时不应重复换')
  assert.equal(mock.calls.connect - beforeReuse, 1, '复用轮只换 baseline 的专用 cookie')

  // cookie 到期：下一次 list 401 → 探活内部换 cookie 并重试一次
  mock.expireCookie()
  const beforeHeal = mock.calls.connect
  const healed = await probeHost(mock.host({ cookie: reused.cookie }), { timeoutMs: 3000 })
  assert.equal(healed.ok, true, healed.message)
  assert.equal(healed.cookieRefreshed, true, '401 后应换 cookie 并重试')
  assert.equal(mock.calls.connect - beforeHeal, 2, '自愈：重换主 cookie + baseline 专用 cookie')
})

test('分页契约：beforeSeq 排他上界 + turnWindow，能一路翻到最早', async (t) => {
  const mock = await createMockHost({ asOfSeq: 120 })
  t.after(() => mock.close())
  const host = await onlineHost(mock)

  const firstPage = await readRawPage(host, 's1', 50)
  assert.equal(firstPage.ok, true, firstPage.message)
  assert.equal(firstPage.hasMore, true)
  assert.equal(firstPage.firstSeq, 71, '首屏取「截至 throughSeq 的最新一页」')
  assert.equal(firstPage.records.length, 50)
  assert.equal(mock.calls.pages.at(-1).beforeSeq, undefined, '首屏不应带 beforeSeq')

  const secondPage = await readRawPage(host, 's1', 50, { beforeSeq: firstPage.firstSeq })
  assert.equal(secondPage.ok, true, secondPage.message)
  assert.equal(secondPage.firstSeq, 21)
  assert.equal(secondPage.records.length, 50)
  const request = mock.calls.pages.at(-1)
  assert.equal(request.beforeSeq, 71, 'beforeSeq 是排他上界')
  assert.deepEqual(request.turnWindow, { minMessages: 50, minTurns: 2 })
  assert.equal(request.address.sessionId, 's1')

  // 翻到 seq=1 之后 hasMore 变 false（客户端据此停掉「加载更早」）
  const tail = await readRawPage(host, 's1', 50, { beforeSeq: 21 })
  assert.equal(tail.firstSeq, 1)
  assert.equal(tail.hasMore, false)
})

test('baseline 失败不拖垮探活：registry 为 null，错误透到 registryError', async (t) => {
  const mock = await createMockHost({ baselineError: true })
  t.after(() => mock.close())

  const result = await probeHost(mock.host(), { timeoutMs: 3000 })
  assert.equal(result.ok, true, '归档集只是补充信息，不能影响在线判定')
  assert.equal(result.registry, null)
  assert.match(result.registryError, /incompatible/, result.registryError)
  // 页面与 session/list 仍然正常工作
  assert.equal(result.items.length, 2)
})

test('兼容探测：modelCatalog 缺失时探活成功但带 compatError', async (t) => {
  const bad = await createMockHost({ compatError: true })
  const good = await createMockHost()
  t.after(() => Promise.all([bad.close(), good.close()]))

  const badResult = await probeHost(bad.host(), { timeoutMs: 3000, checkCompat: true })
  assert.equal(badResult.ok, true)
  assert.match(badResult.compatError, /incompatible/, '端点缺失应标记不兼容')

  const goodResult = await probeHost(good.host(), { timeoutMs: 3000, checkCompat: true })
  assert.equal(goodResult.ok, true)
  assert.equal(goodResult.compatError, null)
})

test('错误分类：非 dsh / 403 / 未知端点 / 结构缺失', async (t) => {
  const notDsh = await createMockHost({ pageBody: '{"hello":1}', pageType: 'application/json' })
  const forbidden = await createMockHost({ rejectApi: true })
  const missingItems = await createMockHost({ listValue: {} })
  t.after(() => Promise.all([notDsh.close(), forbidden.close(), missingItems.close()]))

  const notDshResult = await probeHost(notDsh.host(), { timeoutMs: 3000 })
  assert.equal(notDshResult.ok, false)
  assert.equal(notDshResult.code, 'not-dsh')

  const forbiddenResult = await probeHost(forbidden.host(), { timeoutMs: 3000 })
  assert.equal(forbiddenResult.ok, false)
  assert.equal(forbiddenResult.code, 'incompatible', '403 说明是 dsh 但拒绝了 Host/Origin')

  const structResult = await probeHost(missingItems.host(), { timeoutMs: 3000 })
  assert.equal(structResult.ok, false)
  assert.equal(structResult.code, 'incompatible')

  // 未知/不存在的端点 → 404 → not-dsh（远端没有这条路由）
  const okMock = await createMockHost()
  t.after(() => okMock.close())
  const host = await onlineHost(okMock)
  const unknown = await callRemote(host, 'settings/replace', {})
  assert.equal(unknown.ok, false)
  assert.equal(unknown.code, 'not-dsh')

  // 403 直连（带一个假 cookie 绕过本地短路）也要归到 incompatible
  const blocked = await callRemote(
    { origin: forbidden.origin, token: forbidden.token, tls: {}, cookie: { header: 'dsh-auth-mock=fake' } },
    'session/list',
    {},
  )
  assert.equal(blocked.code, 'incompatible')

  const page = await probePage(notDsh.host(), { timeoutMs: 3000 })
  assert.equal(page.ok, false)
  assert.equal(page.code, 'not-dsh')
})

test('令牌无效：401 落到 auth-required，不误报网络错误', async (t) => {
  const mock = await createMockHost({ token: 'right-token' })
  t.after(() => mock.close())

  const result = await probeHost(mock.host({ token: 'wrong-token' }), { timeoutMs: 3000 })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'auth-required')
  assert.equal(result.status, 'auth-required')
})

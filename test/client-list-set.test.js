/**
 * 客户端 list.set 包装的纯函数测试。
 *
 * 官方 `ClientSessions.projectList()` 会写入 `phase` 与
 * `projectionsBySession`；包装层如果以旧 `real` 为基底，这两项会被旧值覆盖，
 * 本地会话的子代理/计划/todo 投影就永远停在旧值。这里锁住“以 next 为基底、
 * 只剥合成行”的行为。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

async function loadClientModule() {
  const previousWindow = globalThis.window
  const previousFlag = globalThis.__PEERBAR_TEST__
  const previousWarn = console.warn
  let definition = null

  globalThis.window = {
    __ModuleLoader__: {
      load(input) {
        definition = input
      },
    },
  }
  globalThis.__PEERBAR_TEST__ = true
  console.warn = () => {}

  try {
    await import(`../lib/client.js?test=${Date.now()}`)
    assert.ok(definition, 'client.js 没有调用 __ModuleLoader__.load')
    const fakeRequire = (name) => {
      if (name === 'react') {
        return {
          createElement() {},
          Fragment: {},
          useRef() {},
          useState() {},
          useCallback() {},
          useEffect() {},
        }
      }
      throw new Error(`unexpected require: ${name}`)
    }
    const exported = definition.factory(fakeRequire)
    assert.ok(exported.__peerbarTest, '测试环境没有暴露 __peerbarTest')
    return exported.__peerbarTest
  } finally {
    globalThis.window = previousWindow
    if (previousFlag === undefined) delete globalThis.__PEERBAR_TEST__
    else globalThis.__PEERBAR_TEST__ = previousFlag
    console.warn = previousWarn
  }
}

test('list.set 以 next 为基底：保留 phase 与本地 projectionsBySession', async () => {
  const { buildListSetPayload } = await loadClientModule()
  const next = {
    ids: ['local-1', 'peerbar:h_1:sess:remote'],
    byId: {
      'local-1': { id: 'local-1', displayTitle: '本地' },
      'peerbar:h_1:sess:remote': { id: 'peerbar:h_1:sess:remote', displayTitle: '远端' },
    },
    phase: 'ready',
    projectionsBySession: {
      'local-1': { values: { subagentCatalog: [{ id: 'child' }] }, state: 'idle', error: null },
      'peerbar:h_1:sess:remote': { values: { plan: { active: true } }, state: 'idle', error: null },
    },
  }
  const real = {
    ids: ['local-1'],
    byId: { 'local-1': { id: 'local-1', displayTitle: '旧标题' } },
    phase: 'pending',
    projectionsBySession: {
      'local-1': { values: { todo: [] }, state: 'idle', error: null },
    },
    extra: 'keep-me',
  }
  const synthetic = (id) => id.startsWith('peerbar:')

  const clean = buildListSetPayload(next, real, synthetic)

  assert.equal(clean.phase, 'ready', 'phase 必须来自 next')
  assert.equal(clean.extra, 'keep-me', 'next 没提供的字段沿用 real')
  assert.deepEqual(clean.ids, ['local-1'])
  assert.deepEqual(Object.keys(clean.byId), ['local-1'])
  assert.equal(clean.byId['local-1'].displayTitle, '本地')
  assert.deepEqual(Object.keys(clean.projectionsBySession), ['local-1'])
  assert.equal(clean.projectionsBySession['local-1'].values.subagentCatalog[0].id, 'child')
  assert.notEqual(clean.byId, next.byId, 'byId 需要纯化，不能直接共享引用')
})

test('next 缺 phase / projectionsBySession 时回退到 real，并同样剥掉合成行', async () => {
  const { buildListSetPayload } = await loadClientModule()
  const real = {
    ids: ['local-1'],
    byId: {},
    phase: 'pending',
    projectionsBySession: {
      'local-1': { values: { todo: ['a'] }, state: 'idle', error: null },
      'peerbar:h_1:sess:remote': { values: {}, state: 'idle', error: null },
    },
  }
  const clean = buildListSetPayload({ ids: [], byId: {} }, real, (id) => id.startsWith('peerbar:'))
  assert.equal(clean.phase, 'pending')
  assert.deepEqual(clean.ids, [])
  assert.deepEqual(Object.keys(clean.projectionsBySession), ['local-1'])
})

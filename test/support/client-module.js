/**
 * 在 Node 里加载浏览器半 bundle 的测试垫片。
 *
 * `lib/client.js` 顶层只做 `window.__ModuleLoader__.load({ factory })`；
 * 这里接住 factory，用最小 React stub 执行，取得 `__peerbarTest` 暴露的纯函数。
 * 不执行 apply()，所以不会装 DOM/WS/store 补丁。
 */
import assert from 'node:assert/strict'

// 多个测试文件会并行跑；它们都要临时改 globalThis.window/console。
// 用一条串行链保证同一时刻只有一个文件在执行 factory。
let loadChain = Promise.resolve()

export function loadClientModule() {
  const run = loadChain.then(loadOnce, loadOnce)
  loadChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function loadOnce() {
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
    await import(`../../lib/client.js?test=${Date.now()}-${Math.random()}`)
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

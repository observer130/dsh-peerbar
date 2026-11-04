/**
 * 控制/事件流的重连退避：健康连接断开从 3s 起，连续失败逐步放大并封顶。
 * 离线 Host 的“完全不重连”由 startControlBridge 里的 onlineHosts 守卫负责
 * （见 fix/p1-6 的代码路径），这里锁住时间序列。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { loadClientModule } from './support/client-module.js'

test('retryDelayFor: 3s 起，指数增长，30s 封顶', async () => {
  const { retryDelayFor } = await loadClientModule()
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 100].map((n) => retryDelayFor(n)),
    [3000, 6000, 12000, 24000, 30000, 30000, 30000],
  )
  assert.equal(retryDelayFor(0), 3000, '非法次数按第一次处理')
  assert.equal(retryDelayFor(undefined), 3000)
})

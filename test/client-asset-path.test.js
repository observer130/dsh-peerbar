/**
 * 远端 multipart 附件 path 不能沿原型链写值。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { loadClientModule } from './support/client-module.js'

const B64 = Buffer.from('abc').toString('base64')

test('applyBytesAtPath: 正常 path 写回 Uint8Array', async () => {
  const { applyBytesAtPath } = await loadClientModule()
  const target = { nested: { data: null } }
  applyBytesAtPath(target, ['nested', 'data'], B64)
  assert.deepEqual([...target.nested.data], [97, 98, 99])
})

test('applyBytesAtPath: __proto__ / constructor / 不存在的自有属性都拒绝', async () => {
  const { applyBytesAtPath } = await loadClientModule()
  const target = { data: null }
  applyBytesAtPath(target, ['__proto__', 'polluted'], B64)
  applyBytesAtPath(target, ['constructor', 'polluted'], B64)
  applyBytesAtPath(target, ['missing', 'polluted'], B64)
  assert.equal({}.polluted, undefined)
  assert.equal(Object.prototype.polluted, undefined)
  assert.equal(target.data, null, '不存在的路径不能新建字段')
})

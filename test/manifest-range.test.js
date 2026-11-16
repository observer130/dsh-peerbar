import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const read = (name) => readFileSync(new URL(name, root), 'utf8')
const pkg = JSON.parse(read('package.json'))
const range = pkg.engines?.dsh

/**
 * 宿主兼容性只声明这一处，且必须是范围：钉死版本会让每次 dsh 升级都要改清单和文档。
 */
test('engines.dsh 是范围而非钉死的版本', () => {
  assert.equal(typeof range, 'string', 'engines.dsh 必须声明')
  assert.match(range, /[\^~*]|>=|<=|<|>|\bx\b/, `engines.dsh 必须是 SemVer 范围：${range}`)
})

/**
 * 文档引用同一个范围，避免又抄一份会随宿主升级过期的版本号。
 */
test('文档引用同一个 dsh 范围', () => {
  for (const file of ['README.md', 'AGENTS.md', 'docs/插件开发规范.md']) {
    assert.ok(read(file).includes(range), `${file} 没有引用 engines.dsh 的 ${range}`)
  }
})

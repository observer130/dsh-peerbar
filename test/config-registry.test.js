/**
 * 损坏的注册表不能静默当成空表再被下一次写入覆盖。
 */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { readRegistry, registryPath } from '../lib/config.js'

test('readRegistry: 坏 JSON 先备份，再返回空表并标记 corrupt', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'peerbar-config-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    await fs.writeFile(registryPath(), '{"hosts":[', 'utf8')
    const registry = await readRegistry()
    assert.equal(registry.corrupt, true)
    assert.deepEqual(registry.hosts, [])
    assert.ok(registry.corruptBackup, '应返回备份路径')
    const names = await fs.readdir(dir)
    assert.ok(names.some((name) => name.startsWith('dsh-peerbar.json.corrupt-')), `没有生成备份：${names.join(',')}`)
    const backup = await fs.readFile(registry.corruptBackup, 'utf8')
    assert.equal(backup, '{"hosts":[')
    await assert.rejects(fs.readFile(registryPath(), 'utf8'), /ENOENT/, '坏文件应已移走')
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readRegistry: 文件不存在时不标记 corrupt', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'peerbar-config-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    const registry = await readRegistry()
    assert.equal(registry.corrupt, undefined)
    assert.deepEqual(registry.hosts, [])
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await fs.rm(dir, { recursive: true, force: true })
  }
})

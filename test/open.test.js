import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import {
  buildVscodeUri,
  isPathInWorkspaces,
  normalizeRemotePath,
  openCommandFor,
  openUri,
  openVscode,
  resolveSshTarget,
  scrubOpenEnv,
} from '../lib/open.js'
import { CODE } from '../lib/codes.js'

/** 记录 spawn 入参，并按脚本异步发 error / exit 的假 child。 */
function fakeSpawn(record, behavior = {}) {
  return (command, args, options) => {
    record.push({ command, args, options })
    const child = new EventEmitter()
    child.unref = () => {
      record.unrefed = true
    }
    queueMicrotask(() => {
      if (behavior.error) child.emit('error', behavior.error)
      else if (behavior.exitCode !== undefined) child.emit('exit', behavior.exitCode, behavior.signal ?? null)
    })
    return child
  }
}

test('resolveSshTarget: 主机名优先，非法时退回 origin 主机名', () => {
  assert.equal(resolveSshTarget({ name: 'nv50', origin: 'https://192.168.3.50:3080' }), 'nv50')
  assert.equal(resolveSshTarget({ name: 'user@nv50', origin: 'https://192.168.3.50:3080' }), 'user@nv50')
  assert.equal(resolveSshTarget({ name: 'a@b@c', origin: 'https://192.168.3.50:3080' }), '192.168.3.50')
  assert.equal(resolveSshTarget({ name: 'nv50@', origin: 'https://192.168.3.50:3080' }), '192.168.3.50')
  assert.equal(resolveSshTarget({ name: '办公室 nv50', origin: 'https://192.168.3.50:3080' }), '192.168.3.50')
  assert.equal(resolveSshTarget({ name: '-oProxyCommand=calc', origin: 'https://10.0.0.5:3080' }), '10.0.0.5')
  assert.equal(resolveSshTarget({ name: '', origin: 'not a url' }), null)
  assert.equal(resolveSshTarget({ name: '主机:2222', origin: 'https://[::1]:3080' }), null)
})

test('normalizeRemotePath: 只接受规范的远端绝对 POSIX 路径', () => {
  assert.equal(normalizeRemotePath('/home/nwj/meeting_eval'), '/home/nwj/meeting_eval')
  assert.equal(normalizeRemotePath('/home/nwj/meeting_eval/'), '/home/nwj/meeting_eval')
  assert.equal(normalizeRemotePath('/'), '/')
  assert.equal(normalizeRemotePath(' /home/nwj '), '/home/nwj')
  for (const bad of ['', 'relative/path', '/home/../etc', '/home//nwj', '/home/./nwj', '/home/\\nwj', '/home/\u0000x', '/a\\b']) {
    assert.equal(normalizeRemotePath(bad), null, bad)
  }
})

test('buildVscodeUri: 逐段编码，保留路径分隔符', () => {
  assert.equal(
    buildVscodeUri('nv50', '/home/nwj/meeting_eval'),
    'vscode://vscode-remote/ssh-remote+nv50/home/nwj/meeting_eval',
  )
  assert.equal(
    buildVscodeUri('user@nv50', '/home/nwj/my project#1'),
    'vscode://vscode-remote/ssh-remote+user@nv50/home/nwj/my%20project%231',
  )
  assert.equal(
    buildVscodeUri('nv50', '/home/中文/项目'),
    'vscode://vscode-remote/ssh-remote+nv50/home/%E4%B8%AD%E6%96%87/%E9%A1%B9%E7%9B%AE',
  )
  assert.equal(buildVscodeUri('-bad', '/home/nwj'), null)
  assert.equal(buildVscodeUri('nv50', '/home/../etc'), null)
})

test('isPathInWorkspaces: 根、子目录通过，前缀碰撞与非规范路径拒绝', () => {
  const roots = ['/home/nwj/meeting_eval', '/srv/repo/']
  assert.equal(isPathInWorkspaces('/home/nwj/meeting_eval', roots), true)
  assert.equal(isPathInWorkspaces('/home/nwj/meeting_eval/sub', roots), true)
  assert.equal(isPathInWorkspaces('/srv/repo', roots), true)
  assert.equal(isPathInWorkspaces('/home/nwj/meeting_evaluation', roots), false)
  assert.equal(isPathInWorkspaces('/home/nwj/meeting_eval/../other', roots), false)
  assert.equal(isPathInWorkspaces('/home/nwj/meeting_eval', ['/']), true)
})

test('scrubOpenEnv: 保留桌面环境，去掉 harness/Electron 标记', () => {
  const env = scrubOpenEnv({
    PATH: '/usr/bin',
    DISPLAY: ':0',
    SSH_AUTH_SOCK: '/run/ssh.sock',
    DSH_TOKEN: 'secret',
    ELECTRON_RUN_AS_NODE: '1',
    NODE_OPTIONS: '--inspect',
    EMPTY: undefined,
  })
  assert.deepEqual(env, { PATH: '/usr/bin', DISPLAY: ':0', SSH_AUTH_SOCK: '/run/ssh.sock' })
})

test('openCommandFor: 三平台打开器，只接受 vscode://', () => {
  assert.deepEqual(openCommandFor('linux', 'vscode://x'), { command: 'xdg-open', args: ['vscode://x'] })
  assert.deepEqual(openCommandFor('darwin', 'vscode://x'), { command: 'open', args: ['vscode://x'] })
  assert.deepEqual(openCommandFor('win32', 'vscode://x'), {
    command: 'rundll32.exe',
    args: ['url.dll,FileProtocolHandler', 'vscode://x'],
  })
  assert.equal(openCommandFor('linux', 'https://evil'), null)
  assert.equal(openCommandFor('freebsd', 'vscode://x'), null)
})

test('openUri: 启动成功、非零退出、找不到打开器', async () => {
  {
    const record = []
    const result = await openUri('vscode://vscode-remote/ssh-remote+nv50/home/nwj', {
      platform: 'linux',
      watchMs: 50,
      spawnImpl: fakeSpawn(record, { exitCode: 0 }),
      env: { PATH: '/usr/bin', DSH_TOKEN: 'secret' },
    })
    assert.deepEqual(result, { ok: true })
    assert.equal(record.length, 1)
    assert.equal(record[0].command, 'xdg-open')
    assert.deepEqual(record[0].args, ['vscode://vscode-remote/ssh-remote+nv50/home/nwj'])
    assert.equal(record[0].options.detached, true)
    assert.equal(record[0].options.env.DSH_TOKEN, undefined)
    assert.equal(record.unrefed, true)
  }
  {
    const record = []
    const result = await openUri('vscode://x', {
      platform: 'linux',
      watchMs: 50,
      spawnImpl: fakeSpawn(record, { exitCode: 3 }),
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, CODE.OPEN_FAILED)
  }
  {
    const record = []
    const error = Object.assign(new Error('spawn xdg-open ENOENT'), { code: 'ENOENT' })
    const result = await openUri('vscode://x', {
      platform: 'linux',
      watchMs: 50,
      spawnImpl: fakeSpawn(record, { error }),
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, CODE.OPEN_NO_HANDLER)
  }
  {
    const result = await openUri('vscode://x', {
      platform: 'linux',
      watchMs: 10,
      spawnImpl: fakeSpawn([]),
    })
    assert.deepEqual(result, { ok: true })
  }
})

test('openVscode: 目标/路径校验通过后交给 OS，返回 URI', async () => {
  const record = []
  const result = await openVscode({
    host: { name: 'nv50', origin: 'https://192.168.3.50:3080' },
    path: '/home/nwj/meeting_eval',
    platform: 'linux',
    watchMs: 50,
    spawnImpl: fakeSpawn(record, { exitCode: 0 }),
  })
  assert.equal(result.ok, true)
  assert.equal(result.uri, 'vscode://vscode-remote/ssh-remote+nv50/home/nwj/meeting_eval')
  assert.deepEqual(record[0].args, [result.uri])
})

test('openVscode: 无目标 / 非法路径不启动进程', async () => {
  const record = []
  const spawnImpl = fakeSpawn(record, { exitCode: 0 })
  const noTarget = await openVscode({ host: { name: '办公室', origin: 'nope' }, path: '/home/nwj', spawnImpl })
  assert.equal(noTarget.ok, false)
  assert.equal(noTarget.code, CODE.OPEN_NO_TARGET)
  const badPath = await openVscode({ host: { name: 'nv50' }, path: 'relative', spawnImpl })
  assert.equal(badPath.ok, false)
  assert.equal(badPath.code, CODE.OPEN_BAD_PATH)
  assert.equal(record.length, 0)
})

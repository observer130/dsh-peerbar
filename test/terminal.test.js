import assert from 'node:assert/strict'
import { test } from 'node:test'

import { TERMINAL_STREAMS, createTerminalUpgrade, terminalRemoteArgs } from '../lib/terminal.js'
import { decodeFrames, encodeServerFrame, encodeServerText } from '../lib/stream.js'

test('终端代理只放行 attach / retain 两个流端点', () => {
  assert.deepEqual([...TERMINAL_STREAMS].sort(), ['terminal/attach', 'terminal/retain'])
  assert.equal(TERMINAL_STREAMS.has('terminal/close'), false)
  assert.equal(TERMINAL_STREAMS.has('workspaceFiles/changes'), false)
})

test('会话 ID 换成远端裸 ID，attach 用 agentId、retain 用 sessionId', () => {
  assert.deepEqual(terminalRemoteArgs('terminal/attach', 'raw-session', 'term-1'), {
    agentId: 'raw-session',
    id: 'term-1',
  })
  assert.deepEqual(terminalRemoteArgs('terminal/retain', 'raw-session', 'term-1'), {
    sessionId: 'raw-session',
    id: 'term-1',
  })
})

test('服务端帧不加掩码，且能被 decodeFrames 原样拆回', () => {
  const text = encodeServerText('{"type":"item"}')
  // 第二字节最高位为 0：服务端帧不得带掩码（浏览器会直接断连）
  assert.equal(text[1] & 0x80, 0, '服务端帧不能加掩码')
  const { frames, rest } = decodeFrames(text)
  assert.equal(rest.length, 0)
  assert.equal(frames.length, 1)
  assert.equal(frames[0].opcode, 0x1)
  assert.equal(frames[0].payload.toString('utf8'), '{"type":"item"}')
})

test('服务端帧覆盖 126 / 127 两种长度编码', () => {
  for (const size of [125, 126, 65535, 65536]) {
    const payload = Buffer.alloc(size, 0x61)
    const frame = encodeServerFrame(0x2, payload)
    assert.equal(frame[1] & 0x80, 0)
    const { frames } = decodeFrames(frame)
    assert.equal(frames.length, 1)
    assert.equal(frames[0].opcode, 0x2)
    assert.equal(frames[0].payload.length, size)
  }
})

test('upgrade 先跑 guard：非回环地址直接拒，不返回 101', async () => {
  const handler = createTerminalUpgrade({ getHost: () => null }, {})
  const chunks = []
  let destroyed = false
  const socket = {
    write(text) {
      chunks.push(String(text))
    },
    destroy() {
      destroyed = true
    },
  }
  await handler(
    {
      method: 'GET',
      headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-websocket-key': 'x' },
      socket: { remoteAddress: '10.0.0.9' },
    },
    socket,
    Buffer.alloc(0),
  )
  assert.equal(destroyed, true)
  assert.ok(chunks.join('').startsWith('HTTP/1.1 403'), chunks.join(''))
  assert.equal(chunks.join('').includes('101 Switching Protocols'), false)
})

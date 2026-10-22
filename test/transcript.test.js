import test from 'node:test'
import assert from 'node:assert/strict'

import { clampLimit, oldestSeq, readTranscriptFrom, toTranscript } from '../lib/transcript.js'

const userEvent = (text, seq = 1) => ({
  type: 'event',
  event: { type: 'user/message', seq, time: 1000 + seq, data: { role: 'user', content: [{ type: 'text', text }] } },
})

const assistantEvent = (content, seq = 2) => ({
  type: 'event',
  event: {
    type: 'assistant/message',
    seq,
    time: 1000 + seq,
    data: { role: 'assistant', message: { role: 'assistant', content } },
  },
})

test('user 与 assistant 的文本按 seq 保留', () => {
  const messages = toTranscript([
    userEvent('你好', 1),
    assistantEvent([{ type: 'text', text: '你好，有什么可以帮你的' }], 2),
  ])
  assert.equal(messages.length, 2)
  assert.deepEqual(
    messages.map((m) => [m.role, m.text]),
    [
      ['user', '你好'],
      ['assistant', '你好，有什么可以帮你的'],
    ],
  )
})

test('纯 reasoning 的 assistant 事件被丢掉', () => {
  const messages = toTranscript([assistantEvent([{ type: 'reasoning', text: '想一想' }])])
  assert.equal(messages.length, 0)
})

test('只有工具调用的 assistant 事件保留工具名', () => {
  const messages = toTranscript([assistantEvent([{ type: 'tool-call', name: 'bash' }, { type: 'tool-call', toolName: 'read_file' }])])
  assert.equal(messages.length, 1)
  assert.equal(messages[0].text, '')
  assert.deepEqual(messages[0].tools, ['bash', 'read_file'])
})

test('非 message 事件（tool/result、step/start）不进正文', () => {
  const messages = toTranscript([
    { type: 'event', event: { type: 'tool/call', seq: 3, time: 1, data: { name: 'bash' } } },
    { type: 'event', event: { type: 'tool/result', seq: 4, time: 2, data: { message: { role: 'tool', content: [{ type: 'text', text: 'x' }] } } } },
    { type: 'event', event: { type: 'step/start', seq: 5, time: 3, data: {} } },
  ])
  assert.equal(messages.length, 0)
})

test('超长文本按 textLimit 截断并标注原长', () => {
  const messages = toTranscript([userEvent('a'.repeat(50))], { textLimit: 10 })
  assert.ok(messages[0].text.startsWith('aaaaaaaaaa'))
  assert.match(messages[0].text, /已截断，共 50 字/)
})

test('坏数据不炸', () => {
  assert.deepEqual(toTranscript(null), [])
  assert.deepEqual(toTranscript([null, 1, 'x', {}]), [])
})

test('clampLimit 收口到 1..50，非法值用默认', () => {
  assert.equal(clampLimit(10), 10)
  assert.equal(clampLimit(0), 20)
  assert.equal(clampLimit('abc'), 20)
  assert.equal(clampLimit(999), 50)
  assert.equal(clampLimit(-5), 20)
})

test('readTranscriptFrom 把 signal 传给 controller（少传会炸）', async () => {
  const seen = []
  const controller = {
    async projections(request, signal) {
      seen.push(['projections', typeof signal, signal !== undefined])
      signal.throwIfAborted()
      assert.deepEqual(request, { sessionId: 's1' })
      return { asOfSeq: 7 }
    },
    async page(request, signal) {
      seen.push(['page', typeof signal])
      signal.throwIfAborted()
      assert.equal(request.throughSeq, 7)
      assert.equal(request.maxMessages, 5)
      assert.deepEqual(request.address, { kind: 'session', sessionId: 's1' })
      return { records: [userEvent('hi', 1)], hasMore: false }
    },
  }
  const result = await readTranscriptFrom(controller, 's1', 5)
  assert.deepEqual(seen, [
    ['projections', 'object', true],
    ['page', 'object'],
  ])
  assert.equal(result.messages.length, 1)
  assert.equal(result.messages[0].text, 'hi')
  assert.equal(result.hasMore, false)
  assert.equal(result.nextBeforeSeq, 1)
})

test('oldestSeq 取最小 seq，忽略坏记录', () => {
  assert.equal(oldestSeq([{ event: { seq: 9 } }, { event: { seq: 3 } }, { event: {} }, null]), 3)
  assert.equal(oldestSeq([]), null)
  assert.equal(oldestSeq(null), null)
})

test('readTranscriptFrom 把 beforeSeq 透传（翻页游标）', async () => {
  let seenRequest = null
  const controller = {
    async projections() {
      return { asOfSeq: 100 }
    },
    async page(request) {
      seenRequest = request
      return { records: [{ event: { type: 'user/message', seq: 40, data: { content: [{ type: 'text', text: '老消息' }] } } }], hasMore: true }
    },
  }
  const result = await readTranscriptFrom(controller, 's1', 10, { beforeSeq: 55 })
  assert.equal(seenRequest.beforeSeq, 55)
  assert.equal(seenRequest.throughSeq, 100)
  assert.equal(result.nextBeforeSeq, 40)
  assert.equal(result.hasMore, true)
})

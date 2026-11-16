/**
 * 排队回显的退役依据：`inbox` 投影里被队列接管的 requestId。
 *
 * 远端队列行（QueueDock 的持久行）带 `source.rpcId`，就是发送时用的
 * requestId。合成 SessionBinding 必须从同一份投影认出「回显已被接受」，
 * 否则排队项被删除后回显会永远停在「发送中…」。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { loadClientModule } from './support/client-module.js'

test('从两个 inbox target 收集用户队列行的 requestId', async () => {
  const { admittedQueueRequestIds } = await loadClientModule()
  const ids = admittedQueueRequestIds({
    inbox: {
      'next-turn': [
        { source: { kind: 'user', rpcId: 'r1' }, content: [] },
        { source: { kind: 'tool-jobs', form: 'notice' }, content: [] },
      ],
      'next-step': [
        { source: { kind: 'user', rpcId: 'r2' }, content: [] },
      ],
    },
  })
  assert.deepEqual([...ids].sort(), ['r1', 'r2'])
})

test('忽略缺 rpcId 的行与缺失/非对象 inbox', async () => {
  const { admittedQueueRequestIds } = await loadClientModule()
  assert.equal(admittedQueueRequestIds(undefined).size, 0)
  assert.equal(admittedQueueRequestIds({}).size, 0)
  const ids = admittedQueueRequestIds({
    inbox: {
      'next-turn': [
        { source: { kind: 'user' } },
        { source: { kind: 'user', rpcId: '' } },
        { source: { kind: 'system', rpcId: 'not-user' } },
        null,
      ],
    },
  })
  assert.equal(ids.size, 0)
})

test('inbox 出现同一 requestId 后，排队回显延迟一帧退役', async () => {
  const { createRemoteBinding } = await loadClientModule()
  const retirements = []
  const binding = createRemoteBinding({
    ctx: { extend: (options) => ({ ...options }), get: () => null },
    hostId: 'h_test',
    hostName: 'test',
    sessionId: 's_test',
    records: [],
    summary: { running: true, blank: false },
    values: { inbox: { 'next-turn': [], 'next-step': [] } },
    hasMore: false,
  })
  try {
    const submission = binding.session.beginSubmission({
      mode: 'queue',
      text: '排队中',
      attachments: [],
      onRetire: (retirement) => retirements.push(retirement),
    })
    const requestId = submission.requestId
    const before = binding.session.getSnapshot().pendingSubmissions
    assert.equal(before.length, 1)
    assert.equal(before[0].placement, 'queued')

    // 远端队列行到达：官方 QueueDock 用这一行替换本地回显
    binding.hydrate({
      records: [],
      values: {
        inbox: {
          'next-turn': [{ content: [{ type: 'text', text: '排队中' }], source: { kind: 'user', rpcId: requestId } }],
          'next-step': [],
        },
      },
    })
    // 退役排在一帧之后，给 QueueDock 先渲染持久行的机会
    assert.equal(binding.session.getSnapshot().pendingSubmissions.length, 1)
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(binding.session.getSnapshot().pendingSubmissions.length, 0)
    assert.equal(retirements.length, 1)
    assert.equal(retirements[0].reason, 'observed')
  } finally {
    binding.dispose()
  }
})

test('空闲会话的 transcript 回显不能只凭 inbox 退役', async () => {
  const { createRemoteBinding } = await loadClientModule()
  const binding = createRemoteBinding({
    ctx: { extend: (options) => ({ ...options }), get: () => null },
    hostId: 'h_test',
    hostName: 'test',
    sessionId: 's_test',
    records: [],
    summary: { running: false, blank: false },
    values: { inbox: { 'next-turn': [], 'next-step': [] } },
    hasMore: false,
  })
  try {
    const submission = binding.session.beginSubmission({ mode: 'queue', text: '立即发送', attachments: [] })
    const before = binding.session.getSnapshot().pendingSubmissions
    assert.equal(before[0].placement, 'transcript')

    binding.hydrate({
      records: [],
      values: {
        inbox: {
          'next-turn': [{ source: { kind: 'user', rpcId: submission.requestId } }],
          'next-step': [],
        },
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    // transcript 回显要等 user/message 入档，不能在 inbox 过渡态就消失
    assert.equal(binding.session.getSnapshot().pendingSubmissions.length, 1)
  } finally {
    binding.dispose()
  }
})


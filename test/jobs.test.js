import test from 'node:test'
import assert from 'node:assert/strict'

import { buildJobsRequest } from '../lib/jobs.js'

/**
 * 后台任务桥只放行两个只读流端点：名册（`job/list`）与单个任务的观察
 * （`job/follow`）。端点不在白名单、或必填 id 缺失时必须拒绝——否则就等于
 * 给远端开了一个任意流端点代理。
 */

test('job/list：只认 sessionId', () => {
  assert.deepEqual(buildJobsRequest(new URLSearchParams('endpoint=job/list&sessionId=session-a')), {
    endpoint: 'job/list',
    payload: { request: { sessionId: 'session-a' } },
  })
})

test('job/list：缺 sessionId 拒绝', () => {
  assert.equal(buildJobsRequest(new URLSearchParams('endpoint=job/list')), null)
  assert.equal(buildJobsRequest(new URLSearchParams('endpoint=job/list&sessionId=')), null)
})

test('job/follow：jobId 必填，sessionId 与 from 可选', () => {
  assert.deepEqual(buildJobsRequest(new URLSearchParams('endpoint=job/follow&jobId=job-1')), {
    endpoint: 'job/follow',
    payload: { request: { jobId: 'job-1' } },
  })
  assert.deepEqual(
    buildJobsRequest(new URLSearchParams('endpoint=job/follow&jobId=job-1&sessionId=session-a&from=42')),
    { endpoint: 'job/follow', payload: { request: { jobId: 'job-1', sessionId: 'session-a', from: 42 } } },
  )
  assert.equal(buildJobsRequest(new URLSearchParams('endpoint=job/follow')), null)
})

test('白名单外的端点一律拒绝', () => {
  for (const endpoint of ['', 'job/kill', 'job/observe', 'session/control', 'job/list2']) {
    const params = new URLSearchParams({ endpoint, sessionId: 'session-a', jobId: 'job-1' })
    assert.equal(buildJobsRequest(params), null, `${endpoint} 不应放行`)
  }
})

test('id 只接受可见 ASCII，防止把奇怪内容拼进 args', () => {
  assert.equal(buildJobsRequest(new URLSearchParams('endpoint=job/list&sessionId=%3Cscript%3E')), null)
  assert.equal(buildJobsRequest(new URLSearchParams('endpoint=job/follow&jobId=a%20b')), null)
  const long = 'x'.repeat(201)
  assert.equal(buildJobsRequest(new URLSearchParams(`endpoint=job/list&sessionId=${long}`)), null)
})

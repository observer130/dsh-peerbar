import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseMultipart } from '../lib/remote.js'

/**
 * 造一个网关形状的 multipart：metadata（JSON）+ bytes-N（二进制）。
 * @param {string} boundary boundary 值。
 * @param {object} metadata metadata 对象。
 * @param {Buffer[]} chunks 字节分片。
 * @returns {Buffer} 完整响应体。
 */
function build(boundary, metadata, chunks) {
  const pieces = []
  chunks.forEach((chunk, index) => {
    pieces.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="bytes-${index}"; filename="blob"\r\nContent-Type: application/octet-stream\r\n\r\n`))
    pieces.push(chunk)
    pieces.push(Buffer.from('\r\n'))
  })
  pieces.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n`))
  pieces.push(Buffer.from(JSON.stringify(metadata)))
  pieces.push(Buffer.from(`\r\n--${boundary}--\r\n`))
  return Buffer.concat(pieces)
}

test('parseMultipart 按 boundary 切出 metadata 与二进制 part', () => {
  const boundary = '----formdata-undici-007358727917'
  const bytes = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x0d, 0x0a])
  const body = build(boundary, { type: 'server-response', result: { ok: true } }, [bytes])
  const parts = parseMultipart(body, boundary)
  assert.deepEqual(parts.map((part) => part.name), ['bytes-0', 'metadata'])
  assert.deepEqual(parts[0].body, bytes)
  assert.equal(JSON.parse(parts[1].body.toString('utf8')).type, 'server-response')
})

test('parseMultipart 不把结束标记当成 part，空输入返回空数组', () => {
  const boundary = 'b'
  assert.deepEqual(parseMultipart(Buffer.alloc(0), boundary), [])
  assert.deepEqual(parseMultipart(Buffer.from('not multipart'), boundary), [])
  const body = build(boundary, { ok: true }, [Buffer.from('x')])
  assert.equal(parseMultipart(body, boundary).length, 2)
})

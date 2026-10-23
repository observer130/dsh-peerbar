import test from 'node:test'
import assert from 'node:assert/strict'

import { decodeFrames, encodeFrame, encodeTextFrame } from '../lib/stream.js'

const MASK = Buffer.from([0x01, 0x02, 0x03, 0x04])

/** 拼一帧服务端帧（不加掩码），用来模拟宿主下行。 */
function serverFrame(opcode, payload, { fin = true } = {}) {
  const body = Buffer.from(payload)
  const length = body.length
  let header
  if (length < 126) {
    header = Buffer.alloc(2)
    header[1] = length
  } else if (length < 65536) {
    header = Buffer.alloc(4)
    header[1] = 126
    header.writeUInt16BE(length, 2)
  } else {
    header = Buffer.alloc(10)
    header[1] = 127
    header.writeBigUInt64BE(BigInt(length), 2)
  }
  header[0] = (fin ? 0x80 : 0) | (opcode & 0x0f)
  return Buffer.concat([header, body])
}

test('encodeTextFrame 带掩码，decodeFrames 能原样读回', () => {
  const frame = encodeTextFrame('{"type":"open"}', MASK)
  assert.equal(frame[0], 0x81)
  assert.equal(frame[1] & 0x80, 0x80, '客户端帧必须置掩码位')
  assert.deepEqual(frame.subarray(2, 6), MASK)
  const { frames, rest } = decodeFrames(frame)
  assert.equal(rest.length, 0)
  assert.equal(frames.length, 1)
  assert.equal(frames[0].opcode, 0x1)
  assert.equal(frames[0].fin, true)
  assert.equal(frames[0].payload.toString('utf8'), '{"type":"open"}')
})

test('delegate 长度边界：125 / 126 / 65535 / 65536 都能往返', () => {
  for (const size of [0, 1, 125, 126, 65535, 65536]) {
    const text = 'x'.repeat(size)
    const { frames, rest } = decodeFrames(encodeTextFrame(text, MASK))
    assert.equal(rest.length, 0)
    assert.equal(frames.length, 1, `size=${size}`)
    assert.equal(frames[0].payload.length, size, `size=${size}`)
  }
})

test('服务端帧不带掩码也能解，ping 单独识别', () => {
  const data = Buffer.concat([serverFrame(0x1, 'hi'), serverFrame(0x9, 'ping')])
  const { frames } = decodeFrames(data)
  assert.deepEqual(
    frames.map((frame) => [frame.opcode, frame.payload.toString('utf8')]),
    [
      [0x1, 'hi'],
      [0x9, 'ping'],
    ],
  )
})

test('分片到达：不完整的尾帧留在 rest 里', () => {
  const frame = serverFrame(0x1, 'baseline-frame')
  const first = decodeFrames(frame.subarray(0, 5))
  assert.equal(first.frames.length, 0)
  assert.equal(first.rest.length, 5)
  const second = decodeFrames(Buffer.concat([first.rest, frame.subarray(5)]))
  assert.equal(second.frames.length, 1)
  assert.equal(second.frames[0].payload.toString('utf8'), 'baseline-frame')
  assert.equal(second.rest.length, 0)
})

test('超长帧直接抛错，不无限缓冲', () => {
  const header = Buffer.alloc(10)
  header[0] = 0x81
  header[1] = 127
  header.writeBigUInt64BE(BigInt(64 * 1024 * 1024), 2)
  assert.throws(() => decodeFrames(header), /帧过大/)
})

test('encodeFrame 的 opcode 与 FIN 位正确', () => {
  const frame = encodeFrame(0x8, Buffer.alloc(0), MASK)
  assert.equal(frame[0], 0x88)
  assert.equal(frame[1], 0x80)
})

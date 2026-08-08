import test from 'node:test'
import assert from 'node:assert/strict'
import {
  base64ToBytes,
  bytesToBase64,
  crc24q,
  isValidRtcm3Frame,
  Rtcm3StreamParser,
} from '../src/services/rtcm3.js'

function makeFrame(payload) {
  const body = new Uint8Array(3 + payload.length)
  body[0] = 0xD3
  body[1] = (payload.length >> 8) & 0x03
  body[2] = payload.length & 0xFF
  body.set(payload, 3)
  const crc = crc24q(body)
  const frame = new Uint8Array(body.length + 3)
  frame.set(body)
  frame.set([(crc >> 16) & 0xFF, (crc >> 8) & 0xFF, crc & 0xFF], body.length)
  return frame
}

test('RTCM parser reassembles split chunks and multiple frames', () => {
  const first = makeFrame(Uint8Array.from([0x43, 0x20, 1, 2, 3]))
  const second = makeFrame(Uint8Array.from([0x44, 0x10, 4, 5]))
  const parser = new Rtcm3StreamParser()
  assert.deepEqual(parser.feed(first.slice(0, 4)), [])
  const combined = new Uint8Array(first.length - 4 + second.length)
  combined.set(first.slice(4))
  combined.set(second, first.length - 4)
  assert.deepEqual(parser.feed(combined), [first, second])
  assert.equal(parser.validFrames, 2)
})

test('RTCM parser skips noise and a corrupted frame', () => {
  const bad = makeFrame(Uint8Array.from([1, 2, 3]))
  bad[4] ^= 0x01
  const good = makeFrame(Uint8Array.from([4, 5, 6]))
  const input = new Uint8Array(2 + bad.length + good.length)
  input.set([0, 1])
  input.set(bad, 2)
  input.set(good, 2 + bad.length)
  const parser = new Rtcm3StreamParser()
  assert.deepEqual(parser.feed(input), [good])
  assert.equal(parser.invalidFrames, 1)
  assert.equal(isValidRtcm3Frame(good), true)
})

test('RTCM base64 conversion is lossless', () => {
  const frame = makeFrame(Uint8Array.from({length: 200}, (_, index) => index & 0xFF))
  assert.deepEqual(base64ToBytes(bytesToBase64(frame)), frame)
})


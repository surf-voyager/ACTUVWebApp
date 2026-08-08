const RTCM3_PREAMBLE = 0xD3
const RTCM3_MAX_PAYLOAD = 1023
const RTCM3_MAX_FRAME = RTCM3_MAX_PAYLOAD + 6
const DEFAULT_MAX_BUFFER = 128 * 1024

export function crc24q(data) {
  let crc = 0
  for (const byte of data) {
    crc ^= byte << 16
    for (let bit = 0; bit < 8; bit += 1) {
      crc <<= 1
      if (crc & 0x1000000) crc ^= 0x1864CFB
    }
  }
  return crc & 0xFFFFFF
}

export function isValidRtcm3Frame(frame) {
  if (!(frame instanceof Uint8Array) || frame.length < 6 || frame[0] !== RTCM3_PREAMBLE) return false
  const payloadLength = ((frame[1] & 0x03) << 8) | frame[2]
  if (frame.length !== payloadLength + 6) return false
  const expected = (frame[frame.length - 3] << 16) | (frame[frame.length - 2] << 8) | frame[frame.length - 1]
  return crc24q(frame.subarray(0, frame.length - 3)) === expected
}

export function bytesToBase64(bytes) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export function base64ToBytes(encoded) {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function concatenate(left, right) {
  const combined = new Uint8Array(left.length + right.length)
  combined.set(left)
  combined.set(right, left.length)
  return combined
}

export class Rtcm3StreamParser {
  constructor({ maxBufferBytes = DEFAULT_MAX_BUFFER } = {}) {
    this.maxBufferBytes = maxBufferBytes
    this.buffer = new Uint8Array(0)
    this.validFrames = 0
    this.invalidFrames = 0
    this.discardedBytes = 0
  }

  reset() {
    this.buffer = new Uint8Array(0)
  }

  feed(chunk) {
    if (!(chunk instanceof Uint8Array) || chunk.length === 0) return []
    this.buffer = concatenate(this.buffer, chunk)
    if (this.buffer.length > this.maxBufferBytes) {
      this.discardedBytes += this.buffer.length
      this.buffer = new Uint8Array(0)
      return []
    }

    const frames = []
    while (this.buffer.length) {
      const preamble = this.buffer.indexOf(RTCM3_PREAMBLE)
      if (preamble < 0) {
        this.discardedBytes += this.buffer.length
        this.buffer = new Uint8Array(0)
        break
      }
      if (preamble > 0) {
        this.discardedBytes += preamble
        this.buffer = this.buffer.slice(preamble)
      }
      if (this.buffer.length < 3) break

      const payloadLength = ((this.buffer[1] & 0x03) << 8) | this.buffer[2]
      const frameLength = payloadLength + 6
      if (payloadLength > RTCM3_MAX_PAYLOAD || frameLength > RTCM3_MAX_FRAME) {
        this.invalidFrames += 1
        this.buffer = this.buffer.slice(1)
        continue
      }
      if (this.buffer.length < frameLength) break

      const frame = this.buffer.slice(0, frameLength)
      if (!isValidRtcm3Frame(frame)) {
        this.invalidFrames += 1
        this.buffer = this.buffer.slice(1)
        continue
      }
      this.validFrames += 1
      frames.push(frame)
      this.buffer = this.buffer.slice(frameLength)
    }
    return frames
  }
}


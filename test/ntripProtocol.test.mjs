import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGga,
  buildNtripRequest,
  parseNtripResponseHeader,
  statusIsSuccessful,
} from '../tools/ntripProtocol.mjs'

test('GGA contains current coordinate and a correct checksum', () => {
  const sentence = buildGga({
    latitude: 45.776679,
    longitude: 126.674410,
    satellites: 12,
    now: new Date('2026-08-08T12:34:56Z'),
  })
  assert.match(sentence, /^\$GPGGA,123456\.00,4546\.60074,N,12640\.46460,E,1,12,1\.0,0\.0,M,0\.0,M,,\*[0-9A-F]{2}\r\n$/)
  const [body, checksumText] = sentence.trim().slice(1).split('*')
  let checksum = 0
  for (const character of body) checksum ^= character.charCodeAt(0)
  assert.equal(checksumText, checksum.toString(16).toUpperCase().padStart(2, '0'))
})

test('NTRIP request carries mountpoint, authorization and GGA without exposing password elsewhere', () => {
  const request = buildNtripRequest(
    {host: 'caster.example', port: 8002, mountpoint: '/AUTO', username: 'user', password: 'secret'},
    {latitude: 1, longitude: 2, satellites: 8, now: new Date('2026-08-08T00:00:00Z')},
  ).toString('ascii')
  assert.match(request, /^GET \/AUTO HTTP\/1\.0\r\n/)
  assert.match(request, /Authorization: Basic dXNlcjpzZWNyZXQ=/)
  assert.doesNotMatch(request, /user:secret/)
  assert.match(request, /\$GPGGA,/)
})

test('parses ICY and HTTP response headers', () => {
  const icy = Buffer.from('ICY 200 OK\r\n\xD3\x00', 'latin1')
  const icyParsed = parseNtripResponseHeader(icy)
  assert.equal(icyParsed.status, 'ICY 200 OK')
  assert.equal(icyParsed.payloadOffset, 12)
  const http = Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: gnss/data\r\n\r\nabc')
  const httpParsed = parseNtripResponseHeader(http)
  assert.equal(http.subarray(httpParsed.payloadOffset).toString(), 'abc')
  assert.equal(statusIsSuccessful(httpParsed.status), true)
  assert.equal(statusIsSuccessful('HTTP/1.1 401 Unauthorized'), false)
})

test('parses an unterminated HTTP status only after the stream ends', () => {
  const response = Buffer.from('HTTP/1.0 401 Unauthorized', 'ascii')
  assert.equal(parseNtripResponseHeader(response), null)
  assert.deepEqual(parseNtripResponseHeader(response, {endOfStream: true}), {
    status: 'HTTP/1.0 401 Unauthorized',
    payloadOffset: response.length,
  })
  assert.equal(
    parseNtripResponseHeader(Buffer.from('not an NTRIP response'), {endOfStream: true}),
    null,
  )
})

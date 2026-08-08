import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import {once} from 'node:events'
import {NtripBridgeSession} from '../tools/ntripBridgePlugin.mjs'
import {crc24q} from '../src/services/rtcm3.js'

function makeRtcmFrame() {
  const payload = Uint8Array.from([0x43, 0x20, 1, 2, 3, 4])
  const body = Uint8Array.from([0xD3, 0, payload.length, ...payload])
  const crc = crc24q(body)
  return Buffer.from([...body, (crc >> 16) & 0xFF, (crc >> 8) & 0xFF, crc & 0xFF])
}

test('Node bridge authenticates, forwards binary data, and sends GGA', async (context) => {
  const frame = makeRtcmFrame()
  let requestText = ''
  const caster = net.createServer((socket) => {
    socket.once('data', (request) => {
      requestText += request.toString('ascii')
      socket.write(Buffer.concat([Buffer.from('ICY 200 OK\r\n', 'ascii'), frame]))
    })
    socket.on('data', (data) => { requestText += data.toString('ascii') })
  })
  caster.listen(0, '127.0.0.1')
  await once(caster, 'listening')
  context.after(() => caster.close())

  const events = []
  let dataResolve
  const dataReceived = new Promise((resolve) => { dataResolve = resolve })
  const client = {
    send(event, payload) {
      events.push({event, payload})
      if (event === 'ntrip:data') dataResolve(payload)
    },
  }
  const session = new NtripBridgeSession(client, '', console)
  context.after(() => session.stop())
  const {port} = caster.address()
  session.setConfig({host: '127.0.0.1', port, mountpoint: 'AUTO', username: 'test', password: 'secret'})
  session.setPosition({latitude: 45.776679, longitude: 126.674410, satellites: 12})
  const payload = await Promise.race([
    dataReceived,
    new Promise((_, reject) => setTimeout(() => reject(new Error('bridge timeout')), 2000)),
  ])

  assert.deepEqual(Buffer.from(payload.data, 'base64'), frame)
  assert.match(requestText, /^GET \/AUTO HTTP\/1\.0/m)
  assert.match(requestText, /Authorization: Basic dGVzdDpzZWNyZXQ=/)
  assert.match(requestText, /\$GPGGA,/)
  assert.ok(events.some(({event, payload: status}) => event === 'ntrip:status' && status.code === 'authenticated'))
})


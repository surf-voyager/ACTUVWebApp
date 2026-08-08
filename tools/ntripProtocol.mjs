import { Buffer } from 'node:buffer'

export function nmeaCoordinate(value, degreeWidth) {
  const absolute = Math.abs(Number(value))
  const degrees = Math.floor(absolute)
  const minutes = (absolute - degrees) * 60
  return `${String(degrees).padStart(degreeWidth, '0')}${minutes.toFixed(5).padStart(8, '0')}`
}

export function buildGga({ latitude, longitude, satellites = 0, now = new Date() }) {
  const lat = Number(latitude)
  const lon = Number(longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new TypeError('invalid GGA position')
  }

  const time = [
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('') + '.00'
  const satCount = Math.max(0, Math.min(99, Math.trunc(Number(satellites) || 0)))
  const body = [
    'GPGGA',
    time,
    nmeaCoordinate(lat, 2),
    lat >= 0 ? 'N' : 'S',
    nmeaCoordinate(lon, 3),
    lon >= 0 ? 'E' : 'W',
    '1',
    String(satCount).padStart(2, '0'),
    '1.0',
    '0.0',
    'M',
    '0.0',
    'M',
    '',
    '',
  ].join(',')
  let checksum = 0
  for (const character of body) checksum ^= character.charCodeAt(0)
  return `$${body}*${checksum.toString(16).toUpperCase().padStart(2, '0')}\r\n`
}

export function normalizeNtripConfig(input = {}) {
  const host = String(input.host || '').trim()
  const port = Number(input.port)
  const mountpoint = String(input.mountpoint || '').trim().replace(/^\/+/, '')
  const username = String(input.username || '')
  const password = String(input.password || '')
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !mountpoint || !username || !password) {
    throw new TypeError('invalid NTRIP configuration')
  }
  return { host, port, mountpoint, username, password }
}

export function buildNtripRequest(config, position) {
  const normalized = normalizeNtripConfig(config)
  const authorization = Buffer.from(`${normalized.username}:${normalized.password}`, 'utf8').toString('base64')
  const gga = buildGga(position).trim()
  return Buffer.from([
    `GET /${normalized.mountpoint} HTTP/1.0`,
    'User-Agent: NTRIP ACTUV-WebApp/1.0',
    'Accept: */*',
    `Authorization: Basic ${authorization}`,
    '',
    gga,
    '',
  ].join('\r\n'), 'ascii')
}

export function parseNtripResponseHeader(buffer) {
  const lineEnd = buffer.indexOf('\r\n')
  if (lineEnd < 0) return null
  const status = buffer.subarray(0, lineEnd).toString('latin1')
  if (/^ICY\s+/i.test(status)) {
    return { status, payloadOffset: lineEnd + 2 }
  }
  const headerEnd = buffer.indexOf('\r\n\r\n')
  if (headerEnd < 0) return null
  return { status, payloadOffset: headerEnd + 4 }
}

export function statusIsSuccessful(status) {
  return /(?:^ICY\s+200\b|^HTTP\/\d(?:\.\d)?\s+200\b)/i.test(String(status))
}


import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ACTUV_GEOFENCE_FILE_FORMAT,
  ACTUV_GEOFENCE_FILE_VERSION,
  buildGeofenceFilename,
  createGeofenceFileDocument,
  parseGeofenceFileDocument,
} from '../src/services/geofenceFile.js'

const points = [
  {latitude: 45.0, longitude: 126.0},
  {latitude: 45.1, longitude: 126.0},
  {latitude: 45.1, longitude: 126.1},
]

test('geofence document round-trips an inclusion polygon', () => {
  const document = createGeofenceFileDocument(points)
  const parsed = parseGeofenceFileDocument(JSON.stringify(document))

  assert.equal(document.format, ACTUV_GEOFENCE_FILE_FORMAT)
  assert.equal(document.version, ACTUV_GEOFENCE_FILE_VERSION)
  assert.equal(document.fence_type, 'INCLUSION')
  assert.deepEqual(parsed, {fenceType: 'INCLUSION', points})
})

test('invalid geometry cannot be saved', () => {
  assert.throws(() => createGeofenceFileDocument(points.slice(0, 2)), /3–99/)
})

test('invalid or unsupported files are rejected as a whole', () => {
  assert.throws(() => parseGeofenceFileDocument('{'), /有效的 JSON/)
  assert.throws(
    () => parseGeofenceFileDocument(JSON.stringify({
      ...createGeofenceFileDocument(points),
      version: 2,
    })),
    /不支持的围栏文件版本/
  )
  assert.throws(
    () => parseGeofenceFileDocument(JSON.stringify({
      ...createGeofenceFileDocument(points),
      fence_type: 'EXCLUSION',
    })),
    /不是包含型多边形/
  )
  const invalidCoordinate = createGeofenceFileDocument(points)
  invalidCoordinate.points[0].latitude = 91
  assert.throws(
    () => parseGeofenceFileDocument(JSON.stringify(invalidCoordinate)),
    /超出经纬度范围/
  )
})

test('filename is stable and filesystem-safe', () => {
  assert.equal(
    buildGeofenceFilename(new Date('2026-08-09T16:05:07.000Z')),
    'ACTUV-geofence-20260809-160507.json'
  )
})

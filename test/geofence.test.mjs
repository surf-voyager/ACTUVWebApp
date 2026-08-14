import test from 'node:test'
import assert from 'node:assert/strict'

import {
  canAutoSyncGeofence,
  geofenceContainsHome,
  normalizeGeofencePoints,
  parseDownloadedGeofence,
  serializeGeofence,
} from '../src/services/geofence.js'

const triangle = [
  {latitude: 45.0, longitude: 126.0},
  {latitude: 45.1, longitude: 126.0},
  {latitude: 45.1, longitude: 126.1},
]

test('normalizes Leaflet coordinates and a repeated closing point', () => {
  assert.deepEqual(normalizeGeofencePoints([
    {lat: 45.0, lng: 126.0},
    {lat: 45.1, lng: 126.0},
    {lat: 45.1, lng: 126.1},
    {lat: 45.0, lng: 126.0},
  ]), triangle)
})

test('enforces point count, ranges and simple polygon geometry', () => {
  assert.throws(() => normalizeGeofencePoints(triangle.slice(0, 2)), /3–99/)
  assert.throws(() => normalizeGeofencePoints([
    {latitude: 91, longitude: 126}, ...triangle.slice(1),
  ]), /超出经纬度范围/)
  assert.throws(() => normalizeGeofencePoints([
    {latitude: 45.0, longitude: 126.0},
    {latitude: 45.1, longitude: 126.1},
    {latitude: 45.0, longitude: 126.1},
    {latitude: 45.1, longitude: 126.0},
  ]), /自相交/)

  const ninetyNinePoints = Array.from({length: 99}, (_, index) => {
    const angle = (Math.PI * 2 * index) / 99
    return {
      latitude: 45 + Math.sin(angle) * 0.01,
      longitude: 126 + Math.cos(angle) * 0.01,
    }
  })
  assert.equal(normalizeGeofencePoints(ninetyNinePoints).length, 99)
  assert.throws(
    () => normalizeGeofencePoints([...ninetyNinePoints, {latitude: 45, longitude: 126.02}]),
    /3–99/
  )
})

test('home on the inside or boundary is accepted', () => {
  assert.equal(geofenceContainsHome(triangle, {lat: 45.075, lon: 126.025}), true)
  assert.equal(geofenceContainsHome(triangle, {lat: 45.05, lon: 126.0}), true)
  assert.equal(geofenceContainsHome(triangle, {lat: 44.9, lon: 126.0}), false)
  assert.equal(geofenceContainsHome(triangle, null), false)
})

test('download parser only accepts an inclusion polygon', () => {
  assert.deepEqual(parseDownloadedGeofence({
    fence_type: 'INCLUSION', points: triangle,
  }), triangle)
  assert.throws(() => parseDownloadedGeofence({
    fence_type: 'EXCLUSION', points: triangle,
  }), /不是唯一包含型/)
})

test('automatic sync preserves unsent local geofence edits', () => {
  assert.equal(canAutoSyncGeofence([], 'LOCAL'), true)
  assert.equal(canAutoSyncGeofence(triangle, 'PX4'), true)
  assert.equal(canAutoSyncGeofence(triangle, 'LOCAL'), false)
})

test('serialization has one stable protocol shape', () => {
  assert.deepEqual(serializeGeofence(triangle), {
    fence_type: 'INCLUSION',
    points: triangle,
  })
})

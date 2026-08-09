import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ACTUV_MISSION_FILE_FORMAT,
  ACTUV_MISSION_FILE_VERSION,
  buildMissionFilename,
  createMissionFileDocument,
  parseMissionFileDocument,
} from '../src/services/missionFile.js'

const mission = {
  defaults: {speed: 2.5, loiter: 3},
  plannedWaypoints: [
    {seq: 9, lat: 45.776679, lng: 126.674410, speed: 1.5, loiter: 0},
    {seq: 3, lat: 45.776700, lng: 126.674500, speed: 2, loiter: 4},
  ],
}

test('mission document round-trips defaults and waypoints', () => {
  const document = createMissionFileDocument(mission)
  const parsed = parseMissionFileDocument(JSON.stringify(document))

  assert.equal(document.format, ACTUV_MISSION_FILE_FORMAT)
  assert.equal(document.version, ACTUV_MISSION_FILE_VERSION)
  assert.deepEqual(parsed.defaults, mission.defaults)
  assert.deepEqual(parsed.waypoints, [
    {seq: 1, lat: 45.776679, lng: 126.674410, speed: 1.5, loiter: 0},
    {seq: 2, lat: 45.776700, lng: 126.674500, speed: 2, loiter: 4},
  ])
})

test('empty mission cannot be saved', () => {
  assert.throws(
    () => createMissionFileDocument({...mission, plannedWaypoints: []}),
    /没有可保存的任务/
  )
})

test('invalid or unsupported files are rejected as a whole', () => {
  assert.throws(() => parseMissionFileDocument('{'), /有效的 JSON/)
  assert.throws(
    () => parseMissionFileDocument(JSON.stringify({...createMissionFileDocument(mission), version: 2})),
    /不支持的任务文件版本/
  )
  const invalidCoordinate = createMissionFileDocument(mission)
  invalidCoordinate.waypoints[0].latitude = 91
  assert.throws(
    () => parseMissionFileDocument(JSON.stringify(invalidCoordinate)),
    /航点纬度/
  )
})

test('filename is stable and filesystem-safe', () => {
  assert.equal(
    buildMissionFilename(new Date('2026-08-09T16:05:07.000Z')),
    'ACTUV-mission-20260809-160507.json'
  )
})

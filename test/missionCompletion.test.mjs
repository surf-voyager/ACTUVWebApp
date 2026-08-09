import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MISSION_HOLD_DISPOSITION,
  missionHoldDisposition,
} from '../src/services/missionCompletion.js'

test('completed short mission is never classified for automatic recovery', () => {
  assert.equal(missionHoldDisposition({
    flightMode: 'HOLD',
    missionState: 'EXECUTING',
    current: 1,
    total: 1,
    elapsedSinceStartMs: 1200,
  }), MISSION_HOLD_DISPOSITION.COMPLETE)
})

test('early HOLD before the final waypoint remains recoverable', () => {
  assert.equal(missionHoldDisposition({
    flightMode: 'HOLD',
    missionState: 'EXECUTING',
    current: 0,
    total: 3,
    elapsedSinceStartMs: 1200,
  }), MISSION_HOLD_DISPOSITION.RECOVER)
})

test('late HOLD and unrelated states are ignored', () => {
  assert.equal(missionHoldDisposition({
    flightMode: 'HOLD',
    missionState: 'EXECUTING',
    current: 1,
    total: 3,
    elapsedSinceStartMs: 6000,
  }), MISSION_HOLD_DISPOSITION.IGNORE)
  assert.equal(missionHoldDisposition({
    flightMode: 'MISSION',
    missionState: 'EXECUTING',
    current: 3,
    total: 3,
    elapsedSinceStartMs: 1000,
  }), MISSION_HOLD_DISPOSITION.IGNORE)
})

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMapPositionUpdate,
  isRenderableMapPosition,
  normalizeDisplayPosition,
  POSITION_SOURCE_EKF,
  POSITION_SOURCE_RAW_GPS,
  usesRawGpsPosition
} from '../src/services/positionDisplay.js';

test('accepts a valid raw GPS fallback for the map and trajectory', () => {
  const normalized = normalizeDisplayPosition({
    valid: true,
    source: POSITION_SOURCE_RAW_GPS,
    lat: 45.7767,
    lon: 126.6744,
    ekf_global_valid: false,
    reason: 'EKF_GLOBAL_POSITION_INVALID'
  });
  const update = buildMapPositionUpdate(normalized);

  assert.deepEqual(update, {
    position: {
      lat: 45.7767,
      lng: 126.6744,
      valid: true,
      source: POSITION_SOURCE_RAW_GPS
    },
    trajectoryPoint: [45.7767, 126.6744]
  });
  assert.equal(isRenderableMapPosition(update.position), true);
  assert.equal(usesRawGpsPosition(update.position), true);
});

test('restores the normal icon source when EKF becomes valid', () => {
  const normalized = normalizeDisplayPosition({
    valid: true,
    source: POSITION_SOURCE_EKF,
    lat: 45.8,
    lon: 126.7,
    ekf_global_valid: true
  });
  const update = buildMapPositionUpdate(normalized);

  assert.equal(isRenderableMapPosition(update.position), true);
  assert.equal(usesRawGpsPosition(update.position), false);
});

test('rejects unavailable, unknown-source, and out-of-range positions', () => {
  const invalidPositions = [
    null,
    {valid: false, source: POSITION_SOURCE_RAW_GPS, lat: 45, lon: 126},
    {valid: true, source: 'unknown', lat: 45, lon: 126},
    {valid: true, source: POSITION_SOURCE_RAW_GPS, lat: 910000001, lon: 126}
  ];

  for (const position of invalidPositions) {
    assert.equal(normalizeDisplayPosition(position), null);
  }
});

test('keeps compatibility with scaled legacy MAVLink coordinates', () => {
  assert.deepEqual(normalizeDisplayPosition({
    valid: true,
    source: POSITION_SOURCE_RAW_GPS,
    lat: 457767000,
    lon: 1266744000
  }), {
    lat: 45.7767,
    lng: 126.6744,
    source: POSITION_SOURCE_RAW_GPS,
    reason: null,
    ekfGlobalValid: false
  });
});

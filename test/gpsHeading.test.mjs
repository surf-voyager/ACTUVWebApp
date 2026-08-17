import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatGpsHeading,
  normalizeGpsHeading
} from '../src/services/gpsHeading.js';

test('normalizes a valid backend GPS heading', () => {
  assert.deepEqual(normalizeGpsHeading({yaw_deg: 361.25, valid: true}), {
    yaw: 1.25,
    valid: true
  });
  assert.equal(formatGpsHeading({yaw: 185, valid: true}), '185.0°');
});

test('keeps invalid and missing headings unavailable', () => {
  for (const payload of [null, {}, {yaw_deg: null, valid: true}, {yaw_deg: 90, valid: false}]) {
    assert.deepEqual(normalizeGpsHeading(payload), {yaw: null, valid: false});
  }
  assert.equal(formatGpsHeading({yaw: null, valid: false}), '--°');
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeWaypointAcceptanceRadius,
  parseWaypointAcceptanceRadiusResponse,
  shouldRenderWaypointAcceptanceRadius,
  waypointRadiusMatches,
  waypointRadiusQueryDisposition
} from '../src/services/waypointAcceptanceRadius.js';

test('validates PX4 NAV_ACC_RAD boundaries and rejects unsafe values', () => {
  assert.equal(normalizeWaypointAcceptanceRadius(0.05), 0.05);
  assert.equal(normalizeWaypointAcceptanceRadius(200), 200);
  for (const value of [true, null, '', Number.NaN, Infinity, 0.049, 200.1]) {
    assert.equal(normalizeWaypointAcceptanceRadius(value), null);
  }
});

test('parses structured query results', () => {
  assert.equal(parseWaypointAcceptanceRadiusResponse({radius_m: 1.5}), 1.5);
  assert.equal(parseWaypointAcceptanceRadiusResponse({radius_m: 'bad'}), null);
  assert.equal(parseWaypointAcceptanceRadiusResponse(null), null);
});

test('renders only a queried and valid confirmed radius', () => {
  assert.equal(shouldRenderWaypointAcceptanceRadius({queried: false, valueM: 1}), false);
  assert.equal(shouldRenderWaypointAcceptanceRadius({queried: true, valueM: null}), false);
  assert.equal(shouldRenderWaypointAcceptanceRadius({queried: true, valueM: 1}), true);
});

test('draft edits and mismatched readback cannot replace the confirmed value', () => {
  const confirmed = {queried: true, valueM: 1};
  const draft = 2;
  assert.equal(confirmed.valueM, 1);
  assert.equal(waypointRadiusMatches(1.9, draft), false);
  assert.equal(waypointRadiusMatches(2, draft), true);
});

test('background refresh queues once behind a visible query and ignores duplicates', () => {
  assert.equal(waypointRadiusQueryDisposition(true, false), 'QUEUE');
  assert.equal(waypointRadiusQueryDisposition(false, true), 'IGNORE');
  assert.equal(waypointRadiusQueryDisposition(false, false), 'SEND');
});

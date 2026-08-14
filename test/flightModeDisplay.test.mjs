import test from 'node:test';
import assert from 'node:assert/strict';

import {formatFlightModeForDisplay} from '../src/services/flightModeDisplay.js';

test('shows current PX4 mode names without localization', () => {
  for (const mode of ['MANUAL', 'MISSION', 'HOLD', 'OFFBOARD', 'POSCTL']) {
    assert.equal(formatFlightModeForDisplay(mode, true), mode);
  }
});

test('renders PX4 return mode as RTL', () => {
  assert.equal(formatFlightModeForDisplay('RETURN_TO_LAUNCH', true), 'RTL');
});

test('shows unknown when PX4 is disconnected or mode is unavailable', () => {
  assert.equal(formatFlightModeForDisplay('MISSION', false), '未知');
  assert.equal(formatFlightModeForDisplay('UNKNOWN', true), '未知');
  assert.equal(formatFlightModeForDisplay(' unknown ', true), '未知');
  assert.equal(formatFlightModeForDisplay('', true), '未知');
  assert.equal(formatFlightModeForDisplay(null, true), '未知');
  assert.equal(formatFlightModeForDisplay(undefined, true), '未知');
});

test('trims but otherwise preserves future mode names', () => {
  assert.equal(formatFlightModeForDisplay('  FUTURE_MODE  ', true), 'FUTURE_MODE');
});

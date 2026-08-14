import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldShowPlanningControls,
  syncPlanningControlsVisibility
} from '../src/services/mapPlanningControls.js';

function createPm(initiallyVisible) {
  let visible = initiallyVisible;
  return {
    toggleCount: 0,
    disableDrawCount: 0,
    controlsVisible() {
      return visible;
    },
    toggleControls() {
      visible = !visible;
      this.toggleCount += 1;
    },
    disableDraw() {
      this.disableDrawCount += 1;
    }
  };
}

test('only waypoint and geofence planning show map drawing controls', () => {
  assert.equal(shouldShowPlanningControls('planner', 'manual'), true);
  assert.equal(shouldShowPlanningControls('planner', 'geofence'), true);
  assert.equal(shouldShowPlanningControls('planner', 'area'), false);
  assert.equal(shouldShowPlanningControls('dashboard', 'manual'), false);
});

test('visibility synchronization is idempotent', () => {
  const pm = createPm(false);

  syncPlanningControlsVisibility(pm, true);
  syncPlanningControlsVisibility(pm, true);
  assert.equal(pm.toggleCount, 1);
  assert.equal(pm.controlsVisible(), true);

  syncPlanningControlsVisibility(pm, false);
  syncPlanningControlsVisibility(pm, false);
  assert.equal(pm.toggleCount, 2);
  assert.equal(pm.controlsVisible(), false);
  assert.equal(pm.disableDrawCount, 2);
});

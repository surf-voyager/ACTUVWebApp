export function shouldShowPlanningControls(routeName, plannerMode) {
  return routeName === 'planner'
    && (plannerMode === 'manual' || plannerMode === 'geofence');
}

export function syncPlanningControlsVisibility(pm, visible) {
  if (!pm) return;

  const shouldBeVisible = Boolean(visible);
  if (!shouldBeVisible) pm.disableDraw();

  if (pm.controlsVisible() !== shouldBeVisible) {
    pm.toggleControls();
  }
}

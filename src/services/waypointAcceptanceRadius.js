export const WAYPOINT_RADIUS_MIN_M = 0.05;
export const WAYPOINT_RADIUS_MAX_M = 200.0;

export function normalizeWaypointAcceptanceRadius(value) {
  if (typeof value === 'boolean' || value === '' || value == null) return null;
  const radius = Number(value);
  if (!Number.isFinite(radius)
      || radius < WAYPOINT_RADIUS_MIN_M
      || radius > WAYPOINT_RADIUS_MAX_M) return null;
  return radius;
}

export function parseWaypointAcceptanceRadiusResponse(data) {
  return normalizeWaypointAcceptanceRadius(data?.radius_m);
}

export function waypointRadiusMatches(actual, expected, tolerance = 1e-3) {
  const actualRadius = normalizeWaypointAcceptanceRadius(actual);
  const expectedRadius = normalizeWaypointAcceptanceRadius(expected);
  return actualRadius !== null
      && expectedRadius !== null
      && Math.abs(actualRadius - expectedRadius) <= tolerance;
}

export function shouldRenderWaypointAcceptanceRadius(state) {
  return state?.queried === true
      && normalizeWaypointAcceptanceRadius(state?.valueM) !== null;
}

export function waypointRadiusQueryDisposition(infoQueryPending, radiusQueryPending) {
  if (radiusQueryPending) return 'IGNORE';
  if (infoQueryPending) return 'QUEUE';
  return 'SEND';
}

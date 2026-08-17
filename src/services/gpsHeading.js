export const EMPTY_GPS_HEADING = Object.freeze({yaw: null, valid: false});

export function normalizeGpsHeading(payload) {
  if (payload?.yaw_deg == null) return {...EMPTY_GPS_HEADING};
  const yaw = Number(payload?.yaw_deg);
  if (payload?.valid !== true || !Number.isFinite(yaw)) {
    return {...EMPTY_GPS_HEADING};
  }

  return {
    yaw: ((yaw % 360) + 360) % 360,
    valid: true
  };
}

export function formatGpsHeading(heading) {
  if (heading?.valid !== true || !Number.isFinite(Number(heading.yaw))) return '--°';
  const yaw = ((Number(heading.yaw) % 360) + 360) % 360;
  return `${yaw.toFixed(1)}°`;
}

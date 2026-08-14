const MAVLINK_COORDINATE_SCALE = 10000000;

export const POSITION_SOURCE_EKF = 'ekf';
export const POSITION_SOURCE_RAW_GPS = 'raw_gps';
export const POSITION_SOURCE_NONE = 'none';

const POSITION_SOURCES = new Set([
  POSITION_SOURCE_EKF,
  POSITION_SOURCE_RAW_GPS
]);

export function normalizeDisplayPosition(position) {
  if (!position || position.valid !== true || !POSITION_SOURCES.has(position.source)) {
    return null;
  }
  if (position.lat == null || position.lon == null) return null;

  let lat = Number(position.lat);
  let lng = Number(position.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  // The current backend sends degrees. Legacy MAVLink payloads use degrees * 1e7.
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    lat /= MAVLINK_COORDINATE_SCALE;
    lng /= MAVLINK_COORDINATE_SCALE;
  }

  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  return {
    lat,
    lng,
    source: position.source,
    reason: position.reason ?? null,
    ekfGlobalValid: position.ekf_global_valid === true,
  };
}

export function buildMapPositionUpdate(position) {
  if (!position || !POSITION_SOURCES.has(position.source)) return null;

  const lat = Number(position.lat);
  const lng = Number(position.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)
      || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }

  return {
    position: {
      lat,
      lng,
      valid: true,
      source: position.source,
    },
    trajectoryPoint: [lat, lng],
  };
}

export function isRenderableMapPosition(position) {
  return buildMapPositionUpdate(position) !== null && position.valid === true;
}

export function usesRawGpsPosition(position) {
  return isRenderableMapPosition(position)
      && position.source === POSITION_SOURCE_RAW_GPS;
}

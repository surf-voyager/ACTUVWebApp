import * as turf from '@turf/turf'

export const MIN_GEOFENCE_POINTS = 3
export const MAX_GEOFENCE_POINTS = 99

export class GeofenceValidationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'GeofenceValidationError'
    this.code = code
  }
}

function samePoint(first, second) {
  return first.latitude === second.latitude
      && first.longitude === second.longitude
}

function normalizeCoordinate(point, index) {
  const latitude = Number(point?.latitude ?? point?.lat)
  const longitude = Number(point?.longitude ?? point?.lng ?? point?.lon)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new GeofenceValidationError(
      'INVALID_POINT',
      `第 ${index + 1} 个围栏角点不是有效经纬度`
    )
  }
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new GeofenceValidationError(
      'INVALID_POINT',
      `第 ${index + 1} 个围栏角点超出经纬度范围`
    )
  }
  return {latitude, longitude}
}

export function normalizeGeofencePoints(rawPoints) {
  if (!Array.isArray(rawPoints)) {
    throw new GeofenceValidationError('INVALID_POINTS', '围栏角点必须是数组')
  }
  const points = rawPoints.map(normalizeCoordinate)
  if (points.length >= 2 && samePoint(points[0], points.at(-1))) points.pop()
  if (points.length < MIN_GEOFENCE_POINTS || points.length > MAX_GEOFENCE_POINTS) {
    throw new GeofenceValidationError(
      'INVALID_POINT_COUNT',
      `包含型多边形必须包含 ${MIN_GEOFENCE_POINTS}–${MAX_GEOFENCE_POINTS} 个角点`
    )
  }
  points.forEach((point, index) => {
    if (samePoint(point, points[(index + 1) % points.length])) {
      throw new GeofenceValidationError('DUPLICATE_POINT', '围栏不能包含相邻的重复角点')
    }
  })

  const ring = [...points.map(point => [point.longitude, point.latitude])]
  ring.push(ring[0])
  const polygon = turf.polygon([ring])
  if (turf.kinks(polygon).features.length > 0) {
    throw new GeofenceValidationError('SELF_INTERSECTION', '围栏边界不允许自相交')
  }
  if (turf.area(polygon) <= 0.001) {
    throw new GeofenceValidationError('DEGENERATE_POLYGON', '围栏多边形面积必须大于 0')
  }
  return points
}

export function normalizeHomePosition(home) {
  try {
    return normalizeCoordinate(home, 0)
  } catch (_) {
    return null
  }
}

export function geofenceContainsHome(points, home) {
  const normalizedHome = normalizeHomePosition(home)
  if (!normalizedHome) return false
  const normalizedPoints = normalizeGeofencePoints(points)
  const ring = normalizedPoints.map(point => [point.longitude, point.latitude])
  ring.push(ring[0])
  return turf.booleanPointInPolygon(
    turf.point([normalizedHome.longitude, normalizedHome.latitude]),
    turf.polygon([ring]),
    {ignoreBoundary: false}
  )
}

export function parseDownloadedGeofence(value) {
  if (!value || value.fence_type !== 'INCLUSION') {
    throw new GeofenceValidationError(
      'UNSUPPORTED_FENCE_TYPE',
      '飞控返回的不是唯一包含型多边形围栏'
    )
  }
  return normalizeGeofencePoints(value.points)
}

export function serializeGeofence(points) {
  return {
    fence_type: 'INCLUSION',
    points: normalizeGeofencePoints(points)
  }
}


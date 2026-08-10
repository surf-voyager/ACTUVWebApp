import {normalizeGeofencePoints} from './geofence.js'

export const ACTUV_GEOFENCE_FILE_FORMAT = 'ACTUV_GEOFENCE'
export const ACTUV_GEOFENCE_FILE_VERSION = 1

const INCLUSION_FENCE_TYPE = 'INCLUSION'

export function createGeofenceFileDocument(points) {
  const normalizedPoints = normalizeGeofencePoints(points)
  return {
    format: ACTUV_GEOFENCE_FILE_FORMAT,
    version: ACTUV_GEOFENCE_FILE_VERSION,
    saved_at: new Date().toISOString(),
    fence_type: INCLUSION_FENCE_TYPE,
    points: normalizedPoints,
  }
}

export function parseGeofenceFileDocument(text) {
  let document
  try {
    document = JSON.parse(text)
  } catch (_) {
    throw new Error('文件不是有效的 JSON 文本')
  }

  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('围栏文件顶层格式无效')
  }
  if (document.format !== ACTUV_GEOFENCE_FILE_FORMAT) {
    throw new Error('不是 ACTUV 围栏文件')
  }
  if (document.version !== ACTUV_GEOFENCE_FILE_VERSION) {
    throw new Error(`不支持的围栏文件版本：${String(document.version)}`)
  }
  if (document.fence_type !== INCLUSION_FENCE_TYPE) {
    throw new Error('围栏文件不是包含型多边形')
  }

  return {
    fenceType: INCLUSION_FENCE_TYPE,
    points: normalizeGeofencePoints(document.points),
  }
}

export function buildGeofenceFilename(date = new Date()) {
  const timestamp = date.toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .replace(/\..+$/, '')
  return `ACTUV-geofence-${timestamp}.json`
}

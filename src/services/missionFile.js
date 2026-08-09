export const ACTUV_MISSION_FILE_FORMAT = 'ACTUV_MISSION'
export const ACTUV_MISSION_FILE_VERSION = 1

function requireFiniteNumber(value, fieldName, {min = -Infinity, max = Infinity} = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${fieldName} 必须是有效数字`)
  }
  if (value < min || value > max) {
    if (max === Infinity) throw new Error(`${fieldName} 不能小于 ${min}`)
    if (min === -Infinity) throw new Error(`${fieldName} 不能大于 ${max}`)
    throw new Error(`${fieldName} 必须在 ${min}～${max} 范围内`)
  }
  return value
}

function normalizeWaypoint(waypoint, index) {
  if (!waypoint || typeof waypoint !== 'object' || Array.isArray(waypoint)) {
    throw new Error(`第 ${index + 1} 个航点格式无效`)
  }

  return {
    seq: index + 1,
    lat: requireFiniteNumber(waypoint.latitude, `第 ${index + 1} 个航点纬度`, {min: -90, max: 90}),
    lng: requireFiniteNumber(waypoint.longitude, `第 ${index + 1} 个航点经度`, {min: -180, max: 180}),
    speed: requireFiniteNumber(waypoint.speed_m_s, `第 ${index + 1} 个航点速度`, {min: 0}),
    loiter: requireFiniteNumber(waypoint.loiter_s, `第 ${index + 1} 个航点停留时间`, {min: 0}),
  }
}

export function createMissionFileDocument(mission) {
  if (!mission || !Array.isArray(mission.plannedWaypoints)
      || mission.plannedWaypoints.length === 0) {
    throw new Error('当前没有可保存的任务')
  }

  const defaultSpeed = requireFiniteNumber(mission.defaults?.speed, '默认速度', {min: 0})
  const defaultLoiter = requireFiniteNumber(mission.defaults?.loiter, '默认停留时间', {min: 0})
  const waypoints = mission.plannedWaypoints.map((waypoint, index) => ({
    seq: index + 1,
    latitude: requireFiniteNumber(waypoint.lat, `第 ${index + 1} 个航点纬度`, {min: -90, max: 90}),
    longitude: requireFiniteNumber(waypoint.lng, `第 ${index + 1} 个航点经度`, {min: -180, max: 180}),
    speed_m_s: requireFiniteNumber(waypoint.speed, `第 ${index + 1} 个航点速度`, {min: 0}),
    loiter_s: requireFiniteNumber(waypoint.loiter, `第 ${index + 1} 个航点停留时间`, {min: 0}),
  }))

  return {
    format: ACTUV_MISSION_FILE_FORMAT,
    version: ACTUV_MISSION_FILE_VERSION,
    saved_at: new Date().toISOString(),
    defaults: {
      speed_m_s: defaultSpeed,
      loiter_s: defaultLoiter,
    },
    waypoints,
  }
}

export function parseMissionFileDocument(text) {
  let document
  try {
    document = JSON.parse(text)
  } catch (_) {
    throw new Error('文件不是有效的 JSON 文本')
  }

  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('任务文件顶层格式无效')
  }
  if (document.format !== ACTUV_MISSION_FILE_FORMAT) {
    throw new Error('不是 ACTUV 任务文件')
  }
  if (document.version !== ACTUV_MISSION_FILE_VERSION) {
    throw new Error(`不支持的任务文件版本：${String(document.version)}`)
  }
  if (!document.defaults || typeof document.defaults !== 'object'
      || Array.isArray(document.defaults)) {
    throw new Error('任务文件缺少默认参数')
  }
  if (!Array.isArray(document.waypoints) || document.waypoints.length === 0) {
    throw new Error('任务文件中没有航点')
  }

  return {
    defaults: {
      speed: requireFiniteNumber(document.defaults.speed_m_s, '默认速度', {min: 0}),
      loiter: requireFiniteNumber(document.defaults.loiter_s, '默认停留时间', {min: 0}),
    },
    waypoints: document.waypoints.map(normalizeWaypoint),
  }
}

export function buildMissionFilename(date = new Date()) {
  const timestamp = date.toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .replace(/\..+$/, '')
  return `ACTUV-mission-${timestamp}.json`
}

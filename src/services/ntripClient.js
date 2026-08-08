import { base64ToBytes, bytesToBase64, Rtcm3StreamParser } from './rtcm3'

const STATUS_TICK_MS = 500
const POSITION_PUSH_MS = 1000
const FORWARD_INTERVAL_MS = 1000
const VALID_DATA_TIMEOUT_MS = 10_000
const MAX_BATCH_FRAMES = 64
const MAX_BATCH_BYTES = 64 * 1024

const BRIDGE_STATUS_TEXT = Object.freeze({
  invalid_config: '未登录：配置无效',
  waiting_position: '没有有效定位值',
  connecting: '正在连接差分服务',
  authenticated: '等待差分数据',
  auth_failed: '登录失败：请检查账号或挂载点',
  network_error: '无法连接差分服务',
  bridge_error: '本地差分桥接服务不可用',
})

function hasCompleteConfig(config) {
  const port = Number(config?.port)
  return Boolean(
    String(config?.host || '').trim()
    && Number.isInteger(port) && port >= 1 && port <= 65535
    && String(config?.mountpoint || '').trim().replace(/^\/+/, '')
    && String(config?.username || '')
    && String(config?.password || ''),
  )
}

function normalizePosition(position, satellites) {
  const latitude = Number(position?.lat)
  const longitude = Number(position?.lng)
  if (position?.valid !== true || !['ekf', 'raw_gps'].includes(position?.source)) return null
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  return { latitude, longitude, satellites: Math.max(0, Math.trunc(Number(satellites) || 0)) }
}

function configFingerprint(config) {
  return JSON.stringify({
    host: String(config.host).trim(),
    port: Number(config.port),
    mountpoint: String(config.mountpoint).trim().replace(/^\/+/, ''),
    username: String(config.username),
    password: String(config.password),
  })
}

export class NtripClient {
  constructor({ config, status, getPosition, getSatellites, isBackendReady, sendRtcmBatch }) {
    this.config = config
    this.status = status
    this.getPosition = getPosition
    this.getSatellites = getSatellites
    this.isBackendReady = isBackendReady
    this.sendRtcmBatch = sendRtcmBatch
    this.parser = new Rtcm3StreamParser()
    this.pendingFrames = []
    this.pendingBytes = 0
    this.batchId = 0
    this.configKey = null
    this.lastPositionPushAt = 0
    this.authenticatedAt = 0
    this.lastBridgeCode = 'bridge_error'
    this.started = false
    this.statusTimer = null
    this.forwardTimer = null
    this.handleBridgeStatus = this.handleBridgeStatus.bind(this)
    this.handleBridgeData = this.handleBridgeData.bind(this)
    this.handleBridgeDisconnect = this.handleBridgeDisconnect.bind(this)
  }

  start() {
    if (this.started) return
    this.started = true
    if (!import.meta.hot) {
      this.setStatus('bridge_error', '本地差分桥接服务仅随 npm run dev 提供')
      return
    }
    import.meta.hot.on('ntrip:status', this.handleBridgeStatus)
    import.meta.hot.on('ntrip:data', this.handleBridgeData)
    import.meta.hot.on('vite:ws:disconnect', this.handleBridgeDisconnect)
    this.statusTimer = setInterval(() => this.tick(), STATUS_TICK_MS)
    this.forwardTimer = setInterval(() => this.flushFrames(), FORWARD_INTERVAL_MS)
    this.tick()
  }

  stop() {
    if (!this.started) return
    this.started = false
    if (this.statusTimer) clearInterval(this.statusTimer)
    if (this.forwardTimer) clearInterval(this.forwardTimer)
    this.statusTimer = null
    this.forwardTimer = null
    if (import.meta.hot) {
      import.meta.hot.send('ntrip:stop', {})
      import.meta.hot.off('ntrip:status', this.handleBridgeStatus)
      import.meta.hot.off('ntrip:data', this.handleBridgeData)
      import.meta.hot.off('vite:ws:disconnect', this.handleBridgeDisconnect)
    }
    this.pendingFrames = []
    this.pendingBytes = 0
    this.parser.reset()
    this.configKey = null
  }

  configurationChanged() {
    this.configKey = null
    this.pendingFrames = []
    this.pendingBytes = 0
    this.parser.reset()
    this.status.lastValidAt = 0
    this.status.healthy = false
    this.tick()
  }

  tick() {
    if (!this.started || !import.meta.hot) return
    if (!hasCompleteConfig(this.config)) {
      if (this.configKey !== null) import.meta.hot.send('ntrip:stop', {})
      this.configKey = null
      this.setStatus('not_configured', '未登录：请配置账号')
      return
    }

    const position = normalizePosition(this.getPosition(), this.getSatellites())
    if (!position) {
      if (this.configKey !== null) import.meta.hot.send('ntrip:stop', {})
      this.configKey = null
      this.setStatus('waiting_position', '没有有效定位值')
      return
    }

    const nextKey = configFingerprint(this.config)
    if (nextKey !== this.configKey) {
      this.configKey = nextKey
      this.authenticatedAt = 0
      this.status.lastValidAt = 0
      this.parser.reset()
      import.meta.hot.send('ntrip:config', JSON.parse(nextKey))
      import.meta.hot.send('ntrip:position', position)
      this.lastPositionPushAt = Date.now()
      this.setStatus('connecting', '正在连接差分服务')
      return
    }

    const now = Date.now()
    if (now - this.lastPositionPushAt >= POSITION_PUSH_MS) {
      import.meta.hot.send('ntrip:position', position)
      this.lastPositionPushAt = now
    }

    const dataIsFresh = this.lastBridgeCode === 'authenticated'
      && this.status.lastValidAt > 0
      && now - this.status.lastValidAt <= VALID_DATA_TIMEOUT_MS
    if (dataIsFresh) {
      this.status.healthy = true
      this.status.code = 'streaming'
      this.status.reason = this.isBackendReady() ? '差分数据正常' : '差分数据正常；后端未连接，转发已暂停'
      this.status.forwardPaused = !this.isBackendReady()
    } else if (this.lastBridgeCode === 'authenticated') {
      const timedOut = this.authenticatedAt > 0 && now - this.authenticatedAt >= VALID_DATA_TIMEOUT_MS
      this.setStatus(timedOut ? 'no_data' : 'authenticated', timedOut ? '无法获取差分数据：10秒内无有效RTCM' : '等待差分数据')
    }
  }

  handleBridgeStatus(payload = {}) {
    this.lastBridgeCode = String(payload.code || 'bridge_error')
    this.status.transport = String(payload.transport || this.status.transport || '')
    this.status.detail = payload.message ? String(payload.message) : ''
    if (this.lastBridgeCode === 'authenticated') this.authenticatedAt = Date.now()
    if (this.lastBridgeCode !== 'authenticated') {
      this.setStatus(this.lastBridgeCode, BRIDGE_STATUS_TEXT[this.lastBridgeCode] || '差分服务异常')
    } else {
      this.setStatus('authenticated', '等待差分数据')
    }
  }

  handleBridgeData(payload = {}) {
    let bytes
    try {
      bytes = base64ToBytes(String(payload.data || ''))
    } catch {
      this.status.invalidFrames += 1
      return
    }
    const invalidBefore = this.parser.invalidFrames
    const frames = this.parser.feed(bytes)
    this.status.invalidFrames += this.parser.invalidFrames - invalidBefore
    if (!frames.length) return
    this.status.lastValidAt = Date.now()
    this.status.validFrames += frames.length
    this.status.receivedBytes += frames.reduce((total, frame) => total + frame.length, 0)
    this.lastBridgeCode = 'authenticated'
    for (const frame of frames) {
      if (this.pendingFrames.length >= MAX_BATCH_FRAMES || this.pendingBytes + frame.length > MAX_BATCH_BYTES) {
        this.status.droppedFrames += 1
        continue
      }
      this.pendingFrames.push(frame)
      this.pendingBytes += frame.length
    }
    this.tick()
  }

  handleBridgeDisconnect() {
    this.lastBridgeCode = 'bridge_error'
    this.setStatus('bridge_error', '本地差分桥接服务不可用')
  }

  flushFrames() {
    if (!this.pendingFrames.length) return
    const frames = this.pendingFrames
    this.pendingFrames = []
    this.pendingBytes = 0
    if (!this.isBackendReady()) {
      this.status.droppedFrames += frames.length
      return
    }
    this.batchId = (this.batchId + 1) >>> 0
    const sent = this.sendRtcmBatch({
      batch_id: this.batchId,
      frames: frames.map(bytesToBase64),
    })
    if (sent) {
      this.status.forwardedFrames += frames.length
    } else {
      this.status.droppedFrames += frames.length
    }
  }

  setStatus(code, reason) {
    this.status.code = code
    this.status.reason = reason
    this.status.healthy = false
    this.status.forwardPaused = false
  }
}

export { hasCompleteConfig, normalizePosition }

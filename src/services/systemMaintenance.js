export const CLEAR_LOGS_CONFIRM_TEXT = 'CLEAR'
export const POWER_OFF_CONFIRM_TEXT = 'POWER OFF'
export const SYSTEM_MAINTENANCE_TIMEOUT_MS = 15000

export function onboardPowerOffBlockedReason({
  backendConnected,
  px4Connected,
  armedKnown,
  armed,
  powerOffPhase = 'IDLE',
}) {
  if (powerOffPhase !== 'IDLE' && powerOffPhase !== 'ERROR') {
    return powerOffPhase === 'POWERED_OFF'
      ? '机载系统已断电，请通过 BMS 手机 App 恢复供电'
      : '机载系统断电操作正在进行'
  }
  if (!backendConnected) return '机载服务未连接，无法执行断电'
  if (!px4Connected) return 'PX4 未连接，拒绝机载系统断电'
  if (!armedKnown) return 'PX4 解锁状态未知，拒绝机载系统断电'
  if (armed) return 'PX4 已解锁，请先上锁再执行机载系统断电'
  return null
}

export function formatByteCount(value) {
  let bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) bytes = 0
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let unitIndex = 0
  while (bytes >= 1024 && unitIndex < units.length - 1) {
    bytes /= 1024
    unitIndex += 1
  }
  const digits = unitIndex === 0 ? 0 : 1
  return `${bytes.toFixed(digits)} ${units[unitIndex]}`
}

export function formatOperationalLogCleanup(payload = {}) {
  const deleted = Math.max(0, Number(payload.deleted_count) || 0)
  const active = Math.max(0, Number(payload.active_preserved_count) || 0)
  const failed = Math.max(0, Number(payload.failed_count) || 0)
  const freeAfter = formatByteCount(payload.free_bytes_after)
  return `已删除 ${deleted} 个已关闭日志（${formatByteCount(payload.deleted_bytes)}），保留 ${active} 个活动日志，当前可用 ${freeAfter}${failed ? `，失败 ${failed} 个` : ''}`
}

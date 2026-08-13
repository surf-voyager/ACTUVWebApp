export const BATTERY_ALERT_STATES = Object.freeze([
  'LOW_BATTERY',
  'DATA_FAULT',
  'LOW_BATTERY_DATA_FAULT'
])

export const LOW_BATTERY_STATES = Object.freeze([
  'LOW_BATTERY',
  'LOW_BATTERY_DATA_FAULT'
])

export const BATTERY_DATA_FAULT_STATES = Object.freeze([
  'DATA_FAULT',
  'LOW_BATTERY_DATA_FAULT'
])

export const BATTERY_FAULT_MESSAGES = Object.freeze({
  BMS_DRIVER_UNAVAILABLE: '电池串口驱动不可用',
  BMS_SERIAL_UNAVAILABLE: '无法连接 BMS 串口',
  BMS_READ_FAILED: 'BMS 数据读取失败',
  BMS_DATA_STALE: '电池数据超过 5 秒未更新',
  BMS_VOLTAGE_INVALID: 'BMS 返回的动力电池总电压无效'
})

export function parseBatteryVoltageThreshold(value) {
  const text = String(value ?? '').trim()
  if (!/^(?:0|[1-9]\d*)(?:\.\d)?$/.test(text)) return null
  const threshold = Number(text)
  return Number.isFinite(threshold) && threshold >= 0 && threshold <= 100
    ? threshold
    : null
}

export function isBatteryAlertState(value) {
  return BATTERY_ALERT_STATES.includes(String(value || ''))
}

export function isLowBatteryState(value) {
  return LOW_BATTERY_STATES.includes(String(value || ''))
}

export function isBatteryDataFaultState(value) {
  return BATTERY_DATA_FAULT_STATES.includes(String(value || ''))
}

export function batteryFaultMessage(code) {
  return BATTERY_FAULT_MESSAGES[code] || '无法确认当前电池状态'
}

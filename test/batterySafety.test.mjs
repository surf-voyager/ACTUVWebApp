import test from 'node:test'
import assert from 'node:assert/strict'

import {
  batteryFaultMessage,
  isBatteryAlertState,
  isBatteryDataFaultState,
  isLowBatteryState,
  parseBatteryVoltageThreshold,
} from '../src/services/batterySafety.js'

test('battery voltage threshold accepts 0 to 100 V with at most one decimal', () => {
  assert.equal(parseBatteryVoltageThreshold('0'), 0)
  assert.equal(parseBatteryVoltageThreshold(45), 45)
  assert.equal(parseBatteryVoltageThreshold('45.5'), 45.5)
  assert.equal(parseBatteryVoltageThreshold('100'), 100)
  assert.equal(parseBatteryVoltageThreshold('100.0'), 100)
  for (const invalid of ['', '-1', '100.1', '45.55', '1e1', 'abc', null]) {
    assert.equal(parseBatteryVoltageThreshold(invalid), null)
  }
})

test('battery alert states distinguish low battery and data faults', () => {
  assert.equal(isBatteryAlertState('NORMAL'), false)
  assert.equal(isBatteryAlertState('LOW_BATTERY'), true)
  assert.equal(isLowBatteryState('LOW_BATTERY_DATA_FAULT'), true)
  assert.equal(isBatteryDataFaultState('LOW_BATTERY_DATA_FAULT'), true)
  assert.equal(isLowBatteryState('DATA_FAULT'), false)
})

test('battery fault messages are stable and localized', () => {
  assert.equal(batteryFaultMessage('BMS_DATA_STALE'), '电池数据超过 5 秒未更新')
  assert.equal(batteryFaultMessage('BMS_VOLTAGE_INVALID'), 'BMS 返回的动力电池总电压无效')
  assert.equal(batteryFaultMessage('UNKNOWN'), '无法确认当前电池状态')
})

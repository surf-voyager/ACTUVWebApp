import test from 'node:test'
import assert from 'node:assert/strict'

import {
  batteryFaultMessage,
  isBatteryAlertState,
  isBatteryDataFaultState,
  isLowBatteryState,
  parseBatteryThreshold,
} from '../src/services/batterySafety.js'

test('battery threshold accepts only integer text from 0 to 100', () => {
  assert.equal(parseBatteryThreshold('0'), 0)
  assert.equal(parseBatteryThreshold(20), 20)
  assert.equal(parseBatteryThreshold('100'), 100)
  for (const invalid of ['', '-1', '101', '2.5', 'abc', null]) {
    assert.equal(parseBatteryThreshold(invalid), null)
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
  assert.equal(batteryFaultMessage('UNKNOWN'), '无法确认当前电池状态')
})

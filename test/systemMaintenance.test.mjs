import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'

import {
  CLEAR_LOGS_CONFIRM_TEXT,
  formatByteCount,
  formatOperationalLogCleanup,
  onboardPowerOffBlockedReason,
  POWER_OFF_CONFIRM_TEXT,
  SYSTEM_MAINTENANCE_TIMEOUT_MS,
} from '../src/services/systemMaintenance.js'

test('maintenance confirmation tokens and timeout are explicit', () => {
  assert.equal(CLEAR_LOGS_CONFIRM_TEXT, 'CLEAR')
  assert.equal(POWER_OFF_CONFIRM_TEXT, 'POWER OFF')
  assert.equal(SYSTEM_MAINTENANCE_TIMEOUT_MS, 15000)
})

test('power-off is allowed only for a connected known disarmed PX4', () => {
  const ready = {
    backendConnected: true,
    px4Connected: true,
    armedKnown: true,
    armed: false,
    powerOffPhase: 'IDLE',
  }
  assert.equal(onboardPowerOffBlockedReason(ready), null)
  assert.match(onboardPowerOffBlockedReason({...ready, backendConnected: false}), /机载服务未连接/)
  assert.match(onboardPowerOffBlockedReason({...ready, px4Connected: false}), /PX4 未连接/)
  assert.match(onboardPowerOffBlockedReason({...ready, armedKnown: false}), /状态未知/)
  assert.match(onboardPowerOffBlockedReason({...ready, armed: true}), /已解锁/)
  assert.match(onboardPowerOffBlockedReason({...ready, powerOffPhase: 'PENDING'}), /正在进行/)
  assert.match(onboardPowerOffBlockedReason({...ready, powerOffPhase: 'POWERED_OFF'}), /手机 App/)
})

test('cleanup result reports counts, bytes and remaining space', () => {
  assert.equal(formatByteCount(1536), '1.5 KiB')
  assert.equal(formatOperationalLogCleanup({
    deleted_count: 2,
    deleted_bytes: 1536,
    active_preserved_count: 1,
    failed_count: 0,
    free_bytes_after: 2 * 1024 * 1024,
  }), '已删除 2 个已关闭日志（1.5 KiB），保留 1 个活动日志，当前可用 2.0 MiB')

  assert.match(formatOperationalLogCleanup({failed_count: 2}), /失败 2 个/)
})

test('dashboard and store wire only the new maintenance commands', async () => {
  const [dashboard, store, connectionManager] = await Promise.all([
    readFile(new URL('../src/views/DashboardView.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/store/useGcsStore.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/Common/ConnectionManager.vue', import.meta.url), 'utf8'),
  ])
  assert.match(dashboard, /清理磁盘空间/)
  assert.match(dashboard, /机载系统断电/)
  assert.match(store, /CMD_CLEAR_OPERATIONAL_LOGS/)
  assert.match(store, /CMD_POWER_OFF_ONBOARD_SYSTEM/)
  assert.match(store, /ElMessageBox\.prompt/)
  assert.doesNotMatch(store, /CMD_SHUTDOWN_(PI|FCU)/)
  assert.doesNotMatch(connectionManager, /shutdown(Pi|Fcu)/)
})

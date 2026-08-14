import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatCommandAck,
  localizeBackendError,
  NOTIFICATION_TITLES,
  summarizeMissionSync
} from '../src/services/systemNotifications.js';

test('automatic connection and mission download successes stay silent', () => {
    assert.equal(formatCommandAck({commandType: 'CMD_CONNECT_VEHICLE', success: true}), null);
    assert.equal(formatCommandAck({commandType: 'CMD_SYNC_SYSTEM_TIME', success: true}), null);
  assert.equal(formatCommandAck({commandType: 'CMD_DOWNLOAD_MISSION', success: true}), null);
});

test('time synchronization failure is localized', () => {
  assert.deepEqual(formatCommandAck({
    commandType: 'CMD_SYNC_SYSTEM_TIME',
    success: false,
    message: 'helper failed'
  }), {
    title: NOTIFICATION_TITLES.system,
    message: '树莓派系统时间同步失败',
    type: 'error'
  });
});

test('raw English backend errors do not leak into system notifications', () => {
  assert.equal(localizeBackendError('Command denied', '飞控拒绝执行'), '飞控拒绝执行');
  assert.equal(localizeBackendError('返航失败：COMMAND_DENIED', '返航失败'), '返航失败');
  assert.equal(localizeBackendError('飞控拒绝执行', '操作失败'), '飞控拒绝执行');
  assert.deepEqual(formatCommandAck({
    commandType: 'CMD_ARM',
    success: false,
    message: 'COMMAND_DENIED'
  }), {
    title: NOTIFICATION_TITLES.groundControl,
    message: '飞控解锁失败',
    type: 'error'
  });
});

test('command acknowledgements use business-specific Chinese copy', () => {
  assert.deepEqual(formatCommandAck({
    commandType: 'CMD_UPLOAD_MISSION',
    success: true,
    requestPayload: {mission_items: [{}, {}]}
  }), {
    title: NOTIFICATION_TITLES.mission,
    message: '飞控已确认接收 2 个航点',
    type: 'success'
  });

  assert.deepEqual(formatCommandAck({
    commandType: 'CMD_SET_MODE',
    success: true,
    requestPayload: {mode: 'MISSION'}
  }), {
    title: NOTIFICATION_TITLES.groundControl,
    message: '飞控已切换至任务模式（MISSION）',
    type: 'success'
  });

  assert.deepEqual(formatCommandAck({
    commandType: 'CMD_SET_BATTERY_THRESHOLD',
    success: true,
    requestPayload: {threshold_voltage_v: 45.5}
  }), {
    title: NOTIFICATION_TITLES.parameter,
    message: '低电压返航阈值已设为 45.5 V',
    type: 'success'
  });

  assert.deepEqual(formatCommandAck({
    commandType: 'CMD_SET_BATTERY_THRESHOLD',
    success: true,
    requestPayload: {threshold_voltage_v: 0}
  }), {
    title: NOTIFICATION_TITLES.parameter,
    message: '低电压告警已禁用',
    type: 'success'
  });
});

test('failed acknowledgements preserve actionable backend details', () => {
  assert.deepEqual(formatCommandAck({
    commandType: 'CMD_SET_HOME',
    success: false,
    message: '返航点超出有效范围'
  }), {
    title: NOTIFICATION_TITLES.returnHome,
    message: '返航点超出有效范围',
    type: 'error'
  });
});

test('system maintenance acknowledgements use the new command semantics', () => {
  assert.deepEqual(formatCommandAck({
    commandType: 'CMD_CLEAR_OPERATIONAL_LOGS',
    success: true
  }), {
    title: NOTIFICATION_TITLES.system,
    message: '已清理关闭的运行日志',
    type: 'success'
  });
  assert.deepEqual(formatCommandAck({
    commandType: 'CMD_POWER_OFF_ONBOARD_SYSTEM',
    success: false,
    message: 'PX4 已解锁，请先上锁再执行机载系统断电'
  }), {
    title: NOTIFICATION_TITLES.system,
    message: 'PX4 已解锁，请先上锁再执行机载系统断电',
    type: 'error'
  });
});

test('mission synchronization reports received and valid item counts once', () => {
  assert.deepEqual(summarizeMissionSync(0, 0), {
    message: '飞控中没有任务航点',
    type: 'info'
  });
  assert.deepEqual(summarizeMissionSync(1, 0), {
    message: '收到 1 个任务项，但未发现有效航点',
    type: 'warning'
  });
  assert.deepEqual(summarizeMissionSync(3, 2), {
    message: '已加载 2 个有效航点，忽略 1 个无效任务项',
    type: 'warning'
  });
});

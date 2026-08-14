import test from 'node:test';
import assert from 'node:assert/strict';

import {formatEkfHealth} from '../src/services/ekfHealth.js';

test('formats a healthy EKF result', () => {
  assert.equal(formatEkfHealth({healthy: true}), 'EKF健康状态：健康');
});

test('formats the highest-priority cause with current value and PX4 threshold', () => {
  const text = formatEkfHealth({
    healthy: false,
    reason_code: 'GNSS_SATELLITES_INSUFFICIENT',
    current_value: 5,
    threshold_value: 6,
    threshold_operator: '>=',
    unit: '颗',
    threshold_parameter: 'EKF2_REQ_NSATS'
  });
  assert.match(text, /GNSS卫星数不足/);
  assert.match(text, /当前 5颗/);
  assert.match(text, /要求 ≥6颗/);
  assert.match(text, /EKF2_REQ_NSATS/);
});

test('shows a meaningful fix type comparison', () => {
  const text = formatEkfHealth({
    healthy: false,
    reason_code: 'GNSS_FIX_INSUFFICIENT',
    current_value: 2,
    threshold_value: 3,
    threshold_operator: '>=',
    threshold_parameter: 'EKF2_REQ_FIX'
  });
  assert.match(text, /二维定位/);
  assert.match(text, /三维定位/);
});

test('keeps the cause and marks unavailable values', () => {
  const text = formatEkfHealth({
    healthy: false,
    reason_code: 'GNSS_PDOP_TOO_HIGH',
    current_value: null,
    threshold_value: null,
    threshold_operator: '<=',
    threshold_parameter: 'EKF2_REQ_PDOP'
  });
  assert.match(text, /GNSS PDOP过高/);
  assert.match(text, /数值暂不可用/);
});

test('does not append meaningless value placeholders to diagnostic unavailable', () => {
  assert.equal(formatEkfHealth({
    healthy: false,
    reason_code: 'DIAGNOSTIC_DATA_UNAVAILABLE'
  }), 'EKF健康状态：异常 — PX4 EKF诊断数据不可用');
});

test('formats semantic alignment state instead of raw booleans', () => {
  const text = formatEkfHealth({
    healthy: false,
    reason_code: 'YAW_NOT_ALIGNED',
    current_value: false,
    threshold_value: true
  });
  assert.match(text, /航向尚未对准/);
  assert.match(text, /当前：未对准/);
  assert.match(text, /要求：已对准/);
});

test('rejects malformed and unknown results', () => {
  for (const value of [null, {}, {healthy: 'yes'}, {
    healthy: false,
    reason_code: 'UNKNOWN_REASON'
  }]) {
    assert.throws(() => formatEkfHealth(value), /INVALID_RESULT/);
  }
});

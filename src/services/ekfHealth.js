const REASON_LABELS = Object.freeze({
  DIAGNOSTIC_DATA_UNAVAILABLE: 'PX4 EKF诊断数据不可用',
  EKF_HEALTH_DATA_STALE: 'EKF健康数据超时',
  EKF_POSITION_DATA_STALE: 'EKF位置数据超时',
  EKF_POSITION_DATA_INVALID: 'EKF位置数据无效',
  EKF_INTERNAL_FAULT: 'EKF内部数值故障',
  GNSS_SPOOFING_DETECTED: '检测到GNSS欺骗信号',
  GNSS_JAMMING_DETECTED: '检测到GNSS干扰信号',
  GNSS_FAULT: 'GNSS已被EKF判定为故障',
  TILT_NOT_ALIGNED: 'EKF倾斜角尚未对准',
  YAW_NOT_ALIGNED: 'EKF航向尚未对准',
  HORIZONTAL_POSITION_INNOVATION_REJECTED: '水平位置创新检验未通过',
  HORIZONTAL_VELOCITY_INNOVATION_REJECTED: '水平速度创新检验未通过',
  GNSS_FIX_INSUFFICIENT: 'GNSS定位类型不足',
  GNSS_SATELLITES_INSUFFICIENT: 'GNSS卫星数不足',
  GNSS_PDOP_TOO_HIGH: 'GNSS PDOP过高',
  GNSS_HORIZONTAL_ACCURACY_POOR: 'GNSS水平位置精度不足',
  GNSS_VERTICAL_ACCURACY_POOR: 'GNSS垂直位置精度不足',
  GNSS_SPEED_ACCURACY_POOR: 'GNSS速度精度不足',
  GNSS_HORIZONTAL_DRIFT_TOO_HIGH: 'GNSS水平位置漂移过大',
  GNSS_VERTICAL_DRIFT_TOO_HIGH: 'GNSS垂直位置漂移过大',
  GNSS_HORIZONTAL_SPEED_TOO_HIGH: '静止时GNSS水平速度过大',
  GNSS_VERTICAL_SPEED_TOO_HIGH: '静止时GNSS垂直速度过大',
  GNSS_NOT_FUSED: 'GNSS尚未进入EKF融合',
  ABSOLUTE_HORIZONTAL_POSITION_INVALID: 'EKF绝对水平位置解无效'
});

const STATE_DETAILS = Object.freeze({
  GNSS_SPOOFING_DETECTED: '当前：已检测到欺骗信号',
  GNSS_JAMMING_DETECTED: '当前：已检测到干扰信号',
  GNSS_FAULT: '当前：GNSS故障标志已置位',
  TILT_NOT_ALIGNED: '当前：未对准 / 要求：已对准',
  YAW_NOT_ALIGNED: '当前：未对准 / 要求：已对准',
  ABSOLUTE_HORIZONTAL_POSITION_INVALID: '当前：无效 / 要求：有效'
});

const REASONS_WITHOUT_VALUE_DETAILS = new Set([
  'DIAGNOSTIC_DATA_UNAVAILABLE',
  'EKF_POSITION_DATA_INVALID'
]);

const FIX_LABELS = Object.freeze({
  0: '无定位',
  1: '无定位',
  2: '二维定位',
  3: '三维定位',
  4: '差分定位',
  5: 'RTK浮点',
  6: 'RTK固定',
  8: '推算定位'
});

const DISPLAY_OPERATORS = Object.freeze({'>=': '≥', '<=': '≤', '=': '='});

function optionalFiniteNumber(value) {
  if (value === null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value) {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function formatMeasurement(value, unit) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  const number = optionalFiniteNumber(value);
  if (number === null) return '数值暂不可用';
  return `${formatNumber(number)}${unit || ''}`;
}

function formatFix(value) {
  const number = optionalFiniteNumber(value);
  if (number === null) return '数值暂不可用';
  return `${formatNumber(number)}（${FIX_LABELS[number] || '未知类型'}）`;
}

function formatDetails(data) {
  const stateDetail = STATE_DETAILS[data.reason_code];
  if (stateDetail) return stateDetail;

  const parameter = typeof data.threshold_parameter === 'string'
      && data.threshold_parameter.trim()
    ? data.threshold_parameter.trim()
    : null;
  const operator = typeof data.threshold_operator === 'string'
    ? (DISPLAY_OPERATORS[data.threshold_operator] || data.threshold_operator)
    : '';
  const unit = typeof data.unit === 'string' ? data.unit : '';
  const isFix = data.reason_code === 'GNSS_FIX_INSUFFICIENT';
  const current = isFix
    ? formatFix(data.current_value)
    : formatMeasurement(data.current_value, unit);
  const threshold = isFix
    ? formatFix(data.threshold_value)
    : formatMeasurement(data.threshold_value, unit);

  let detail = `当前 ${current} / 要求 ${operator}${threshold}`;
  if (parameter) detail += `（阈值 ${parameter}）`;
  return detail;
}

export function formatEkfHealth(data) {
  if (!data || typeof data.healthy !== 'boolean') {
    throw new Error('INVALID_RESULT');
  }
  if (data.healthy) return 'EKF健康状态：健康';

  const label = REASON_LABELS[data.reason_code];
  if (!label) throw new Error('INVALID_RESULT');
  if (REASONS_WITHOUT_VALUE_DETAILS.has(data.reason_code)) {
    return `EKF健康状态：异常 — ${label}`;
  }
  return `EKF健康状态：异常 — ${label}（${formatDetails(data)}）`;
}

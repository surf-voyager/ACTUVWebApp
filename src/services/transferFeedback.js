export const TRANSFER_FEEDBACK_TIMEOUT_MS = 20000;

const BASE_OPTIONS = Object.freeze({
  offset: 28,
  showClose: false,
  grouping: false
});

export function transferFeedbackOptions(state) {
  if (state === 'sending') {
    return {
      ...BASE_OPTIONS,
      message: '发送中',
      type: 'info',
      duration: 0,
      customClass: 'actuv-transfer-feedback is-sending'
    };
  }
  if (state === 'success') {
    return {
      ...BASE_OPTIONS,
      message: '发送成功',
      type: 'success',
      duration: 2500,
      customClass: 'actuv-transfer-feedback is-success'
    };
  }
  return {
    ...BASE_OPTIONS,
    message: state === 'timeout' ? '发送超时' : '发送失败',
    type: 'error',
    duration: 3500,
    customClass: 'actuv-transfer-feedback is-error'
  };
}

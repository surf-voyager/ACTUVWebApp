import test from 'node:test';
import assert from 'node:assert/strict';

import {transferFeedbackOptions} from '../src/services/transferFeedback.js';

test('sending feedback remains visible until an acknowledgement', () => {
  const options = transferFeedbackOptions('sending');
  assert.equal(options.message, '发送中');
  assert.equal(options.duration, 0);
  assert.match(options.customClass, /is-sending/);
});

test('successful acknowledgement produces the green completion message', () => {
  const options = transferFeedbackOptions('success');
  assert.equal(options.message, '发送成功');
  assert.equal(options.type, 'success');
  assert.match(options.customClass, /is-success/);
});

test('failed and timed-out transfers never report success', () => {
  assert.equal(transferFeedbackOptions('error').message, '发送失败');
  assert.equal(transferFeedbackOptions('timeout').message, '发送超时');
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  connectionUnavailableCopy,
  isOperationalConnectionReady
} from '../src/services/connectionAccess.js';

test('unlocks task planning only when both backend and PX4 are connected', () => {
  assert.equal(isOperationalConnectionReady(true, true), true);
  assert.equal(isOperationalConnectionReady(false, true), false);
  assert.equal(isOperationalConnectionReady(true, false), false);
  assert.equal(isOperationalConnectionReady(false, false), false);
});

test('reports a backend disconnection before the dependent PX4 state', () => {
  const copy = connectionUnavailableCopy(false, false);

  assert.match(copy.title, /后端服务/);
  assert.match(copy.description, /自动重连后端服务/);
});

test('reports PX4 disconnection when the backend remains connected', () => {
  const copy = connectionUnavailableCopy(true, false);

  assert.match(copy.title, /PX4 飞控/);
  assert.match(copy.description, /后端服务已连接/);
});

test('returns no unavailable message for a fully operational connection', () => {
  assert.equal(connectionUnavailableCopy(true, true), null);
});

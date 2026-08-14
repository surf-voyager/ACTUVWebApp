import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatDiskSpace,
  formatDiskUsageWarning,
  parseDiskSpace
} from '../src/services/diskSpace.js';

const sample = {
  free_bytes: 17_420_000_000,
  total_bytes: 31_270_000_000,
  used_percent: 44.29,
  threshold_percent: 90
};

test('formats decimal GB with two decimal places', () => {
  assert.equal(formatDiskSpace(sample), '17.42 GB / 31.27 GB');
});

test('formats a disk warning with usage and threshold', () => {
  const message = formatDiskUsageWarning(sample);
  assert.match(message, /17\.42 GB \/ 31\.27 GB/);
  assert.match(message, /44\.29%/);
  assert.match(message, /90\.0%/);
  assert.match(message, /清理/);
});

test('rejects malformed or impossible disk usage', () => {
  for (const value of [null, {},
    {free_bytes: null, total_bytes: 1, used_percent: 1},
    {free_bytes: '', total_bytes: 1, used_percent: 1},
    {free_bytes: false, total_bytes: 1, used_percent: 1},
    {free_bytes: -1, total_bytes: 1, used_percent: 1},
    {free_bytes: 2, total_bytes: 1, used_percent: 1},
    {free_bytes: 0, total_bytes: 0, used_percent: 0},
    {free_bytes: 0, total_bytes: 1, used_percent: 101}]) {
    assert.equal(parseDiskSpace(value), null);
  }
});

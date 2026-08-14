import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {buildSystemTimeSyncPayload} from '../src/services/systemTimeSync.js';


test('builds a deterministic frontend clock payload', () => {
    assert.deepEqual(buildSystemTimeSyncPayload({
        now: () => 1786672800123,
        resolveTimezone: () => 'Asia/Shanghai'
    }), {
        client_epoch_ms: 1786672800123,
        client_timezone: 'Asia/Shanghai'
    });
});

test('falls back to UTC when browser timezone lookup fails', () => {
    assert.equal(buildSystemTimeSyncPayload({
        now: () => 1786672800123,
        resolveTimezone: () => {
            throw new Error('unavailable');
        }
    }).client_timezone, 'UTC');
});

test('rejects an invalid browser clock', () => {
    assert.throws(
        () => buildSystemTimeSyncPayload({now: () => Number.NaN}),
        /浏览器系统时间无效/
    );
});

test('sends time sync before vehicle connection on every websocket open', async () => {
    const source = await readFile(
        new URL('../src/store/useGcsStore.js', import.meta.url),
        'utf8'
    );
    const onOpenStart = source.indexOf('nextSocket.onopen = () =>');
    const syncIndex = source.indexOf('CMD_SYNC_SYSTEM_TIME', onOpenStart);
    const connectIndex = source.indexOf('CMD_CONNECT_VEHICLE', onOpenStart);
    assert.ok(onOpenStart >= 0);
    assert.ok(syncIndex > onOpenStart);
    assert.ok(connectIndex > syncIndex);
});

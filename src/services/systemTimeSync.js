export function buildSystemTimeSyncPayload({
    now = () => Date.now(),
    resolveTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
} = {}) {
    const clientEpochMs = Number(now());
    if (!Number.isFinite(clientEpochMs) || !Number.isInteger(clientEpochMs)) {
        throw new TypeError('浏览器系统时间无效');
    }
    let clientTimezone = 'UTC';
    try {
        clientTimezone = String(resolveTimezone() || 'UTC');
    } catch (_) {
        // IANA 时区仅用于诊断；Unix 时间戳仍可正常用于同步。
    }
    return {
        client_epoch_ms: clientEpochMs,
        client_timezone: clientTimezone
    };
}

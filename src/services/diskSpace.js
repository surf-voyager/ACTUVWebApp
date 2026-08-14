const BYTES_PER_GB = 1_000_000_000;

function finiteNonNegative(value) {
  if (value === null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function parseDiskSpace(data) {
  const freeBytes = finiteNonNegative(data?.free_bytes);
  const totalBytes = finiteNonNegative(data?.total_bytes);
  const usedPercent = finiteNonNegative(data?.used_percent);
  if (freeBytes === null || totalBytes === null || usedPercent === null
      || totalBytes <= 0 || freeBytes > totalBytes || usedPercent > 100) {
    return null;
  }
  return {freeBytes, totalBytes, usedPercent};
}

export function formatDiskSpace(data) {
  const parsed = parseDiskSpace(data);
  if (!parsed) throw new Error('INVALID_RESULT');
  return `${(parsed.freeBytes / BYTES_PER_GB).toFixed(2)} GB / ${(parsed.totalBytes / BYTES_PER_GB).toFixed(2)} GB`;
}

export function formatDiskUsageWarning(data) {
  const parsed = parseDiskSpace(data);
  const threshold = finiteNonNegative(data?.threshold_percent);
  if (!parsed || threshold === null || threshold > 100) {
    throw new Error('INVALID_RESULT');
  }
  return `树莓派磁盘空间不足，当前剩余 ${formatDiskSpace(data)}，已使用 ${parsed.usedPercent.toFixed(2)}%（告警阈值 ${threshold.toFixed(1)}%）。请及时下载并清理日志或其他无用文件。`;
}

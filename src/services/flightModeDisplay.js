export function formatFlightModeForDisplay(mode, connected) {
  if (connected !== true) return '未知';

  const value = String(mode ?? '').trim();
  if (!value || value.toUpperCase() === 'UNKNOWN') return '未知';
  if (value.toUpperCase() === 'RETURN_TO_LAUNCH') return 'RTL';
  return value;
}

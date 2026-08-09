export const MISSION_HOLD_DISPOSITION = Object.freeze({
  COMPLETE: 'COMPLETE',
  RECOVER: 'RECOVER',
  IGNORE: 'IGNORE',
})

export function missionHoldDisposition({
  flightMode,
  missionState,
  current,
  total,
  elapsedSinceStartMs,
  recoveryWindowMs = 5000,
}) {
  if (flightMode !== 'HOLD' || missionState !== 'EXECUTING') {
    return MISSION_HOLD_DISPOSITION.IGNORE
  }

  const currentIndex = Number(current)
  const totalCount = Number(total)
  if (Number.isFinite(currentIndex) && Number.isFinite(totalCount)
      && totalCount > 0 && currentIndex >= totalCount) {
    return MISSION_HOLD_DISPOSITION.COMPLETE
  }

  const elapsed = Number(elapsedSinceStartMs)
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < recoveryWindowMs) {
    return MISSION_HOLD_DISPOSITION.RECOVER
  }

  return MISSION_HOLD_DISPOSITION.IGNORE
}

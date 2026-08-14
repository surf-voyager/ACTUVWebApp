<template>
  <div
      v-if="isVisible"
      class="geofence-breach-layer"
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
  >
    <section class="geofence-breach-alert">
      <svg
          class="geofence-ring"
          viewBox="0 0 220 220"
          aria-hidden="true"
      >
        <circle class="ring-glow" cx="110" cy="110" r="101" />
        <circle class="ring-dashes" cx="110" cy="110" r="101" />
      </svg>
      <div class="alert-content">
        <span class="alert-mark" aria-hidden="true">!</span>
        <strong>超出地理围栏</strong>
      </div>
    </section>
  </div>
</template>

<script setup>
import {onUnmounted, ref, watch} from 'vue';
import {storeToRefs} from 'pinia';
import {useGcsStore} from '../../store/useGcsStore';
import {
  GEOFENCE_ALERT_DISPLAY_DURATION_MS,
  shouldPresentGeofenceAlert
} from '../../services/geofenceAlert';
import {
  startGeofenceAlarmAudio,
  stopGeofenceAlarmAudio
} from '../../services/leakAlarmAudio';

const store = useGcsStore();
const {geofenceAlert} = storeToRefs(store);
const isVisible = ref(false);
let hideTimer = null;
const shownEventStorageKey = 'actuv.geofence-alert.last-shown-event-id';

const readShownEventId = () => {
  try {
    return window.sessionStorage.getItem(shownEventStorageKey);
  } catch (_) {
    return null;
  }
};

const rememberShownEventId = (eventId) => {
  try {
    window.sessionStorage.setItem(shownEventStorageKey, eventId);
  } catch (_) {
    // 存储被禁用时仍正常显示告警，仅无法跨刷新去重。
  }
};

const clearHideTimer = () => {
  if (hideTimer === null) return;
  clearTimeout(hideTimer);
  hideTimer = null;
};

watch(() => [
  geofenceAlert.value.active,
  geofenceAlert.value.breachEventId
], ([active, eventId]) => {
  clearHideTimer();
  if (!active) {
    isVisible.value = false;
    return;
  }
  if (!shouldPresentGeofenceAlert(
      geofenceAlert.value, readShownEventId()
  )) {
    isVisible.value = false;
    return;
  }
  if (eventId) rememberShownEventId(eventId);
  isVisible.value = true;
  hideTimer = setTimeout(() => {
    hideTimer = null;
    isVisible.value = false;
  }, GEOFENCE_ALERT_DISPLAY_DURATION_MS);
}, {immediate: true});

watch(isVisible, (visible) => {
  if (visible) startGeofenceAlarmAudio();
  else stopGeofenceAlarmAudio();
}, {immediate: true});

onUnmounted(() => {
  clearHideTimer();
  stopGeofenceAlarmAudio();
});
</script>

<style scoped>
.geofence-breach-layer {
  position: absolute;
  top: 41%;
  left: 50%;
  z-index: 6500;
  transform: translate(-50%, -50%);
  pointer-events: none !important;
}

.geofence-breach-alert {
  position: relative;
  display: grid;
  width: clamp(178px, 18vw, 220px);
  aspect-ratio: 1;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  background: rgba(138, 7, 15, 0.62);
  box-shadow:
    inset 0 0 32px rgba(255, 79, 87, 0.24),
    0 0 28px rgba(255, 33, 45, 0.55),
    0 14px 42px rgba(0, 0, 0, 0.48);
  backdrop-filter: blur(7px);
  animation: geofence-pulse 1.35s ease-in-out infinite alternate;
}

.geofence-ring {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.ring-glow,
.ring-dashes {
  fill: none;
  vector-effect: non-scaling-stroke;
}

.ring-glow {
  stroke: rgba(255, 70, 80, 0.3);
  stroke-width: 10;
}

.ring-dashes {
  stroke: #ff4652;
  stroke-width: 5;
  stroke-linecap: round;
  stroke-dasharray: 13 9;
  animation: geofence-dash-flow 0.7s linear infinite;
}

.alert-content {
  position: relative;
  display: flex;
  align-items: center;
  flex-direction: column;
  color: #fff;
  text-align: center;
  text-shadow: 0 2px 8px rgba(80, 0, 4, 0.78);
}

.alert-mark {
  margin-top: -10px;
  font-family: Arial, sans-serif;
  font-size: clamp(72px, 8vw, 96px);
  font-weight: 900;
  line-height: 0.95;
}

.alert-content strong {
  margin-top: 9px;
  font-size: clamp(17px, 1.8vw, 22px);
  font-weight: 900;
  letter-spacing: 0.08em;
  white-space: nowrap;
}

@keyframes geofence-dash-flow {
  to { stroke-dashoffset: -44; }
}

@keyframes geofence-pulse {
  from {
    box-shadow:
      inset 0 0 26px rgba(255, 79, 87, 0.2),
      0 0 20px rgba(255, 33, 45, 0.42),
      0 14px 42px rgba(0, 0, 0, 0.48);
  }
  to {
    box-shadow:
      inset 0 0 38px rgba(255, 79, 87, 0.3),
      0 0 38px rgba(255, 33, 45, 0.7),
      0 14px 42px rgba(0, 0, 0, 0.48);
  }
}

@media (prefers-reduced-motion: reduce) {
  .geofence-breach-alert,
  .ring-dashes {
    animation: none;
  }
}
</style>

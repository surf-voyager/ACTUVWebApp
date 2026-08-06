<template>
  <div
      v-if="isVisible"
      class="leak-alert-layer"
      :class="routePositionClass"
      aria-live="assertive"
  >
    <section
        class="leak-alert-card"
        :class="isLeakPanel ? 'is-leak' : 'is-fault'"
        role="alert"
        aria-atomic="true"
    >
      <div class="alert-heading">
        <el-icon class="alert-icon"><WarningFilled /></el-icon>
        <div>
          <h2>{{ alertTitle }}</h2>
          <p>{{ alertDescription }}</p>
        </div>
      </div>

      <div v-if="isLeakPanel && leakAlert.sensorFault" class="sensor-fault-strip">
        漏水传感器故障，当前漏水状态无法确认
      </div>

      <div v-if="leakAlert.rtlMessage && isLeakPanel" class="rtl-result" :class="rtlResultClass">
        {{ leakAlert.rtlMessage }}
      </div>

      <button
          v-if="showReturnButton"
          class="return-button"
          :disabled="returnButtonDisabled"
          @click="confirmReturnToLaunch"
      >
        {{ returnButtonText }}
      </button>
    </section>
  </div>
</template>

<script setup>
import {computed, onUnmounted, watch} from 'vue';
import {storeToRefs} from 'pinia';
import {useRoute} from 'vue-router';
import {ElMessageBox} from 'element-plus';
import {WarningFilled} from '@element-plus/icons-vue';
import {useGcsStore} from '../../store/useGcsStore';
import {startLeakAlarmAudio, stopLeakAlarmAudio} from '../../services/leakAlarmAudio';

const store = useGcsStore();
const route = useRoute();
const {leakAlert, vehicle, isWsConnected} = storeToRefs(store);

const isVisible = computed(() => leakAlert.value.phase !== 'NORMAL');
const isLeakPanel = computed(() => [
  'LEAK_ACTIVE',
  'LEAK_UNKNOWN',
  'LEAK_LINGER',
  'LEAK_WITH_SENSOR_FAULT'
].includes(leakAlert.value.phase));

const routePositionClass = computed(() => (
  route.name === 'planner' ? 'position-planner' : 'position-dashboard'
));

const alertTitle = computed(() => {
  if (leakAlert.value.phase === 'LEAK_LINGER') return '漏水信号已停止，持续观察';
  if (leakAlert.value.phase === 'SENSOR_FAULT_LINGER') return '漏水传感器已恢复，持续观察';
  if (isLeakPanel.value) return '检测到舱内漏水';
  return '漏水传感器故障';
});

const alertDescription = computed(() => {
  if (leakAlert.value.phase === 'LEAK_UNKNOWN') return '通信中断，漏水状态未知，请立即检查';
  if (leakAlert.value.phase === 'LEAK_LINGER') {
    return `漏水信号持续观察中，面板将在 ${leakAlert.value.lingerRemainingSeconds} 秒后关闭`;
  }
  if (leakAlert.value.phase === 'SENSOR_FAULT_LINGER') {
    return `传感器通信已恢复，面板将在 ${leakAlert.value.lingerRemainingSeconds} 秒后关闭`;
  }
  if (isLeakPanel.value) return '请立即检查舱体状态，并评估是否返航';
  return '舱内状态未知，请检查传感器和 GPIO 接线';
});

const showReturnButton = computed(() => isLeakPanel.value && leakAlert.value.phase !== 'LEAK_LINGER');
const returnButtonDisabled = computed(() => (
  leakAlert.value.rtlStatus === 'PENDING'
  || leakAlert.value.rtlStatus === 'SUCCESS'
  || leakAlert.value.communicationLost
  || !isWsConnected.value
));
const returnButtonText = computed(() => {
  if (leakAlert.value.rtlStatus === 'PENDING') return '正在请求返航…';
  if (leakAlert.value.rtlStatus === 'SUCCESS') return '返航指令已接受';
  return '是否返航';
});
const rtlResultClass = computed(() => (
  leakAlert.value.rtlStatus === 'ERROR' ? 'is-error' : 'is-success'
));
const shouldPlayAlarm = computed(() => (
  leakAlert.value.detected
  && leakAlert.value.phase !== 'LEAK_LINGER'
));

watch(shouldPlayAlarm, (shouldPlay) => {
  if (shouldPlay) startLeakAlarmAudio();
  else stopLeakAlarmAudio();
}, {immediate: true});

const confirmReturnToLaunch = async () => {
  if (!isWsConnected.value || !vehicle.value.connected || !vehicle.value.armed) {
    store.requestLeakReturn();
    return;
  }

  try {
    await ElMessageBox.confirm(
      '舱内正在发生漏水。确认立即执行返航吗？',
      '漏水返航确认',
      {
        confirmButtonText: '确认返航',
        cancelButtonText: '暂不返航',
        type: 'error',
        customClass: 'hud-message-box',
        distinguishCancelAndClose: true
      }
    );
    store.requestLeakReturn();
  } catch (_) {
    // “暂不返航”只关闭确认框，不改变告警、声音或后端状态。
  }
};

onUnmounted(() => stopLeakAlarmAudio());
</script>

<style scoped>
.leak-alert-layer {
  position: absolute;
  z-index: 6000;
  width: min(370px, calc(100vw - 32px));
  pointer-events: none;
}

.position-dashboard {
  left: 300px;
  top: 140px;
}

.position-planner {
  left: 20px;
  top: 100px;
}

.leak-alert-card {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  padding: 18px 20px;
  overflow: hidden;
  border-radius: 14px;
  color: #fff;
  text-align: left;
  pointer-events: auto;
  backdrop-filter: blur(12px);
}

.leak-alert-card.is-leak {
  background:
    repeating-linear-gradient(90deg, #ff4d4f 0 9px, transparent 9px 17px) 0 0 / 200% 3px no-repeat,
    repeating-linear-gradient(180deg, #ff4d4f 0 9px, transparent 9px 17px) 100% 0 / 3px 200% no-repeat,
    repeating-linear-gradient(270deg, #ff4d4f 0 9px, transparent 9px 17px) 100% 100% / 200% 3px no-repeat,
    repeating-linear-gradient(0deg, #ff4d4f 0 9px, transparent 9px 17px) 0 100% / 3px 200% no-repeat,
    rgba(92, 8, 12, 0.78);
  box-shadow: 0 0 26px rgba(255, 50, 55, 0.62), 0 12px 32px rgba(0, 0, 0, 0.48);
  animation: leak-dash-flow 0.8s linear infinite, leak-glow 1.4s ease-in-out infinite alternate;
}

.leak-alert-card.is-fault {
  border: 2px solid #e6a23c;
  background: rgba(104, 61, 4, 0.8);
  box-shadow: 0 0 22px rgba(230, 162, 60, 0.44), 0 12px 32px rgba(0, 0, 0, 0.42);
}

.alert-heading {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.alert-icon {
  flex: 0 0 auto;
  margin-top: 2px;
  font-size: 30px;
  color: #fff2f2;
}

.is-fault .alert-icon {
  color: #ffe2ac;
}

h2 {
  margin: 0;
  font-size: 21px;
  line-height: 1.25;
  font-weight: 900;
  letter-spacing: 0.02em;
}

p {
  margin: 7px 0 0;
  color: rgba(255, 255, 255, 0.88);
  font-size: 14px;
  line-height: 1.5;
}

.sensor-fault-strip {
  margin-top: 14px;
  padding: 9px 11px;
  border: 1px solid rgba(255, 196, 92, 0.85);
  border-radius: 8px;
  background: rgba(126, 74, 0, 0.78);
  color: #fff0cc;
  font-size: 13px;
  font-weight: 700;
}

.rtl-result {
  margin-top: 12px;
  font-size: 13px;
  font-weight: 700;
}

.rtl-result.is-success {
  color: #b9f6ca;
}

.rtl-result.is-error {
  color: #ffd0d0;
}

.return-button {
  width: 100%;
  margin-top: 15px;
  padding: 10px 14px;
  border: 1px solid rgba(255, 255, 255, 0.68);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.94);
  color: #9f1117;
  font-size: 15px;
  font-weight: 900;
  cursor: pointer;
  transition: transform 0.15s ease, background-color 0.15s ease;
}

.return-button:hover:not(:disabled) {
  border-color: #fff;
  background: #fff;
  transform: translateY(-1px);
}

.return-button:focus-visible {
  outline: 3px solid #fff;
  outline-offset: 3px;
}

.return-button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

@keyframes leak-dash-flow {
  to {
    background-position: 17px 0, 100% 17px, calc(100% - 17px) 100%, 0 calc(100% - 17px), 0 0;
  }
}

@keyframes leak-glow {
  from { box-shadow: 0 0 18px rgba(255, 50, 55, 0.42), 0 12px 32px rgba(0, 0, 0, 0.48); }
  to { box-shadow: 0 0 32px rgba(255, 50, 55, 0.78), 0 12px 32px rgba(0, 0, 0, 0.48); }
}

@media (max-width: 900px) {
  .position-dashboard,
  .position-planner {
    top: 140px;
    left: 50%;
    transform: translateX(-50%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .leak-alert-card.is-leak {
    animation: none;
  }

  .return-button {
    transition: none;
  }
}
</style>

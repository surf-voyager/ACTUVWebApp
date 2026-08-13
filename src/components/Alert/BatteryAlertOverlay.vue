<template>
  <div
    v-if="isVisible"
    class="battery-alert-layer"
    :class="[routePositionClass, { 'with-leak-alert': leakVisible }]"
    aria-live="assertive"
  >
    <section class="battery-alert-card" :class="isLowBattery ? 'is-low' : 'is-fault'" role="alert">
      <div class="alert-heading">
        <el-icon class="alert-icon"><WarningFilled /></el-icon>
        <div>
          <h2>{{ alertTitle }}</h2>
          <p>{{ alertDescription }}</p>
        </div>
      </div>

      <div class="battery-values">
        <span>总电压 <strong>{{ voltageText }}</strong></span>
        <span>低压阈值 <strong>{{ thresholdText }}</strong></span>
        <span>剩余电量 <strong>{{ remainingText }}</strong></span>
      </div>

      <div v-if="batteryAlert.communicationLost" class="communication-warning">
        机载服务通信中断，无法确认当前电池状态
      </div>

      <div v-if="batteryAlert.returnMessage" class="return-result" :class="returnResultClass">
        {{ batteryAlert.returnMessage }}
      </div>

      <button class="return-button" :disabled="returnButtonDisabled" @click="confirmReturnToLaunch">
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
import {
  startBatteryAlarmAudio,
  stopBatteryAlarmAudio
} from '../../services/leakAlarmAudio';
import {
  batteryFaultMessage,
  isBatteryAlertState,
  isBatteryDataFaultState,
  isLowBatteryState
} from '../../services/batterySafety';

const store = useGcsStore();
const route = useRoute();
const {batteryAlert, leakAlert, vehicle, isWsConnected} = storeToRefs(store);

const isVisible = computed(() => isBatteryAlertState(vehicle.value.battery.safety_state));
const isLowBattery = computed(() => isLowBatteryState(vehicle.value.battery.safety_state));
const hasDataFault = computed(() => isBatteryDataFaultState(vehicle.value.battery.safety_state));
const leakVisible = computed(() => leakAlert.value.phase !== 'NORMAL');
const routePositionClass = computed(() => (
  route.name === 'planner' ? 'position-planner' : 'position-dashboard'
));

const alertTitle = computed(() => {
  if (vehicle.value.battery.safety_state === 'LOW_BATTERY_DATA_FAULT') {
    return '低电压且电池数据异常';
  }
  return isLowBattery.value ? '检测到低电压' : '电池数据异常';
});
const alertDescription = computed(() => {
  if (batteryAlert.value.communicationLost) return '请检查机载服务连接，并评估是否返航';
  if (hasDataFault.value) {
    return `${batteryFaultMessage(vehicle.value.battery.fault_code)}，请检查 BMS 并评估是否返航`;
  }
  return '动力电池总电压已连续达到低压阈值，请评估是否返航';
});
const voltageText = computed(() => {
  const value = Number(vehicle.value.battery.voltage_v);
  return Number.isFinite(value) && value > 0 ? `${value.toFixed(2)} V` : '--';
});
const remainingText = computed(() => {
  const rawValue = vehicle.value.battery.remaining_percent;
  if (rawValue === null || rawValue === undefined || rawValue === '') return '--';
  const value = Number(rawValue);
  return Number.isFinite(value) ? `${value.toFixed(0)}%` : '--';
});
const thresholdText = computed(() => {
  const value = Number(vehicle.value.battery.low_battery_threshold_voltage_v);
  return value === 0 ? '已禁用' : `${value.toFixed(1)} V`;
});
const returnButtonDisabled = computed(() => (
  batteryAlert.value.returnStatus === 'PENDING'
  || batteryAlert.value.returnStatus === 'SUCCESS'
  || batteryAlert.value.communicationLost
  || !isWsConnected.value
  || !vehicle.value.connected
));
const returnButtonText = computed(() => {
  if (batteryAlert.value.returnStatus === 'PENDING') return '正在请求返航…';
  if (batteryAlert.value.returnStatus === 'SUCCESS') return '已进入返航模式';
  if (batteryAlert.value.returnStatus === 'ERROR') return '重新确认返航';
  return '是否返航';
});
const returnResultClass = computed(() => (
  batteryAlert.value.returnStatus === 'ERROR' ? 'is-error' : 'is-success'
));
const shouldPlayAlarm = computed(() => (
  isVisible.value
  && isLowBattery.value
  && !batteryAlert.value.soundSilenced
));

watch(shouldPlayAlarm, (shouldPlay) => {
  if (shouldPlay) startBatteryAlarmAudio();
  else stopBatteryAlarmAudio();
}, {immediate: true});

const confirmReturnToLaunch = async () => {
  try {
    await ElMessageBox.confirm(
      hasDataFault.value
        ? '当前无法确认电池数据。确认立即返航吗？必要时后端将自动解锁飞控。'
        : '当前已确认低电压。确认立即返航吗？必要时后端将自动解锁飞控。',
      '电池安全返航确认',
      {
        confirmButtonText: '确认返航',
        cancelButtonText: '暂不返航',
        type: 'error',
        customClass: 'hud-message-box',
        distinguishCancelAndClose: true
      }
    );
    store.requestBatteryReturn();
  } catch (_) {
    // 暂不返航：保持面板；低电压声音继续播放。
  }
};

onUnmounted(() => stopBatteryAlarmAudio());
</script>

<style scoped>
.battery-alert-layer {
  position: absolute;
  z-index: 5900;
  width: min(370px, calc(100vw - 32px));
  pointer-events: none;
}

.position-dashboard { left: 300px; top: 140px; }
.position-planner { left: 20px; top: 100px; }
.position-dashboard.with-leak-alert { top: 390px; }
.position-planner.with-leak-alert { top: 350px; }

.battery-alert-card {
  box-sizing: border-box;
  width: 100%;
  padding: 18px 20px;
  border: 1px solid transparent;
  border-radius: 14px;
  color: #fff;
  pointer-events: auto;
  backdrop-filter: blur(12px);
}

.battery-alert-card.is-low {
  border-color: rgba(255, 111, 64, 0.82);
  background: rgba(111, 35, 12, 0.84);
  box-shadow: 0 0 24px rgba(255, 82, 45, 0.48), 0 12px 32px rgba(0, 0, 0, 0.46);
}

.battery-alert-card.is-fault {
  border-color: rgba(230, 162, 60, 0.78);
  background: rgba(89, 61, 13, 0.86);
  box-shadow: 0 0 20px rgba(230, 162, 60, 0.34), 0 12px 32px rgba(0, 0, 0, 0.44);
}

.alert-heading { display: flex; align-items: flex-start; gap: 12px; }
.alert-icon { flex: 0 0 auto; margin-top: 2px; color: #ffd04b; font-size: 28px; }
.alert-heading h2 { margin: 0 0 5px; font-size: 20px; }
.alert-heading p { margin: 0; color: rgba(255,255,255,0.82); font-size: 13px; line-height: 1.45; }

.battery-values {
  display: flex;
  justify-content: space-between;
  margin-top: 14px;
  padding: 9px 10px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);
  color: rgba(255,255,255,0.72);
  font-size: 12px;
}
.battery-values strong { margin-left: 4px; color: #fff; font-size: 14px; }

.communication-warning,
.return-result {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.2);
  font-size: 12px;
}
.communication-warning,
.return-result.is-error { color: #ffb3b3; }
.return-result.is-success { color: #b8f5c8; }

.return-button {
  width: 100%;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(255,255,255,0.32);
  border-radius: 8px;
  background: rgba(255,255,255,0.13);
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}
.return-button:hover:not(:disabled) { background: rgba(255,255,255,0.22); }
.return-button:disabled { cursor: not-allowed; opacity: 0.5; }

@media (max-height: 700px) {
  .position-dashboard.with-leak-alert,
  .position-planner.with-leak-alert { top: 330px; }
  .battery-alert-card { padding: 14px 16px; }
}
</style>

<template>
  <el-container class="app-wrapper">
    <div class="map-layer">
      <BaseMap ref="mapRef"/>
    </div>

    <div class="ui-layer">
      <router-view v-slot="{ Component }">
        <keep-alive>
          <component :is="Component"/>
        </keep-alive>
      </router-view>
      <LeakAlertOverlay />
      <BatteryAlertOverlay />
      <GeofenceBreachOverlay />
      <el-dialog
          :model-value="store.diskUsageWarning.pending"
          title="磁盘空间告警"
          width="480px"
          class="hud-dialog disk-usage-warning-dialog"
          align-center
          append-to-body
          :show-close="false"
          :close-on-click-modal="false"
          :close-on-press-escape="false"
      >
        <p class="disk-usage-warning-message">
          {{ store.diskUsageWarning.message }}
        </p>
        <template #footer>
          <el-button type="warning" @click="confirmDiskUsageWarning">
            我知道了
          </el-button>
        </template>
      </el-dialog>
<!--      <div class="global-map-controls">-->
<!--        <el-tooltip content="定位到船只" placement="left">-->
<!--          <button class="control-btn" @click="handleFocusBoat">-->
<!--            <el-icon>-->
<!--              <Aim/>-->
<!--            </el-icon>-->
<!--          </button>-->
<!--        </el-tooltip>-->
<!--      </div>-->
      <div class="bottom-dock">
        <el-radio-group v-model="currentTab" @change="handleTabChange" class="glass-nav">
          <el-radio-button value="dashboard">
            <el-icon>
              <Monitor/>
            </el-icon>
            监控站
          </el-radio-button>
          <el-radio-button value="planner" :disabled="!navigationUnlocked">
            <el-icon>
              <MapLocation/>
            </el-icon>
            任务规划
          </el-radio-button>
        </el-radio-group>
      </div>
    </div>
  </el-container>
</template>

<script setup>
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import {useRoute, useRouter} from 'vue-router'
import {useGcsStore} from './store/useGcsStore'
import BaseMap from './components/Map/BaseMap.vue'
import LeakAlertOverlay from './components/Alert/LeakAlertOverlay.vue'
import BatteryAlertOverlay from './components/Alert/BatteryAlertOverlay.vue'
import GeofenceBreachOverlay from './components/Alert/GeofenceBreachOverlay.vue'
import {MapLocation, Monitor,Aim} from '@element-plus/icons-vue'
import {disposeLeakAlarmAudio, primeLeakAlarmAudio} from './services/leakAlarmAudio'
import {isOperationalConnectionReady} from './services/connectionAccess'
const mapRef = ref(null)
const router = useRouter()
const route = useRoute()
const store = useGcsStore()
const currentTab = ref('dashboard')
const navigationUnlocked = computed(() =>
  isOperationalConnectionReady(store.isWsConnected, store.vehicle.connected)
)

const handleTabChange = (val) => {
  if (val === 'planner' && !navigationUnlocked.value) {
    currentTab.value = 'dashboard'
    return
  }
  router.push(`/${val}`)
}

watch(
  [() => route.name, navigationUnlocked],
  ([routeName, unlocked]) => {
    if (!unlocked && routeName !== 'dashboard') {
      currentTab.value = 'dashboard'
      void router.replace('/dashboard')
      return
    }

    currentTab.value = routeName === 'planner' ? 'planner' : 'dashboard'
  },
  {immediate: true}
)

// 调用地图组件的定位方法
const handleFocusBoat = () => {
  if (mapRef.value) {
    mapRef.value.focusBoat()
  }
}
const handleSaveCurrentMap = () => {
  if (mapRef.value) {
    mapRef.value.saveCurrentArea();
  }
}
// --- 添加这段监听代码 ---
watch(() => store.mapTriggers.centerMap, (newVal) => {
  if (newVal) {
    handleFocusBoat(); // 执行父组件的定位逻辑
    store.mapTriggers.centerMap = false; // 立即复位，保证下次点击还能触发
  }
});
watch(() => store.mapTriggers.saveCurrentMap, (newVal) => {
  if (newVal) {
    handleSaveCurrentMap();
  }
});
const confirmDiskUsageWarning = () => {
  const generation = store.diskUsageWarning.connectionGeneration;
  store.acknowledgeDiskUsageWarning(generation);
  store.clearDiskUsageWarning(generation);
};
const activateAlarmAudio = () => {
  void primeLeakAlarmAudio();
};

const audioActivationOptions = {once: true, capture: true};

onMounted(() => {
  store.startLeakAlertWatchdog();
  store.startPropulsionFeedbackWatchdog();
  store.startNtripClient();
  store.connectWebSocket();
  window.addEventListener('pointerdown', activateAlarmAudio, audioActivationOptions);
  window.addEventListener('touchstart', activateAlarmAudio, audioActivationOptions);
  window.addEventListener('keydown', activateAlarmAudio, audioActivationOptions);
})

onUnmounted(() => {
  store.stopLeakAlertWatchdog();
  store.stopPropulsionFeedbackWatchdog();
  store.stopNtripClient();
  window.removeEventListener('pointerdown', activateAlarmAudio, true);
  window.removeEventListener('touchstart', activateAlarmAudio, true);
  window.removeEventListener('keydown', activateAlarmAudio, true);
  void disposeLeakAlarmAudio();
})
</script>

<style>
/* 全局样式保持不变 */
html, body, #app {
  margin: 0;
  padding: 0;
  height: 100%;
  width: 100%;
  overflow: hidden;
  font-family: Arial, sans-serif;
}

.app-wrapper {
  height: 100vh;
  background: #000;
  position: relative;
}

.map-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
}

.ui-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 10;
  pointer-events: none;
}

.ui-layer > * {
  pointer-events: auto;
}

.view-container {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.disk-usage-warning-message {
  margin: 0;
  line-height: 1.75;
  color: #ddd;
}

/* --- 底部 Dock 栏 --- */
.bottom-dock {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2000;
  /* 增加阴影提升层次感 */
  filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.5));
}

/* 玻璃拟态导航按钮 */
.glass-nav .el-radio-button__inner {
  background: rgba(20, 20, 20, 0.75) !important;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2) !important;
  color: #ccc !important;
  box-shadow: none !important;
  padding: 12px 24px !important;
  font-weight: bold;
  font-size: 14px;
}

/* 选中状态 */
.glass-nav .el-radio-button__original-radio:checked + .el-radio-button__inner {
  background: rgba(64, 158, 255, 0.8) !important; /* 蓝色高亮 */
  color: white !important;
  border-color: #409EFF !important;
  box-shadow: 0 0 15px rgba(64, 158, 255, 0.4) !important;
}

/* 圆角处理: 左边圆，右边圆 */
.glass-nav .el-radio-button:first-child .el-radio-button__inner {
  border-radius: 24px 0 0 24px;
}

.glass-nav .el-radio-button:last-child .el-radio-button__inner {
  border-radius: 0 24px 24px 0;
}
/* [新增] 全局地图控制按钮样式 */
.global-map-controls {
  position: absolute;
  /* 放在右下侧，避开底部 Dock 和 摇杆 */
  bottom: 140px;
  right: 20px;
  z-index: 3000; /* 确保层级最高，超过 Dashboard */
  pointer-events: auto; /* 恢复点击 */
}

.control-btn {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background-color: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(4px);
  border: 1px solid rgba(0,0,0,0.1);
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  cursor: pointer;
  display: flex;
  justify-content: center;
  align-items: center;
  color: #333;
  font-size: 22px;
  transition: all 0.2s;
}

.control-btn:hover {
  background-color: #409EFF;
  color: white;
  transform: scale(1.1);
}

.control-btn:active {
  transform: scale(0.95);
}
</style>

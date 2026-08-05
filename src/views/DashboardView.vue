<template>
  <div class="view-container">

    <!-- 左侧：控制面板 -->
    <aside class="side-panel left">
      <div class="panel-header">
        <div class="brand">特种搅池器地面站</div>
        <div class="status-chip" :class="{ 'online': vehicle.connected }">
          {{ vehicle.connected ? '系统在线' : '系统离线' }}
        </div>
      </div>

      <div class="panel-scroll-content">
        <!-- 1. 连接配置 -->
        <section class="panel-section">
          <div class="section-header">
            <el-icon>
              <Link/>
            </el-icon>
            <span>连接配置</span>
          </div>
          <div class="connection-box">
            <div class="status-row">
              <span class="label">后端服务</span>
              <span :class="['status-dot', isWsConnected ? 'success' : 'error']"></span>
            </div>
            <div class="address-row">
              <span class="address">{{ wsUrl }}</span>
              <el-button type="primary" link @click="openWsDialog">更改</el-button>
            </div>
          </div>
        </section>

        <!-- 2. 特种混合器 -->
        <section class="panel-section">
          <div class="section-header">
            <el-icon>
              <Lightning/>
            </el-icon>
            <span>特种混合器</span>
          </div>
          <div class="mode-grid-flat">
            <button class="mode-btn-flat small" :class="{ 'active': vehicle.relay_on }" @click="store.setRelay(true)">
              开启
            </button>
            <button class="mode-btn-flat small" :class="{ 'active': !vehicle.relay_on }" @click="store.setRelay(false)">
              关闭
            </button>
          </div>
        </section>

        <!-- 3. 飞行模式 -->
        <section class="panel-section">
          <div class="section-header">
            <el-icon>
              <Menu/>
            </el-icon>
            <span>飞行模式</span>
          </div>
          <div class="mode-grid-flat">
            <button class="mode-btn-flat small"
                    :class="{ 'active': controlStatus.state === 'manual' }"
                    :disabled="controlStatus.transitioning"
                    @click="handleGroundControlToggle">
              {{ controlStatus.transitioning
                  ? '切换中...'
                  : (controlStatus.state === 'manual' ? '退出地面控制' : '地面控制') }}
            </button>
            <button class="mode-btn-flat small" :class="{ 'active': vehicle.mode === 'MISSION' }"
                    @click="changeMode('MISSION')" :disabled="mission.plannedWaypoints.length === 0">自动任务
            </button>
            <button class="mode-btn-flat small" :class="{ 'active': !vehicle.armed }" @click="handlePause">暂停模式
            </button>
            <button class="mode-btn-flat small" :class="{ 'active': vehicle.mode === 'RETURN_TO_LAUNCH' }"
                    @click="changeMode('RTL')">前往目标
            </button>
          </div>
        </section>

        <!-- 4. 电池设置 -->
        <section class="panel-section">
          <div class="section-header">
            <el-icon>
              <Setting/>
            </el-icon>
            <span>电池设置</span>
          </div>
          <div class="threshold-container">
            <div class="threshold-info">
              <span class="threshold-label">低电量返航阈值</span>
              <span class="threshold-value">{{ vehicle.battery.low_battery_threshold }}%</span>
            </div>
            <el-slider
                v-model="vehicle.battery.low_battery_threshold"
                :min="5"
                :max="50"
                :step="1"
                @change="handleThresholdChange"
                class="hud-slider"
            />
          </div>
        </section>

        <!-- 5. 交互工具 -->
        <section class="panel-section">
          <div class="section-header">
            <el-icon>
              <Tools/>
            </el-icon>
            <span>交互工具</span>
          </div>
          <div class="mode-grid-flat">
            <button class="mode-btn-flat small" @click="handleCenterMap">地图居中</button>
            <button class="mode-btn-flat small" @click="store.clearTrajectory">清除轨迹</button>
          </div>
        </section>

        <!-- 6. 系统维护 -->
        <section class="panel-section">
          <div class="section-header">
            <el-icon>
              <SwitchButton/>
            </el-icon>
            <span>系统维护</span>
          </div>
          <div class="mode-grid-flat">
            <button class="mode-btn-flat small danger-text" @click="store.shutdownFcu">关动力分配</button>
            <button class="mode-btn-flat small danger-text" @click="store.shutdownPi">关机载电脑</button>
          </div>
        </section>
      </div>
    </aside>

    <!-- 右侧：消息与日志面板 -->
    <aside class="side-panel right">
      <div class="panel-header">
        <div class="brand">日志信息</div>
        <div class="status-chip">实时遥测</div>
      </div>

      <div class="panel-scroll-content">
        <!-- 日志透传 -->
        <!-- 消息透传 (原 Notification 内容) -->
        <section class="panel-section messages-section">
          <div class="section-header">
            <el-icon>
              <Bell/>
            </el-icon>
            <span>消息透传</span>
          </div>
          <div class="mini-terminal messages">
            <div v-if="notificationLogs.length === 0" class="empty-log">暂无系统消息</div>
            <div v-for="msg in notificationLogs" :key="msg.id" class="log-line-flat" :class="msg.type">
              <span class="log-time">{{ msg.time }}</span>
              <span class="log-text">【{{ msg.title }}】{{ msg.message }}</span>
            </div>
          </div>
        </section>
        <section class="panel-section logs-section">
          <div class="section-header">
            <el-icon>
              <Document/>
            </el-icon>
            <span>日志透传</span>
          </div>
          <div class="mini-terminal">
            <div v-if="sysLogs.length === 0" class="empty-log">暂无日志</div>
            <div v-for="log in reversedLogs.slice(0, 30)" :key="log.id" class="log-line-flat"
                 :class="getLogLevelClass(log.level)">
              <span class="log-time">{{ log.time }}</span>
              <span class="log-text">{{ log.text }}</span>
            </div>
          </div>
        </section>


      </div>
    </aside>

    <!-- 顶部数据展示 HUD -->
    <div class="hud-top-bar display-only" @wheel="handleHudScroll">
      <div class="telemetry-group">
        <div class="telemetry-item">
          <span class="label">卫星定位</span>
          <div class="val-group">
            <span class="value">{{ vehicle.gps.sats ?? 0 }}<small>颗</small></span>
            <div class="sub-label-wrap"><span class="sub-label">{{ vehicle.gps.fix }}</span></div>
          </div>
        </div>
        <div class="divider"></div>
        <div class="telemetry-item">
          <span class="label">动力电池</span>
          <div class="val-group">
            <span class="value" :style="{ color: getBatColor }">{{ vehicle.battery.remaining_percent ?? 0 }}%</span>
            <div class="sub-label-wrap"><span class="sub-label">{{
                (vehicle.battery.voltage_v ?? 0).toFixed(2)
              }}V | {{ (vehicle.battery.current_a ?? 0).toFixed(1) }}A</span></div>
          </div>
        </div>
        <div class="divider"></div>
        <div class="telemetry-item">
          <span class="label">电机状态</span>
          <div class="val-group">
            <span class="value" :class="vehicle.armed ? 'armed-text' : 'disarmed-text'">{{
                vehicle.armed ? '已解锁' : '已上锁'
              }}</span>
            <div class="sub-label-wrap">
              <button class="hud-stop-btn" @click="handleSystemStop">系统停机</button>
            </div>
          </div>
        </div>
        <div class="divider"></div>
        <div class="telemetry-item">
          <span class="label">运动状态</span>
          <div class="val-group">
            <span class="value">{{ (vehicle.velocity.speed ?? 0).toFixed(1) }}<small>m/s</small></span>
            <div class="sub-label-wrap"><span class="sub-label">实时航向: {{
                (vehicle.attitude.yaw ?? 0).toFixed(0)
              }}°</span></div>
          </div>
        </div>
        <div class="divider"></div>
        <div class="telemetry-item position-item">
          <span class="label">当前位置</span>
          <div class="coords">
            <span>{{ (vehicle.position.lat ?? 0).toFixed(7) }} N</span>
            <span>{{ (vehicle.position.lng ?? 0).toFixed(7) }} E</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部控制面板 -->
    <transition name="slide-up">
      <div class="bottom-dashboard"
           v-if="vehicle.connected && ((controlStatus.state === 'manual' && !controlStatus.transitioning) || vehicle.mode === 'MISSION')">
        <template v-if="controlStatus.state === 'manual' && !controlStatus.transitioning">
          <div class="joystick-box left">
            <div class="joystick-field">
              <VirtualJoystick @update="handleLeftStick" @end="resetLeftStick" lockY/>
            </div>
            <span class="stick-label">油门控制</span>
          </div>
          <div class="center-panel">
              <div class="manual-controls">
                <div class="control-hint">PX4 MANUAL · 推进器直接控制</div>
              </div>
          </div>
          <div class="joystick-box right">
            <div class="joystick-field">
              <VirtualJoystick @update="handleRightStick" @end="resetRightStick" lockX/>
            </div>
            <span class="stick-label">转向控制</span>
          </div>
        </template>
        <template v-else-if="vehicle.mode === 'MISSION'">
          <div class="mission-dashboard">
            <!-- 左侧控制 -->
            <div class="mission-side-btn">
              <div
                  class="hud-action-btn"
                  :class="[missionState === 'EXECUTING' ? 'btn-pause' : 'btn-resume', { 'btn-disabled': missionState === 'PAUSED' && resumeCooldown > 0 }]"
                  @click="controlMission(missionState === 'EXECUTING' ? 'PAUSE' : 'RESUME')"
              >
                <el-icon v-if="missionState === 'EXECUTING'">
                  <VideoPause/>
                </el-icon>
                <el-icon v-else>
                  <VideoPlay/>
                </el-icon>
                <div class="btn-text">
                  <span class="main-text">{{
                      missionState === 'EXECUTING' ? '暂停任务' : (resumeCooldown > 0 ? `等待 (${resumeCooldown}s)` : '继续任务')
                    }}</span>
                </div>
              </div>
            </div>

            <!-- 中间核心数据 -->
            <div class="mission-center-stat">
              <div class="manual-wp-jump">
                <!--                <el-input-number-->
                <!--                    v-model="manualWaypointIndex"-->
                <!--                    :min="1"-->
                <!--                    :max="totalWaypoints"-->
                <!--                    size="small"-->
                <!--                    controls-position="right"-->
                <!--                />-->
                <button class="jump-btn" @click="jumpToWaypoint">航点跳转</button>
              </div>

              <div class="wp-counter">
                <span class="label">航点进度</span>
                <span class="val">{{ currentWaypointIndex }} / {{ totalWaypoints }}</span>
              </div>

              <div class="mission-progress-bar">
                <div class="progress-fill" :style="{ width: missionProgress + '%' }">
                  <div class="glow-head"></div>
                </div>
              </div>

              <div class="mission-status-text">
                系统状态: {{ missionState === 'EXECUTING' ? '正在按计划巡航' : '已暂停，等待指令' }}
              </div>
            </div>

            <!-- 右侧操作 -->
            <div class="mission-side-btn">
              <div class="hud-action-btn btn-abort" @click="cancelMission">
                <el-icon>
                  <SwitchButton/>
                </el-icon>
                <div class="btn-text"><span class="main-text">终止任务</span></div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </transition>

    <div v-if="!vehicle.connected" class="offline-mask">
      <div class="offline-box">
        <el-icon class="rotating-slow">
          <Loading/>
        </el-icon>
        <h2>连接已断开</h2>
        <p>正在尝试自动重连...</p>
        <div class = "ws_disconnect_group panel-background">
        <h3>当前连接地址</h3>
       <p>{{wsUrl}}</p>
        <el-button style="font-weight: 600; font-size: 16px" type="primary" link @click="openWsDialog">更改连接地址</el-button>
        </div>
        </div>
    </div>

    <!-- 弹窗统一样式 -->
    <el-dialog v-model="wsDialog.visible" title="修改后端地址" width="400px" class="hud-dialog" align-center
               append-to-body>
      <el-input v-model="wsDialog.newAddress" placeholder="例如: ws://192.168.1.10:8765"/>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="wsDialog.visible = false" class="hud-btn-cancel">取消</el-button>
          <el-button type="primary" @click="confirmWsChange" class="hud-btn-confirm">确认修改</el-button>
        </span>
      </template>
    </el-dialog>

    <el-dialog v-model="gotoDialog.visible" title="目标设定" width="320px" class="hud-dialog" align-center
               append-to-body>
      <div class="follow-form">
        <div class="form-item"><label>目标经度</label><span class="coord-val">{{
            gotoDialog.target.lng.toFixed(7)
          }}</span></div>
        <div class="form-item"><label>目标纬度</label><span class="coord-val">{{
            gotoDialog.target.lat.toFixed(7)
          }}</span></div>
      </div>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="gotoDialog.visible = false" class="hud-btn-cancel">取消</el-button>
          <el-button type="primary" @click="confirmGoto" class="hud-btn-confirm">确认执行</el-button>
        </span>
      </template>
    </el-dialog>

    <el-dialog v-model="missionStartDialog.visible" title="启动自动任务" width="400px"
               class="hud-dialog mission-start-dialog" align-center append-to-body :show-close="false">
      <div class="mission-start-form">
        <div class="safety-check-group">
          <div class="safety-check-item">
            <span class="label">低电量阈值</span>
            <span class="value warning">{{ vehicle.battery.low_battery_threshold }}%</span>
          </div>
          <div class="safety-check-item">
            <span class="label">目标位置 (Target)</span>
            <span class="value info" v-if="mission.plannedWaypoints.length > 0">
              {{ mission.plannedWaypoints[missionStartDialog.startIndex - 1]?.lat.toFixed(7) }},
              {{ mission.plannedWaypoints[missionStartDialog.startIndex - 1]?.lng.toFixed(7) }}
            </span>
            <span class="value error" v-else>无航点数据</span>
          </div>
        </div>

        <div class="form-setting-row">
          <label>起始航点序号</label>
          <el-input-number v-model="missionStartDialog.startIndex" :min="1" :max="totalWaypoints" size="default"
                           controls-position="right"/>
        </div>
        <div class="mission-meta">共 {{ totalWaypoints }} 个预设航点</div>
      </div>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="missionStartDialog.visible = false" class="hud-btn-cancel">取消</el-button>
          <el-button type="primary" @click="confirmMissionStart" class="hud-btn-confirm">确认并开始</el-button>
        </span>
      </template>
    </el-dialog>

  </div>
</template>

<script setup>
import {computed, onUnmounted, ref, watch} from 'vue';
import {useGcsStore} from '../store/useGcsStore';
import {storeToRefs} from 'pinia';
import VirtualJoystick from '../components/Cockpit/VirtualJoystick.vue';
import {
  Bell,
  Document,
  Lightning,
  Link,
  Loading,
  Menu,
  Setting,
  SwitchButton,
  Tools,
  VideoPause,
  VideoPlay
} from '@element-plus/icons-vue';
import {ElMessageBox} from 'element-plus';

const store = useGcsStore();
const {vehicle, sysLogs, notificationLogs, mission, mapTriggers, isWsConnected, wsUrl, controlStatus} = storeToRefs(store);

// --- 状态变量 ---
const missionState = ref('EXECUTING');
const lastMissionStartTime = ref(0);
const lastTargetIndex = ref(0);
const resumeCooldown = ref(0);
let cooldownTimer = null;
const gotoDialog = ref({visible: false, target: {lat: 0, lng: 0}, heading: 0});
const missionStartDialog = ref({visible: false, startIndex: 1});
const wsDialog = ref({visible: false, newAddress: ''});
const manualWaypointIndex = ref(1);

// 计算倒序日志
const reversedLogs = computed(() => [...(sysLogs.value || [])].reverse());

// --- WebSocket 设置 ---
const openWsDialog = () => {
  wsDialog.value.newAddress = wsUrl.value;
  wsDialog.value.visible = true;
};
const confirmWsChange = () => {
  store.changeWsUrl(wsDialog.value.newAddress);
  wsDialog.value.visible = false;
  store.pushNotification('系统消息', '正在更新连接地址...', 'success');
};

// --- 自动重连逻辑 ---
let reconnectTimer = null;
watch(() => vehicle.value.connected, (connected) => {
  if (!connected) {
    if (!reconnectTimer) {
      reconnectTimer = setInterval(() => store.sendPacket('CMD_CONNECT_VEHICLE'), 3000);
    }
  } else {
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
      store.pushNotification('连接成功', '飞控已建立连接', 'success');
    }
    store.sendPacket("CMD_DOWNLOAD_MISSION", {});
    store.mapTriggers.centerMap = true;
  }
}, {immediate: true});

// --- 指点模式逻辑 ---
watch(() => mapTriggers.value.gotoTargetCandidate, (newTarget) => {
  if (newTarget) {
    gotoDialog.value.target = newTarget;
    gotoDialog.value.visible = true;
    // 清除候选，防止重复触发
    store.setGotoTargetCandidate(null);
  }
}, {deep: true});

// --- 辅助计算 ---
const getBatColor = computed(() => {
  const pct = vehicle.value.battery.remaining_percent;
  if (pct <= vehicle.value.battery.low_battery_threshold) return '#f56c6c';
  return pct > 30 ? '#67c23a' : '#e6a23c';
});

const currentWaypointIndex = computed(() => mission.value.progress.total > 0 ? mission.value.progress.current + 1 : 0);
const totalWaypoints = computed(() => mission.value.progress.total);
const missionProgress = computed(() => {
  const {total, current} = mission.value.progress;
  return total > 0 ? Math.min(((current + 1) / total) * 100, 100) : 0;
});
const getLogLevelClass = (level) => {
  if (level.includes('ERROR') || level.includes('FAIL')) return 'log-error';
  if (level.includes('WARN')) return 'log-warn';
  return 'log-info';
};

// --- 动作逻辑 ---
const changeMode = (mode, payload_extra = {}) => {

  if (mode === vehicle.value.mode) {
    if (!vehicle.value.armed) {
      sendArmCommand('ARM', false);
    }
    return;
  }

  if (mode === 'MISSION') {
    if (mission.value.plannedWaypoints.length === 0) {
      store.pushNotification('操作提示', '无任务航点，无法开始', 'warning');
      return;
    }
    let defaultStart = (mission.value.progress.current >= 0) ? mission.value.progress.current + 1 : 1;
    missionStartDialog.value.startIndex = defaultStart;
    missionStartDialog.value.visible = true;
  } else {
    executeChangeMode(mode, payload_extra);
  }
  if (mode === 'RTL') {
    if (!vehicle.value.armed) {
      sendArmCommand('ARM', false);
    }
  }
};

const handleGroundControlToggle = () => {
  if (controlStatus.value.transitioning) return;

  if (controlStatus.value.state === 'manual') {
    stopManualControlLoop();
    controlState.value = {throttle: 0.0, steering: 0.0};
    store.requestLocked();
    store.pushNotification('地面控制', '正在归零并请求后端上锁', 'info');
    return;
  }

  store.requestManual();
  store.pushNotification('地面控制', '正在请求后端进入 MANUAL 并解锁', 'info');
};

const handlePause = () => {
  store.requestLocked();
  store.setRelay(0);
  store.pushNotification('暂停模式', '正在归零、上锁并关闭混合器', 'warning');
};

const handleSystemStop = () => {
  store.setRelay(0);
  store.requestLocked();
  store.pushNotification('系统停机', '正在关闭混合器并请求后端安全上锁', 'error');
};

const confirmMissionStart = () => {
  const targetIndex = missionStartDialog.value.startIndex - 1;
  executeChangeMode('MISSION', {mission_item_index: targetIndex});
  missionStartDialog.value.visible = false;
  store.pushNotification('任务启动', `自动巡航任务已从第 ${missionStartDialog.value.startIndex} 航点开始`, 'success');
  if (!vehicle.value.armed) {
    sendArmCommand('ARM', false);
  }

  // 记录启动信息
  lastMissionStartTime.value = Date.now();
  lastTargetIndex.value = targetIndex;
};

const executeChangeMode = (mode, payload_extra) => {
  let payload = {mode: mode, ...payload_extra};
  store.sendPacket('CMD_SET_MODE', payload);
  if (mode === 'MISSION') {
    missionState.value = 'EXECUTING';
    setTimeout(() => store.setRelay(1), 2000);
  }
}

// 监听模式异常切回 HOLD 的自动恢复逻辑
watch(() => vehicle.value.mode, (newMode) => {
  if (newMode === 'HOLD' && missionState.value === 'EXECUTING') {
    const now = Date.now();
    // 如果在开启 5 秒内切回 HOLD
    if (now - lastMissionStartTime.value < 5000) {
      store.pushNotification('自动恢复', '检测到任务意外中断，正在尝试重新执行...', 'warning');

      const targetIndex = lastTargetIndex.value;
      // 重复发送指令
      store.sendPacket('CMD_MISSION_CONTROL', {action: 'SET_INDEX', index: targetIndex});

      setTimeout(() => {
        // 如果是因为 Disarm 导致的 HOLD，重新 Arm
        if (!vehicle.value.armed) {
          sendArmCommand('ARM', false);
        }
        store.sendPacket('CMD_MISSION_CONTROL', {action: 'RESUME'});
      }, 500);
    }
  }
});

const jumpToWaypoint = () => {
  if (manualWaypointIndex.value > 0 && manualWaypointIndex.value <= totalWaypoints.value) {
    ElMessageBox.confirm(`确定要跳转到航点 ${manualWaypointIndex.value} 吗？`, '航点跳转', {
      type: 'warning'
    }).then(() => {
      const targetIndex = manualWaypointIndex.value - 1;
      executeChangeMode('MISSION', {mission_item_index: targetIndex});
      store.pushNotification('指令发送', `已请求跳转到航点 ${manualWaypointIndex.value}`, 'success');
    });
  }
};

const handleCenterMap = () => {
  store.mapTriggers.centerMap = true;
  store.pushNotification('地图工具', '已将视角定位至无人艇', 'info');
};

const handleThresholdChange = (val) => {
  store.sendPacket('CMD_SET_BATTERY_THRESHOLD', {threshold: val});
  store.pushNotification('电池设置', `已发送低电量阈值设定: ${val}%`, 'info');
};

// 修复：HUD 鼠标滚轮横向滚动
const handleHudScroll = (e) => {
  const container = e.currentTarget;
  if (container) {
    container.scrollLeft += e.deltaY;
    e.preventDefault(); // 防止触发页面级别的滚动
  }
};

const controlMission = (action) => {
  if (action === 'RESUME') {
    if (resumeCooldown.value > 0) return;
    // 恢复任务前：1. 解锁电机 2. 重设当前航点索引 3. 恢复任务
    const targetIndex = mission.value.progress.current;

    // 记录启动信息以供自动恢复使用
    lastMissionStartTime.value = Date.now();
    lastTargetIndex.value = targetIndex;

    store.sendPacket('CMD_MISSION_CONTROL', {action: 'SET_INDEX', index: targetIndex});
    // 稍作延迟发送继续指令，确保索引设置生效
    setTimeout(() => {
      store.sendPacket('CMD_MISSION_CONTROL', {action: 'RESUME'});
      missionState.value = 'EXECUTING';
      store.pushNotification('任务恢复', `已解锁电机并从第 ${targetIndex + 1} 航点恢复任务`, 'success');
      sendArmCommand('ARM', false);
    }, 200);
    setTimeout(() => {
      store.setRelay(1);
    }, 200);

    return;
  } else if (action === 'PAUSE') {
    missionState.value = 'PAUSED';
    sendArmCommand("DISARM", false);
    store.setRelay(0);
    store.pushNotification('任务暂停', '任务已暂停，电机已上锁', 'warning');

    // 启动3秒冷却
    resumeCooldown.value = 3;
    if (cooldownTimer) clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      resumeCooldown.value--;
      if (resumeCooldown.value <= 0) {
        clearInterval(cooldownTimer);
      }
    }, 1000);
    return;
  }
};

const cancelMission = () => {
  ElMessageBox.confirm('确定要终止任务吗？', '终止任务', {type: 'warning'}).then(() => {
    sendArmCommand("DISARM", false);
    store.sendPacket('CMD_MISSION_CONTROL', {action: 'RESET'});
    changeMode('HOLD');
    store.setRelay(0);
    store.pushNotification('任务终止', '任务已取消，电机已上锁', 'warning');
  });
};

const sendArmCommand = (action, force) => {
  const isArming = (action === 'ARM');
  // 如果当前状态已经是请求的状态，且不是强制操作，则不执行
  if (!force && vehicle.value.armed === isArming) return;

  const cmd = isArming ? 'CMD_ARM' : 'CMD_DISARM';
  if (force) {
    ElMessageBox.confirm('确定要强制操作吗？极其危险！', '危险操作', {type: 'error'}).then(() => {
      store.sendPacket(cmd, {force: true});
      store.pushNotification('危险操作', `已强制发送 ${action} 指令`, 'error');
    });
  } else {
    store.sendPacket(cmd, {force: false});
    store.pushNotification('电机控制', `已发送 ${action === 'ARM' ? '解锁' : '上锁'} 指令`, 'info');
  }
};

const confirmGoto = () => {
  store.sendPacket('CMD_SET_HOME', {lat: gotoDialog.value.target.lat, lon: gotoDialog.value.target.lng, alt: 0});
  gotoDialog.value.visible = false;
  store.pushNotification('指点飞行', '已发送前往目标点指令', 'success');
};

// --- 摇杆逻辑 ---
const controlState = ref({throttle: 0.0, steering: 0.0});
let controlLoop = null;

const startManualControlLoop = () => {
  if (controlLoop) return;
  controlLoop = setInterval(() => {
    if (controlStatus.value.state === 'manual' && !controlStatus.value.transitioning) {
      store.sendManualControl(controlState.value.throttle, controlState.value.steering);
    }
  }, 100);
};

const stopManualControlLoop = () => {
  if (!controlLoop) return;
  clearInterval(controlLoop);
  controlLoop = null;
};

watch(() => [controlStatus.value.state, controlStatus.value.transitioning], ([state, transitioning]) => {
  if (state === 'manual' && !transitioning) {
    startManualControlLoop();
  } else {
    stopManualControlLoop();
    controlState.value = {throttle: 0.0, steering: 0.0};
  }
}, {immediate: true});

const handleLeftStick = (vec) => controlState.value.throttle = vec.y;
const resetLeftStick = () => controlState.value.throttle = 0;
const handleRightStick = (vec) => controlState.value.steering = vec.x;
const resetRightStick = () => controlState.value.steering = 0;

onUnmounted(() => {
  stopManualControlLoop();
  if (reconnectTimer) clearInterval(reconnectTimer);
  if (cooldownTimer) clearInterval(cooldownTimer);
});
</script>

<style scoped>
.view-container {
  width: 100vw;
  height: 100vh;
  position: fixed;
  top: 0;
  left: 0;
  background: transparent;
  color: #fff;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  overflow: hidden;
  pointer-events: none;
}

/* ================== 通用侧边面板样式 ================== */
.side-panel {
  position: absolute;
  top: 20px;
  bottom: 20px;
  width: 260px; /* 压缩宽度 */
  background: rgba(20, 20, 20, 0.88);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  padding: 16px 0;
  display: flex;
  flex-direction: column;
  z-index: 1000;
  pointer-events: auto;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
}

.side-panel.left {
  left: 20px;
}

.side-panel.right {
  right: 20px;
}

.panel-header {
  padding: 0 16px 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.panel-scroll-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  /* 核心逻辑：空间充足时分散对齐，空间不足时保持最小间距并滚动 */
  justify-content: space-between;
  gap: 16px; /* 最小间距限制 */
}

/* 确保在内容很少时，也能有一个最小高度支撑 space-between */
.panel-scroll-content > :last-child {
  margin-bottom: 8px;
}

.panel-scroll-content::-webkit-scrollbar {
  width: 3px;
}

.panel-scroll-content::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
}

.brand {
  font-size: 18px;
  font-weight: 900;
  color: #409EFF;
  text-shadow: 0 0 10px rgba(64, 158, 255, 0.4);
}

.status-chip {
  font-size: 11px;
  font-weight: bold;
  margin-top: 4px;
  color: #f56c6c;
  opacity: 0.9;
}

.status-chip.online {
  color: #67c23a;
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: bold;
  color: #888;
  text-transform: uppercase;
}

.connection-box {
  background: rgba(255, 255, 255, 0.04);
  padding: 10px;
  border-radius: 10px;
}

.threshold-container {
  background: rgba(255, 255, 255, 0.04);
  padding: 12px;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.threshold-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.threshold-label {
  font-size: 13px;
  color: #ccc;
}

.threshold-value {
  font-size: 15px;
  font-weight: bold;
  color: #409EFF;
}

:deep(.hud-slider) {
  padding: 0 4px;
}

.status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  margin-bottom: 4px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot.success {
  background: #67c23a;
  box-shadow: 0 0 8px #67c23a;
}

.status-dot.error {
  background: #f56c6c;
}

.address-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: #666;
}

.address {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 140px;
}

/* 按钮网格：支持一行两个 */
.mode-grid-flat {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.mode-btn-flat.small {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #ccc;
  border-radius: 8px;
  padding: 10px 6px;
  cursor: pointer;
  transition: all 0.2s;
  font-weight: bold;
  font-size: 13px;
  text-align: center;
}

.mode-btn-flat.small:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  border-color: #409EFF;
}

.mode-btn-flat.small.active {
  background: #409EFF;
  border-color: #409EFF;
  color: white;
}

.mode-btn-flat.small:disabled {
  opacity: 0.2;
  cursor: not-allowed;
}

.danger-text {
  color: #f56c6c !important;
}

/* 终端样式 */
.mini-terminal {
  background: rgba(0, 0, 0, 0.4);
  border-radius: 10px;
  padding: 10px;
  height: 220px;
  overflow-y: auto;
  font-family: 'Roboto Mono', monospace;
  font-size: 12px;
}

.mini-terminal.messages {
  height: 280px;
}

.log-line-flat {
  margin-bottom: 4px;
  display: flex;
  gap: 8px;
  line-height: 1.3;
}

.log-time {
  color: #555;
  white-space: nowrap;
}

.log-error {
  color: #f56c6c;
}

.log-warn {
  color: #e6a23c;
}

/* 消息透传颜色 */
.msg-success .log-text {
  color: #67c23a;
}

.msg-error .log-text {
  color: #f56c6c;
}

.msg-warning .log-text {
  color: #e6a23c;
}

.msg-info .log-text {
  color: #409EFF;
}

/* ================== 顶部数据 HUD ================== */
.hud-top-bar.display-only {
  position: absolute;
  top: 20px;
  left: 300px;
  right: 300px; /* 避开左右面板 */
  height: 90px;
  background: rgba(20, 20, 20, 0.75);
  backdrop-filter: blur(15px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 15px;
  display: flex;
  align-items: center;
  padding: 0 30px;
  z-index: 900;
  pointer-events: auto;
  overflow-x: auto; /* 开启水平滚动 */
  overflow-y: hidden;
}

/* 滚动条美化 */
.hud-top-bar.display-only::-webkit-scrollbar {
  height: 4px;
}

.hud-top-bar.display-only::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
}

.telemetry-group {
  display: flex;
  align-items: center;
  width: 100%;
  justify-content: space-between;
}

.telemetry-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 110px;
  flex-shrink: 0;
}

.telemetry-item .label {
  font-size: 11px;
  font-weight: bold;
  color: #888;
}

.telemetry-item .value {
  font-family: 'DIN Alternate', sans-serif;
  font-size: 24px;
  font-weight: bold;
  line-height: 1;
  white-space: nowrap;
}

.telemetry-item small {
  font-size: 11px;
  margin-left: 4px;
  opacity: 0.6;
}

.telemetry-item .sub-label {
  font-size: 13px;
  color: #ffffff;
  font-weight: 900;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
  white-space: nowrap;
}

.coords {
  font-family: monospace;
  font-size: 12px;
  font-weight: bold;
  color: #409EFF;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.divider {
  width: 1px;
  height: 40px;
  background: rgba(255, 255, 255, 0.15);
  flex-shrink: 0;
}

.armed-text {
  color: #f56c6c;
  text-shadow: 0 0 15px rgba(245, 108, 108, 0.6);
}

.disarmed-text {
  color: #67c23a;
  text-shadow: 0 0 15px rgba(103, 194, 58, 0.6);
}

.hud-stop-btn {
  background: rgba(245, 108, 108, 0.15);
  border: 1px solid rgba(245, 108, 108, 0.4);
  color: #f56c6c;
  font-size: 11px;
  font-weight: bold;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.hud-stop-btn:hover {
  background: rgba(245, 108, 108, 0.3);
  box-shadow: 0 0 10px rgba(245, 108, 108, 0.3);
}

.hud-stop-btn:active {
  transform: scale(0.95);
}
.panel-background{
    background: rgba(20, 20, 20, 0.88);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 20px;
    padding: 16px 20px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
}
/* ================== 底部仪表盘 ================== */
.bottom-dashboard {
  pointer-events: auto;
  position: absolute;
  bottom: 80px;
  left: 300px;
  right: 300px; /* 与顶部 HUD 宽度保持一致 */
  height: 160px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.95), rgba(0, 0, 0, 0.6));
  backdrop-filter: blur(12px);
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 40px;
  z-index: 1000;
}

.joystick-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 120px;
  height: 100%;
}

.joystick-field {
  width: 100%;
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stick-label {
  margin-top: -10px;
  padding-bottom: 10px;
  font-size: 12px;
  color: #aaa;
  font-weight: bold;
}

.center-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.mode-switch-group {
  display: flex;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 8px;
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, 0.15);
}

.switch-item {
  padding: 8px 20px;
  font-size: 14px;
  color: #888;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.3s;
  font-weight: bold;
}

.switch-item.active {
  background: #333;
  color: #409EFF;
}

.control-hint {
  font-size: 12px;
  color: #666;
  margin-top: 10px;
}

/* ================== MISSION 模式样式 (严格同步 back.vue) ================== */
.mission-dashboard {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mission-side-btn {
  width: 160px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.hud-action-btn {
  width: 100%;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.hud-action-btn:active {
  transform: scale(0.96);
}

.btn-text .main-text {
  font-size: 16px;
  font-weight: bold;
  color: white;
}

.btn-pause {
  background: rgba(230, 162, 60, 0.2);
  border-color: rgba(230, 162, 60, 0.4);
  color: #e6a23c;
}

.btn-resume {
  background: rgba(103, 194, 58, 0.2);
  border-color: rgba(103, 194, 58, 0.4);
  color: #67c23a;
}

.btn-abort {
  background: rgba(245, 108, 108, 0.2);
  border-color: rgba(245, 108, 108, 0.4);
  color: #f56c6c;
}

.btn-disabled {
  opacity: 0.5;
  cursor: not-allowed !important;
  pointer-events: none;
}

.mission-center-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 20px;
}

.manual-wp-jump {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  background: rgba(0, 0, 0, 0.3);
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.jump-btn {
  background: #409EFF;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: bold;
}

.wp-counter {
  margin-bottom: 8px;
  text-align: center;
}

.wp-counter .label {
  display: block;
  font-size: 10px;
  color: #666;
  letter-spacing: 3px;
  margin-bottom: 2px;
}

.wp-counter .val {
  font-family: 'DIN Alternate', sans-serif;
  font-size: 28px;
  color: white;
  font-weight: bold;
}

.mission-progress-bar {
  width: 100%;
  height: 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  overflow: hidden;
  position: relative;
  margin-bottom: 8px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #409EFF, #36d1dc);
  position: relative;
  transition: width 0.3s ease;
  box-shadow: 0 0 10px rgba(64, 158, 255, 0.5);
}

.glow-head {
  position: absolute;
  right: 0;
  top: 0;
  height: 100%;
  width: 5px;
  background: white;
  box-shadow: 0 0 5px white;
  opacity: 0.8;
}

.mission-status-text {
  font-size: 12px;
  color: #aaa;
}

.offline-mask {
  z-index: 2000;
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  justify-content: center;
  align-items: center;
  pointer-events: auto;
}

.rotating-slow {
  animation: rotate 3s linear infinite;
  font-size: 40px;
  margin-bottom: 10px;
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* ================== 统一对话框样式 (深黑主题) ================== */
:deep(.hud-dialog) {
  background: #000000 !important;
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  border-radius: 20px;
}

:deep(.el-input__wrapper) {
  background-color: #111 !important;
  box-shadow: 0 0 0 1px #333 inset !important;
}

:deep(.el-input__inner) {
  color: white !important;
}

.hud-btn-confirm {
  background: #409EFF;
  border: none;
  font-weight: bold;
}

.hud-btn-cancel {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid #444;
  color: #999;
}

.slide-up-enter-active, .slide-up-leave-active {
  transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}

.slide-up-enter-from, .slide-up-leave-to {
  transform: translate(-50%, 120%);
  opacity: 0;
}
</style>

<!-- 全局覆盖：处理 Element Plus 弹窗深色主题 -->
<style>
.el-dialog__title {
  font-size: 20px;
  color: white;
  font-weight: 900;
}

.el-dialog__body {
  color: white;
  font-size: 18px;
  padding: 0px 20px;
}

.el-dialog {
  background: #000000 !important;
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  border-radius: 20px;
}

.mission-start-dialog .mission-start-form {
  padding: 10px 0;
}

.mission-start-dialog .safety-check-group {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 15px;
  margin-bottom: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.mission-start-dialog .safety-check-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;

}

.mission-start-dialog .safety-check-item:last-child {
  margin-bottom: 0;
}

.mission-start-dialog .safety-check-item .label {
  font-size: 14px;
  color: white;
}

.mission-start-dialog .safety-check-item .value {
  font-family: 'Roboto Mono', monospace;
  font-weight: bold;
  font-size: 15px;
}

.mission-start-dialog .safety-check-item .value.warning {
  color: #e6a23c;
}

.mission-start-dialog .safety-check-item .value.info {
  color: #409EFF;
}

.mission-start-dialog .safety-check-item .value.error {
  color: #f56c6c;
}

.mission-start-dialog .form-setting-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 25px;
}

.mission-start-dialog .form-setting-row label {
  font-size: 14px;
  font-weight: bold;
  color: #eee;
}

.mission-start-dialog .mission-meta {
  text-align: right;
  font-size: 14px;
  color: white;
  margin-top: 8px;
  font-style: italic;
}

/* 覆盖 Element Plus 数字输入框 */
.mission-start-dialog .el-input-number.is-controls-right .el-input-number__decrease,
.mission-start-dialog .el-input-number.is-controls-right .el-input-number__increase {
  background: #1a1a1a !important;
  border-color: #333 !important;
  color: #bbb !important;
}

.mission-start-dialog .el-input-number.is-controls-right .el-input-number__decrease:hover,
.mission-start-dialog .el-input-number.is-controls-right .el-input-number__increase:hover {
  color: #409EFF !important;
}

.mission-start-dialog .el-input-number .el-input__wrapper {
  background: #0a0a0a !important;
  box-shadow: 0 0 0 1px #333 inset !important;
}

.mission-start-dialog .el-input-number .el-input__inner {
  color: #fff !important;
}
</style>

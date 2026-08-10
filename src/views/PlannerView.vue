<template>
  <div class="view-container">

    <div class="planner-panel" :class="{ 'is-collapsed': isCollapsed }">

      <div class="toggle-btn" @click="isCollapsed = !isCollapsed">
        <el-icon><component :is="isCollapsed ? 'ArrowLeft' : 'ArrowRight'" /></el-icon>
      </div>

      <div class="panel-content-wrapper">
        <el-tabs v-model="activeTab" class="hud-tabs">

          <el-tab-pane label="航线" name="mission">
            <div class="tab-content">

              <div class="defaults-bar">
                <span class="bar-label">默认值:</span>
                <div class="input-group">
                  <span>速度</span>
                  <input type="number" class="hud-input mini" v-model.number="mission.defaults.speed" step="0.5">
                </div>
                <div class="input-group">
                  <span>停留</span>
                  <input type="number" class="hud-input mini" v-model.number="mission.defaults.loiter">
                </div>
              </div>

              <div class="acceptance-radius-bar">
                <div class="acceptance-radius-main">
                  <span class="bar-label">航点接受半径</span>
                  <div class="radius-input-wrap">
                    <input
                      v-model="acceptanceRadiusDraft"
                      type="number"
                      class="hud-input radius-input"
                      min="0.05"
                      max="200"
                      step="0.1"
                      placeholder="未查询"
                      aria-label="航点接受半径"
                    >
                    <span class="radius-unit">m</span>
                  </div>
                  <el-button
                    type="primary"
                    size="small"
                    :loading="isAcceptanceRadiusSetting"
                    :disabled="Boolean(acceptanceRadiusDisabledReason)"
                    @click="handleSetAcceptanceRadius"
                  >配置</el-button>
                </div>
                <div class="acceptance-radius-status" :class="{ confirmed: waypointAcceptanceRadius.queried }">
                  {{ acceptanceRadiusStatusText }}
                </div>
              </div>

              <div class="tools-header">
                <span class="info-text">共 {{ mission.plannedWaypoints.length }} 个航点 (可拖拽排序)</span>
                <el-button type="danger" link size="small"
                           :loading="mission.clearOperation.phase === 'PENDING'"
                           :disabled="mission.clearOperation.phase === 'PENDING'"
                           @click="handleClear">清空</el-button>
              </div>

              <el-table
                ref="tableRef"
                row-key="seq"
                :data="mission.plannedWaypoints"
                height="280"
                size="small"
                class="hud-table draggable-table"
                empty-text="请在地图绘制"
              >
                <el-table-column width="30" align="center">
                  <template #default>
                    <el-icon class="drag-handle"><Grid /></el-icon>
                  </template>
                </el-table-column>

                <el-table-column label="#" prop="seq" width="35" align="center">
                  <template #default="scope">
                    <span class="seq-badge">{{ scope.$index + 1 }}</span>
                  </template>
                </el-table-column>

                <el-table-column label="速度" width="75" align="center">
                  <template #default="scope">
                    <input type="number" class="hud-input" v-model.number="scope.row.speed" step="0.5" min="0">
                  </template>
                </el-table-column>

                <el-table-column label="停留" width="60" align="center">
                  <template #default="scope">
                    <input type="number" class="hud-input" v-model.number="scope.row.loiter" min="0">
                  </template>
                </el-table-column>

                <el-table-column label="操作" width="40" align="center">
                  <template #default="scope">
                     <el-icon class="delete-icon" @click="confirmRemove(scope.$index)"><Close /></el-icon>
                  </template>
                </el-table-column>
              </el-table>

              <div class="action-footer">
                <button class="hud-btn primary" @click="handleUpload">
                  <el-icon><Upload /></el-icon> 发送任务到飞控
                </button>
                <button class="hud-btn primary" @click="handleDownload">
                  <el-icon><Download /></el-icon> 从飞控读取任务
                </button>
              </div>

              <div class="action-footer file-action-footer">
                <button class="hud-btn secondary" @click="handleSaveMissionFile">
                  <el-icon><Document /></el-icon> 保存任务到文件
                </button>
                <button class="hud-btn secondary" @click="handleChooseMissionFile">
                  <el-icon><FolderOpened /></el-icon> 从文件读取任务
                </button>
                <input ref="missionFileInputRef" type="file" class="mission-file-input"
                       accept=".json,application/json" @change="handleMissionFileSelected">
              </div>

            </div>
          </el-tab-pane>

          <el-tab-pane label="区域规划" name="area">
            <div class="tab-content">
              <div class="area-controls">
                <div class="input-group">
                  <span>作业方向</span>
                  <el-switch
                    v-model="areaParams.isVertical"
                    active-text="垂直"
                    inactive-text="水平"
                  />
                </div>
                <div class="input-group" v-if="areaParams.isVertical">
                  <span>行间距 (m)</span>
                  <input type="number" class="hud-input" v-model.number="areaParams.horizontalSpacing">
                </div>
                <div class="input-group" v-else>
                  <span>行间距 (m)</span>
                  <input type="number" class="hud-input" v-model.number="areaParams.verticalSpacing">
                </div>
              </div>

              <div class="tools-header">
                <span class="info-text">已选 {{ store.areaPoints.length }} / 4 个角点</span>
                <el-button type="danger" link size="small" @click="store.clearAreaPoints">清空角点</el-button>
              </div>

              <button class="hud-btn success" @click="generatePath" :disabled="store.areaPoints.length !== 4">
                <el-icon><MapLocation /></el-icon> 生成路径
              </button>
            </div>
          </el-tab-pane>

          <el-tab-pane label="地理围栏" name="geofence">
            <div class="tab-content geofence-content">
              <div class="geofence-summary">
                <div>
                  <span class="geofence-type-dot"></span>
                  <span>包含型多边形</span>
                </div>
                <span>{{ geofence.points.length }} / {{ MAX_GEOFENCE_POINTS }} 个角点</span>
              </div>

              <div class="tools-header">
                <span class="info-text">角点顺序固定，仅支持删除</span>
                <el-button
                  type="danger"
                  link
                  size="small"
                  :loading="geofence.clear.phase === 'PENDING'"
                  :disabled="geofenceOperationPending"
                  @click="handleGeofenceClear"
                >全部清空</el-button>
              </div>

              <el-table
                :data="geofence.points"
                height="280"
                size="small"
                class="hud-table geofence-table"
                empty-text="请使用地图左侧多边形工具绘制"
              >
                <el-table-column label="#" width="34" align="center">
                  <template #default="scope">
                    <span class="seq-badge geofence-seq">{{ scope.$index + 1 }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="纬度" min-width="84" align="center">
                  <template #default="scope">
                    <span class="coordinate-text">{{ scope.row.latitude.toFixed(7) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="经度" min-width="88" align="center">
                  <template #default="scope">
                    <span class="coordinate-text">{{ scope.row.longitude.toFixed(7) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="" width="30" align="center">
                  <template #default="scope">
                    <el-icon
                      class="delete-icon"
                      :class="{ disabled: geofence.points.length <= 3 }"
                      @click="handleRemoveGeofencePoint(scope.$index)"
                    ><Close /></el-icon>
                  </template>
                </el-table-column>
              </el-table>

              <div class="geofence-status" :class="geofenceStatusClass">
                {{ geofenceStatusText }}
              </div>

              <div class="action-footer geofence-actions">
                <button
                  class="hud-btn primary"
                  :disabled="geofenceOperationPending || geofence.points.length < 3"
                  @click="handleGeofenceUpload"
                >
                  <el-icon><Upload /></el-icon>
                  {{ geofence.upload.phase === 'PENDING' ? '正在发送…' : '发送围栏到飞控' }}
                </button>
                <button
                  class="hud-btn primary"
                  :disabled="geofenceOperationPending"
                  @click="handleGeofenceDownload"
                >
                  <el-icon><Download /></el-icon>
                  {{ geofence.download.phase === 'PENDING' ? '正在读取…' : '从飞控读取地理围栏' }}
                </button>
              </div>
            </div>
          </el-tab-pane>


          <el-tab-pane label="地图" name="offline">
             <button class="hud-btn success" @click="handleSaveMap">
                <el-icon><MapLocation /></el-icon> 下载当前视野
              </button>
          </el-tab-pane>

        </el-tabs>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, reactive, watch } from 'vue';
import { useGcsStore } from '../store/useGcsStore';
import { storeToRefs } from 'pinia';
import { ElMessageBox, ElMessage, ElNotification } from 'element-plus';
import Sortable from 'sortablejs';
import {
  ArrowLeft,
  ArrowRight,
  Close,
  Document,
  Download,
  FolderOpened,
  Grid,
  MapLocation,
  Upload
} from '@element-plus/icons-vue';
import * as turf from '@turf/turf';
import {
  buildMissionFilename,
  createMissionFileDocument,
  parseMissionFileDocument
} from '../services/missionFile';
import {
  geofenceContainsHome,
  MAX_GEOFENCE_POINTS,
  normalizeGeofencePoints,
  normalizeHomePosition
} from '../services/geofence';

const store = useGcsStore();
const {
  mission,
  geofence,
  vehicle,
  isWsConnected,
  infoQuery,
  waypointAcceptanceRadius
} = storeToRefs(store);

const isCollapsed = ref(false);
const activeTab = ref('mission');
const tableRef = ref(null);
const missionFileInputRef = ref(null);
const acceptanceRadiusDraft = ref('');
const MAX_MISSION_FILE_SIZE_BYTES = 1024 * 1024;
const geofenceOperationPending = computed(() =>
  ['upload', 'download', 'clear'].some(
    operation => geofence.value[operation].phase === 'PENDING'
  )
);
const geofenceStatusText = computed(() => {
  const pending = ['upload', 'download', 'clear'].find(
    operation => geofence.value[operation].phase === 'PENDING'
  );
  if (pending === 'upload') return '正在向 PX4 发送围栏…';
  if (pending === 'download') return '正在从 PX4 读取围栏…';
  if (pending === 'clear') return '正在清空 PX4 全部围栏…';
  const failed = ['upload', 'download', 'clear'].find(
    operation => geofence.value[operation].phase === 'ERROR'
  );
  if (failed) return geofence.value[failed].error || '上次围栏操作失败';
  if (geofence.value.points.length === 0) return '尚未规划本地围栏';
  return geofence.value.source === 'PX4'
    ? '当前围栏已与 PX4 操作结果同步'
    : '本地围栏尚未发送到 PX4';
});
const geofenceStatusClass = computed(() => {
  if (geofenceOperationPending.value) return 'pending';
  if (['upload', 'download', 'clear'].some(
    operation => geofence.value[operation].phase === 'ERROR'
  )) return 'error';
  return geofence.value.source === 'PX4' ? 'success' : '';
});

const parsedAcceptanceRadius = computed(() => {
  if (acceptanceRadiusDraft.value === '') return null;
  const value = Number(acceptanceRadiusDraft.value);
  return Number.isFinite(value) && value >= 0.05 && value <= 200 ? value : null;
});
const isAcceptanceRadiusSetting = computed(() =>
  ['PENDING', 'VERIFYING'].includes(waypointAcceptanceRadius.value.setPhase)
);
const acceptanceRadiusDisabledReason = computed(() => {
  if (!isWsConnected.value) return '后端未连接';
  if (!vehicle.value.connected) return 'PX4 未连接';
  if (!vehicle.value.armedKnown) return 'PX4 解锁状态未知';
  if (vehicle.value.armed) return '请先上锁 PX4';
  if (parsedAcceptanceRadius.value === null) return '请输入 0.05–200.0m';
  if (infoQuery.value.phase === 'PENDING'
      || waypointAcceptanceRadius.value.queryPhase === 'PENDING') return '正在查询飞控参数';
  if (isAcceptanceRadiusSetting.value) return '正在配置';
  return '';
});
const acceptanceRadiusStatusText = computed(() => {
  if (waypointAcceptanceRadius.value.setPhase === 'VERIFYING') return '正在回读确认…';
  if (waypointAcceptanceRadius.value.setPhase === 'PENDING') return '正在写入飞控参数…';
  if (vehicle.value.armed) return '请先暂停并确认飞控上锁';
  if (waypointAcceptanceRadius.value.queried) {
    return `飞控当前值：${waypointAcceptanceRadius.value.valueM.toFixed(1)} m`;
  }
  return acceptanceRadiusDisabledReason.value || '尚未查询飞控参数';
});

watch(() => waypointAcceptanceRadius.value.valueM, (value) => {
  if (waypointAcceptanceRadius.value.queried && Number.isFinite(value)) {
    acceptanceRadiusDraft.value = value.toFixed(1);
  }
}, {immediate: true});

const handleSetAcceptanceRadius = () => {
  if (acceptanceRadiusDisabledReason.value) return;
  store.setWaypointAcceptanceRadius(parsedAcceptanceRadius.value);
};

const geofenceWriteBlockReason = () => {
  if (!isWsConnected.value) return '后端未连接';
  if (!vehicle.value.connected) return 'PX4 未连接';
  if (!vehicle.value.armedKnown) return 'PX4 解锁状态未知';
  if (vehicle.value.armed) return 'PX4 已解锁，请先上锁';
  return '';
};

const handleRemoveGeofencePoint = (index) => {
  store.removeGeofencePoint(index);
};

const handleGeofenceUpload = async () => {
  const blocked = geofenceWriteBlockReason();
  if (blocked) {
    ElMessage.warning(blocked);
    return;
  }

  let points;
  try {
    points = normalizeGeofencePoints(geofence.value.points);
  } catch (error) {
    ElMessage.error(error?.message || '本地地理围栏无效');
    return;
  }
  if (vehicle.value.health.is_home_position_ok !== true) {
    ElMessage.error('PX4 Home 点无效，禁止发送包含型围栏');
    return;
  }
  const home = normalizeHomePosition(vehicle.value.home);
  if (!home) {
    ElMessage.error('未获得有效的 PX4 Home 坐标，禁止发送围栏');
    return;
  }
  if (!geofenceContainsHome(points, home)) {
    ElMessage.error('PX4 Home 点不在围栏内部或边界上，禁止发送');
    return;
  }

  try {
    await ElMessageBox.confirm(
      `将用当前 ${points.length} 个角点的包含型多边形覆盖 PX4 上所有既有围栏。`
        + '该围栏会同时作用于地面控制和自动任务，确定继续吗？',
      '覆盖飞控地理围栏',
      {
        confirmButtonText: '确认覆盖并发送',
        cancelButtonText: '取消',
        type: 'warning',
        customClass: 'hud-message-box'
      }
    );
  } catch (_) {
    return;
  }
  store.requestGeofenceUpload();
};

const handleGeofenceDownload = async () => {
  if (!isWsConnected.value || !vehicle.value.connected) {
    ElMessage.warning(!isWsConnected.value ? '后端未连接' : 'PX4 未连接');
    return;
  }
  if (geofence.value.points.length > 0) {
    try {
      await ElMessageBox.confirm(
        '从 PX4 读取成功后将完整替换当前前端本地围栏，尚未发送的修改会丢失。',
        '覆盖本地地理围栏',
        {
          confirmButtonText: '确认读取并覆盖',
          cancelButtonText: '取消',
          type: 'warning',
          customClass: 'hud-message-box'
        }
      );
    } catch (_) {
      return;
    }
  }
  store.requestGeofenceDownload();
};

const handleGeofenceClear = async () => {
  const blocked = geofenceWriteBlockReason();
  if (blocked) {
    ElMessage.warning(blocked);
    return;
  }
  try {
    await ElMessageBox.confirm(
      '此操作将清空 PX4 上所有类型的多边形和圆形围栏。'
        + '仅在飞控确认成功后才清空前端本地围栏，且无法撤销。',
      '清空全部地理围栏',
      {
        confirmButtonText: '确认永久清空',
        cancelButtonText: '取消',
        type: 'error',
        customClass: 'hud-message-box'
      }
    );
  } catch (_) {
    return;
  }
  store.requestGeofenceClear();
};

const areaParams = reactive({
  horizontalSpacing: 20,
  verticalSpacing: 20,
  isVertical: false,
});

// --- 监听 Tab 切换来改变模式 ---
watch(activeTab, (newTab) => {
  if (newTab === 'mission') {
    store.setPlannerMode('manual');
  } else if (newTab === 'area') {
    store.setPlannerMode('area');
  } else if (newTab === 'geofence') {
    store.setPlannerMode('geofence');
  }
});

// --- 拖拽排序初始化 ---
onMounted(() => {
  // 初始化时，根据默认 tab 设置模式
  store.setPlannerMode(
    activeTab.value === 'mission'
      ? 'manual'
      : (activeTab.value === 'area' ? 'area' : 'geofence')
  );

  const tbody = document.querySelector('.draggable-table .el-table__body-wrapper tbody');
  if (tbody) {
    Sortable.create(tbody, {
      handle: '.drag-handle', // 只能通过手柄拖拽
      animation: 150,
      ghostClass: 'sortable-ghost',
      onEnd: ({ newIndex, oldIndex }) => {
        // 1. 调整数据顺序
        const targetRow = mission.value.plannedWaypoints.splice(oldIndex, 1)[0];
        mission.value.plannedWaypoints.splice(newIndex, 0, targetRow);

        // 2. 重新生成序号
        mission.value.plannedWaypoints.forEach((pt, idx) => pt.seq = idx + 1);

        // 3. 强制地图重绘 (同步线和点)
        store.triggerRedraw();
      }
    });
  }
});

// --- 删除确认 ---
const confirmRemove = (index) => {
  ElMessageBox.confirm(
    '确定要删除这个航点吗?',
    '删除确认',
    {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
      customClass: 'hud-message-box'
    }
  ).then(() => {
    // 1. 删除数据
    mission.value.plannedWaypoints.splice(index, 1);
    // 2. 重新排序号
    mission.value.plannedWaypoints.forEach((pt, idx) => pt.seq = idx + 1);
    // 3. 触发地图重绘
    store.triggerRedraw();
  }).catch(() => {});
};

const handleClear = () => {
  ElMessageBox.confirm(
      '此操作将同时永久清空前端本地航点和 PX4 中的任务，且无法撤销。确定继续吗？',
      '清空全部航点', {
    confirmButtonText: '确认永久清空', cancelButtonText: '取消', type: 'error',
    customClass: 'hud-message-box'
  }).then(() => {
    store.requestMissionClear();
  }).catch(()=>{});
};

const handleUpload = () => {
  if (mission.value.plannedWaypoints.length === 0) {
    ElMessage.warning("请先绘制航线");
    return;
  }

  // 1. 转换数据格式为后端所需
  const missionItems = mission.value.plannedWaypoints.map(pt => ({
    seq: pt.seq,
    latitude: pt.lat,
    longitude: pt.lng,
    relative_altitude_m: 0, // 水面船高度 0
    speed_m_s: pt.speed,
    yaw_deg: Number.NaN, // 自动航向
    is_fly_through: true
  }));

  // 2. 发送指令
  store.sendPacket("CMD_UPLOAD_MISSION", {
    mission_items: missionItems
  });

  // 3. 立即反馈
  ElNotification.success({
    title: '任务上传',
    message: `已请求上传 ${missionItems.length} 个航点`,
    position: 'top-right'
  });
  store.pushNotification('任务上传', `已发起 ${missionItems.length} 个航点上传请求`, 'info');
};

const handleDownload = () => {
    store.sendPacket("CMD_DOWNLOAD_MISSION", {});
};

const handleSaveMissionFile = () => {
  try {
    const missionDocument = createMissionFileDocument(mission.value);
    const jsonText = `${JSON.stringify(missionDocument, null, 2)}\n`;
    const objectUrl = URL.createObjectURL(
        new Blob([jsonText], {type: 'application/json;charset=utf-8'})
    );
    const link = window.document.createElement('a');
    link.href = objectUrl;
    link.download = buildMissionFilename();
    window.document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    ElMessage.success(`已保存 ${missionDocument.waypoints.length} 个航点`);
  } catch (error) {
    ElMessage.error(error?.message || '任务文件保存失败');
  }
};

const handleChooseMissionFile = () => {
  if (!missionFileInputRef.value) return;
  missionFileInputRef.value.value = '';
  missionFileInputRef.value.click();
};

const handleMissionFileSelected = async (event) => {
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;

  let importedMission;
  try {
    if (!file.name.toLowerCase().endsWith('.json')) {
      throw new Error('请选择 JSON 格式的任务文件');
    }
    if (file.size > MAX_MISSION_FILE_SIZE_BYTES) {
      throw new Error('任务文件不能超过 1 MB');
    }
    importedMission = parseMissionFileDocument(await file.text());
  } catch (error) {
    input.value = '';
    ElMessage.error(error?.message || '任务文件读取失败');
    return;
  }

  if (mission.value.plannedWaypoints.length > 0) {
    try {
      await ElMessageBox.confirm(
          '读取文件将完整替换当前前端本地任务，尚未保存的修改会丢失。确定继续吗？',
          '替换当前任务',
          {
            confirmButtonText: '确认替换',
            cancelButtonText: '取消',
            type: 'warning',
            customClass: 'hud-message-box'
          }
      );
    } catch (_) {
      input.value = '';
      return;
    }
  }

  mission.value.defaults.speed = importedMission.defaults.speed;
  mission.value.defaults.loiter = importedMission.defaults.loiter;
  mission.value.plannedWaypoints = importedMission.waypoints;
  mission.value.progress.current = 0;
  mission.value.progress.total = 0;
  store.triggerRedraw();
  input.value = '';
  ElNotification.success({
    title: '任务文件读取成功',
    message: `已载入 ${importedMission.waypoints.length} 个本地航点；如需写入 PX4，请点击“发送任务到飞控”`,
    position: 'top-right'
  });
};

const handleSaveMap = () => store.triggerMapSave();

// --- 区域规划 ---
const generatePath = () => {
  if (store.areaPoints.length !== 4) {
    ElMessage.error("请先在地图上选择4个角点");
    return;
  }

  try {
    const waypoints = calculateSPath(store.areaPoints, areaParams);
    const startSeq = mission.value.plannedWaypoints.length;
    const newWaypoints = waypoints.map((pt, index) => ({
      seq: startSeq + index + 1,
      lat: pt[1],
      lng: pt[0],
      speed: mission.value.defaults.speed,
      loiter: mission.value.defaults.loiter,
    }));

    mission.value.plannedWaypoints.push(...newWaypoints);
    store.clearAreaPoints(); // 清理临时点
    store.triggerRedraw();
    ElMessage.success(`成功生成 ${waypoints.length} 个航点`);
    activeTab.value = 'mission'; // 跳转回航线 tab

  } catch (error) {
    console.error("路径生成失败:", error);
    ElMessage.error("路径生成失败: " + error.message);
  }
};

function calculateSPath(points, params) {
  const { horizontalSpacing, verticalSpacing, isVertical } = params;
  const polygon = turf.polygon([ [...points, points[0]].map(p => [p.lng, p.lat]) ]);

  const bbox = turf.bbox(polygon); // [minLng, minLat, maxLng, maxLat]
  const west = bbox[0];
  const south = bbox[1];
  const east = bbox[2];
  const north = bbox[3];

  const waypoints = [];
  let isForward = true;

  if (isVertical) {
    // 垂直作业
    for (let lng = west; lng <= east; lng += horizontalSpacing / 111320) { // 简易经度转换
      const line = turf.lineString([[lng, south], [lng, north]]);
      const intersections = turf.lineIntersect(line, polygon);

      if (intersections.features.length > 0) {
        let segmentPoints = intersections.features.map(f => f.geometry.coordinates);
        segmentPoints.sort((a, b) => a[1] - b[1]); // 按纬度排序

        if (!isForward) segmentPoints.reverse();

        waypoints.push(...segmentPoints);

        isForward = !isForward;
      }
    }
  } else {
    // 水平作业
    for (let lat = south; lat <= north; lat += verticalSpacing / 111320) { // 简易纬度转换
      const line = turf.lineString([[west, lat], [east, lat]]);
      const intersections = turf.lineIntersect(line, polygon);

      if (intersections.features.length > 0) {
        let segmentPoints = intersections.features.map(f => f.geometry.coordinates);
        segmentPoints.sort((a, b) => a[0] - b[0]); // 按经度排序

        if (!isForward) segmentPoints.reverse();

        waypoints.push(...segmentPoints);

        isForward = !isForward;
      }
    }
  }
  return waypoints;
}

</script>

<style scoped>
/* ... 之前的 Panel 样式保持不变 ... */
.view-container { width: 100%; height: 100%; position: relative; pointer-events: none; overflow: hidden; }
.planner-panel { pointer-events: auto; position: absolute; top: 80px; right: 0; width: 360px; max-height: 80%; background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(12px); border-left: 1px solid rgba(255, 255, 255, 0.15); border-bottom: 1px solid rgba(255, 255, 255, 0.15); border-top-left-radius: 8px; border-bottom-left-radius: 8px; transition: transform 0.3s; display: flex; }
.planner-panel.is-collapsed { transform: translateX(360px); }
.toggle-btn { position: absolute; left: -24px; top: 50%; transform: translateY(-50%); width: 24px; height: 48px; background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(12px); cursor: pointer; color: #ccc; display: flex; align-items: center; justify-content: center; border-radius: 4px 0 0 4px; }
.panel-content-wrapper { width: 100%; padding: 10px 15px; }

/* --- 新增样式 --- */
.area-controls { display: flex; flex-direction: column; gap: 10px; margin-bottom: 15px; }
.area-controls .input-group { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #ddd; }
.area-controls .hud-input { width: 80px; }

/* 默认值设置栏 */
.defaults-bar {
  display: flex; align-items: center; gap: 8px;
  background: rgba(255,255,255,0.05); padding: 8px; border-radius: 4px; margin-bottom: 10px;
}
.acceptance-radius-bar {
  margin-bottom: 10px;
  padding: 8px;
  border: 1px solid rgba(64, 158, 255, 0.22);
  border-radius: 4px;
  background: rgba(64, 158, 255, 0.07);
}
.acceptance-radius-main { display: flex; align-items: center; gap: 7px; }
.acceptance-radius-main .bar-label { flex: 1; white-space: nowrap; }
.radius-input-wrap { position: relative; width: 72px; }
.radius-input { padding-right: 19px; }
.radius-unit {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  color: #909399; font-size: 10px; pointer-events: none;
}
.acceptance-radius-status {
  margin-top: 5px; color: #909399; font-size: 10px; line-height: 1.2;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.acceptance-radius-status.confirmed { color: #67c23a; }
.bar-label { font-size: 11px; color: #aaa; }
.input-group { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #ddd; }
.hud-input.mini { width: 40px; padding: 2px; text-align: center; }

/* 拖拽相关 */
.drag-handle { cursor: move; color: #888; }
.drag-handle:hover { color: #fff; }
.sortable-ghost { opacity: 0.5; background: rgba(64, 158, 255, 0.2) !important; }
.seq-badge {
  background: #409EFF; color: white; border-radius: 50%;
  width: 16px; height: 16px; display: inline-flex;
  align-items: center; justify-content: center; font-size: 10px;
}

/* 覆盖表格 */
:deep(.hud-table) { background: transparent; --el-table-tr-bg-color: transparent; --el-table-header-bg-color: rgba(255,255,255,0.05); --el-table-text-color: #eee; --el-table-border-color: rgba(255,255,255,0.1); font-size: 12px; }
.hud-input { width: 100%; background: rgba(255,255,255,0.1); border: 1px solid transparent; color: white; border-radius: 4px; padding: 4px; text-align: center; }
.hud-input:focus { border-color: #409EFF; outline: none; }
.hud-btn { width: 100%; padding: 10px; border: none; border-radius: 4px; color: white; font-weight: 600; cursor: pointer; margin-top: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; }
.hud-btn.primary { background: #409EFF; }
.hud-btn.success { background: #67c23a; }
.hud-btn.secondary { background: #53677d; }
.hud-btn.secondary:hover { background: #637c96; }
.file-action-footer { margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.1); }
.mission-file-input { display: none; }
.delete-icon { cursor: pointer; color: #f56c6c; }
.delete-icon.disabled { cursor: not-allowed; color: #606266; opacity: 0.55; }
.geofence-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px;
  margin-bottom: 8px;
  border: 1px solid rgba(245, 166, 35, 0.35);
  border-radius: 4px;
  background: rgba(245, 166, 35, 0.09);
  color: #ddd;
  font-size: 11px;
}
.geofence-summary > div { display: flex; align-items: center; gap: 6px; }
.geofence-type-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f5a623;
  box-shadow: 0 0 7px rgba(245, 166, 35, 0.75);
}
.geofence-seq { background: #f5a623; color: #201200; }
.coordinate-text { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10px; }
.geofence-status {
  min-height: 16px;
  padding-top: 6px;
  color: #909399;
  font-size: 10px;
  line-height: 1.35;
}
.geofence-status.pending { color: #e6a23c; }
.geofence-status.success { color: #67c23a; }
.geofence-status.error { color: #f56c6c; }
.geofence-actions { display: flex; flex-direction: column; }
.hud-btn:disabled { cursor: not-allowed; opacity: 0.48; }

/* Tabs */
:deep(.el-tabs__item) { color: #999; }
:deep(.el-tabs__item.is-active) { color: #409EFF; }
:deep(.el-tabs__nav-wrap::after) { background: rgba(255,255,255,0.1); }
</style>

<style>
.hud-message-box {
  background: rgba(30, 30, 30, 0.95) !important;
  backdrop-filter: blur(10px);
  border: 1px solid #444 !important;
}
.hud-message-box .el-message-box__title { color: white !important; }
.hud-message-box .el-message-box__message { color: #ddd !important; }
</style>

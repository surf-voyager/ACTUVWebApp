<template>
  <div id="map-container"></div>

  <div v-if="waypointDragInfo.visible" class="waypoint-drag-info">
    <span class="waypoint-drag-title">航点 {{ waypointDragInfo.number }}</span>
    <span class="waypoint-drag-item">
      距上一航点 <strong>{{ formattedWaypointDistance }}</strong>
    </span>
    <span class="waypoint-drag-divider"></span>
    <span class="waypoint-drag-item">
      方位 <strong>{{ waypointDragInfo.bearingDeg.toFixed(1) }}°</strong>
    </span>
  </div>

  <div
    v-if="downloadState !== 'idle'"
    class="download-status"
    :class="downloadState"
  >
    <div class="status-header">
      <span>{{ downloadTitle }}</span>
      <span class="percentage">{{ downloadProgress }}%</span>
    </div>
    <el-progress
      :percentage="downloadProgress"
      :show-text="false"
      :stroke-width="9"
      :status="downloadProgressStatus"
      :color="downloadProgressColor"
    />
    <span class="status-detail">{{ downloadDetail }}</span>
  </div>
</template>

<script setup>
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// 插件
import {downloadTile, hasTile, saveTile} from 'leaflet.offline';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import 'leaflet-rotatedmarker';

import boatIconImg from '../../assets/navigator-arrows.svg';
import boatIconRawGpsImg from '../../assets/navigator-arrows-raw-gps.svg';
import { useGcsStore } from '../../store/useGcsStore';
import { storeToRefs } from 'pinia';
import { useRoute } from 'vue-router';
import {ElMessage, ElMessageBox} from 'element-plus';
import {shouldRenderWaypointAcceptanceRadius} from '../../services/waypointAcceptanceRadius';
import {
  isRenderableMapPosition,
  POSITION_SOURCE_EKF,
  POSITION_SOURCE_RAW_GPS,
  usesRawGpsPosition
} from '../../services/positionDisplay';

const store = useGcsStore();
const {
  vehicle,
  mapTriggers,
  plannerMode,
  areaPoints,
  mission,
  geofence,
  waypointAcceptanceRadius
} = storeToRefs(store);

const route = useRoute();

// --- 变量定义 ---
let map = null;
let baseLayer = null;

let boatLayerGroup = null;
let missionLayerGroup = null;
let trajectoryLayerGroup = null;
let areaLayerGroup = null;
let geofenceLayerGroup = null;
let homeLayerGroup = null; // 新增：HOME点图层

let boatMarker = null;
let boatIcons = null;
let activeBoatIconSource = null;
let homeMarker = null; // 新增：HOME点标记
let trajectoryPolyline = null;
let trajectoryShadow = null; // <--- 轨迹阴影
let downloadCloseTimer = null;

// 下载状态
const downloadProgress = ref(0);
const totalTiles = ref(0);
const savedTiles = ref(0);
const failedTiles = ref(0);
const downloadState = ref('idle');
const downloadError = ref('');
const waypointDragInfo = ref({
  visible: false,
  number: 0,
  distanceM: 0,
  bearingDeg: 0
});
const formattedWaypointDistance = computed(() => {
  const distanceM = waypointDragInfo.value.distanceM;
  return distanceM >= 1000
    ? `${(distanceM / 1000).toFixed(2)} km`
    : `${distanceM.toFixed(1)} m`;
});
const downloadTitle = computed(() => ({
  downloading: '正在下载当前视野',
  success: '当前视野下载完成',
  error: '当前视野下载失败'
})[downloadState.value] || '');
const downloadProgressStatus = computed(() => {
  if (downloadState.value === 'success') return 'success';
  if (downloadState.value === 'error') return 'exception';
  return undefined;
});
const downloadProgressColor = computed(() =>
  downloadState.value === 'downloading' ? '#78b7ff' : undefined
);
const downloadDetail = computed(() => {
  if (downloadState.value === 'error') {
    return `${downloadError.value}（成功 ${savedTiles.value}，失败 ${failedTiles.value}，共 ${totalTiles.value} 张）`;
  }
  if (downloadState.value === 'success') {
    return `已缓存 ${savedTiles.value} / ${totalTiles.value} 张瓦片`;
  }
  return `正在处理 ${savedTiles.value + failedTiles.value} / ${totalTiles.value} 张瓦片`;
});

// --- 生命周期 ---
onMounted(() => {
  initMap();
  document.addEventListener('mouseup', hideWaypointDragInfo);
  document.addEventListener('touchend', hideWaypointDragInfo);
  watch(() => route.name, (newRouteName) => {
    handleModeChange(newRouteName);
  }, { immediate: true });
});

onUnmounted(() => {
  if (downloadCloseTimer) clearTimeout(downloadCloseTimer);
  document.removeEventListener('mouseup', hideWaypointDragInfo);
  document.removeEventListener('touchend', hideWaypointDragInfo);
  if (map) map.remove();
});

const calculateBearingDeg = (from, to) => {
  const toRad = value => value * Math.PI / 180;
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const deltaLng = toRad(to.lng - from.lng);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};

const updateWaypointDragInfo = (index, currentPosition, routeLatLngs) => {
  if (index === 0) {
    hideWaypointDragInfo();
    return;
  }
  const previousPosition = L.latLng(routeLatLngs[index - 1]);
  waypointDragInfo.value = {
    visible: true,
    number: index + 1,
    distanceM: previousPosition.distanceTo(currentPosition),
    bearingDeg: calculateBearingDeg(previousPosition, currentPosition)
  };
};

function hideWaypointDragInfo() {
  waypointDragInfo.value.visible = false;
}

// --- 初始化地图 ---
const initMap = () => {

  // 全局坐标显示精度改为 8 位小数
  const _formatNum = L.Util.formatNum;
  L.Util.formatNum = function (num, digits) {
    return _formatNum(num, digits || 8);
  };

  map = L.map('map-container', {
    zoomControl: false,
    attributionControl: false,
    minZoom: 3,
    doubleClickZoom: false
  }).setView([45.77, 126.67], 16);

  initOfflineSystem();
  initLayerGroups();
  initBoat();
  initHome(); // 新增：初始化HOME点
  initTrajectory();
  initGeoman();

  // --- 新增: 地图点击事件 ---
  map.on('click', handleMapClick);
  map.on('dblclick', handleMapDblClick); // 新增：双击事件
};

const initLayerGroups = () => {
  // 定义不同的 pane 来控制层级
  map.createPane('areaPane');
  map.getPane('areaPane').style.zIndex = 440;

  map.createPane('missionPane');
  map.getPane('missionPane').style.zIndex = 450;

  map.createPane('geofencePane');
  map.getPane('geofencePane').style.zIndex = 445;

  map.createPane('trajectoryPane');
  map.getPane('trajectoryPane').style.zIndex = 500;

  map.createPane('boatPane');
  map.getPane('boatPane').style.zIndex = 650;

  map.createPane('homePane'); // 新增：HOME点窗格
  map.getPane('homePane').style.zIndex = 700; // 最高

  // 初始化图层组并分配到对应的 pane
  areaLayerGroup = L.layerGroup({ pane: 'areaPane' }).addTo(map);
  geofenceLayerGroup = L.layerGroup({ pane: 'geofencePane' }).addTo(map);
  missionLayerGroup = L.layerGroup({ pane: 'missionPane' }).addTo(map);
  trajectoryLayerGroup = L.layerGroup({ pane: 'trajectoryPane' }).addTo(map);
  boatLayerGroup = L.layerGroup({ pane: 'boatPane' }).addTo(map);
  homeLayerGroup = L.layerGroup({ pane: 'homePane' }).addTo(map); // 新增
};

const initOfflineSystem = () => {
  const googleHybridUrl = 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}';
  baseLayer = L.tileLayer.offline(googleHybridUrl, {
    maxNativeZoom: 20,
    maxZoom: 22,
    subdomains: ['0', '1', '2', '3'],
    location: 'indexedDB',
    saveWhatYouOnto: true,
    crossOrigin: true,
  }).addTo(map);
};

const initBoat = () => {
  if (!boatLayerGroup) return;
  const iconOptions = {
    iconSize: [48, 48],
    iconAnchor: [24, 24]
  };
  boatIcons = {
    [POSITION_SOURCE_EKF]: L.icon({...iconOptions, iconUrl: boatIconImg}),
    [POSITION_SOURCE_RAW_GPS]: L.icon({...iconOptions, iconUrl: boatIconRawGpsImg})
  };
  const hasInitialPosition = isRenderableMapPosition(vehicle.value.position);
  const startLat = hasInitialPosition ? Number(vehicle.value.position.lat) : 45.99;
  const startLng = hasInitialPosition ? Number(vehicle.value.position.lng) : 126.67;
  activeBoatIconSource = usesRawGpsPosition(vehicle.value.position)
    ? POSITION_SOURCE_RAW_GPS
    : POSITION_SOURCE_EKF;
  boatMarker = L.marker([startLat, startLng], {
    icon: boatIcons[activeBoatIconSource],
    rotationAngle: -45,
    rotationOrigin: 'center center',
    zIndexOffset: 2000
  }).addTo(boatLayerGroup);
  boatMarker.setOpacity(hasInitialPosition ? 1 : 0);
};

// 新增：初始化HOME点
const initHome = () => {
  if (!homeLayerGroup) return;
  const homeIcon = L.divIcon({
    className: 'map-home-icon',
    html: 'T',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
  homeMarker = L.marker([0, 0], {
    icon: homeIcon,
    zIndexOffset: 3000,
    opacity: 0, // 初始不可见
  }).addTo(homeLayerGroup);
};


// --- 修改: 初始化轨迹样式 ---
const initTrajectory = () => {
  if (!trajectoryLayerGroup) return;

  // 1. 阴影层
  trajectoryShadow = L.polyline([], {
    color: 'black',
    weight: 7, // 比主线宽
    opacity: 0.4,
    lineJoin: 'round',
  }).addTo(trajectoryLayerGroup);

  // 2. 主线层
  trajectoryPolyline = L.polyline([], {
    color: '#FF4500',
    weight: 5, // 粗实线
    opacity: 1,
    lineJoin: 'round',
  }).addTo(trajectoryLayerGroup);
};


const initGeoman = () => {
  map.pm.setLang('zh');
  map.pm.setGlobalOptions({allowSelfIntersection: false});
  map.pm.addControls({
    position: 'topleft',
    drawCircle: false, drawMarker: false, drawPolygon: true,
    drawPolyline: true, editMode: true, dragMode: true, removalMode: true
  });
  map.pm.toggleControls(false);

  map.on('pm:create', async (e) => {
    const layer = e.layer;
    map.removeLayer(layer);

    if (e.shape === 'Polygon') {
      const rings = layer.getLatLngs();
      const points = Array.isArray(rings[0]) ? rings[0] : rings;
      if (geofence.value.points.length > 0) {
        try {
          await ElMessageBox.confirm(
            '新绘制的多边形将替换当前前端本地围栏，尚未发送的修改会丢失。',
            '替换本地地理围栏',
            {
              confirmButtonText: '确认替换',
              cancelButtonText: '取消',
              type: 'warning',
              customClass: 'hud-message-box'
            }
          );
        } catch (_) {
          return;
        }
      }
      try {
        store.setGeofencePoints(points, 'LOCAL');
        ElMessage.success(`已绘制包含型地理围栏（${points.length} 个角点）`);
      } catch (error) {
        ElMessage.error(error?.message || '地理围栏无效');
      }
      return;
    }

    if (e.shape !== 'Line') return;
    const latlngs = layer.getLatLngs();
    const startSeq = mission.value.plannedWaypoints.length;
    const newWaypoints = latlngs.map((pt, index) => ({
      seq: startSeq + index + 1,
      lat: pt.lat,
      lng: pt.lng,
      speed: mission.value.defaults.speed,
      loiter: mission.value.defaults.loiter,
    }));
    mission.value.plannedWaypoints.push(...newWaypoints);
    store.triggerRedraw();
  });
};

// --- 新增: 地图点击处理 ---
const handleMapClick = (e) => {
  if (plannerMode.value === 'area') {
    store.addAreaPoint(e.latlng);
  }
};

// 新增：地图双击处理
const handleMapDblClick = (e) => {
  // 任何模式下都允许指点
  store.setGotoTargetCandidate(e.latlng);
};


const renderMissionFromStore = () => {
  if (!map || !missionLayerGroup) return;
  missionLayerGroup.clearLayers();
  const waypoints = store.mission.plannedWaypoints;
  if (!waypoints || waypoints.length === 0) return;
  const latlngs = waypoints.map(p => [p.lat, p.lng]);
  const acceptanceRadiusCircles = [];

  const acceptanceRadiusM = Number(waypointAcceptanceRadius.value.valueM);
  if (shouldRenderWaypointAcceptanceRadius(waypointAcceptanceRadius.value)) {
    waypoints.forEach((pt) => {
      const circle = L.circle([pt.lat, pt.lng], {
        radius: acceptanceRadiusM,
        color: '#f5c542',
        weight: 2,
        opacity: 0.9,
        fill: false,
        dashArray: '6, 7',
        interactive: false,
      }).addTo(missionLayerGroup);
      acceptanceRadiusCircles.push(circle);
    });
  }

  const missionOutline = L.polyline(latlngs, {
    color: 'white', weight: 6, opacity: 0.9, lineJoin: 'round'
  }).addTo(missionLayerGroup);
  const missionRoute = L.polyline(latlngs, {
    color: '#409EFF', weight: 3, opacity: 1, lineJoin: 'round'
  }).addTo(missionLayerGroup);

  // 判断当前是否在 planner 界面
  const isPlannerPage = route.name === 'planner';

  waypoints.forEach((pt, index) => {
    const numberIcon = L.divIcon({
      className: 'map-seq-icon',
      html: `<span>${index + 1}</span>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    const marker = L.marker([pt.lat, pt.lng], {
      icon: numberIcon,
      draggable: isPlannerPage, // 只有在 planner 界面才允许拖动
      zIndexOffset: 1000
    }).addTo(missionLayerGroup);

    if (isPlannerPage) {
      marker.on('mousedown', (e) => {
        updateWaypointDragInfo(index, e.target.getLatLng(), latlngs);
      });
      marker.on('dragstart', (e) => {
        updateWaypointDragInfo(index, e.target.getLatLng(), latlngs);
      });
      marker.on('drag', (e) => {
        const newPos = e.target.getLatLng();
        latlngs[index] = newPos;
        missionOutline.setLatLngs(latlngs);
        missionRoute.setLatLngs(latlngs);
        acceptanceRadiusCircles[index]?.setLatLng(newPos);
        updateWaypointDragInfo(index, newPos, latlngs);
      });
      marker.on('dragend', (e) => {
        const newPos = e.target.getLatLng();
        store.mission.plannedWaypoints[index].lat = newPos.lat;
        store.mission.plannedWaypoints[index].lng = newPos.lng;
        hideWaypointDragInfo();
        store.triggerRedraw();
      });
    }
  });
};

// --- 新增: 渲染区域选择 ---
const renderAreaSelection = () => {
  if (!map || !areaLayerGroup) return;
  areaLayerGroup.clearLayers();
  const points = areaPoints.value;
  if (!points || points.length === 0) return;

  const latlngs = points.map(p => [p.lat, p.lng]);

  // 判断当前是否在 planner 界面
  const isPlannerPage = route.name === 'planner';

  // 绘制点
  points.forEach((pt, index) => {
    const cornerIcon = L.divIcon({
      className: 'map-corner-icon',
      html: `<span>${index + 1}</span>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
    const marker = L.marker([pt.lat, pt.lng], {
      icon: cornerIcon,
      draggable: isPlannerPage // 只有在 planner 界面才允许拖动
    }).addTo(areaLayerGroup);

    if (isPlannerPage) {
      // 添加拖动事件
      marker.on('dragend', (e) => {
        const newPos = e.target.getLatLng();
        // 更新 store 中的点
        store.areaPoints[index] = newPos;
        // 触发重绘
        store.triggerRedraw();
      });
    }
  });

  // 绘制连接线 (虚线)
  if (latlngs.length > 1) {
    L.polyline(latlngs, {
      color: '#67C23A',
      weight: 3,
      dashArray: '5, 10',
      opacity: 0.8
    }).addTo(areaLayerGroup);
  }

  // 如果4个点都选了，闭合区域
  if (latlngs.length === 4) {
    L.polyline([...latlngs, latlngs[0]], {
      color: '#67C23A',
      weight: 3,
      dashArray: '5, 10',
      opacity: 0.8
    }).addTo(areaLayerGroup);
  }
};


const scheduleDownloadPanelClose = (delayMs) => {
  if (downloadCloseTimer) clearTimeout(downloadCloseTimer);
  downloadCloseTimer = setTimeout(() => {
    downloadState.value = 'idle';
    downloadCloseTimer = null;
  }, delayMs);
};

const updateDownloadProgress = () => {
  const processed = savedTiles.value + failedTiles.value;
  downloadProgress.value = totalTiles.value > 0
    ? Math.min(100, Math.round((processed / totalTiles.value) * 100))
    : 0;
};

const cacheMapTile = async (tile) => {
  try {
    if (!await hasTile(tile.key)) {
      const blob = await downloadTile(tile.url);
      await saveTile(tile, blob);
    }
    savedTiles.value += 1;
  } catch (error) {
    failedTiles.value += 1;
    if (!downloadError.value) {
      downloadError.value = '地图瓦片下载或本地缓存写入失败';
      console.error('地图瓦片缓存失败:', error);
    }
  } finally {
    updateDownloadProgress();
  }
};

const cacheTilesWithConcurrency = async (tiles, concurrency = 6) => {
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < tiles.length) {
      const tile = tiles[nextIndex];
      nextIndex += 1;
      await cacheMapTile(tile);
    }
  };
  await Promise.all(
    Array.from({length: Math.min(concurrency, tiles.length)}, () => worker())
  );
};

const saveCurrentArea = async () => {
  if (!baseLayer || !map || downloadState.value === 'downloading') return false;
  if (downloadCloseTimer) {
    clearTimeout(downloadCloseTimer);
    downloadCloseTimer = null;
  }

  downloadState.value = 'downloading';
  downloadProgress.value = 0;
  totalTiles.value = 0;
  savedTiles.value = 0;
  failedTiles.value = 0;
  downloadError.value = '';

  try {
    const currentZoom = map.getZoom();
    const nativeZoom = Number(baseLayer.options.maxNativeZoom);
    const downloadZoom = Number.isFinite(nativeZoom)
      ? Math.min(currentZoom, nativeZoom)
      : currentZoom;
    const visibleBounds = map.getBounds();
    const pixelBounds = L.bounds(
      map.project(visibleBounds.getNorthWest(), downloadZoom),
      map.project(visibleBounds.getSouthEast(), downloadZoom)
    );
    const tiles = baseLayer.getTileUrls(pixelBounds, downloadZoom);
    totalTiles.value = tiles.length;
    if (tiles.length === 0) throw new Error('当前视野没有可下载的地图瓦片');

    await cacheTilesWithConcurrency(tiles);
    if (failedTiles.value > 0) {
      downloadState.value = 'error';
      downloadError.value = downloadError.value || '部分地图瓦片下载失败';
      scheduleDownloadPanelClose(10000);
      return false;
    }

    downloadProgress.value = 100;
    downloadState.value = 'success';
    scheduleDownloadPanelClose(5000);
    return true;
  } catch (error) {
    downloadState.value = 'error';
    downloadError.value = error?.message || '地图下载失败';
    scheduleDownloadPanelClose(10000);
    return false;
  }
};

const focusBoat = () => {
  if (!map || !vehicle.value.position) return;
  const { lat, lng } = vehicle.value.position;
  if (isRenderableMapPosition(vehicle.value.position)) {
    map.flyTo([lat, lng], 18, { animate: true, duration: 1.0 });
  }
};

const renderGeofenceFromStore = () => {
  if (!map || !geofenceLayerGroup) return;
  geofenceLayerGroup.clearLayers();
  const points = geofence.value.points;
  if (!Array.isArray(points) || points.length < 3) return;

  const latlngs = points.map(point => [point.latitude, point.longitude]);
  L.polygon(latlngs, {
    pane: 'geofencePane',
    color: '#f5a623',
    weight: 3,
    opacity: 0.95,
    fillColor: '#f5a623',
    fillOpacity: 0.13,
    interactive: false,
    pmIgnore: true
  }).addTo(geofenceLayerGroup);

  points.forEach((point, index) => {
    const icon = L.divIcon({
      className: 'map-geofence-icon',
      html: `<span>${index + 1}</span>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });
    L.marker([point.latitude, point.longitude], {
      pane: 'geofencePane',
      icon,
      draggable: false,
      interactive: false,
      pmIgnore: true,
      zIndexOffset: 500
    }).addTo(geofenceLayerGroup);
  });
};

defineExpose({ saveCurrentArea, focusBoat });

// --- 监听器 ---

watch(() => vehicle.value.position, (newPos) => {
  if (!boatMarker) return;
  if (isRenderableMapPosition(newPos)) {
    const iconSource = usesRawGpsPosition(newPos)
      ? POSITION_SOURCE_RAW_GPS
      : POSITION_SOURCE_EKF;
    if (iconSource !== activeBoatIconSource) {
      boatMarker.setIcon(boatIcons[iconSource]);
      activeBoatIconSource = iconSource;
    }
    boatMarker.setLatLng([newPos.lat, newPos.lng]);
    boatMarker.setOpacity(1);
  } else {
    boatMarker.setOpacity(0);
  }
}, { deep: true });

watch(() => vehicle.value.attitude.yaw, (newYaw) => {
  if (boatMarker) {
    boatMarker.setRotationAngle(newYaw-45 || -45);
  }
});

// 仅在 PX4 明确确认 Home 有效后显示，避免把默认 (0, 0) 当作真实 Home。
watch(
  () => [vehicle.value.home, vehicle.value.health.is_home_position_ok],
  ([newHome, homePositionOk]) => {
    const homeLat = Number(newHome?.lat);
    const homeLon = Number(newHome?.lon);
    if (homeMarker && homePositionOk === true
        && Number.isFinite(homeLat) && Number.isFinite(homeLon)
        && Math.abs(homeLat) <= 90 && Math.abs(homeLon) <= 180) {
      homeMarker.setLatLng([homeLat, homeLon]);
      homeMarker.setOpacity(1);
    } else if (homeMarker) {
      homeMarker.setOpacity(0);
    }
  },
  {deep: true, immediate: true}
);


// --- 修改: 监听轨迹数据变化 ---
watch(() => vehicle.value.trajectory, (newTrajectory, oldTrajectory) => {
  if (trajectoryPolyline && trajectoryShadow) {
    // 如果是清空操作，则直接设置为空数组
    if (newTrajectory.length === 0 && oldTrajectory.length > 0) {
      trajectoryPolyline.setLatLngs([]);
      trajectoryShadow.setLatLngs([]);
    } else { // 否则是增量更新
      trajectoryPolyline.setLatLngs(newTrajectory);
      trajectoryShadow.setLatLngs(newTrajectory);
    }
  }
}, { deep: true });


watch(() => mapTriggers.value.redrawMission, (val) => {
  if (val) {
    renderMissionFromStore();
    renderAreaSelection(); // 同时重绘区域
    renderGeofenceFromStore();
  }
});

watch(
  () => geofence.value.points,
  () => renderGeofenceFromStore(),
  {deep: true}
);

watch(
  () => [waypointAcceptanceRadius.value.queried, waypointAcceptanceRadius.value.valueM],
  () => renderMissionFromStore()
);

watch(() => mapTriggers.value.clearMap, (val) => {
  if (val && missionLayerGroup) {
    missionLayerGroup.clearLayers();
    areaLayerGroup.clearLayers(); // 同时清除区域
  }
});

watch(plannerMode, (newMode) => {
  if (newMode === 'manual' || newMode === 'geofence') {
    map.pm.toggleControls(true);
  } else {
    map.pm.toggleControls(false);
    map.pm.disableDraw();
  }
});


const handleModeChange = (pageName) => {
  if (!map) return;
  if (pageName === 'planner'
      && (plannerMode.value === 'manual' || plannerMode.value === 'geofence')) {
    map.pm.toggleControls(true);
  } else {
    map.pm.toggleControls(false);
    map.pm.disableDraw();
  }
  // 切换页面时，重新渲染任务以更新拖动状态
  renderMissionFromStore();
  renderAreaSelection();
  renderGeofenceFromStore();
};
</script>

<style scoped>
#map-container {
  width: 100%;
  height: 100%;
  background: #222;
  z-index: 1;
}

.waypoint-drag-info {
  position: absolute;
  top: 94px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 360px;
  box-sizing: border-box;
  padding: 11px 18px;
  border: 1px solid rgba(116, 186, 255, 0.72);
  border-radius: 12px;
  background: rgba(22, 91, 166, 0.78);
  box-shadow: 0 8px 22px rgba(0, 32, 72, 0.42);
  backdrop-filter: blur(8px);
  color: #d9ecff;
  pointer-events: none;
}

.waypoint-drag-title {
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}

.waypoint-drag-item {
  color: #b9d8f7;
  font-size: 12px;
  white-space: nowrap;
}

.waypoint-drag-item strong {
  margin-left: 4px;
  color: #fff;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.waypoint-drag-divider {
  width: 1px;
  height: 20px;
  background: rgba(199, 226, 255, 0.35);
}

.download-status {
  position: absolute;
  bottom: 88px;
  left: 300px;
  width: 320px;
  box-sizing: border-box;
  background: rgba(24, 91, 170, 0.78);
  backdrop-filter: blur(8px);
  padding: 13px 15px;
  border-radius: 10px;
  z-index: 9999;
  border: 1px solid rgba(120, 183, 255, 0.7);
  box-shadow: 0 7px 20px rgba(0, 25, 60, 0.45);
  color: #d9ecff;
  animation: slideUp 0.3s ease-out;
  transition: color 0.25s ease, background 0.25s ease, border-color 0.25s ease;
}
.download-status.success {
  background: rgba(20, 91, 58, 0.82);
  border-color: rgba(103, 194, 58, 0.8);
  color: #85e6a6;
}
.download-status.error {
  background: rgba(120, 31, 42, 0.84);
  border-color: rgba(245, 108, 108, 0.85);
  color: #ffadb3;
}
.status-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 600;
  color: inherit;
}

.percentage {
  color: inherit;
}

.status-detail {
  display: block;
  margin-top: 8px;
  font-size: 12px;
  color: inherit;
  opacity: 0.9;
  text-align: left;
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
<style>
.map-seq-icon {
  background-color: #409EFF;
  border: 3px solid white;
  border-radius: 50%;
  color: white;
  text-align: center;
  display: flex;
  justify-content: center;
  align-items: center;
  font-weight: 800;
  font-size: 16px;
  font-family: Arial, sans-serif;
  box-shadow: 0 3px 8px rgba(0,0,0,0.6);
  box-sizing: border-box;
  transition: background-color 0.2s, box-shadow 0.2s;
}

.map-seq-icon:hover {
  background-color: #66b1ff;
  box-shadow: 0 4px 10px rgba(64, 158, 255, 0.8);
}

.map-corner-icon {
  background-color: #67C23A;
  border: 2px solid white;
  border-radius: 50%;
  color: white;
  text-align: center;
  display: flex;
  justify-content: center;
  align-items: center;
  font-weight: 600;
  font-size: 14px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.5);
}

.map-geofence-icon {
  background-color: #f5a623;
  border: 2px solid white;
  border-radius: 50%;
  color: #201200;
  display: flex;
  justify-content: center;
  align-items: center;
  font-weight: 800;
  font-size: 12px;
  box-shadow: 0 2px 7px rgba(0, 0, 0, 0.65);
}

/* 新增：HOME点图标样式 */
.map-home-icon {
  background-color: #f56c6c;
  border: 3px solid white;
  border-radius: 50%;
  color: white;
  text-align: center;
  display: flex;
  justify-content: center;
  align-items: center;
  font-weight: 800;
  font-size: 20px;
  font-family: 'Arial Black', sans-serif;
  box-shadow: 0 4px 12px rgba(0,0,0,0.7);
  text-shadow: 0 0 5px black;
}
</style>

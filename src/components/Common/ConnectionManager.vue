<template>
  <el-popover
    placement="bottom-end"
    :width="250"
    trigger="click"
    popper-class="hud-popover"
  >
    <template #reference>
      <el-button :type="statusType" circle class="connection-btn">
        <el-icon size="18"><Link /></el-icon>
      </el-button>
    </template>
    <div class="connection-status-panel">
      <div class="status-item">
        <span class="status-label">后端服务 (WebSocket)</span>
        <div class="status-value">
          <span :class="['status-dot', isWsConnected ? 'success' : 'error']"></span>
          <span class="status-text">{{ isWsConnected ? '已连接' : '未连接' }}</span>
        </div>
      </div>
       <div class="status-item">
        <span class="status-label"></span>
        <div class="status-value">
          <span class="address-text">{{ wsUrl }}</span>
          <el-link type="primary" @click="openChangeDialog">更改</el-link>
        </div>
      </div>
      <el-divider />
      <div class="status-item">
        <span class="status-label">飞控 (Vehicle)</span>
        <div class="status-value">
          <span :class="['status-dot', vehicle.connected ? 'success' : 'error']"></span>
          <span class="status-text">{{ vehicle.connected ? '已连接' : '未连接' }}</span>
        </div>
      </div>
      <el-divider />
      <div class="system-controls">
        <div class="status-label" style="margin-bottom: 8px;">系统控制</div>
        <div class="control-btns">
          <el-button type="danger" size="small" :icon="SwitchButton" @click="store.shutdownPi" plain>
            关闭 RPi
          </el-button>
          <el-button type="danger" size="small" :icon="VideoPause" @click="store.shutdownFcu" plain>
            关闭 FCU
          </el-button>
        </div>
      </div>
    </div>
  </el-popover>

  <el-dialog
    v-model="isDialogVisible"
    title="设置后端连接地址"
    width="400px"
    class="hud-dialog"
    append-to-body
  >
    <el-input v-model="newWsAddress" placeholder="例如: ws://192.168.1.10:8765" />
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="isDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleChangeAddress">
          确认
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useGcsStore } from '../../store/useGcsStore';
import { storeToRefs } from 'pinia';
import { Link, SwitchButton, VideoPause } from '@element-plus/icons-vue';

const store = useGcsStore();
const { vehicle, isWsConnected, wsUrl } = storeToRefs(store);

const isDialogVisible = ref(false);
const newWsAddress = ref('');

const statusType = computed(() => {
  if (isWsConnected.value && vehicle.value.connected) {
    return 'primary'; // Blue
  }
  if (isWsConnected.value || vehicle.value.connected) {
    return 'warning'; // Yellow
  }
  return 'error'; // Red
});

const openChangeDialog = () => {
  newWsAddress.value = wsUrl.value; // Load current address into dialog
  isDialogVisible.value = true;
};

const handleChangeAddress = () => {
  store.changeWsUrl(newWsAddress.value);
  isDialogVisible.value = false;
};
</script>

<style scoped>
.connection-status-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 13px;
}
.status-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.status-label {
  color: #aaa;
}
.status-value {
  display: flex;
  align-items: center;
  gap: 6px;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.status-dot.success { background-color: #67C23A; }
.status-dot.error { background-color: #F56C6C; }
.status-text { color: #eee; }
.address-text { font-size: 12px; color: #888; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.el-divider { margin: 4px 0; border-color: #444; }
.connection-btn {
  width: 32px;
  height: 32px;
  min-height: 32px;
  padding: 0;
  border: none;
}
.control-btns {
  display: flex;
  gap: 10px;
  justify-content: center;
}
</style>
<style>
/* Global styles for popover and dialog to match HUD theme */
/* Note: .hud-popover is defined in DashboardView, so we reuse it. */

.hud-dialog {
  background: rgba(30, 30, 30, 0.95) !important;
  backdrop-filter: blur(10px);
  border: 1px solid #444 !important;
}
.hud-dialog .el-dialog__title { color: white; }
.hud-dialog .el-dialog__body { color: #ddd; }
.hud-dialog .el-input__wrapper {
  background-color: #222;
  box-shadow: 0 0 0 1px #444 inset;
}
.hud-dialog .el-input__inner {
  color: white;
}
</style>

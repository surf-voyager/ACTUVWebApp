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
          <div class="connection-box ntrip-connection-box">
            <div class="status-row">
              <span class="label">差分定位服务</span>
              <span :class="['status-dot', ntripStatus.healthy ? 'success' : 'error']"></span>
            </div>
            <div class="address-row">
              <span class="address" :title="ntripEndpoint">{{ ntripEndpoint }}</span>
              <el-button type="primary" link @click="openNtripDialog">更改</el-button>
            </div>
            <div :class="['ntrip-status-reason', ntripStatus.healthy ? 'success' : 'error']"
                 role="status" aria-live="polite">
              {{ ntripStatus.reason }}
            </div>
          </div>
        </section>

        <!-- 2. 信息查询 -->
        <section class="panel-section">
          <div class="section-header">
            <el-icon>
              <Search/>
            </el-icon>
            <span>信息查询</span>
          </div>
          <div class="info-query-box">
            <div class="info-query-controls">
              <el-select
                  v-model="infoQuery.selectedId"
                  class="info-query-select"
                  :disabled="infoQuery.phase === 'PENDING' || waypointAcceptanceRadius.queryPhase === 'PENDING'"
                  aria-label="查询项目"
              >
                <el-option
                    v-for="option in infoQueryOptions"
                    :key="option.id"
                    :label="option.label"
                    :value="option.id"
                />
              </el-select>
              <el-button
                  type="primary"
                  class="info-query-button"
                  :loading="infoQuery.phase === 'PENDING'"
                  :disabled="!isWsConnected || infoQuery.phase === 'PENDING' || waypointAcceptanceRadius.queryPhase === 'PENDING'"
                  @click="handleInfoQuery"
              >
                查询
              </el-button>
            </div>
            <div
                class="info-query-result"
                :class="`is-${infoQuery.phase.toLowerCase()}`"
                role="status"
                aria-live="polite"
            >
              {{ infoQuery.displayText }}
            </div>
          </div>
        </section>

        <!-- 3. 特种混合器 -->
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
                    @click="handleReturnHome">前往返航点
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

        <!-- 5. 地图工具 -->
        <section class="panel-section">
          <div class="section-header">
            <el-icon>
              <Tools/>
            </el-icon>
            <span>地图工具</span>
          </div>
          <div class="mode-grid-flat">
            <button class="mode-btn-flat small" @click="handleCenterMap">船舶居中</button>
            <button class="mode-btn-flat small" @click="store.clearTrajectory">清除轨迹</button>
            <button class="mode-btn-flat small full-row" @click="handleSaveMap">下载当前视野</button>
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
        <!-- 系统通知（原 Notification 内容） -->
        <section class="panel-section messages-section">
          <div class="section-header">
            <el-icon>
              <Bell/>
            </el-icon>
            <span>系统通知</span>
          </div>
          <div class="mini-terminal messages">
            <div v-if="notificationLogs.length === 0" class="empty-log">暂无系统通知</div>
            <div v-for="msg in notificationLogs" :key="msg.id" class="log-line-flat" :class="msg.type">
              <span class="log-time">{{ msg.time }}</span>
              <span class="log-text">[{{ msg.title }}]{{ msg.message }}<template v-if="msg.count > 1">（重复 {{ msg.count }} 次）</template></span>
            </div>
          </div>
        </section>
        <section class="panel-section logs-section">
          <div class="section-header">
            <el-icon>
              <Document/>
            </el-icon>
            <span>运行日志</span>
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
        <div class="telemetry-item location-item">
          <span class="label">卫星定位</span>
          <div class="location-content">
            <div class="gps-summary">
              <span class="value gps-count">{{ satelliteCount }}<small>颗</small></span>
              <span class="gps-fix-badge" :class="`fix-${gpsFixStatus.level}`">{{ gpsFixStatus.label }}</span>
            </div>
            <div class="coordinate-list">
              <span class="position-source-badge" :class="positionSourceClass">{{ positionSourceStatus.label }}</span>
              <div class="coordinate-row">
                <span class="coordinate-label">纬度</span>
                <template v-if="hasValidPosition">
                  <span class="coordinate-value" :class="positionSourceClass">{{ formattedLatitude }}</span>
                  <small class="coordinate-suffix">{{ latitudeSuffix }}</small>
                </template>
                <span v-else class="coordinate-placeholder">--</span>
              </div>
              <div class="coordinate-row">
                <span class="coordinate-label">经度</span>
                <template v-if="hasValidPosition">
                  <span class="coordinate-value" :class="positionSourceClass">{{ formattedLongitude }}</span>
                  <small class="coordinate-suffix">{{ longitudeSuffix }}</small>
                </template>
                <span v-else class="coordinate-placeholder">--</span>
              </div>
            </div>
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
        <div class="telemetry-item motion-item">
          <span class="label">运动状态</span>
          <div class="val-group motion-val-group">
            <div class="motion-primary-row">
              <span class="value speed-readout">
                <small class="motion-metric-label">航速</small>
                <span>{{ formatOneDecimal(vehicle.velocity.speed) }}</span><small>m/s</small>
              </span>
              <span class="value heading-readout">
                <small class="motion-metric-label">航向</small>
                <span>{{ formatHeading(vehicle.attitude.yaw) }}</span><small>°</small>
              </span>
            </div>
            <div class="sub-label-wrap tilt-row">
              <span class="sub-label tilt-reading">
                <small class="motion-metric-label">横倾</small>
                <span
                    class="tilt-value"
                    :class="{ 'tilt-warning': isTiltWarning(vehicle.attitude.roll) }"
                >{{ formatOneDecimal(vehicle.attitude.roll) }}°</span>
              </span>
              <span class="tilt-separator">|</span>
              <span class="sub-label tilt-reading">
                <small class="motion-metric-label">纵倾</small>
                <span
                    class="tilt-value"
                    :class="{ 'tilt-warning': isTiltWarning(vehicle.attitude.pitch) }"
                >{{ formatOneDecimal(vehicle.attitude.pitch) }}°</span>
              </span>
            </div>
          </div>
        </div>
        <div class="divider"></div>
        <div class="telemetry-item propulsion-feedback-item">
          <span class="label">推力反馈</span>
          <div class="propulsion-feedback-layout">
            <div
                class="propulsion-track propulsion-track-vertical"
                :class="{ 'is-invalid': !propulsionFeedbackForcedStopped && !vehicle.propulsionFeedback.leftRear.valid }"
                :title="propulsionFeedbackTitle('左后', vehicle.propulsionFeedback.leftRear)"
            >
              <span class="propulsion-zero-line"></span>
              <span
                  class="propulsion-fill"
                  :class="propulsionDirectionClass(vehicle.propulsionFeedback.leftRear)"
                  :style="propulsionFillStyle(vehicle.propulsionFeedback.leftRear, 'vertical')"
              ></span>
            </div>

            <div class="propulsion-feedback-center">
              <div class="propulsion-rear-values">
                <span>左后 <strong :class="propulsionDirectionClass(vehicle.propulsionFeedback.leftRear)">{{ formatPropulsionPercent(vehicle.propulsionFeedback.leftRear) }}</strong></span>
                <span class="propulsion-value-divider">|</span>
                <span
                    class="propulsion-motion-state"
                    :class="`is-${propulsionMotionState.key}`"
                    :title="propulsionMotionState.label"
                    role="status"
                    :aria-label="`运动状态：${propulsionMotionState.label}`"
                >{{ propulsionMotionState.symbol }}</span>
                <span class="propulsion-value-divider">|</span>
                <span>右后 <strong :class="propulsionDirectionClass(vehicle.propulsionFeedback.rightRear)">{{ formatPropulsionPercent(vehicle.propulsionFeedback.rightRear) }}</strong></span>
              </div>
              <div
                  class="propulsion-track propulsion-track-horizontal"
                  :class="{ 'is-invalid': !propulsionFeedbackForcedStopped && !vehicle.propulsionFeedback.lateral.valid }"
                  :title="propulsionFeedbackTitle('侧推', vehicle.propulsionFeedback.lateral)"
              >
                <span class="propulsion-zero-line"></span>
                <span
                    class="propulsion-fill"
                    :class="propulsionDirectionClass(vehicle.propulsionFeedback.lateral)"
                    :style="propulsionFillStyle(vehicle.propulsionFeedback.lateral, 'horizontal')"
                ></span>
              </div>
              <div class="propulsion-lateral-value">
                侧推
                <strong :class="propulsionDirectionClass(vehicle.propulsionFeedback.lateral)">{{ formatPropulsionPercent(vehicle.propulsionFeedback.lateral) }}</strong>
              </div>
            </div>

            <div
                class="propulsion-track propulsion-track-vertical"
                :class="{ 'is-invalid': !propulsionFeedbackForcedStopped && !vehicle.propulsionFeedback.rightRear.valid }"
                :title="propulsionFeedbackTitle('右后', vehicle.propulsionFeedback.rightRear)"
            >
              <span class="propulsion-zero-line"></span>
              <span
                  class="propulsion-fill"
                  :class="propulsionDirectionClass(vehicle.propulsionFeedback.rightRear)"
                  :style="propulsionFillStyle(vehicle.propulsionFeedback.rightRear, 'vertical')"
              ></span>
            </div>
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

    <el-dialog v-model="ntripDialog.visible" title="修改差分定位服务" width="440px" class="hud-dialog"
               align-center append-to-body @closed="resetNtripConnectionTest">
      <div class="ntrip-config-form">
        <div class="ntrip-form-row">
          <label>主机</label>
          <el-input v-model="ntripDialog.form.host" placeholder="rtk.ntrip.qxwz.com"/>
        </div>
        <div class="ntrip-form-row">
          <label>端口</label>
          <el-input v-model.number="ntripDialog.form.port" type="number" min="1" max="65535" placeholder="8002"/>
        </div>
        <div class="ntrip-form-row">
          <label>挂载点</label>
          <el-input v-model="ntripDialog.form.mountpoint" placeholder="AUTO"/>
        </div>
        <div class="ntrip-form-row">
          <label>用户名</label>
          <el-input v-model="ntripDialog.form.username" autocomplete="username"/>
        </div>
        <div class="ntrip-form-row">
          <label>密码</label>
          <el-input v-model="ntripDialog.form.password" type="password" show-password
                    autocomplete="current-password"/>
        </div>
        <div class="ntrip-storage-warning">配置将保存在当前浏览器的 localStorage 中。</div>
      </div>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="ntripDialog.visible = false" class="hud-btn-cancel">取消</el-button>
          <el-button
              :type="ntripDialog.test.phase === 'success' ? 'success' : 'primary'"
              :loading="ntripDialog.test.phase === 'testing'"
              :disabled="ntripDialog.test.phase === 'testing'"
              @click="startNtripConnectionTest"
              class="hud-btn-confirm"
          >
            <template v-if="ntripDialog.test.phase === 'success'">
              <el-icon><CircleCheckFilled/></el-icon>
              测试通过
            </template>
            <template v-else>{{ ntripDialog.test.phase === 'error' ? '重新测试' : '连接测试' }}</template>
          </el-button>
          <el-button
              type="primary"
              :disabled="ntripDialog.test.phase !== 'success'"
              @click="confirmNtripChange"
              class="hud-btn-confirm"
          >保存并连接</el-button>
        </span>
        <div
            v-if="ntripDialog.test.phase !== 'idle'"
            class="ntrip-test-result"
            :class="`is-${ntripDialog.test.phase}`"
            role="status"
            aria-live="polite"
        >{{ ntripDialog.test.message }}</div>
      </template>
    </el-dialog>

    <el-dialog v-model="gotoDialog.visible" title="返航点设定" width="320px" class="hud-dialog" align-center
               append-to-body>
      <div class="goto-config-form">
        <div class="goto-form-row">
          <label>经度</label>
          <el-input v-model="gotoDialog.target.lng" type="number" min="-180" max="180"
                    step="0.0000001" inputmode="decimal"/>
        </div>
        <div class="goto-form-row">
          <label>纬度</label>
          <el-input v-model="gotoDialog.target.lat" type="number" min="-90" max="90"
                    step="0.0000001" inputmode="decimal"/>
        </div>
      </div>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="gotoDialog.visible = false" class="hud-btn-cancel">取消</el-button>
          <el-button type="primary" @click="confirmGoto" class="hud-btn-confirm">确认设定</el-button>
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
  CircleCheckFilled,
  Document,
  Lightning,
  Link,
  Loading,
  Menu,
  Search,
  Setting,
  SwitchButton,
  Tools,
  VideoPause,
  VideoPlay
} from '@element-plus/icons-vue';
import {ElMessage, ElMessageBox} from 'element-plus';
import {
  MISSION_HOLD_DISPOSITION,
  missionHoldDisposition
} from '../services/missionCompletion';
import {NOTIFICATION_TITLES} from '../services/systemNotifications';

const store = useGcsStore();
const {
  vehicle,
  sysLogs,
  notificationLogs,
  mission,
  mapTriggers,
  isWsConnected,
  wsUrl,
  controlStatus,
  infoQuery,
  waypointAcceptanceRadius,
  ntripConfig,
  ntripStatus
} = storeToRefs(store);

const infoQueryOptions = [
  {id: 'PX4_POWER_VOLTAGE', label: '飞控供电电压'},
  {id: 'WAYPOINT_ACCEPTANCE_RADIUS', label: '航点接受半径'}
];

// --- 状态变量 ---
const missionState = ref('EXECUTING');
const lastMissionStartTime = ref(0);
const lastTargetIndex = ref(0);
const resumeCooldown = ref(0);
let cooldownTimer = null;
let missionHoldTimer = null;
const MISSION_HOLD_SETTLE_MS = 1000;
const gotoDialog = ref({visible: false, target: {lat: 0, lng: 0}, heading: 0});
const missionStartDialog = ref({visible: false, startIndex: 1});
const wsDialog = ref({visible: false, newAddress: ''});
const ntripDialog = ref({
  visible: false,
  form: {host: '', port: 8002, mountpoint: '', username: '', password: ''},
  test: {phase: 'idle', message: '', requestId: null}
});
const manualWaypointIndex = ref(1);
const controlState = ref({throttle: 0.0, steering: 0.0});

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
};

const ntripEndpoint = computed(() => {
  const host = String(ntripConfig.value.host || '').trim();
  const mountpoint = String(ntripConfig.value.mountpoint || '').trim().replace(/^\/+/, '');
  if (!host) return '未配置';
  return `${host}:${ntripConfig.value.port || '--'}/${mountpoint || '--'}`;
});

const openNtripDialog = () => {
  resetNtripConnectionTest();
  ntripDialog.value.form = {
    host: ntripConfig.value.host,
    port: ntripConfig.value.port,
    mountpoint: ntripConfig.value.mountpoint,
    username: ntripConfig.value.username,
    password: ntripConfig.value.password
  };
  ntripDialog.value.visible = true;
};

const NTRIP_TEST_ERROR_MESSAGES = Object.freeze({
  invalid_config: '配置无效，请完整填写连接信息',
  auth_failed: '认证失败，请检查用户名、密码和挂载点',
  network_error: '无法连接差分服务',
  bridge_error: '本地差分桥接服务不可用',
  no_data: '已登录，但 10 秒内未收到有效 RTCM 数据',
  test_timeout: '连接测试超时'
});
const NTRIP_TEST_UI_TIMEOUT_MS = 11_000;
let ntripTestUiTimeout = null;

const clearNtripTestUiTimeout = () => {
  if (ntripTestUiTimeout) clearTimeout(ntripTestUiTimeout);
  ntripTestUiTimeout = null;
};

const stopNtripConnectionTest = () => {
  clearNtripTestUiTimeout();
  const requestId = ntripDialog.value.test.requestId;
  if (requestId && import.meta.hot) {
    import.meta.hot.send('ntrip:test-stop', {request_id: requestId});
  }
};

function resetNtripConnectionTest() {
  stopNtripConnectionTest();
  ntripDialog.value.test = {phase: 'idle', message: '', requestId: null};
}

const normalizeNtripTestConfig = (input) => ({
  host: String(input?.host || '').trim(),
  port: Number(input?.port),
  mountpoint: String(input?.mountpoint || '').trim().replace(/^\/+/, ''),
  username: String(input?.username || ''),
  password: String(input?.password || '')
});

const startNtripConnectionTest = () => {
  const config = normalizeNtripTestConfig(ntripDialog.value.form);
  if (!config.host || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535
      || !config.mountpoint || !config.username || !config.password) {
    ntripDialog.value.test = {
      phase: 'error',
      message: NTRIP_TEST_ERROR_MESSAGES.invalid_config,
      requestId: null
    };
    return;
  }
  if (!import.meta.hot) {
    ntripDialog.value.test = {
      phase: 'error',
      message: '本地差分桥接服务仅随 npm run dev 提供',
      requestId: null
    };
    return;
  }

  stopNtripConnectionTest();
  const requestId = `ntrip-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  ntripDialog.value.test = {
    phase: 'testing',
    message: '正在连接差分服务…',
    requestId
  };
  import.meta.hot.send('ntrip:test', {request_id: requestId, config});
  ntripTestUiTimeout = setTimeout(() => {
    if (ntripDialog.value.test.phase !== 'testing'
        || ntripDialog.value.test.requestId !== requestId) return;
    import.meta.hot.send('ntrip:test-stop', {request_id: requestId});
    ntripDialog.value.test = {
      phase: 'error',
      message: '连接测试超时：本地差分桥接服务未响应',
      requestId: null
    };
    ntripTestUiTimeout = null;
  }, NTRIP_TEST_UI_TIMEOUT_MS);
};

const handleNtripTestStatus = (payload = {}) => {
  if (String(payload.request_id || '') !== ntripDialog.value.test.requestId) return;
  const code = String(payload.code || 'bridge_error');
  if (code === 'connecting') {
    ntripDialog.value.test.message = '正在连接差分服务…';
    return;
  }
  if (code === 'authenticated') {
    ntripDialog.value.test.message = '登录成功，正在等待有效 RTCM 数据…';
    return;
  }
  if (code === 'success') {
    clearNtripTestUiTimeout();
    ntripDialog.value.test = {
      phase: 'success',
      message: '连接成功，已收到有效 RTCM 数据',
      requestId: null
    };
    return;
  }
  clearNtripTestUiTimeout();
  ntripDialog.value.test = {
    phase: 'error',
    message: NTRIP_TEST_ERROR_MESSAGES[code] || String(payload.message || '连接测试失败'),
    requestId: null
  };
};

if (import.meta.hot) import.meta.hot.on('ntrip:test-status', handleNtripTestStatus);

watch(() => ntripDialog.value.form, () => {
  if (ntripDialog.value.visible && ntripDialog.value.test.phase !== 'idle') {
    resetNtripConnectionTest();
  }
}, {deep: true});

const confirmNtripChange = () => {
  if (ntripDialog.value.test.phase !== 'success') return;
  if (store.saveNtripConfig(ntripDialog.value.form)) {
    ntripDialog.value.visible = false;
  }
};

const handleInfoQuery = () => {
  store.requestInformationQuery(infoQuery.value.selectedId);
};

// --- 自动重连逻辑 ---
let reconnectTimer = null;
watch(() => vehicle.value.connected, (connected, wasConnected) => {
  if (!connected) {
    if (!reconnectTimer) {
      reconnectTimer = setInterval(
          () => store.sendPacket('CMD_CONNECT_VEHICLE', {}, {silent: true}),
          3000
      );
    }
    if (wasConnected === true) {
      store.pushNotification(
          NOTIFICATION_TITLES.flightController,
          '连接已断开，正在等待重连',
          'warning',
          {key: 'connection:flight-controller', incrementCount: false}
      );
    }
  } else {
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
    store.pushNotification(
        NOTIFICATION_TITLES.flightController,
        '连接成功',
        'success',
        {key: 'connection:flight-controller', incrementCount: false}
    );
    store.sendPacket("CMD_DOWNLOAD_MISSION", {});
    store.mapTriggers.centerMap = true;
    if (vehicle.value.mode === 'MISSION') {
      store.requestWaypointAcceptanceRadius({notifyOnError: true});
    }
  }
}, {immediate: true});

// --- 指点模式逻辑 ---
watch(() => mapTriggers.value.gotoTargetCandidate, (newTarget) => {
  if (newTarget) {
    gotoDialog.value.target = {
      lat: Number(newTarget.lat),
      lng: Number(newTarget.lng)
    };
    gotoDialog.value.visible = true;
    // 清除候选，防止重复触发
    store.setGotoTargetCandidate(null);
  }
}, {deep: true});

// --- 辅助计算 ---
const GPS_FIX_DISPLAY = Object.freeze({
  NO_GPS: {label: '未定位', level: 'bad', hasFix: false},
  NO_FIX: {label: '未定位', level: 'bad', hasFix: false},
  FIX_2D: {label: '二维定位', level: 'warning', hasFix: true},
  FIX_3D: {label: '三维定位', level: 'good', hasFix: true},
  FIX_DGPS: {label: '差分定位', level: 'good', hasFix: true},
  RTK_FLOAT: {label: 'RTK 浮点', level: 'good', hasFix: true},
  RTK_FIXED: {label: 'RTK 固定', level: 'good', hasFix: true},
  UNKNOWN: {label: '未知定位', level: 'bad', hasFix: false}
});

const normalizeGpsFixKey = (value) => {
  const normalized = String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return normalized.split('.').pop() || 'UNKNOWN';
};

const gpsFixStatus = computed(() => {
  const key = normalizeGpsFixKey(vehicle.value.gps.fix);
  return GPS_FIX_DISPLAY[key] || GPS_FIX_DISPLAY.UNKNOWN;
});

const satelliteCount = computed(() => {
  const count = Number(vehicle.value.gps.sats);
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
});

const POSITION_SOURCE_DISPLAY = Object.freeze({
  ekf: {label: 'EKF 全局位置', className: 'source-ekf'},
  raw_gps: {label: '原始 GPS · EKF无效', className: 'source-raw'},
  none: {label: '未定位', className: 'source-none'}
});

const positionSourceStatus = computed(() => {
  const source = vehicle.value.displayPosition.source;
  return POSITION_SOURCE_DISPLAY[source] || POSITION_SOURCE_DISPLAY.none;
});

const positionSourceClass = computed(() => positionSourceStatus.value.className);

const hasValidPosition = computed(() => {
  const lat = Number(vehicle.value.displayPosition.lat);
  const lng = Number(vehicle.value.displayPosition.lng);
  return vehicle.value.connected
      && vehicle.value.displayPosition.valid === true
      && ['ekf', 'raw_gps'].includes(vehicle.value.displayPosition.source)
      && Number.isFinite(lat)
      && Number.isFinite(lng)
      && Math.abs(lat) <= 90
      && Math.abs(lng) <= 180;
});

const formatCoordinate = (value) => {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? Math.abs(coordinate).toFixed(6) : '--';
};

const formattedLatitude = computed(() => formatCoordinate(vehicle.value.displayPosition.lat));
const formattedLongitude = computed(() => formatCoordinate(vehicle.value.displayPosition.lng));
const latitudeSuffix = computed(() => Number(vehicle.value.displayPosition.lat) < 0 ? '° S' : '° N');
const longitudeSuffix = computed(() => Number(vehicle.value.displayPosition.lng) < 0 ? '° W' : '° E');

const toFiniteNumber = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

const formatOneDecimal = (value) => {
  const roundedValue = Math.round(toFiniteNumber(value) * 10) / 10;
  return (Object.is(roundedValue, -0) ? 0 : roundedValue).toFixed(1);
};

const formatHeading = (value) => {
  const normalizedValue = ((toFiniteNumber(value) % 360) + 360) % 360;
  const roundedValue = Math.round(normalizedValue * 10) / 10;
  return (roundedValue >= 360 ? 0 : roundedValue).toFixed(1);
};

const isTiltWarning = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && Math.abs(numericValue) > 10;
};

const PROPULSION_STATUS_LABELS = Object.freeze({
  waiting: '等待信号',
  not_received: '等待数据',
  ambiguous_direction: '方向异常',
  stuck_high: '信号异常',
  gpio_unavailable: 'GPIO异常',
  collector_stale: '采集超时',
  frontend_timeout: '数据超时',
  backend_disconnected: '后端断开',
  invalid: '数据异常'
});

const PROPULSION_INFERENCE_THRESHOLD = 0.2;
const PROPULSION_MOTION_STATES = Object.freeze({
  unknown: Object.freeze({key: 'unknown', symbol: '?', label: '状态未知'}),
  stationary: Object.freeze({key: 'stationary', symbol: '●', label: '静止'}),
  forward: Object.freeze({key: 'forward', symbol: '↑', label: '前进'}),
  reverse: Object.freeze({key: 'reverse', symbol: '↓', label: '后退'}),
  left: Object.freeze({key: 'left', symbol: '↶', label: '左转'}),
  right: Object.freeze({key: 'right', symbol: '↷', label: '右转'}),
  conflict: Object.freeze({key: 'conflict', symbol: '⚠', label: '矛盾'})
});

const propulsionMotionState = computed(() => {
  const feedback = vehicle.value.propulsionFeedback;
  const isValid = (channel) => channel?.valid && Number.isFinite(Number(channel.ratio));

  if (!vehicle.value.connected) return PROPULSION_MOTION_STATES.unknown;
  if (!vehicle.value.armed) {
    return PROPULSION_MOTION_STATES.stationary;
  }

  const leftRearValid = isValid(feedback.leftRear);
  const rightRearValid = isValid(feedback.rightRear);
  const rearPairValid = leftRearValid && rightRearValid;
  const lateralValid = isValid(feedback.lateral);
  const manualInputNeutral = controlStatus.value.state === 'manual'
      && Math.abs(controlState.value.throttle) <= PROPULSION_INFERENCE_THRESHOLD
      && Math.abs(controlState.value.steering) <= PROPULSION_INFERENCE_THRESHOLD;

  const leftRear = leftRearValid ? Number(feedback.leftRear.ratio) : 0;
  const rightRear = rightRearValid ? Number(feedback.rightRear.ratio) : 0;
  const lateral = lateralValid ? Number(feedback.lateral.ratio) : 0;
  const forwardComponent = rearPairValid ? (leftRear + rightRear) / 2 : 0;
  // With both rear channels available, use their differential component.
  // With only one active rear channel, its signed thrust alone identifies yaw:
  // left positive/right negative -> right turn, and vice versa.
  const mainYawComponent = rearPairValid
      ? (leftRear - rightRear) / 2
      : leftRear - rightRear;
  const mainYawActive = Math.abs(mainYawComponent) > PROPULSION_INFERENCE_THRESHOLD;
  const lateralYawActive = lateralValid
      && Math.abs(lateral) > PROPULSION_INFERENCE_THRESHOLD;

  if (mainYawActive && lateralYawActive && Math.sign(mainYawComponent) !== Math.sign(lateral)) {
    return PROPULSION_MOTION_STATES.conflict;
  }

  if (mainYawActive || lateralYawActive) {
    const yawDirection = mainYawActive ? mainYawComponent : lateral;
    return yawDirection > 0
        ? PROPULSION_MOTION_STATES.right
        : PROPULSION_MOTION_STATES.left;
  }

  if (rearPairValid) {
    if (forwardComponent > PROPULSION_INFERENCE_THRESHOLD) return PROPULSION_MOTION_STATES.forward;
    if (forwardComponent < -PROPULSION_INFERENCE_THRESHOLD) return PROPULSION_MOTION_STATES.reverse;
    return PROPULSION_MOTION_STATES.stationary;
  }

  // A stopped feedback line may contain no measurable cycle. In manual mode,
  // zero user input is therefore the safe stationary fallback when no channel
  // provides enough evidence for another state.
  return manualInputNeutral
      ? PROPULSION_MOTION_STATES.stationary
      : PROPULSION_MOTION_STATES.unknown;
});

const propulsionFeedbackForcedStopped = computed(() => (
    vehicle.value.connected
    && !vehicle.value.armed
));

const formatPropulsionPercent = (channel) => {
  if (propulsionFeedbackForcedStopped.value) return '0%';
  if (!channel?.valid || !Number.isFinite(Number(channel.ratio))) return '--';
  const percent = Math.round(Math.max(-1, Math.min(1, Number(channel.ratio))) * 100);
  if (percent === 0) return '0%';
  return `${percent > 0 ? '+' : ''}${percent}%`;
};

const propulsionDirectionClass = (channel) => {
  if (propulsionFeedbackForcedStopped.value) return 'feedback-neutral';
  if (!channel?.valid || !Number.isFinite(Number(channel.ratio))) return 'feedback-invalid';
  const ratio = Number(channel.ratio);
  if (ratio > 0) return 'feedback-positive';
  if (ratio < 0) return 'feedback-negative';
  return 'feedback-neutral';
};

const propulsionFillStyle = (channel, orientation) => {
  if (propulsionFeedbackForcedStopped.value) {
    return orientation === 'vertical'
        ? {height: '0%', top: '50%'}
        : {width: '0%', left: '50%'};
  }
  if (!channel?.valid || !Number.isFinite(Number(channel.ratio))) return {};
  const ratio = Math.max(-1, Math.min(1, Number(channel.ratio)));
  const extent = `${Math.abs(ratio) * 50}%`;
  if (orientation === 'vertical') {
    return ratio >= 0
        ? {height: extent, top: '50%'}
        : {height: extent, bottom: '50%'};
  }
  return ratio >= 0
      ? {width: extent, left: '50%'}
      : {width: extent, right: '50%'};
};

const propulsionFeedbackTitle = (name, channel) => {
  if (propulsionFeedbackForcedStopped.value) return `${name}：0%（暂停模式）`;
  if (channel?.valid) return `${name}：${formatPropulsionPercent(channel)}`;
  const status = PROPULSION_STATUS_LABELS[channel?.status] || '反馈无效';
  return `${name}：${status}`;
};

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
      store.pushNotification(NOTIFICATION_TITLES.mission, '没有可执行的任务航点', 'warning');
      return;
    }
    let defaultStart = (mission.value.progress.current >= 0) ? mission.value.progress.current + 1 : 1;
    missionStartDialog.value.startIndex = defaultStart;
    missionStartDialog.value.visible = true;
  } else {
    executeChangeMode(mode, payload_extra, {
      pendingNotification: {
        title: NOTIFICATION_TITLES.groundControl,
        message: '正在请求切换飞控模式…'
      }
    });
  }
};

const handleReturnHome = async () => {
  if (!isWsConnected.value) {
    store.pushNotification(NOTIFICATION_TITLES.returnHome, '机载服务通信已断开，无法执行返航', 'error');
    return;
  }
  if (!vehicle.value.connected) {
    store.pushNotification(NOTIFICATION_TITLES.returnHome, '飞控未连接，无法执行返航', 'error');
    return;
  }

  try {
    await ElMessageBox.confirm(
        '确认由后端自动解锁并前往返航点吗？',
        '前往返航点确认',
        {
          confirmButtonText: '确认返航',
          cancelButtonText: '取消',
          type: 'warning',
          customClass: 'hud-message-box'
        }
    );
  } catch (_) {
    return;
  }

  // 立即停止界面摇杆输出；后端在同一返航事务中退出手操、解锁并进入 RTL。
  stopManualControlLoop();
  controlState.value = {throttle: 0.0, steering: 0.0};
  store.sendPacket('CMD_RETURN_HOME', {}, {
    pendingNotification: {
      title: NOTIFICATION_TITLES.returnHome,
      message: '正在校验返航点并请求自动解锁和返航…'
    }
  });
};

const handleGroundControlToggle = () => {
  if (controlStatus.value.transitioning) return;

  if (controlStatus.value.state === 'manual') {
    stopManualControlLoop();
    controlState.value = {throttle: 0.0, steering: 0.0};
    if (!store.requestLocked()) return;
    store.pushNotification(
        NOTIFICATION_TITLES.groundControl,
        '正在归零并请求飞控上锁…',
        'info',
        {key: 'ground-control:state', incrementCount: false}
    );
    return;
  }

  if (!store.requestManual()) return;
  store.pushNotification(
      NOTIFICATION_TITLES.groundControl,
      '正在请求进入手动模式并解锁…',
      'info',
      {key: 'ground-control:state', incrementCount: false}
  );
};

const handlePause = () => {
  if (!store.requestLocked()) return;
  store.setRelay(0);
  store.pushNotification(
      NOTIFICATION_TITLES.groundControl,
      '正在归零、上锁并关闭混合器…',
      'warning',
      {key: 'ground-control:state', incrementCount: false}
  );
};

const handleSystemStop = () => {
  store.setRelay(0);
  if (!store.requestLocked()) return;
  store.pushNotification(
      NOTIFICATION_TITLES.system,
      '正在关闭混合器并请求飞控安全上锁…',
      'warning',
      {key: 'ground-control:state', incrementCount: false}
  );
};

const confirmMissionStart = () => {
  const targetIndex = missionStartDialog.value.startIndex - 1;
  const requestId = executeChangeMode('MISSION', {mission_item_index: targetIndex}, {
    pendingNotification: {
      title: NOTIFICATION_TITLES.mission,
      message: `正在从第 ${missionStartDialog.value.startIndex} 个航点启动任务…`
    },
    successNotification: {
      title: NOTIFICATION_TITLES.mission,
      message: `飞控已确认从第 ${missionStartDialog.value.startIndex} 个航点启动任务`
    },
    failureTitle: NOTIFICATION_TITLES.mission
  });
  if (!requestId) return;
  missionStartDialog.value.visible = false;
  if (!vehicle.value.armed) {
    sendArmCommand('ARM', false, {silentSuccess: true});
  }

  // 记录启动信息
  lastMissionStartTime.value = Date.now();
  lastTargetIndex.value = targetIndex;
};

const executeChangeMode = (mode, payload_extra = {}, notificationOptions = {}) => {
  let payload = {mode: mode, ...payload_extra};
  const requestId = store.sendPacket('CMD_SET_MODE', payload, notificationOptions);
  if (!requestId) return null;
  if (mode === 'MISSION') {
    if (missionHoldTimer) {
      clearTimeout(missionHoldTimer);
      missionHoldTimer = null;
    }
    const startIndex = Number(payload.mission_item_index);
    if (Number.isInteger(startIndex) && startIndex >= 0) {
      mission.value.progress.current = startIndex;
    }
    missionState.value = 'EXECUTING';
    setTimeout(() => store.setRelay(1), 2000);
  }
  return requestId;
}

const clearMissionHoldTimer = () => {
  if (!missionHoldTimer) return;
  clearTimeout(missionHoldTimer);
  missionHoldTimer = null;
};

const markMissionCompleted = () => {
  if (missionState.value !== 'EXECUTING') return;
  clearMissionHoldTimer();
  missionState.value = 'COMPLETED';
  store.pushNotification(
      NOTIFICATION_TITLES.mission,
      '已完成最后一个航点，飞控已进入保持模式（HOLD）',
      'success'
  );
};

// HOLD 可能是任务正常完成，也可能是启动阶段异常退出；等待进度消息收敛后再判断。
watch(() => vehicle.value.mode, (newMode) => {
  clearMissionHoldTimer();
  if (newMode !== 'HOLD' || missionState.value !== 'EXECUTING') return;

  const elapsedAtHold = Date.now() - lastMissionStartTime.value;
  missionHoldTimer = setTimeout(() => {
    missionHoldTimer = null;
    const disposition = missionHoldDisposition({
      flightMode: vehicle.value.mode,
      missionState: missionState.value,
      current: mission.value.progress.current,
      total: mission.value.progress.total,
      elapsedSinceStartMs: elapsedAtHold
    });

    if (disposition === MISSION_HOLD_DISPOSITION.COMPLETE) {
      markMissionCompleted();
      return;
    }
    if (disposition !== MISSION_HOLD_DISPOSITION.RECOVER) return;

    store.pushNotification(NOTIFICATION_TITLES.mission, '检测到任务意外中断，正在尝试恢复…', 'warning');
    const targetIndex = lastTargetIndex.value;
    store.sendPacket('CMD_MISSION_CONTROL', {action: 'SET_INDEX', index: targetIndex}, {silentSuccess: true});

    setTimeout(() => {
      if (!vehicle.value.armed) {
        sendArmCommand('ARM', false, {silentSuccess: true});
      }
      store.sendPacket('CMD_MISSION_CONTROL', {action: 'RESUME'}, {silentSuccess: true});
    }, 500);
  }, MISSION_HOLD_SETTLE_MS);
});

// 如果任务进度比模式更新更晚到达，仍能把预期 HOLD 识别为正常完成。
watch(() => [mission.value.progress.current, mission.value.progress.total], ([current, total]) => {
  const disposition = missionHoldDisposition({
    flightMode: vehicle.value.mode,
    missionState: missionState.value,
    current,
    total,
    elapsedSinceStartMs: Date.now() - lastMissionStartTime.value
  });
  if (disposition === MISSION_HOLD_DISPOSITION.COMPLETE) {
    markMissionCompleted();
  }
});

// PX4 实际进入任务模式时后台读取一次 NAV_ACC_RAD。该查询不改变信息查询面板。
watch(() => vehicle.value.mode, (newMode, oldMode) => {
  if (newMode === 'MISSION' && oldMode !== 'MISSION') {
    store.requestWaypointAcceptanceRadius({notifyOnError: true});
  }
});

const jumpToWaypoint = () => {
  if (manualWaypointIndex.value > 0 && manualWaypointIndex.value <= totalWaypoints.value) {
    ElMessageBox.confirm(`确定要跳转到航点 ${manualWaypointIndex.value} 吗？`, '航点跳转', {
      type: 'warning'
    }).then(() => {
      const targetIndex = manualWaypointIndex.value - 1;
      executeChangeMode('MISSION', {mission_item_index: targetIndex}, {
        pendingNotification: {
          title: NOTIFICATION_TITLES.mission,
          message: `正在请求跳转到第 ${manualWaypointIndex.value} 个航点…`
        },
        successNotification: {
          title: NOTIFICATION_TITLES.mission,
          message: `飞控已确认跳转到第 ${manualWaypointIndex.value} 个航点`
        },
        failureTitle: NOTIFICATION_TITLES.mission
      });
    });
  }
};

const handleCenterMap = () => {
  store.mapTriggers.centerMap = true;
  ElMessage.success('已将视角定位至无人艇');
};

const handleSaveMap = () => {
  store.triggerMapSave();
};

const handleThresholdChange = (val) => {
  store.sendPacket('CMD_SET_BATTERY_THRESHOLD', {threshold: val}, {
    pendingNotification: {
      title: NOTIFICATION_TITLES.parameter,
      message: `正在设置低电量阈值为 ${val}%…`
    }
  });
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

    store.sendPacket(
        'CMD_MISSION_CONTROL',
        {action: 'SET_INDEX', index: targetIndex},
        {silentSuccess: true}
    );
    // 稍作延迟发送继续指令，确保索引设置生效
    setTimeout(() => {
      store.sendPacket('CMD_MISSION_CONTROL', {action: 'RESUME'}, {
        pendingNotification: {
          title: NOTIFICATION_TITLES.mission,
          message: `正在从第 ${targetIndex + 1} 个航点恢复任务…`
        }
      });
      missionState.value = 'EXECUTING';
      sendArmCommand('ARM', false, {silentSuccess: true});
    }, 200);
    setTimeout(() => {
      store.setRelay(1);
    }, 200);

    return;
  } else if (action === 'PAUSE') {
    missionState.value = 'PAUSED';
    sendArmCommand("DISARM", false, {
      pendingNotification: {
        title: NOTIFICATION_TITLES.mission,
        message: '正在暂停任务并上锁飞控…',
        type: 'warning'
      },
      successNotification: {
        title: NOTIFICATION_TITLES.mission,
        message: '任务已暂停，飞控已确认上锁'
      },
      failureTitle: NOTIFICATION_TITLES.mission
    });
    store.setRelay(0);

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
    sendArmCommand("DISARM", false, {
      pendingNotification: {
        title: NOTIFICATION_TITLES.mission,
        message: '正在终止任务并上锁飞控…',
        type: 'warning'
      },
      successNotification: {
        title: NOTIFICATION_TITLES.mission,
        message: '任务已终止，飞控已确认上锁'
      },
      failureTitle: NOTIFICATION_TITLES.mission
    });
    store.sendPacket('CMD_MISSION_CONTROL', {action: 'RESET'}, {silentSuccess: true});
    executeChangeMode('HOLD', {}, {silentSuccess: true});
    store.setRelay(0);
  });
};

const sendArmCommand = (action, force, notificationOptions = {}) => {
  const isArming = (action === 'ARM');
  // 如果当前状态已经是请求的状态，且不是强制操作，则不执行
  if (!force && vehicle.value.armed === isArming) return;

  const cmd = isArming ? 'CMD_ARM' : 'CMD_DISARM';
  if (force) {
    ElMessageBox.confirm('确定要强制操作吗？极其危险！', '危险操作', {type: 'error'}).then(() => {
      store.sendPacket(cmd, {force: true}, {
        pendingNotification: {
          title: NOTIFICATION_TITLES.safety,
          message: `正在请求强制${isArming ? '解锁' : '上锁'}…`,
          type: 'warning'
        },
        failureTitle: NOTIFICATION_TITLES.safety,
        ...notificationOptions
      });
    });
  } else {
    const defaultNotification = notificationOptions.silentSuccess
        ? {}
        : {
          pendingNotification: {
            title: NOTIFICATION_TITLES.groundControl,
            message: `正在请求飞控${isArming ? '解锁' : '上锁'}…`
          }
        };
    store.sendPacket(cmd, {force: false}, {
      ...defaultNotification,
      ...notificationOptions
    });
  }
};

const confirmGoto = () => {
  const rawLat = gotoDialog.value.target.lat;
  const rawLon = gotoDialog.value.target.lng;
  const lat = Number(rawLat);
  const lon = Number(rawLon);
  if (String(rawLat).trim() === '' || String(rawLon).trim() === ''
      || !Number.isFinite(lat) || lat < -90 || lat > 90
      || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    store.pushNotification(NOTIFICATION_TITLES.returnHome, '请输入有效的经纬度', 'warning');
    return;
  }

  store.sendPacket('CMD_SET_HOME', {lat, lon, alt: 0}, {
    pendingNotification: {
      title: NOTIFICATION_TITLES.returnHome,
      message: '正在更新返航点…'
    }
  });
  gotoDialog.value.visible = false;
};

// --- 摇杆逻辑 ---
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
  resetNtripConnectionTest();
  if (import.meta.hot) import.meta.hot.off('ntrip:test-status', handleNtripTestStatus);
  stopManualControlLoop();
  clearMissionHoldTimer();
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

.ntrip-connection-box {
  margin-top: 2px;
}

.ntrip-status-reason {
  margin-top: 6px;
  font-size: 10px;
  line-height: 1.35;
  word-break: break-word;
}

.ntrip-status-reason.success {
  color: #67c23a;
}

.ntrip-status-reason.error {
  color: #f56c6c;
}

.info-query-box {
  background: rgba(255, 255, 255, 0.04);
  padding: 10px;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-query-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.info-query-select {
  flex: 1;
  min-width: 0;
}

.info-query-button {
  width: 66px;
  flex: 0 0 66px;
}

.info-query-result {
  min-height: 48px;
  box-sizing: border-box;
  padding: 9px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
  color: #aaa;
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.info-query-result.is-pending {
  color: #409EFF;
  border-color: rgba(64, 158, 255, 0.35);
}

.info-query-result.is-success {
  color: #67c23a;
  border-color: rgba(103, 194, 58, 0.35);
}

.info-query-result.is-error {
  color: #f56c6c;
  border-color: rgba(245, 108, 108, 0.35);
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
  flex-direction: column;
  gap: 0;
  line-height: 1.3;
}

.mode-btn-flat.full-row {
  grid-column: 1 / -1;
}

.log-time {
  color: #555;
  white-space: nowrap;
  width: 100%;
  text-align: center;
}

.log-text {
  width: 100%;
  text-align: left;
}

.log-error {
  color: #f56c6c;
}

.log-warn {
  color: #e6a23c;
}

/* 系统通知颜色 */
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
  height: 98px;
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

.location-item {
  width: 292px;
  min-width: 292px;
  gap: 5px;
}

.location-content {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: center;
  column-gap: 16px;
}

.gps-summary {
  min-width: 0;
  padding-right: 14px;
  border-right: 1px solid rgba(255, 255, 255, 0.12);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 7px;
}

.gps-count {
  display: inline-flex;
  align-items: baseline;
}

.gps-fix-badge {
  padding: 2px 6px;
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  line-height: 1.2;
  white-space: nowrap;
}

.gps-fix-badge.fix-good {
  color: #67c23a;
  background: rgba(103, 194, 58, 0.12);
}

.gps-fix-badge.fix-warning {
  color: #e6a23c;
  background: rgba(230, 162, 60, 0.12);
}

.gps-fix-badge.fix-bad {
  color: #f56c6c;
  background: rgba(245, 108, 108, 0.12);
}

.coordinate-list {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.position-source-badge {
  align-self: flex-start;
  padding: 1px 5px;
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
  line-height: 1.2;
  white-space: nowrap;
}

.position-source-badge.source-ekf {
  color: #67c23a;
  background: rgba(103, 194, 58, 0.12);
}

.position-source-badge.source-raw {
  color: #f56c6c;
  background: rgba(245, 108, 108, 0.12);
}

.position-source-badge.source-none {
  color: #909399;
  background: rgba(144, 147, 153, 0.12);
}

.coordinate-row {
  display: grid;
  grid-template-columns: 28px minmax(98px, auto) auto;
  align-items: baseline;
  justify-content: start;
  column-gap: 4px;
  line-height: 1;
  white-space: nowrap;
}

.coordinate-label {
  color: #888;
  font-size: 11px;
  font-weight: 700;
}

.coordinate-value {
  font-family: 'Roboto Mono', monospace;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.4px;
}

.coordinate-value.source-ekf {
  color: #67c23a;
}

.coordinate-value.source-raw {
  color: #f56c6c;
}

.coordinate-suffix {
  margin-left: 0 !important;
  color: #aaa;
  font-size: 11px !important;
  opacity: 0.6;
}

.coordinate-placeholder {
  grid-column: 2 / 4;
  color: rgba(255, 255, 255, 0.35);
  font-family: 'Roboto Mono', monospace;
  font-size: 18px;
  font-weight: 700;
}

.motion-item {
  width: 170px;
  min-width: 170px;
}

.motion-val-group {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.motion-primary-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  white-space: nowrap;
}

.motion-item .value {
  font-size: 22px;
}

.motion-item .value small {
  margin-left: 3px;
}

.speed-readout,
.heading-readout {
  display: inline-flex;
  align-items: center;
}

.motion-metric-label {
  margin-left: 0 !important;
  margin-right: 3px;
  color: #ffffff;
}

.tilt-row {
  display: flex;
  align-items: center;
  gap: 7px;
  line-height: 1;
  white-space: nowrap;
}

.tilt-value {
  transition: color 0.2s ease, text-shadow 0.2s ease;
}

.tilt-separator {
  color: rgba(255, 255, 255, 0.28);
  font-size: 12px;
}

.tilt-warning {
  color: #f56c6c !important;
  text-shadow: 0 0 8px rgba(245, 108, 108, 0.45) !important;
}

.propulsion-feedback-item {
  width: 220px;
  min-width: 220px;
}

.propulsion-feedback-layout {
  height: 58px;
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) 10px;
  align-items: stretch;
  gap: 9px;
}

.propulsion-feedback-center {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
}

.propulsion-rear-values,
.propulsion-lateral-value {
  color: #888;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  text-align: center;
  white-space: nowrap;
}

.propulsion-rear-values {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}

.propulsion-rear-values strong,
.propulsion-lateral-value strong {
  margin-left: 2px;
  font-family: 'Roboto Mono', monospace;
  font-size: 11px;
  transition: color 0.2s ease;
}

.propulsion-value-divider {
  color: rgba(255, 255, 255, 0.22);
}

.propulsion-motion-state {
  min-width: 12px;
  color: #67c23a;
  font-size: 13px;
  line-height: 10px;
  text-align: center;
  transition: color 0.2s ease, text-shadow 0.2s ease;
}

.propulsion-motion-state.is-stationary {
  color: #d7dbe0;
  font-size: 9px;
}

.propulsion-motion-state.is-conflict {
  color: #f56c6c;
  text-shadow: 0 0 7px rgba(245, 108, 108, 0.45);
}

.propulsion-motion-state.is-unknown {
  color: #777;
}

.propulsion-track {
  position: relative;
  overflow: hidden;
  box-sizing: border-box;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.07);
}

.propulsion-track-vertical {
  width: 10px;
  height: 58px;
}

.propulsion-track-horizontal {
  width: 100%;
  height: 10px;
}

.propulsion-zero-line {
  position: absolute;
  z-index: 2;
  background: rgba(255, 255, 255, 0.55);
}

.propulsion-track-vertical .propulsion-zero-line {
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
}

.propulsion-track-horizontal .propulsion-zero-line {
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
}

.propulsion-fill {
  position: absolute;
  z-index: 1;
  transition: width 0.35s ease, height 0.35s ease;
}

.propulsion-track-vertical .propulsion-fill {
  left: 0;
  right: 0;
}

.propulsion-track-horizontal .propulsion-fill {
  top: 0;
  bottom: 0;
}

.feedback-positive {
  color: #67c23a !important;
}

.feedback-negative {
  color: #f56c6c !important;
}

.propulsion-fill.feedback-positive {
  background-color: #67c23a;
}

.propulsion-fill.feedback-negative {
  background-color: #f56c6c;
}

.feedback-neutral {
  color: #d7dbe0 !important;
}

.feedback-invalid {
  color: #777 !important;
}

.propulsion-track.is-invalid {
  border-style: dashed;
  background: repeating-linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.03) 0,
      rgba(255, 255, 255, 0.03) 3px,
      rgba(255, 255, 255, 0.09) 3px,
      rgba(255, 255, 255, 0.09) 6px
  );
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

.hud-btn-confirm.el-button--success {
  background: #67c23a;
}

.hud-btn-cancel {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid #444;
  color: #999;
}

.goto-config-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.goto-form-row {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}

.goto-form-row label {
  color: #aaa;
  font-size: 13px;
  text-align: right;
}

.ntrip-config-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ntrip-form-row {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}

.ntrip-form-row label {
  color: #aaa;
  font-size: 13px;
  text-align: right;
}

.ntrip-storage-warning {
  padding-left: 74px;
  color: #e6a23c;
  font-size: 11px;
  line-height: 1.4;
}

.ntrip-test-result {
  min-height: 16px;
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.35;
  text-align: right;
}

.ntrip-test-result.is-testing {
  color: #409eff;
}

.ntrip-test-result.is-success {
  color: #67c23a;
}

.ntrip-test-result.is-error {
  color: #f56c6c;
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

import {defineStore} from 'pinia'
import {reactive, ref} from 'vue'
import {ElMessage, ElMessageBox} from 'element-plus'
import {NtripClient} from '../services/ntripClient'
import {
    normalizeWaypointAcceptanceRadius,
    parseWaypointAcceptanceRadiusResponse,
    waypointRadiusMatches,
    waypointRadiusQueryDisposition
} from '../services/waypointAcceptanceRadius'
import {
    normalizeGeofencePoints,
    parseDownloadedGeofence,
    serializeGeofence
} from '../services/geofence'
import {
    formatCommandAck,
    localizeBackendError,
    NOTIFICATION_TITLES,
    summarizeMissionSync
} from '../services/systemNotifications'
import {isBatteryAlertState} from '../services/batterySafety'

const MAVLINK_COORDINATE_SCALE = 10000000;
const POSITION_SOURCES = new Set(['ekf', 'raw_gps']);

function normalizePosition(position) {
    if (!position || position.valid !== true || !POSITION_SOURCES.has(position.source)) return null;
    if (position.lat == null || position.lon == null) return null;

    let lat = Number(position.lat);
    let lng = Number(position.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    // The current backend sends degrees. Legacy MAVLink payloads use degrees * 1e7.
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        lat /= MAVLINK_COORDINATE_SCALE;
        lng /= MAVLINK_COORDINATE_SCALE;
    }

    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

    return {
        lat,
        lng,
        source: position.source,
        reason: position.reason ?? null,
        ekfGlobalValid: position.ekf_global_valid === true,
    };
}

export const useGcsStore = defineStore('gcs', () => {
    // --- 1. 车辆状态 ---
    const vehicle = reactive({
        connected: false,
        armed: false,
        armedKnown: false,
        mode: 'UNKNOWN',
        // 修改：适配新的电池数据结构
        battery: {
            voltage_v: 0,
            remaining_percent: null,
            current_a: 0.0,
            temperature: 0.0,
            alarms: [],
            low_battery_threshold: 20,
            data_valid: false,
            data_state: 'STARTING',
            fault_code: null,
            last_valid_sample_age_s: null,
            safety_state: 'STARTING',
            alarm_id: 0,
            return_status: 'IDLE',
            return_message: null,
            safety_return_lock: false
        },
        gps: {sats: 0, fix: 'No Fix'},
        health: {is_global_position_ok: false, is_home_position_ok: false, is_armable: false},
        attitude: {roll: 0, pitch: 0, yaw: 0},
        position: {lat: 45.7700000, lng: 126.6700000, valid: false}, // 默认地图位置，不代表实时定位
        displayPosition: {
            lat: null,
            lng: null,
            valid: false,
            source: 'none',
            reason: 'NOT_CONNECTED',
            ekfGlobalValid: false,
        },
        home: null, // 新增：HOME点坐标
        velocity: {speed: 0},
        propulsionFeedback: {
            leftRear: {ratio: null, valid: false, status: 'not_received'},
            rightRear: {ratio: null, valid: false, status: 'not_received'},
            lateral: {ratio: null, valid: false, status: 'not_received'},
            lastReceivedAt: 0,
            stale: true
        },
        trajectory: [], //  <--- 轨迹
        relay_on: false, // <--- 继电器状态
    })

    // --- 2. 任务数据 ---
    const mission = reactive({
        plannedWaypoints: [],
        uploadedWaypoints: [],
        defaults: {speed: 2.0, loiter: 0},
        progress: {
            current: 0,
            total: 0
        },
        clearOperation: {
            phase: 'IDLE',
            pendingRequestId: null,
            error: null
        }
    })

    const geofence = reactive({
        points: [],
        source: 'LOCAL',
        upload: {phase: 'IDLE', pendingRequestId: null, error: null},
        download: {phase: 'IDLE', pendingRequestId: null, error: null},
        clear: {phase: 'IDLE', pendingRequestId: null, error: null}
    })
    
    // --- 3. 规划器状态 ---
    const plannerMode = ref('manual'); // 'manual' | 'area' | 'geofence'
    const areaPoints = ref([]); // 区域规划的四个角点

    // --- 4. 交互触发器 ---
    const mapTriggers = reactive({
        saveCurrentMap: false,
        clearMap: false,
        redrawMission: false,
        centerMap: false,
        gotoTargetCandidate: null, // 新增：指点目标候选
    })

    const sysLogs = reactive([]);
    const notificationLogs = ref([]); // 全局系统通知
    const controlStatus = reactive({
        state: 'locked',
        transitioning: false,
        armed: false,
        px4_mode: 'UNKNOWN',
        reason: null
    });
    const leakAlert = reactive({
        detected: false,
        sensorFault: false,
        faultCode: null,
        phase: 'NORMAL',
        lastAlertReceivedAt: 0,
        lastBackendMessageAt: 0,
        channelConnectedAt: 0,
        lingerDeadline: 0,
        lingerRemainingSeconds: 0,
        communicationLost: false,
        rtlRequestId: null,
        rtlStatus: 'IDLE',
        rtlMessage: null
    });
    const batteryThresholdConfig = reactive({
        phase: 'IDLE',
        pendingRequestId: null,
        expectedValue: null,
        error: null
    });
    const batteryAlert = reactive({
        alarmId: 0,
        soundSilenced: false,
        communicationLost: false,
        returnRequestId: null,
        returnStatus: 'IDLE',
        returnMessage: null
    });
    const infoQuery = reactive({
        selectedId: 'PX4_POWER_VOLTAGE',
        phase: 'IDLE',
        pendingRequestId: null,
        pendingQueryId: null,
        result: null,
        displayText: '请选择查询项目后点击查询'
    });
    const waypointAcceptanceRadius = reactive({
        valueM: null,
        queried: false,
        queryPhase: 'IDLE',
        setPhase: 'IDLE',
        error: null,
        lastUpdatedAt: 0,
        pendingQueryRequestId: null,
        pendingSetRequestId: null,
        expectedValueM: null,
        notifyOnQueryError: false,
        refreshQueued: false
    });
    const defaultNtripConfig = {
        host: 'rtk.ntrip.qxwz.com',
        port: 8002,
        mountpoint: 'AUTO',
        username: '',
        password: ''
    };
    let savedNtripConfig = {};
    try {
        savedNtripConfig = JSON.parse(localStorage.getItem('ntripConfig') || '{}');
    } catch {
        savedNtripConfig = {};
    }
    const ntripConfig = reactive({...defaultNtripConfig, ...savedNtripConfig});
    const ntripStatus = reactive({
        code: 'not_configured',
        reason: '未登录：请配置账号',
        healthy: false,
        forwardPaused: false,
        transport: '',
        detail: '',
        lastValidAt: 0,
        validFrames: 0,
        invalidFrames: 0,
        receivedBytes: 0,
        forwardedFrames: 0,
        droppedFrames: 0
    });
    let ntripClient = null;

    const LEAK_ALERT_STALE_MS = 1000;
    const BACKEND_CHANNEL_STALE_MS = 1500;
    const LEAK_ALERT_LINGER_MS = 10000;
    const INFO_QUERY_TIMEOUT_MS = 6000;
    const BATTERY_CONFIG_TIMEOUT_MS = 5000;
    const BATTERY_RETURN_TIMEOUT_MS = 10000;
    const MISSION_CLEAR_TIMEOUT_MS = 10000;
    const GEOFENCE_OPERATION_TIMEOUT_MS = 15000;
    const PROPULSION_FEEDBACK_STALE_MS = 2000;
    const NOTIFICATION_DEDUPE_MS = 3000;
    const INFO_QUERY_ERROR_TEXT = {
        INVALID_REQUEST: '查询失败：请求格式错误',
        UNSUPPORTED_QUERY: '查询失败：不支持该查询项目',
        PX4_NOT_CONNECTED: '查询失败：飞控未连接',
        QUERY_BUSY: '查询失败：已有查询正在进行',
        QUERY_TIMEOUT: '查询超时，请重试',
        MAVLINK_ERROR: '查询失败：飞控通信异常',
        PARSE_ERROR: '查询失败：无法解析飞控返回信息',
        BACKEND_DISCONNECTED: '查询失败：机载服务连接已断开',
        FRONTEND_TIMEOUT: '查询超时，请重试',
        INVALID_RESULT: '查询失败：返回数据格式错误'
    };
    const INFO_QUERY_FORMATTERS = {
        PX4_POWER_VOLTAGE(data) {
            const voltage = Number(data?.voltage_v);
            if (!Number.isFinite(voltage)) throw new Error('INVALID_RESULT');
            return `飞控供电电压：${voltage.toFixed(2)}V`;
        },
        WAYPOINT_ACCEPTANCE_RADIUS(data) {
            const radius = parseWaypointAcceptanceRadiusResponse(data);
            if (radius === null) throw new Error('INVALID_RESULT');
            return `航点接受半径：${radius.toFixed(1)}m`;
        }
    };
    let leakWatchdogTimer = null;
    let leakRtlTimeout = null;
    let batteryConfigTimeout = null;
    let batteryReturnTimeout = null;
    let infoQueryTimeout = null;
    let waypointRadiusQueryTimeout = null;
    let waypointRadiusSetTimeout = null;
    let missionClearTimeout = null;
    let geofenceOperationTimeout = null;
    let propulsionFeedbackWatchdogTimer = null;
    let requestSequence = 0;

    const monotonicNow = () => performance.now();

    function resetPropulsionFeedback(status = 'not_received') {
        for (const channelName of ['leftRear', 'rightRear', 'lateral']) {
            Object.assign(vehicle.propulsionFeedback[channelName], {
                ratio: null,
                valid: false,
                status
            });
        }
        vehicle.propulsionFeedback.lastReceivedAt = 0;
        vehicle.propulsionFeedback.stale = true;
    }

    function normalizePropulsionChannel(channel) {
        const hasRatio = channel?.ratio !== null && channel?.ratio !== undefined;
        const ratio = Number(channel?.ratio);
        const valid = channel?.valid === true && hasRatio && Number.isFinite(ratio);
        return {
            ratio: valid ? Math.max(-1, Math.min(1, ratio)) : null,
            valid,
            status: String(channel?.status || (valid ? 'ok' : 'invalid'))
        };
    }

    function handlePropulsionFeedback(payload = {}) {
        Object.assign(
            vehicle.propulsionFeedback.leftRear,
            normalizePropulsionChannel(payload.left_rear)
        );
        Object.assign(
            vehicle.propulsionFeedback.rightRear,
            normalizePropulsionChannel(payload.right_rear)
        );
        Object.assign(
            vehicle.propulsionFeedback.lateral,
            normalizePropulsionChannel(payload.lateral)
        );
        vehicle.propulsionFeedback.lastReceivedAt = monotonicNow();
        vehicle.propulsionFeedback.stale = false;
    }

    function evaluatePropulsionFeedbackFreshness() {
        const feedback = vehicle.propulsionFeedback;
        if (feedback.lastReceivedAt <= 0 || feedback.stale) return;
        if (monotonicNow() - feedback.lastReceivedAt < PROPULSION_FEEDBACK_STALE_MS) return;
        resetPropulsionFeedback('frontend_timeout');
    }

    function startPropulsionFeedbackWatchdog() {
        if (propulsionFeedbackWatchdogTimer) return;
        propulsionFeedbackWatchdogTimer = setInterval(
            evaluatePropulsionFeedbackFreshness,
            250
        );
    }

    function stopPropulsionFeedbackWatchdog() {
        if (!propulsionFeedbackWatchdogTimer) return;
        clearInterval(propulsionFeedbackWatchdogTimer);
        propulsionFeedbackWatchdogTimer = null;
    }

    function clearInfoQueryTimeout() {
        if (infoQueryTimeout) {
            clearTimeout(infoQueryTimeout);
            infoQueryTimeout = null;
        }
    }

    function clearWaypointRadiusTimers() {
        if (waypointRadiusQueryTimeout) clearTimeout(waypointRadiusQueryTimeout);
        if (waypointRadiusSetTimeout) clearTimeout(waypointRadiusSetTimeout);
        waypointRadiusQueryTimeout = null;
        waypointRadiusSetTimeout = null;
    }

    function clearMissionClearTimeout() {
        if (!missionClearTimeout) return;
        clearTimeout(missionClearTimeout);
        missionClearTimeout = null;
    }

    function failPendingMissionClear(message) {
        if (mission.clearOperation.phase !== 'PENDING') return;
        pendingCommands.delete(mission.clearOperation.pendingRequestId);
        clearMissionClearTimeout();
        Object.assign(mission.clearOperation, {
            phase: 'ERROR',
            pendingRequestId: null,
            error: message
        });
        pushNotification(NOTIFICATION_TITLES.mission, message, 'error');
    }

    function clearGeofenceOperationTimeout() {
        if (!geofenceOperationTimeout) return;
        clearTimeout(geofenceOperationTimeout);
        geofenceOperationTimeout = null;
    }

    function pendingGeofenceOperation() {
        return ['upload', 'download', 'clear'].find(
            operation => geofence[operation].phase === 'PENDING'
        ) || null;
    }

    function failPendingGeofenceOperations(message) {
        const pending = pendingGeofenceOperation();
        if (!pending) return;
        pendingCommands.delete(geofence[pending].pendingRequestId);
        clearGeofenceOperationTimeout();
        Object.assign(geofence[pending], {
            phase: 'ERROR',
            pendingRequestId: null,
            error: message
        });
        pushNotification(NOTIFICATION_TITLES.geofence, `操作失败：${message}，本地围栏已保留`, 'error');
    }

    function beginGeofenceOperation(operation, commandType, payload) {
        if (pendingGeofenceOperation()) {
            pushNotification(NOTIFICATION_TITLES.geofence, '已有操作正在进行，请稍后重试', 'warning');
            return false;
        }
        const requestId = sendPacket(commandType, payload);
        if (!requestId) return false;
        for (const name of ['upload', 'download', 'clear']) {
            if (name === operation) continue;
            Object.assign(geofence[name], {
                phase: 'IDLE',
                pendingRequestId: null,
                error: null
            });
        }
        Object.assign(geofence[operation], {
            phase: 'PENDING',
            pendingRequestId: requestId,
            error: null
        });
        clearGeofenceOperationTimeout();
        geofenceOperationTimeout = setTimeout(() => {
            if (geofence[operation].pendingRequestId !== requestId) return;
            pendingCommands.delete(requestId);
            Object.assign(geofence[operation], {
                phase: 'ERROR',
                pendingRequestId: null,
                error: '请求超时，无法确认飞控围栏状态'
            });
            geofenceOperationTimeout = null;
            pushNotification(
                NOTIFICATION_TITLES.geofence,
                '无法确认飞控围栏状态，本地围栏已保留',
                'error'
            );
        }, GEOFENCE_OPERATION_TIMEOUT_MS);
        return true;
    }

    function clearWaypointAcceptanceRadius(reason = null) {
        pendingCommands.delete(waypointAcceptanceRadius.pendingQueryRequestId);
        pendingCommands.delete(waypointAcceptanceRadius.pendingSetRequestId);
        clearWaypointRadiusTimers();
        Object.assign(waypointAcceptanceRadius, {
            valueM: null,
            queried: false,
            queryPhase: 'IDLE',
            setPhase: 'IDLE',
            error: reason,
            lastUpdatedAt: 0,
            pendingQueryRequestId: null,
            pendingSetRequestId: null,
            expectedValueM: null,
            notifyOnQueryError: false,
            refreshQueued: false
        });
    }

    function applyWaypointAcceptanceRadius(data) {
        const radius = parseWaypointAcceptanceRadiusResponse(data);
        if (radius === null) return false;
        waypointAcceptanceRadius.valueM = radius;
        waypointAcceptanceRadius.queried = true;
        waypointAcceptanceRadius.error = null;
        waypointAcceptanceRadius.lastUpdatedAt = Date.now();
        return true;
    }

    function finishInfoQueryError(errorCode) {
        const failedQueryId = infoQuery.pendingQueryId;
        pendingCommands.delete(infoQuery.pendingRequestId);
        clearInfoQueryTimeout();
        infoQuery.phase = 'ERROR';
        infoQuery.pendingRequestId = null;
        infoQuery.pendingQueryId = null;
        infoQuery.result = null;
        infoQuery.displayText = INFO_QUERY_ERROR_TEXT[errorCode]
            || '查询失败：未知错误';
        if (failedQueryId === 'WAYPOINT_ACCEPTANCE_RADIUS') {
            waypointAcceptanceRadius.valueM = null;
            waypointAcceptanceRadius.queried = false;
            waypointAcceptanceRadius.queryPhase = 'ERROR';
            waypointAcceptanceRadius.error = infoQuery.displayText;
            waypointAcceptanceRadius.lastUpdatedAt = 0;
        }
        drainQueuedWaypointRadiusQuery();
    }

    function failPendingInfoQuery(errorCode) {
        if (infoQuery.phase !== 'PENDING') return;
        finishInfoQueryError(errorCode);
    }

    function pushNotification(title, message, type = 'info', options = {}) {
        const now = Date.now();
        const time = new Date(now).toLocaleTimeString();
        const normalizedMessage = String(message || '操作失败');
        const key = options.key || null;
        const dedupeKey = options.dedupeKey || `${title}:${normalizedMessage}:${type}`;
        let existingIndex = -1;

        if (key) {
            existingIndex = notificationLogs.value.findIndex(item => item.key === key);
        } else {
            const dedupeWindowMs = options.dedupeWindowMs ?? NOTIFICATION_DEDUPE_MS;
            existingIndex = notificationLogs.value.findIndex(item => (
                item.dedupeKey === dedupeKey && now - item.updatedAt <= dedupeWindowMs
            ));
        }

        if (existingIndex >= 0) {
            const [existing] = notificationLogs.value.splice(existingIndex, 1);
            Object.assign(existing, {
                time,
                title,
                message: normalizedMessage,
                type: `msg-${type}`,
                updatedAt: now,
                count: options.incrementCount === false ? existing.count : existing.count + 1,
                key: key || existing.key,
                dedupeKey
            });
            notificationLogs.value.unshift(existing);
            return existing.id;
        }

        const entry = {
            id: now + Math.random(),
            time,
            title,
            message: normalizedMessage,
            type: `msg-${type}`,
            updatedAt: now,
            count: 1,
            key,
            dedupeKey
        };
        notificationLogs.value.unshift(entry);
        if (notificationLogs.value.length > 50) notificationLogs.value.pop();
        return entry.id;
    }

    // --- WebSocket 相关变量 ---
    let socket = null;
    let reconnectTimer = null;
    let heartbeatTimer = null;
    let socketGeneration = 0;
    const pendingCommands = new Map();
    let reconnectEnabled = true;
    const isWsConnected = ref(false);
    const wsUrl = ref(localStorage.getItem('wsUrl') || 'ws://10.168.1.199:8765');


    // ==========================================
    // WebSocket 核心逻辑
    // ==========================================

    function connectWebSocket() {
        if (socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)) return;

        reconnectEnabled = true;
        const generation = ++socketGeneration;

        console.log(`正在连接后端服务: ${wsUrl.value}`);
        const nextSocket = new WebSocket(wsUrl.value);
        socket = nextSocket;

        nextSocket.onopen = () => {
            if (generation !== socketGeneration || socket !== nextSocket) return;
            console.log("后端连接成功!");
            isWsConnected.value = true;
            leakAlert.channelConnectedAt = monotonicNow();
            batteryAlert.communicationLost = false;
            pushNotification(
                NOTIFICATION_TITLES.onboard,
                '连接成功',
                'success',
                {key: 'connection:onboard', incrementCount: false}
            );
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            sendPacket("CMD_CONNECT_VEHICLE", {}, {silent: true});
            sendPacket("CMD_GET_RECENT_LOGS", {}, {silent: true}); // 连接时获取历史日志
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            heartbeatTimer = setInterval(() => sendSimplePacket('heartbeat'), 1000);
        };
        nextSocket.binaryType = "arraybuffer";
        const decoder = new TextDecoder('utf-8');

        nextSocket.onmessage = (event) => {
            if (generation !== socketGeneration || socket !== nextSocket) return;
            try {
                let jsonString = '';
                if (event.data instanceof ArrayBuffer) {
                    jsonString = decoder.decode(event.data);
                } else {
                    jsonString = event.data;
                }
                const msg = JSON.parse(jsonString);
                handleIncomingMessage(msg);
            } catch (e) {
                console.error("解析消息失败:", e);
                if (event.data instanceof ArrayBuffer) {
                    console.log("Raw binary data length:", event.data.byteLength);
                } else {
                    console.log("Raw text data:", event.data);
                }
            }
        };

        nextSocket.onclose = (event) => {
            if (generation !== socketGeneration || socket !== nextSocket) return;
            console.warn("后端连接断开，3秒后重连...");
            isWsConnected.value = false;
            vehicle.connected = false;
            vehicle.armedKnown = false;
            clearLivePosition('BACKEND_DISCONNECTED');
            resetPropulsionFeedback('backend_disconnected');
            failPendingInfoQuery('BACKEND_DISCONNECTED');
            failPendingMissionClear('后端连接已断开，本地航点已保留');
            failPendingGeofenceOperations('后端连接已断开');
            clearWaypointAcceptanceRadius('BACKEND_DISCONNECTED');
            markLeakChannelDisconnected();
            markBatteryChannelDisconnected();
            pendingCommands.clear();
            socket = null;
            if (heartbeatTimer) {
                clearInterval(heartbeatTimer);
                heartbeatTimer = null;
            }
            if (event.code === 1013 && event.reason) {
                pushNotification(
                    NOTIFICATION_TITLES.onboard,
                    event.reason,
                    'warning',
                    {key: 'connection:onboard', incrementCount: false}
                );
            } else if (reconnectEnabled) {
                pushNotification(
                    NOTIFICATION_TITLES.onboard,
                    '连接已断开，正在重连',
                    'warning',
                    {key: 'connection:onboard', incrementCount: false}
                );
            }
            if (reconnectEnabled && !reconnectTimer) {
                reconnectTimer = setTimeout(() => {
                    reconnectTimer = null;
                    connectWebSocket();
                }, 3000);
            }
        };

        nextSocket.onerror = (err) => {
            if (generation !== socketGeneration || socket !== nextSocket) return;
            console.error("WebSocket 错误:", err);
            isWsConnected.value = false;
            vehicle.connected = false;
            vehicle.armedKnown = false;
            clearLivePosition('BACKEND_DISCONNECTED');
            resetPropulsionFeedback('backend_disconnected');
            failPendingInfoQuery('BACKEND_DISCONNECTED');
            failPendingMissionClear('后端连接异常，本地航点已保留');
            failPendingGeofenceOperations('后端连接异常');
            clearWaypointAcceptanceRadius('BACKEND_DISCONNECTED');
            markLeakChannelDisconnected();
            markBatteryChannelDisconnected();
        };
    }
    
    function disconnectWebSocket() {
        reconnectEnabled = false;
        socketGeneration++;
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
        const oldSocket = socket;
        socket = null;
        if (oldSocket) {
            oldSocket.close();
        }
        isWsConnected.value = false;
        vehicle.connected = false;
        vehicle.armedKnown = false;
        clearLivePosition('BACKEND_DISCONNECTED');
        resetPropulsionFeedback('backend_disconnected');
        failPendingInfoQuery('BACKEND_DISCONNECTED');
        failPendingMissionClear('后端连接已断开，本地航点已保留');
        failPendingGeofenceOperations('后端连接已断开');
        clearWaypointAcceptanceRadius('BACKEND_DISCONNECTED');
        markLeakChannelDisconnected();
        markBatteryChannelDisconnected();
        pendingCommands.clear();
    }

    function changeWsUrl(newUrl) {
        if (newUrl === wsUrl.value) {
            ElMessage.info('新地址与当前地址相同，无需更改');
            return;
        }

        const doChange = () => {
            wsUrl.value = newUrl;
            localStorage.setItem('wsUrl', newUrl);
            pushNotification(
                NOTIFICATION_TITLES.onboard,
                '连接地址已更新，正在重新连接…',
                'info',
                {key: 'connection:onboard', incrementCount: false}
            );
            disconnectWebSocket();
            reconnectEnabled = true;
            setTimeout(connectWebSocket, 500);
        };

        if (isWsConnected.value) {
            ElMessageBox.confirm(
                '当前已连接到后端服务，更改地址将断开现有连接。是否继续?',
                '警告',
                {
                    confirmButtonText: '强制切换',
                    cancelButtonText: '取消',
                    type: 'warning',
                    customClass: 'hud-message-box'
                }
            ).then(() => {
                doChange();
            }).catch(() => {
                ElMessage.info('已取消更改');
            });
        } else {
            doChange();
        }
    }


    function clearLeakRtlTimeout() {
        if (leakRtlTimeout) {
            clearTimeout(leakRtlTimeout);
            leakRtlTimeout = null;
        }
    }

    function resetLeakRtlState() {
        pendingCommands.delete(leakAlert.rtlRequestId);
        clearLeakRtlTimeout();
        leakAlert.rtlRequestId = null;
        leakAlert.rtlStatus = 'IDLE';
        leakAlert.rtlMessage = null;
    }

    function handleLeakAlert(payload = {}) {
        const wasDetected = leakAlert.detected;
        const hadSensorFault = leakAlert.sensorFault;
        const detected = Boolean(payload.detected);
        const sensorFault = Boolean(payload.sensor_fault);

        leakAlert.lastAlertReceivedAt = monotonicNow();
        leakAlert.lingerDeadline = 0;
        leakAlert.lingerRemainingSeconds = 0;
        leakAlert.communicationLost = false;
        if (!detected && !sensorFault) {
            beginLeakAlertLinger();
            return;
        }

        leakAlert.detected = detected;
        leakAlert.sensorFault = sensorFault;
        leakAlert.faultCode = payload.fault_code || null;

        if (detected && sensorFault) {
            leakAlert.phase = 'LEAK_WITH_SENSOR_FAULT';
        } else if (detected) {
            leakAlert.phase = 'LEAK_ACTIVE';
        } else if (sensorFault) {
            leakAlert.phase = 'SENSOR_FAULT_ACTIVE';
        }

        if (detected && !wasDetected) {
            resetLeakRtlState();
            pushNotification(NOTIFICATION_TITLES.safety, '检测到舱内漏水', 'error');
        }
        if (sensorFault && !hadSensorFault) {
            pushNotification(NOTIFICATION_TITLES.safety, '漏水传感器状态异常', 'warning');
        }
    }

    function beginLeakAlertLinger() {
        const hadLeak = leakAlert.detected
            || leakAlert.phase === 'LEAK_ACTIVE'
            || leakAlert.phase === 'LEAK_UNKNOWN'
            || leakAlert.phase === 'LEAK_WITH_SENSOR_FAULT';
        const hadFault = leakAlert.sensorFault
            || leakAlert.phase === 'SENSOR_FAULT_ACTIVE';

        if (!hadLeak && !hadFault) return;

        leakAlert.detected = false;
        leakAlert.sensorFault = false;
        leakAlert.faultCode = null;
        leakAlert.communicationLost = false;
        leakAlert.phase = hadLeak ? 'LEAK_LINGER' : 'SENSOR_FAULT_LINGER';
        leakAlert.lingerDeadline = monotonicNow() + LEAK_ALERT_LINGER_MS;
        leakAlert.lingerRemainingSeconds = Math.ceil(LEAK_ALERT_LINGER_MS / 1000);
        pushNotification(
            NOTIFICATION_TITLES.safety,
            hadLeak ? '漏水信号已停止，持续观察 10 秒' : '漏水传感器已恢复，持续观察 10 秒',
            hadLeak ? 'warning' : 'success'
        );
    }

    function finishLeakAlertLinger() {
        leakAlert.detected = false;
        leakAlert.sensorFault = false;
        leakAlert.faultCode = null;
        leakAlert.phase = 'NORMAL';
        leakAlert.lingerDeadline = 0;
        leakAlert.lingerRemainingSeconds = 0;
        leakAlert.communicationLost = false;
        resetLeakRtlState();
    }

    function markLeakChannelDisconnected() {
        if (leakAlert.detected) {
            if (!leakAlert.communicationLost) {
                pushNotification(NOTIFICATION_TITLES.safety, '通信中断，漏水状态未知', 'error');
            }
            leakAlert.communicationLost = true;
            leakAlert.phase = 'LEAK_UNKNOWN';
        } else if (leakAlert.sensorFault) {
            leakAlert.communicationLost = true;
            leakAlert.phase = 'SENSOR_FAULT_ACTIVE';
        }
    }

    function evaluateLeakAlertState() {
        const now = monotonicNow();
        if (leakAlert.phase === 'LEAK_LINGER' || leakAlert.phase === 'SENSOR_FAULT_LINGER') {
            const remainingMs = Math.max(0, leakAlert.lingerDeadline - now);
            leakAlert.lingerRemainingSeconds = Math.ceil(remainingMs / 1000);
            if (leakAlert.lingerDeadline > 0 && remainingMs <= 0) {
                finishLeakAlertLinger();
            }
            return;
        }

        if (!leakAlert.detected && !leakAlert.sensorFault) return;
        if (now - leakAlert.lastAlertReceivedAt < LEAK_ALERT_STALE_MS) return;

        const backendChannelHealthy = isWsConnected.value
            && now - leakAlert.lastBackendMessageAt <= BACKEND_CHANNEL_STALE_MS;
        if (!backendChannelHealthy) {
            markLeakChannelDisconnected();
            return;
        }
        if (leakAlert.communicationLost
            && now - leakAlert.channelConnectedAt < LEAK_ALERT_STALE_MS) {
            return;
        }
        beginLeakAlertLinger();
    }

    function startLeakAlertWatchdog() {
        if (leakWatchdogTimer) return;
        leakWatchdogTimer = setInterval(evaluateLeakAlertState, 200);
    }

    function stopLeakAlertWatchdog() {
        if (leakWatchdogTimer) {
            clearInterval(leakWatchdogTimer);
            leakWatchdogTimer = null;
        }
        clearLeakRtlTimeout();
    }

    function clearBatteryConfigTimeout() {
        if (batteryConfigTimeout) clearTimeout(batteryConfigTimeout);
        batteryConfigTimeout = null;
    }

    function clearBatteryReturnTimeout() {
        if (batteryReturnTimeout) clearTimeout(batteryReturnTimeout);
        batteryReturnTimeout = null;
    }

    function failPendingBatteryConfig(message) {
        if (batteryThresholdConfig.phase !== 'PENDING') return;
        pendingCommands.delete(batteryThresholdConfig.pendingRequestId);
        clearBatteryConfigTimeout();
        Object.assign(batteryThresholdConfig, {
            phase: 'ERROR',
            pendingRequestId: null,
            expectedValue: null,
            error: message
        });
        pushNotification('电池设置', message, 'error');
    }

    function failPendingBatteryReturn(message) {
        if (batteryAlert.returnStatus !== 'PENDING') return;
        pendingCommands.delete(batteryAlert.returnRequestId);
        clearBatteryReturnTimeout();
        batteryAlert.returnRequestId = null;
        batteryAlert.returnStatus = 'ERROR';
        batteryAlert.returnMessage = message;
        pushNotification(NOTIFICATION_TITLES.returnHome, message, 'error');
    }

    function markBatteryChannelDisconnected() {
        if (isBatteryAlertState(vehicle.battery.safety_state)) {
            batteryAlert.communicationLost = true;
        }
        failPendingBatteryConfig('机载服务连接已断开，阈值配置结果未知');
        failPendingBatteryReturn('机载服务连接已断开，无法确认返航结果');
    }

    function handleBatteryStatus(payload = {}) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
        const incoming = {...payload};
        const incomingThreshold = Number(incoming.low_battery_threshold);
        delete incoming.low_battery_threshold;
        Object.assign(vehicle.battery, incoming);

        if (batteryThresholdConfig.phase !== 'PENDING'
            && Number.isInteger(incomingThreshold)
            && incomingThreshold >= 0
            && incomingThreshold <= 100) {
            vehicle.battery.low_battery_threshold = incomingThreshold;
        }

        const safetyState = String(vehicle.battery.safety_state || 'STARTING');
        const alarmId = Number(vehicle.battery.alarm_id) || 0;
        if (isBatteryAlertState(safetyState)) {
            if (alarmId !== batteryAlert.alarmId) {
                batteryAlert.alarmId = alarmId;
                batteryAlert.soundSilenced = false;
                batteryAlert.returnRequestId = null;
                batteryAlert.returnStatus = 'IDLE';
                batteryAlert.returnMessage = null;
                clearBatteryReturnTimeout();
            }
            batteryAlert.communicationLost = false;
            const preservePendingReturn = batteryAlert.returnRequestId
                && batteryAlert.returnStatus === 'PENDING'
                && vehicle.battery.return_status === 'IDLE';
            if (vehicle.battery.return_status && !preservePendingReturn) {
                batteryAlert.returnStatus = vehicle.battery.return_status;
                batteryAlert.returnMessage = vehicle.battery.return_message || null;
            }
        } else {
            batteryAlert.communicationLost = false;
            batteryAlert.returnRequestId = null;
            batteryAlert.returnStatus = 'IDLE';
            batteryAlert.returnMessage = null;
            batteryAlert.soundSilenced = false;
            clearBatteryReturnTimeout();
        }
    }


    // --- 消息分发处理 ---
    function clearLivePosition(reason = 'POSITION_UNAVAILABLE') {
        Object.assign(vehicle.displayPosition, {
            lat: null,
            lng: null,
            valid: false,
            source: 'none',
            reason,
            ekfGlobalValid: false,
        });
        vehicle.position.valid = false;
    }

    function handleIncomingMessage(msg) {
        const {type, payload} = msg;
        leakAlert.lastBackendMessageAt = monotonicNow();

        switch (type) {
            case 'DATA_NAV': {
                const normalizedPosition = normalizePosition(payload.position);

                if (normalizedPosition) {
                    Object.assign(vehicle.displayPosition, normalizedPosition, {valid: true});

                    if (normalizedPosition.source === 'ekf') {
                        vehicle.position.lat = normalizedPosition.lat;
                        vehicle.position.lng = normalizedPosition.lng;
                        vehicle.position.valid = true;
                        vehicle.trajectory.push([normalizedPosition.lat, normalizedPosition.lng]);
                    } else {
                        vehicle.position.valid = false;
                    }
                } else {
                    clearLivePosition(payload.position?.reason);
                }

                if (payload.attitude) {
                    vehicle.attitude = {
                        roll: payload.attitude.roll_deg ?? 0,
                        pitch: payload.attitude.pitch_deg ?? 0,
                        yaw: payload.attitude.yaw_deg ?? 0
                    };
                }
                if (payload.velocity) {
                    vehicle.velocity.speed = payload.velocity.ground_speed_m_s;
                }
                break;
            }

            case 'DATA_STATUS':
                vehicle.connected = payload.is_connected;
                if (!vehicle.connected) {
                    clearLivePosition('PX4_DISCONNECTED');
                    clearWaypointAcceptanceRadius('PX4_DISCONNECTED');
                }
                vehicle.armed = payload.is_armed;
                vehicle.armedKnown = payload.is_armed_known === true;
                vehicle.mode = payload.flight_mode;
                if (payload.battery) handleBatteryStatus(payload.battery);
                if (payload.gps) vehicle.gps = {sats: payload.gps.sat_count, fix: payload.gps.fix_type};
                if (payload.health) Object.assign(vehicle.health, payload.health);
                if (payload.home) {
                    const homeLat = Number(payload.home.lat);
                    const homeLon = Number(payload.home.lon);
                    if (Number.isFinite(homeLat) && Number.isFinite(homeLon)
                        && Math.abs(homeLat) <= 90 && Math.abs(homeLon) <= 180) {
                        vehicle.home = {...payload.home, lat: homeLat, lon: homeLon};
                    }
                }
                if (payload.control_state) {
                    Object.assign(controlStatus, payload.control_state);
                }
                break;
            case 'DATA_PROPULSION_FEEDBACK':
                handlePropulsionFeedback(payload);
                break;
            case 'DATA_LEAK_ALERT':
                handleLeakAlert(payload);
                break;
            case 'DATA_INFO_QUERY_RESULT':
                handleInfoQueryResult(payload);
                break;
            case 'state': {
                const previousState = controlStatus.state;
                const previousReason = controlStatus.reason;
                Object.assign(controlStatus, {
                    state: msg.state,
                    transitioning: Boolean(msg.transitioning),
                    armed: Boolean(msg.armed),
                    px4_mode: msg.px4_mode || 'UNKNOWN',
                    reason: msg.reason || null
                });
                vehicle.armed = Boolean(msg.armed);
                if (msg.px4_mode) vehicle.mode = msg.px4_mode;

                if (!controlStatus.transitioning) {
                    if (controlStatus.reason && controlStatus.reason !== previousReason) {
                        const isSafetyLock = controlStatus.state === 'locked'
                            && /自动上锁|连接断开|无消息/.test(controlStatus.reason);
                        const reason = localizeBackendError(
                            controlStatus.reason,
                            isSafetyLock ? '飞控已进入安全锁定状态' : '地面控制操作失败'
                        );
                        pushNotification(
                            isSafetyLock ? NOTIFICATION_TITLES.safety : NOTIFICATION_TITLES.groundControl,
                            reason,
                            isSafetyLock ? 'warning' : 'error',
                            isSafetyLock
                                ? {dedupeKey: `safety:${reason}`}
                                : {key: 'ground-control:state', incrementCount: false}
                        );
                    } else if (controlStatus.state !== previousState) {
                        const entered = controlStatus.state === 'manual';
                        pushNotification(
                            NOTIFICATION_TITLES.groundControl,
                            entered ? '已进入手操并确认解锁' : '已归零并确认上锁',
                            entered ? 'success' : 'warning',
                            {key: 'ground-control:state', incrementCount: false}
                        );
                    }
                }
                break;
            }
            case 'DATA_LOG':
                addLog(payload.text, payload.level);
                break;
            case 'ACK':
                handleAck(payload);
                break;
            case 'DATA_MISSION_PROGRESS':
                mission.progress.current = payload.current;
                mission.progress.total = payload.total;
                break;
            case 'DATA_RELAY_STATUS': // <--- 处理继电器状态反馈
                vehicle.relay_on = payload.state === 1;
                break;
            default:
            // console.log("未知消息类型:", type);
        }
    }

    function addLog(text, level = 'INFO', ts = null) {
        let timeStr;
        if (ts) {
            // 如果后端传了 timestamp (秒)，转换回本地时间
            // 注意：backend 使用的是 asyncio.get_running_loop().time()，这是单调时间
            // 历史日志的时间戳可能需要处理，或者后端直接传格式化好的字符串。
            // 这里暂且简单处理，如果后端没传绝对时间，我们就用当前时间。
            timeStr = new Date().toLocaleTimeString();
        } else {
            timeStr = new Date().toLocaleTimeString();
        }
        
        sysLogs.unshift({
            id: Date.now() + Math.random(),
            time: timeStr,
            text: text,
            level: level
        });
        if (sysLogs.length > 50) {
            sysLogs.pop();
        }
    }

    function handleAck(payload) {
        const {request_id, command_type, success, message} = payload;
        const commandContext = pendingCommands.get(request_id) || {
            type: command_type,
            payload: {},
            notificationKey: null,
            silent: false,
            silentSuccess: false,
            successNotification: null,
            failureTitle: null
        };
        pendingCommands.delete(request_id);
        const notificationOptions = commandContext.notificationKey
            ? {key: commandContext.notificationKey, incrementCount: false}
            : {};
        if (command_type === 'CMD_SET_BATTERY_THRESHOLD') {
            if (request_id !== batteryThresholdConfig.pendingRequestId) return;
            clearBatteryConfigTimeout();
            batteryThresholdConfig.pendingRequestId = null;
            batteryThresholdConfig.expectedValue = null;
            if (!success) {
                batteryThresholdConfig.phase = 'ERROR';
                batteryThresholdConfig.error = message || '低电量阈值配置失败';
                pushNotification('电池设置', batteryThresholdConfig.error, 'error');
                return;
            }
            const threshold = Number(payload.threshold);
            if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100) {
                batteryThresholdConfig.phase = 'ERROR';
                batteryThresholdConfig.error = '后端返回的阈值无效';
                pushNotification('电池设置', batteryThresholdConfig.error, 'error');
                return;
            }
            vehicle.battery.low_battery_threshold = threshold;
            batteryThresholdConfig.phase = 'SUCCESS';
            batteryThresholdConfig.error = null;
            pushNotification(
                '电池设置',
                threshold === 0 ? '低电量报警已禁用' : `低电量阈值已配置为 ${threshold}%`,
                'success'
            );
            return;
        }
        if (command_type === 'CMD_RETURN_HOME'
            && Number.isInteger(payload.alarm_id)) {
            if (request_id !== batteryAlert.returnRequestId
                || payload.alarm_id !== batteryAlert.alarmId) return;
            clearBatteryReturnTimeout();
            batteryAlert.returnRequestId = null;
            batteryAlert.returnStatus = success ? 'SUCCESS' : 'ERROR';
            batteryAlert.returnMessage = success
                ? (message || '飞控已确认进入返航模式')
                : localizeBackendError(message, '返航流程执行失败');
            pushNotification(
                NOTIFICATION_TITLES.returnHome,
                batteryAlert.returnMessage,
                success ? 'success' : 'error'
            );
            return;
        }
        const geofenceCommands = {
            CMD_UPLOAD_GEOFENCE: 'upload',
            CMD_DOWNLOAD_GEOFENCE: 'download',
            CMD_CLEAR_GEOFENCE: 'clear'
        };
        const geofenceOperation = geofenceCommands[command_type];
        if (geofenceOperation) {
            const operation = geofence[geofenceOperation];
            if (request_id !== operation.pendingRequestId) return;
            clearGeofenceOperationTimeout();
            operation.pendingRequestId = null;

            if (!success) {
                operation.phase = 'ERROR';
                operation.error = localizeBackendError(message, '飞控地理围栏操作失败');
                pushNotification(NOTIFICATION_TITLES.geofence, operation.error, 'error');
                return;
            }

            if (geofenceOperation === 'download') {
                try {
                    geofence.points = parseDownloadedGeofence(payload.geofence);
                    geofence.source = 'PX4';
                } catch (error) {
                    operation.phase = 'ERROR';
                    operation.error = error?.message || '飞控返回的围栏数据无效';
                    pushNotification(NOTIFICATION_TITLES.geofence, operation.error, 'error');
                    return;
                }
            } else if (geofenceOperation === 'clear') {
                geofence.points = [];
                geofence.source = 'LOCAL';
            } else {
                geofence.source = 'PX4';
            }
            operation.phase = 'SUCCESS';
            operation.error = null;
            triggerRedraw();
            pushNotification(
                NOTIFICATION_TITLES.geofence,
                message || '飞控地理围栏操作成功',
                'success',
                notificationOptions
            );
            return;
        }
        if (command_type === 'CMD_SET_WAYPOINT_ACCEPTANCE_RADIUS'
            && request_id === waypointAcceptanceRadius.pendingSetRequestId) {
            if (waypointRadiusSetTimeout) clearTimeout(waypointRadiusSetTimeout);
            waypointRadiusSetTimeout = null;
            waypointAcceptanceRadius.pendingSetRequestId = null;

            if (!success) {
                waypointAcceptanceRadius.setPhase = 'ERROR';
                waypointAcceptanceRadius.expectedValueM = null;
                waypointAcceptanceRadius.error = localizeBackendError(message, '航点接受半径配置失败');
                pushNotification(NOTIFICATION_TITLES.parameter, waypointAcceptanceRadius.error, 'error');
                return;
            }

            waypointAcceptanceRadius.setPhase = 'VERIFYING';
            waypointAcceptanceRadius.error = null;
            requestWaypointAcceptanceRadius({notifyOnError: true});
            return;
        }
        const isLeakRtlAck = command_type === 'CMD_SET_MODE'
            && request_id
            && request_id === leakAlert.rtlRequestId;

        if (isLeakRtlAck) {
            clearLeakRtlTimeout();
            leakAlert.rtlRequestId = null;
            leakAlert.rtlStatus = success ? 'SUCCESS' : 'ERROR';
            leakAlert.rtlMessage = success
                ? '返航指令已接受'
                : localizeBackendError(message, '返航指令执行失败');
            pushNotification(
                NOTIFICATION_TITLES.returnHome,
                leakAlert.rtlMessage,
                success ? 'success' : 'error',
                notificationOptions
            );
            return;
        }

        if (command_type === 'CMD_RETURN_HOME') {
            pushNotification(
                NOTIFICATION_TITLES.returnHome,
                success
                    ? (message || '飞控已进入返航模式')
                    : localizeBackendError(message, '返航流程执行失败'),
                success ? 'success' : 'error',
                notificationOptions
            );
            return;
        }

        if (command_type === 'CMD_CLEAR_MISSION') {
            if (request_id !== mission.clearOperation.pendingRequestId) return;
            clearMissionClearTimeout();
            mission.clearOperation.pendingRequestId = null;

            if (!success) {
                mission.clearOperation.phase = 'ERROR';
                mission.clearOperation.error = localizeBackendError(message, '飞控任务清空失败');
                pushNotification(
                    NOTIFICATION_TITLES.mission,
                    `${mission.clearOperation.error}，本地航点已保留`,
                    'error',
                    notificationOptions
                );
                return;
            }

            triggerMapClear();
            mission.clearOperation.phase = 'SUCCESS';
            mission.clearOperation.error = null;
            pushNotification(
                NOTIFICATION_TITLES.mission,
                message || '本地航点和飞控任务均已清空',
                'success',
                notificationOptions
            );
            return;
        }

        if (success) {
            if (command_type === 'CMD_DOWNLOAD_MISSION' && Array.isArray(payload.mission_items)) {
                processDownloadedMission(payload.mission_items);
            }
            if (command_type === 'CMD_GET_RECENT_LOGS' && payload.logs) {
                // 清空当前日志并填入历史记录
                sysLogs.length = 0;
                payload.logs.forEach(log => {
                    // 历史日志通常已经包含完整的 packet 结构，直接提取 payload
                    if (log.payload) {
                        addLog(log.payload.text, log.payload.level, log.timestamp);
                    }
                });
            }
        }

        let notification = formatCommandAck({
            commandType: command_type,
            success,
            message,
            requestPayload: commandContext.payload,
            silentSuccess: commandContext.silent || commandContext.silentSuccess
        });
        if (success && commandContext.successNotification) {
            notification = {
                type: 'success',
                ...commandContext.successNotification
            };
        } else if (!success && notification && commandContext.failureTitle) {
            notification.title = commandContext.failureTitle;
        }
        if (notification && !commandContext.silent) {
            pushNotification(
                notification.title,
                notification.message,
                notification.type,
                notificationOptions
            );
        }
    }

    function handleInfoQueryResult(payload = {}) {
        pendingCommands.delete(payload.request_id);
        if (payload.request_id === waypointAcceptanceRadius.pendingQueryRequestId
            && payload.query_id === 'WAYPOINT_ACCEPTANCE_RADIUS') {
            finishBackgroundWaypointRadiusQuery(payload);
            return;
        }
        if (infoQuery.phase !== 'PENDING') return;
        if (payload.request_id !== infoQuery.pendingRequestId) return;
        if (payload.query_id !== infoQuery.pendingQueryId) return;

        if (!payload.success) {
            finishInfoQueryError(payload.error?.code);
            return;
        }

        const formatter = INFO_QUERY_FORMATTERS[payload.query_id];
        if (!formatter) {
            finishInfoQueryError('INVALID_RESULT');
            return;
        }

        try {
            const displayText = formatter(payload.data);
            if (payload.query_id === 'WAYPOINT_ACCEPTANCE_RADIUS'
                && !applyWaypointAcceptanceRadius(payload.data)) {
                throw new Error('INVALID_RESULT');
            }
            if (payload.query_id === 'WAYPOINT_ACCEPTANCE_RADIUS') {
                waypointAcceptanceRadius.queryPhase = 'SUCCESS';
            }
            clearInfoQueryTimeout();
            infoQuery.phase = 'SUCCESS';
            infoQuery.pendingRequestId = null;
            infoQuery.pendingQueryId = null;
            infoQuery.result = payload.data;
            infoQuery.displayText = displayText;
            drainQueuedWaypointRadiusQuery();
        } catch (error) {
            finishInfoQueryError(error?.message || 'INVALID_RESULT');
        }
    }

    function processDownloadedMission(items) {
        const receivedItems = Array.isArray(items) ? items : [];
        const validPoints = [];
        receivedItems.forEach((item) => {
            if (item.latitude == null || isNaN(item.latitude) ||
                item.longitude == null || isNaN(item.longitude)) {
                return;
            }
            let safeSpeed = item.speed_m_s;
            if (safeSpeed === null || safeSpeed === undefined || isNaN(safeSpeed)) {
                safeSpeed = mission.defaults.speed;
            }
            validPoints.push({
                seq: validPoints.length + 1,
                lat: item.latitude,
                lng: item.longitude,
                speed: safeSpeed,
                loiter: item.loiter || 0
            });
        });

        mission.plannedWaypoints = validPoints;
        mission.progress.total = validPoints.length;
        mission.progress.current = 0; // 重置当前航点
        triggerRedraw();
        const summary = summarizeMissionSync(receivedItems.length, validPoints.length);
        pushNotification(
            NOTIFICATION_TITLES.mission,
            summary.message,
            summary.type,
            {key: 'mission:sync', incrementCount: false}
        );
    }

    function sendPacket(type, payload = {}, options = {}) {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            if (type !== 'CMD_MANUAL_CONTROL') {
                pushNotification(
                    NOTIFICATION_TITLES.onboard,
                    '未连接，无法发送请求',
                    'warning',
                    {dedupeKey: 'connection:send-failed'}
                );
            }
            return null;
        }
        requestSequence += 1;
        const requestId = `${Date.now()}-${requestSequence}`;
        const packet = {
            type: type,
            payload: payload,
            request_id: requestId
        };
        if(packet.type!=="CMD_MANUAL_CONTROL"){
            console.log(JSON.stringify(packet))
        }
        if (type !== 'CMD_MANUAL_CONTROL') {
            const notificationKey = options.notificationKey
                || (options.pendingNotification ? `request:${requestId}` : null);
            pendingCommands.set(requestId, {
                type,
                payload,
                notificationKey,
                silent: options.silent === true,
                silentSuccess: options.silentSuccess === true,
                successNotification: options.successNotification || null,
                failureTitle: options.failureTitle || null
            });
            if (options.pendingNotification) {
                pushNotification(
                    options.pendingNotification.title,
                    options.pendingNotification.message,
                    options.pendingNotification.type || 'info',
                    {key: notificationKey, incrementCount: false}
                );
            }
        }
        socket.send(JSON.stringify(packet));
        return requestId;
    }

    function requestMissionClear() {
        if (mission.clearOperation.phase === 'PENDING') return false;
        if (!isWsConnected.value) {
            pushNotification(NOTIFICATION_TITLES.mission, '机载服务未连接，无法清空任务；本地航点已保留', 'error');
            return false;
        }
        if (!vehicle.connected) {
            pushNotification(NOTIFICATION_TITLES.mission, '飞控未连接，无法清空任务；本地航点已保留', 'error');
            return false;
        }
        if (!vehicle.armedKnown) {
            pushNotification(NOTIFICATION_TITLES.mission, '飞控解锁状态未知，无法清空任务；本地航点已保留', 'error');
            return false;
        }
        if (vehicle.armed) {
            pushNotification(
                NOTIFICATION_TITLES.mission,
                '请先进入暂停模式并确认飞控上锁；本地航点已保留',
                'warning'
            );
            return false;
        }

        const requestId = sendPacket('CMD_CLEAR_MISSION', {});
        if (!requestId) return false;

        clearMissionClearTimeout();
        Object.assign(mission.clearOperation, {
            phase: 'PENDING',
            pendingRequestId: requestId,
            error: null
        });
        missionClearTimeout = setTimeout(() => {
            if (mission.clearOperation.pendingRequestId !== requestId) return;
            pendingCommands.delete(requestId);
            mission.clearOperation.pendingRequestId = null;
            mission.clearOperation.phase = 'ERROR';
            mission.clearOperation.error = '清空请求超时，无法确认飞控任务状态';
            pushNotification(
                NOTIFICATION_TITLES.mission,
                '无法确认飞控清空结果，本地航点已保留',
                'error'
            );
            missionClearTimeout = null;
        }, MISSION_CLEAR_TIMEOUT_MS);
        return true;
    }

    function setGeofencePoints(points, source = 'LOCAL') {
        geofence.points = normalizeGeofencePoints(points);
        geofence.source = source;
        triggerRedraw();
    }

    function removeGeofencePoint(index) {
        if (geofence.points.length <= 3) {
            pushNotification(NOTIFICATION_TITLES.geofence, '多边形至少需要 3 个角点', 'warning');
            return false;
        }
        if (!Number.isInteger(index) || index < 0 || index >= geofence.points.length) {
            return false;
        }
        geofence.points.splice(index, 1);
        geofence.source = 'LOCAL';
        triggerRedraw();
        return true;
    }

    function geofenceConnectionReady(operationName, {requireDisarmed = false} = {}) {
        if (!isWsConnected.value) {
            pushNotification(NOTIFICATION_TITLES.geofence, `${operationName}：机载服务未连接，本地围栏已保留`, 'error');
            return false;
        }
        if (!vehicle.connected) {
            pushNotification(NOTIFICATION_TITLES.geofence, `${operationName}：飞控未连接，本地围栏已保留`, 'error');
            return false;
        }
        if (!requireDisarmed) return true;
        if (!vehicle.armedKnown) {
            pushNotification(NOTIFICATION_TITLES.geofence, `${operationName}：飞控解锁状态未知，本地围栏已保留`, 'error');
            return false;
        }
        if (vehicle.armed) {
            pushNotification(NOTIFICATION_TITLES.geofence, `${operationName}：飞控已解锁，请先上锁再操作`, 'warning');
            return false;
        }
        return true;
    }

    function requestGeofenceUpload() {
        if (!geofenceConnectionReady('地理围栏发送失败', {requireDisarmed: true})) {
            return false;
        }
        let payload;
        try {
            payload = serializeGeofence(geofence.points);
        } catch (error) {
            pushNotification(NOTIFICATION_TITLES.geofence, error?.message || '本地围栏无效，无法发送', 'error');
            return false;
        }
        return beginGeofenceOperation('upload', 'CMD_UPLOAD_GEOFENCE', payload);
    }

    function requestGeofenceDownload() {
        if (!geofenceConnectionReady('地理围栏读取失败')) return false;
        return beginGeofenceOperation('download', 'CMD_DOWNLOAD_GEOFENCE', {});
    }

    function requestGeofenceClear() {
        if (!geofenceConnectionReady('地理围栏清空失败', {requireDisarmed: true})) {
            return false;
        }
        return beginGeofenceOperation('clear', 'CMD_CLEAR_GEOFENCE', {});
    }

    function requestInformationQuery(queryId = infoQuery.selectedId) {
        if (infoQuery.phase === 'PENDING') return false;
        if (waypointAcceptanceRadius.queryPhase === 'PENDING') {
            infoQuery.phase = 'ERROR';
            infoQuery.result = null;
            infoQuery.displayText = INFO_QUERY_ERROR_TEXT.QUERY_BUSY;
            return false;
        }
        if (!isWsConnected.value) {
            infoQuery.phase = 'ERROR';
            infoQuery.result = null;
            infoQuery.displayText = INFO_QUERY_ERROR_TEXT.BACKEND_DISCONNECTED;
            return false;
        }
        if (!INFO_QUERY_FORMATTERS[queryId]) {
            infoQuery.phase = 'ERROR';
            infoQuery.result = null;
            infoQuery.displayText = INFO_QUERY_ERROR_TEXT.UNSUPPORTED_QUERY;
            return false;
        }

        const requestId = sendPacket('CMD_QUERY_INFO', {query_id: queryId});
        if (!requestId) return false;

        clearInfoQueryTimeout();
        infoQuery.phase = 'PENDING';
        infoQuery.pendingRequestId = requestId;
        infoQuery.pendingQueryId = queryId;
        infoQuery.result = null;
        infoQuery.displayText = '查询中…';
        infoQueryTimeout = setTimeout(() => {
            if (infoQuery.pendingRequestId !== requestId) return;
            finishInfoQueryError('FRONTEND_TIMEOUT');
        }, INFO_QUERY_TIMEOUT_MS);
        return true;
    }

    function finishBackgroundWaypointRadiusQuery(payload) {
        pendingCommands.delete(payload.request_id);
        if (waypointRadiusQueryTimeout) clearTimeout(waypointRadiusQueryTimeout);
        waypointRadiusQueryTimeout = null;
        waypointAcceptanceRadius.pendingQueryRequestId = null;

        let errorMessage = null;
        if (!payload.success) {
            const errorCode = payload.error?.code || 'INVALID_RESULT';
            errorMessage = INFO_QUERY_ERROR_TEXT[errorCode] || '航点接受半径查询失败';
        } else {
            const returnedRadius = parseWaypointAcceptanceRadiusResponse(payload.data);
            if (returnedRadius === null) {
                errorMessage = INFO_QUERY_ERROR_TEXT.INVALID_RESULT;
            } else if (waypointAcceptanceRadius.expectedValueM !== null
                && !waypointRadiusMatches(
                    returnedRadius,
                    waypointAcceptanceRadius.expectedValueM
                )) {
            errorMessage = `配置校验失败：期望 ${waypointAcceptanceRadius.expectedValueM.toFixed(1)} m，`
                    + `飞控返回 ${returnedRadius.toFixed(1)} m`;
            } else {
                applyWaypointAcceptanceRadius(payload.data);
            }
        }

        if (errorMessage) {
            waypointAcceptanceRadius.valueM = null;
            waypointAcceptanceRadius.queried = false;
            waypointAcceptanceRadius.lastUpdatedAt = 0;
            waypointAcceptanceRadius.queryPhase = 'ERROR';
            waypointAcceptanceRadius.error = errorMessage;
            if (waypointAcceptanceRadius.setPhase === 'VERIFYING') {
                waypointAcceptanceRadius.setPhase = 'ERROR';
            }
            if (waypointAcceptanceRadius.notifyOnQueryError) {
                pushNotification(NOTIFICATION_TITLES.parameter, errorMessage, 'warning');
            }
        } else {
            waypointAcceptanceRadius.queryPhase = 'SUCCESS';
            if (waypointAcceptanceRadius.setPhase === 'VERIFYING') {
                waypointAcceptanceRadius.setPhase = 'SUCCESS';
                pushNotification(
                    NOTIFICATION_TITLES.parameter,
                    `已配置并确认 ${waypointAcceptanceRadius.valueM.toFixed(1)} m`,
                    'success'
                );
            }
        }

        waypointAcceptanceRadius.expectedValueM = null;
        waypointAcceptanceRadius.notifyOnQueryError = false;
        drainQueuedWaypointRadiusQuery();
    }

    function drainQueuedWaypointRadiusQuery() {
        if (!waypointAcceptanceRadius.refreshQueued
            || infoQuery.phase === 'PENDING'
            || waypointAcceptanceRadius.queryPhase === 'PENDING') return;
        waypointAcceptanceRadius.refreshQueued = false;
        requestWaypointAcceptanceRadius({notifyOnError: true});
    }

    function requestWaypointAcceptanceRadius({notifyOnError = false} = {}) {
        const disposition = waypointRadiusQueryDisposition(
            infoQuery.phase === 'PENDING',
            waypointAcceptanceRadius.queryPhase === 'PENDING'
        );
        if (disposition === 'IGNORE') return false;
        if (disposition === 'QUEUE') {
            waypointAcceptanceRadius.refreshQueued = true;
            waypointAcceptanceRadius.notifyOnQueryError ||= notifyOnError;
            return false;
        }
        if (!isWsConnected.value || !vehicle.connected) {
            waypointAcceptanceRadius.queryPhase = 'ERROR';
            waypointAcceptanceRadius.error = !isWsConnected.value
                ? INFO_QUERY_ERROR_TEXT.BACKEND_DISCONNECTED
                : INFO_QUERY_ERROR_TEXT.PX4_NOT_CONNECTED;
            if (notifyOnError) {
                pushNotification(
                    NOTIFICATION_TITLES.parameter,
                    waypointAcceptanceRadius.error,
                    'warning'
                );
            }
            return false;
        }

        const requestId = sendPacket('CMD_QUERY_INFO', {
            query_id: 'WAYPOINT_ACCEPTANCE_RADIUS'
        });
        if (!requestId) return false;

        waypointAcceptanceRadius.queryPhase = 'PENDING';
        waypointAcceptanceRadius.pendingQueryRequestId = requestId;
        waypointAcceptanceRadius.notifyOnQueryError = notifyOnError;
        waypointAcceptanceRadius.error = null;
        if (waypointRadiusQueryTimeout) clearTimeout(waypointRadiusQueryTimeout);
        waypointRadiusQueryTimeout = setTimeout(() => {
            if (waypointAcceptanceRadius.pendingQueryRequestId !== requestId) return;
            finishBackgroundWaypointRadiusQuery({
                request_id: requestId,
                query_id: 'WAYPOINT_ACCEPTANCE_RADIUS',
                success: false,
                error: {code: 'FRONTEND_TIMEOUT'}
            });
        }, INFO_QUERY_TIMEOUT_MS);
        return true;
    }

    function setWaypointAcceptanceRadius(value) {
        const radius = normalizeWaypointAcceptanceRadius(value);
        if (radius === null) {
            pushNotification(NOTIFICATION_TITLES.parameter, '航点接受半径必须在 0.05–200.0 m 范围内', 'warning');
            return false;
        }
        if (!isWsConnected.value || !vehicle.connected) {
            pushNotification(NOTIFICATION_TITLES.parameter, '机载服务或飞控未连接，无法配置航点接受半径', 'warning');
            return false;
        }
        if (!vehicle.armedKnown) {
            pushNotification(NOTIFICATION_TITLES.parameter, '飞控解锁状态未知，无法配置航点接受半径', 'warning');
            return false;
        }
        if (vehicle.armed) {
            pushNotification(NOTIFICATION_TITLES.parameter, '请先上锁飞控，再配置航点接受半径', 'warning');
            return false;
        }
        if (waypointAcceptanceRadius.setPhase === 'PENDING'
            || waypointAcceptanceRadius.setPhase === 'VERIFYING') return false;

        const requestId = sendPacket('CMD_SET_WAYPOINT_ACCEPTANCE_RADIUS', {
            radius_m: radius
        });
        if (!requestId) return false;

        waypointAcceptanceRadius.setPhase = 'PENDING';
        waypointAcceptanceRadius.pendingSetRequestId = requestId;
        waypointAcceptanceRadius.expectedValueM = radius;
        waypointAcceptanceRadius.error = null;
        if (waypointRadiusSetTimeout) clearTimeout(waypointRadiusSetTimeout);
        waypointRadiusSetTimeout = setTimeout(() => {
            if (waypointAcceptanceRadius.pendingSetRequestId !== requestId) return;
            pendingCommands.delete(requestId);
            waypointAcceptanceRadius.pendingSetRequestId = null;
            waypointAcceptanceRadius.expectedValueM = null;
            waypointAcceptanceRadius.setPhase = 'ERROR';
            waypointAcceptanceRadius.error = '配置请求超时，请重试';
            pushNotification(NOTIFICATION_TITLES.parameter, waypointAcceptanceRadius.error, 'error');
            waypointRadiusSetTimeout = null;
        }, INFO_QUERY_TIMEOUT_MS);
        return true;
    }

    function requestLeakReturn() {
        if (leakAlert.rtlStatus === 'PENDING') return false;
        if (!isWsConnected.value) {
            pushNotification(NOTIFICATION_TITLES.returnHome, '机载服务通信已断开，无法执行返航', 'error');
            return false;
        }
        if (!vehicle.connected) {
            pushNotification(NOTIFICATION_TITLES.returnHome, '飞控未连接，无法执行返航', 'error');
            return false;
        }
        if (!vehicle.armed) {
            pushNotification(NOTIFICATION_TITLES.returnHome, '飞控当前未解锁，无法执行返航', 'warning');
            return false;
        }

        const requestId = sendPacket('CMD_SET_MODE', {mode: 'RTL'});
        if (!requestId) return false;

        clearLeakRtlTimeout();
        leakAlert.rtlRequestId = requestId;
        leakAlert.rtlStatus = 'PENDING';
        leakAlert.rtlMessage = '正在请求返航…';
        leakRtlTimeout = setTimeout(() => {
            if (leakAlert.rtlRequestId !== requestId) return;
            pendingCommands.delete(requestId);
            leakAlert.rtlRequestId = null;
            leakAlert.rtlStatus = 'ERROR';
            leakAlert.rtlMessage = '返航请求超时，请重试';
            pushNotification(NOTIFICATION_TITLES.returnHome, leakAlert.rtlMessage, 'error');
            leakRtlTimeout = null;
        }, 3000);
        return true;
    }

    function configureBatteryThreshold(value) {
        if (batteryThresholdConfig.phase === 'PENDING') return false;
        if (!Number.isInteger(value) || value < 0 || value > 100) {
            batteryThresholdConfig.phase = 'ERROR';
            batteryThresholdConfig.error = '请输入 0～100 的整数';
            pushNotification('电池设置', batteryThresholdConfig.error, 'warning');
            return false;
        }
        const requestId = sendPacket('CMD_SET_BATTERY_THRESHOLD', {threshold: value});
        if (!requestId) return false;
        Object.assign(batteryThresholdConfig, {
            phase: 'PENDING',
            pendingRequestId: requestId,
            expectedValue: value,
            error: null
        });
        clearBatteryConfigTimeout();
        batteryConfigTimeout = setTimeout(() => {
            if (batteryThresholdConfig.pendingRequestId !== requestId) return;
            pendingCommands.delete(requestId);
            Object.assign(batteryThresholdConfig, {
                phase: 'ERROR',
                pendingRequestId: null,
                expectedValue: null,
                error: '配置请求超时，原阈值保持不变'
            });
            batteryConfigTimeout = null;
            pushNotification('电池设置', batteryThresholdConfig.error, 'error');
        }, BATTERY_CONFIG_TIMEOUT_MS);
        return true;
    }

    function requestBatteryReturn() {
        const safetyState = String(vehicle.battery.safety_state || 'STARTING');
        if (!isBatteryAlertState(safetyState)) return false;
        if (batteryAlert.returnStatus === 'PENDING') return false;
        if (!isWsConnected.value) {
            pushNotification(NOTIFICATION_TITLES.returnHome, '机载服务通信已断开，无法执行返航', 'error');
            return false;
        }
        if (!vehicle.connected) {
            pushNotification(NOTIFICATION_TITLES.returnHome, '飞控未连接，无法执行返航', 'error');
            return false;
        }

        const reason = safetyState === 'DATA_FAULT'
            ? 'BATTERY_DATA_FAULT'
            : 'LOW_BATTERY';
        const requestId = sendPacket('CMD_RETURN_HOME', {
            reason,
            alarm_id: batteryAlert.alarmId
        });
        if (!requestId) return false;
        batteryAlert.soundSilenced = true;
        batteryAlert.returnRequestId = requestId;
        batteryAlert.returnStatus = 'PENDING';
        batteryAlert.returnMessage = '正在请求返航…';
        clearBatteryReturnTimeout();
        batteryReturnTimeout = setTimeout(() => {
            if (batteryAlert.returnRequestId !== requestId) return;
            pendingCommands.delete(requestId);
            batteryAlert.returnRequestId = null;
            batteryAlert.returnStatus = 'ERROR';
            batteryAlert.returnMessage = '返航请求超时，请重试';
            pushNotification(NOTIFICATION_TITLES.returnHome, batteryAlert.returnMessage, 'error');
            batteryReturnTimeout = null;
        }, BATTERY_RETURN_TIMEOUT_MS);
        return true;
    }

    function sendSimplePacket(type, fields = {}) {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            if (type !== 'control' && type !== 'heartbeat') {
                pushNotification(NOTIFICATION_TITLES.onboard, '未连接，无法发送请求', 'warning', {dedupeKey: 'connection:send-failed'});
            }
            return false;
        }
        socket.send(JSON.stringify({type, ...fields}));
        return true;
    }

    function startNtripClient() {
        if (!ntripClient) {
            ntripClient = new NtripClient({
                config: ntripConfig,
                status: ntripStatus,
                getPosition: () => vehicle.displayPosition,
                getSatellites: () => vehicle.gps.sats,
                isBackendReady: () => isWsConnected.value && vehicle.connected,
                sendRtcmBatch: (batch) => sendSimplePacket('rtcm', batch)
            });
        }
        ntripClient.start();
    }

    function stopNtripClient() {
        ntripClient?.stop();
    }

    function saveNtripConfig(nextConfig) {
        const normalized = {
            host: String(nextConfig?.host || '').trim(),
            port: Number(nextConfig?.port),
            mountpoint: String(nextConfig?.mountpoint || '').trim().replace(/^\/+/, ''),
            username: String(nextConfig?.username || ''),
            password: String(nextConfig?.password || '')
        };
        if (!normalized.host || !Number.isInteger(normalized.port)
            || normalized.port < 1 || normalized.port > 65535
            || !normalized.mountpoint || !normalized.username || !normalized.password) {
            pushNotification(NOTIFICATION_TITLES.ntrip, '请完整填写主机、端口、挂载点、用户名和密码', 'warning');
            return false;
        }
        Object.assign(ntripConfig, normalized);
        localStorage.setItem('ntripConfig', JSON.stringify(normalized));
        ntripClient?.configurationChanged();
        pushNotification(NOTIFICATION_TITLES.ntrip, '配置已保存；正在等待有效定位并自动登录', 'info');
        return true;
    }

    function requestManual() {
        return sendSimplePacket('manual');
    }

    function requestLocked() {
        return sendSimplePacket('locked');
    }

    function sendManualControl(throttle, steering) {
        return sendSimplePacket('control', {throttle, steering});
    }

    function updatePlannedMission(latlngs) {
        const oldPoints = mission.plannedWaypoints;
        mission.plannedWaypoints = latlngs.map((pt, index) => {
            const oldPt = oldPoints[index];
            const useOld = oldPt && Math.abs(oldPt.lat - pt.lat) < 0.0001 && Math.abs(oldPt.lng - pt.lng) < 0.0001;
            return {
                seq: index + 1,
                lat: pt.lat,
                lng: pt.lng,
                speed: useOld ? oldPt.speed : mission.defaults.speed,
                loiter: useOld ? oldPt.loiter : mission.defaults.loiter
            };
        });
    }

    function triggerRedraw() {
        mapTriggers.redrawMission = true;
        setTimeout(() => {
            mapTriggers.redrawMission = false
        }, 50);
    }

    function triggerMapSave() {
        mapTriggers.saveCurrentMap = true;
        setTimeout(() => {
            mapTriggers.saveCurrentMap = false
        }, 100);
    }

    function triggerMapClear() {
        mapTriggers.clearMap = true;
        mission.plannedWaypoints = [];
        mission.uploadedWaypoints = [];
        mission.progress.current = 0;
        mission.progress.total = 0;
        setTimeout(() => {
            mapTriggers.clearMap = false
        }, 100);
    }

    // --- 新增: 清除轨迹 ---
    function clearTrajectory() {
        vehicle.trajectory = [];
        ElMessage.success('轨迹已清除');
    }

    // --- 新增: 继电器控制 ---
    function setRelay(state) {
        if (state && vehicle.battery.safety_return_lock) {
            pushNotification(NOTIFICATION_TITLES.safety, '安全返航进行中，禁止开启混合搅拌器', 'warning');
            return;
        }
        sendPacket('CMD_SET_RELAY', {state: state ? 1 : 0});
    }
    
    // --- 区域规划相关 ---
    function setPlannerMode(mode) {
        plannerMode.value = mode;
        if (mode !== 'area') {
            clearAreaPoints();
        }
    }

    function addAreaPoint(latlng) {
        if (areaPoints.value.length < 4) {
            areaPoints.value.push(latlng);
            triggerRedraw(); // 触发地图重绘以显示区域
        }
    }

    function clearAreaPoints() {
        areaPoints.value = [];
        triggerRedraw();
    }
    
    // --- 新增: 设置家点 ---
    function setHome(lat, lon, alt = 0) {
        sendPacket('CMD_SET_HOME', {
            lat: lat,
            lon: lon,
            alt: alt
        }, {
            pendingNotification: {
                title: NOTIFICATION_TITLES.returnHome,
                message: '正在更新返航点…'
            }
        });
    }

    // --- 新增: 指点模式 ---
    function setGotoTargetCandidate(latlng) {
        mapTriggers.gotoTargetCandidate = latlng;
    }


    // --- 新增: 系统控制 ---
    function shutdownPi() {
        ElMessageBox.confirm(
            '确定要关闭树莓派吗？这将导致地面站断开连接。',
            '系统关机确认',
            {
                confirmButtonText: '确定关机',
                cancelButtonText: '取消',
                type: 'warning',
                customClass: 'hud-message-box'
            }
        ).then(() => {
            sendPacket('CMD_SHUTDOWN_PI', {}, {
                pendingNotification: {
                    title: NOTIFICATION_TITLES.system,
                    message: '正在关闭机载计算机…',
                    type: 'warning'
                }
            });
        }).catch(() => {});
    }

    function shutdownFcu() {
        ElMessageBox.confirm(
            '确定要关闭飞控吗？',
            '飞控关机确认',
            {
                confirmButtonText: '确定关机',
                cancelButtonText: '取消',
                type: 'warning',
                customClass: 'hud-message-box'
            }
        ).then(() => {
            sendPacket('CMD_SHUTDOWN_FCU', {}, {
                pendingNotification: {
                    title: NOTIFICATION_TITLES.system,
                    message: '正在关闭飞控…',
                    type: 'warning'
                }
            });
        }).catch(() => {});
    }

    return {
        vehicle,
        mission,
        geofence,
        mapTriggers,
        sysLogs,
        plannerMode,
        areaPoints,
        notificationLogs,
        controlStatus,
        leakAlert,
        batteryAlert,
        batteryThresholdConfig,
        infoQuery,
        waypointAcceptanceRadius,
        ntripConfig,
        ntripStatus,
        isWsConnected,
        wsUrl,

        connectWebSocket,
        changeWsUrl,
        sendPacket,
        requestManual,
        requestLocked,
        sendManualControl,
        requestLeakReturn,
        requestBatteryReturn,
        configureBatteryThreshold,
        requestMissionClear,
        setGeofencePoints,
        removeGeofencePoint,
        requestGeofenceUpload,
        requestGeofenceDownload,
        requestGeofenceClear,
        requestInformationQuery,
        requestWaypointAcceptanceRadius,
        setWaypointAcceptanceRadius,
        startLeakAlertWatchdog,
        stopLeakAlertWatchdog,
        startPropulsionFeedbackWatchdog,
        stopPropulsionFeedbackWatchdog,
        startNtripClient,
        stopNtripClient,
        saveNtripConfig,
        pushNotification,
        updatePlannedMission,
        triggerMapSave,
        triggerMapClear,
        triggerRedraw,
        clearTrajectory,
        setRelay,
        
        setPlannerMode,
        addAreaPoint,
        clearAreaPoints,
        setHome,
        setGotoTargetCandidate,
        shutdownPi,
        shutdownFcu
    }
})

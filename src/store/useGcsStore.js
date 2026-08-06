import {defineStore} from 'pinia'
import {reactive, ref} from 'vue'
import {ElMessage, ElNotification, ElMessageBox} from 'element-plus'

export const useGcsStore = defineStore('gcs', () => {
    // --- 1. 车辆状态 ---
    const vehicle = reactive({
        connected: false,
        armed: false,
        mode: 'UNKNOWN',
        // 修改：适配新的电池数据结构
        battery: {
            voltage_v: 0,
            remaining_percent: 0,
            current_a: 0.0,
            temperature: 0.0,
            alarms: [],
            low_battery_threshold: 20, // 低电量阈值
            is_low_battery_rtl_triggered: false  // 低电量返航状态
        },
        gps: {sats: 0, fix: 'No Fix'},
        attitude: {roll: 0, pitch: 0, yaw: 0},
        position: {lat: 45.7700000, lng: 126.6700000}, // 默认位置
        home: null, // 新增：HOME点坐标
        velocity: {speed: 0},
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
        }
    })
    
    // --- 3. 规划器状态 ---
    const plannerMode = ref('manual'); // 'manual' | 'area'
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
    const notificationLogs = ref([]); // 新增：全局消息透传日志
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

    const LEAK_ALERT_STALE_MS = 1000;
    const BACKEND_CHANNEL_STALE_MS = 1500;
    const LEAK_ALERT_LINGER_MS = 10000;
    let leakWatchdogTimer = null;
    let leakRtlTimeout = null;
    let requestSequence = 0;

    const monotonicNow = () => performance.now();

    function pushNotification(title, message, type = 'info') {
        notificationLogs.value.unshift({
            id: Date.now() + Math.random(),
            time: new Date().toLocaleTimeString(),
            title,
            message,
            type: `msg-${type}`
        });
        if (notificationLogs.value.length > 50) notificationLogs.value.pop();
    }

    // --- WebSocket 相关变量 ---
    let socket = null;
    let reconnectTimer = null;
    let heartbeatTimer = null;
    let socketGeneration = 0;
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
            pushNotification('系统消息', '地面站后端已连接', 'success');
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            sendPacket("CMD_CONNECT_VEHICLE", {});
            sendPacket("CMD_GET_RECENT_LOGS", {}); // 连接时获取历史日志
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
            markLeakChannelDisconnected();
            socket = null;
            if (heartbeatTimer) {
                clearInterval(heartbeatTimer);
                heartbeatTimer = null;
            }
            if (event.code === 1013 && event.reason) {
                pushNotification('连接被拒绝', event.reason, 'warning');
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
            markLeakChannelDisconnected();
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
        markLeakChannelDisconnected();
    }

    function changeWsUrl(newUrl) {
        if (newUrl === wsUrl.value) {
            pushNotification('提示', '新地址与当前地址相同，无需更改', 'info');
            return;
        }

        const doChange = () => {
            wsUrl.value = newUrl;
            localStorage.setItem('wsUrl', newUrl);
            pushNotification('系统消息', '连接地址已更新，正在重新连接...', 'success');
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
                pushNotification('提示', '已取消更改', 'info');
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
            pushNotification('漏水告警', '检测到舱内漏水', 'error');
        }
        if (sensorFault && !hadSensorFault) {
            pushNotification('传感器故障', '漏水传感器状态异常', 'warning');
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
            hadLeak ? '漏水观察' : '传感器恢复',
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
                pushNotification('漏水告警', '通信中断，漏水状态未知', 'error');
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


    // --- 消息分发处理 ---
    function handleIncomingMessage(msg) {
        const {type, payload} = msg;
        leakAlert.lastBackendMessageAt = monotonicNow();

        switch (type) {
            case 'DATA_NAV':
                if (payload.position && payload.position.lat) {
                    // 1. 先除以 1e7 (10^7)
                    let rawLat = payload.position.lat / 10000000;
                    let rawLon = payload.position.lon / 10000000;

                    // 2. 强制保留 7 位小数，并转为浮点数
                    // 这一步至关重要：即使原始数据是整数（如 45.7700000），toFixed 也能保证显示 7 位
                    vehicle.position.lat = parseFloat(rawLat.toFixed(7));
                    vehicle.position.lng = parseFloat(rawLon.toFixed(7));

                    // 轨迹数据存入
                    vehicle.trajectory.push([vehicle.position.lat, vehicle.position.lng]);
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

            case 'DATA_STATUS':
                vehicle.connected = payload.is_connected;
                vehicle.armed = payload.is_armed;
                vehicle.mode = payload.flight_mode;
                // 修改：直接赋值新的电池对象
                if (payload.battery) {
                    Object.assign(vehicle.battery, payload.battery);
                }
                if (payload.gps) vehicle.gps = {sats: payload.gps.sat_count, fix: payload.gps.fix_type};
                if (payload.home && payload.home.lat && payload.home.lon) {
                    vehicle.home = payload.home;
                }
                if (payload.control_state) {
                    Object.assign(controlStatus, payload.control_state);
                }
                break;
            case 'DATA_LEAK_ALERT':
                handleLeakAlert(payload);
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
                        pushNotification(
                            isSafetyLock ? '安全锁定' : '地面控制失败',
                            controlStatus.reason,
                            isSafetyLock ? 'warning' : 'error'
                        );
                    } else if (controlStatus.state !== previousState) {
                        const entered = controlStatus.state === 'manual';
                        pushNotification(
                            '地面控制',
                            entered ? '已进入手操并确认解锁' : '已归零并确认上锁',
                            entered ? 'success' : 'warning'
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
        const isLeakRtlAck = command_type === 'CMD_SET_MODE'
            && request_id
            && request_id === leakAlert.rtlRequestId;

        if (isLeakRtlAck) {
            clearLeakRtlTimeout();
            leakAlert.rtlRequestId = null;
            leakAlert.rtlStatus = success ? 'SUCCESS' : 'ERROR';
            leakAlert.rtlMessage = success
                ? '返航指令已接受'
                : (message || '返航指令执行失败');
            pushNotification(
                success ? '漏水返航' : '返航失败',
                leakAlert.rtlMessage,
                success ? 'success' : 'error'
            );
            return;
        }

        if (success) {
            if (command_type !== 'CMD_MANUAL_CONTROL' && command_type !== 'CMD_SET_RELAY' && command_type !== 'CMD_GET_RECENT_LOGS') {
                pushNotification('指令成功', message || '指令执行成功', 'success');
            }
            if (command_type === 'CMD_DOWNLOAD_MISSION' && payload.mission_items) {
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
        } else {
            pushNotification('指令失败', message, 'error');
        }
    }

    function processDownloadedMission(items) {
        if (!items) { // 允许空任务
            mission.plannedWaypoints = [];
            mission.progress.total = 0;
            mission.progress.current = 0;
            pushNotification('任务信息', '飞控上无任务', 'info');
            return;
        }
        
        const validPoints = [];
        items.forEach((item) => {
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
        if (validPoints.length > 0) {
            pushNotification('任务加载', `已从飞控加载 ${validPoints.length} 个航点`, 'success');
        } else {
            pushNotification('任务信息', '飞控上无有效航点', 'info');
        }
    }

    function sendPacket(type, payload) {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            if (type !== 'CMD_MANUAL_CONTROL') {
                pushNotification('连接警告', '未连接到后端服务', 'warning');
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
        socket.send(JSON.stringify(packet));
        return requestId;
    }

    function requestLeakReturn() {
        if (leakAlert.rtlStatus === 'PENDING') return false;
        if (!isWsConnected.value) {
            pushNotification('返航失败', '后端通信已断开，无法执行返航', 'error');
            return false;
        }
        if (!vehicle.connected) {
            pushNotification('返航失败', 'PX4 未连接，无法执行返航', 'error');
            return false;
        }
        if (!vehicle.armed) {
            pushNotification('返航提示', '当前未解锁，无法执行返航', 'warning');
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
            leakAlert.rtlRequestId = null;
            leakAlert.rtlStatus = 'ERROR';
            leakAlert.rtlMessage = '返航请求超时，请重试';
            pushNotification('返航超时', leakAlert.rtlMessage, 'error');
            leakRtlTimeout = null;
        }, 3000);
        return true;
    }

    function sendSimplePacket(type, fields = {}) {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            if (type !== 'control' && type !== 'heartbeat') {
                pushNotification('连接警告', '未连接到后端服务', 'warning');
            }
            return false;
        }
        socket.send(JSON.stringify({type, ...fields}));
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
        setTimeout(() => {
            mapTriggers.clearMap = false
        }, 100);
    }

    // --- 新增: 清除轨迹 ---
    function clearTrajectory() {
        vehicle.trajectory = [];
        pushNotification('操作成功', '轨迹已清除', 'success');
    }

    // --- 新增: 继电器控制 ---
    function setRelay(state) {
        if (state && vehicle.battery.is_low_battery_rtl_triggered) {
            pushNotification('操作被阻止', '低电量返航中，禁止开启混合搅拌器', 'warning');
            return;
        }
        sendPacket('CMD_SET_RELAY', {state: state ? 1 : 0});
    }
    
    // --- 区域规划相关 ---
    function setPlannerMode(mode) {
        plannerMode.value = mode;
        if (mode === 'manual') {
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
            sendPacket('CMD_SHUTDOWN_PI', {});
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
            sendPacket('CMD_SHUTDOWN_FCU', {});
        }).catch(() => {});
    }

    return {
        vehicle,
        mission,
        mapTriggers,
        sysLogs,
        plannerMode,
        areaPoints,
        notificationLogs,
        controlStatus,
        leakAlert,
        isWsConnected,
        wsUrl,

        connectWebSocket,
        changeWsUrl,
        sendPacket,
        requestManual,
        requestLocked,
        sendManualControl,
        requestLeakReturn,
        startLeakAlertWatchdog,
        stopLeakAlertWatchdog,
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

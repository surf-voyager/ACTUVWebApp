export const NOTIFICATION_TITLES = Object.freeze({
    onboard: '机载服务',
    flightController: '飞控连接',
    mission: '任务管理',
    geofence: '地理围栏',
    groundControl: '地面控制',
    returnHome: '返航',
    safety: '安全告警',
    parameter: '参数设置',
    ntrip: '差分定位',
    system: '系统控制'
});

const MODE_NAMES = Object.freeze({
    FOLLOW: '跟随模式（FOLLOW）',
    HOLD: '保持模式（HOLD）',
    MANUAL: '手动模式（MANUAL）',
    MISSION: '任务模式（MISSION）',
    OFFBOARD: '外部控制模式（OFFBOARD）',
    RTL: '返航模式（RTL）'
});

const COMMAND_TITLES = Object.freeze({
    CMD_CONNECT_VEHICLE: NOTIFICATION_TITLES.flightController,
    CMD_GET_RECENT_LOGS: NOTIFICATION_TITLES.onboard,
    CMD_ARM: NOTIFICATION_TITLES.groundControl,
    CMD_DISARM: NOTIFICATION_TITLES.groundControl,
    CMD_SET_MODE: NOTIFICATION_TITLES.groundControl,
    CMD_SET_OFFBOARD_SUBMODE: NOTIFICATION_TITLES.groundControl,
    CMD_FOLLOW_TARGET: NOTIFICATION_TITLES.groundControl,
    CMD_MISSION_CONTROL: NOTIFICATION_TITLES.mission,
    CMD_UPLOAD_MISSION: NOTIFICATION_TITLES.mission,
    CMD_DOWNLOAD_MISSION: NOTIFICATION_TITLES.mission,
    CMD_CLEAR_MISSION: NOTIFICATION_TITLES.mission,
    CMD_SET_HOME: NOTIFICATION_TITLES.returnHome,
    CMD_RETURN_HOME: NOTIFICATION_TITLES.returnHome,
    CMD_SET_BATTERY_THRESHOLD: NOTIFICATION_TITLES.parameter,
    CMD_SET_WAYPOINT_ACCEPTANCE_RADIUS: NOTIFICATION_TITLES.parameter,
    CMD_UPLOAD_GEOFENCE: NOTIFICATION_TITLES.geofence,
    CMD_DOWNLOAD_GEOFENCE: NOTIFICATION_TITLES.geofence,
    CMD_CLEAR_GEOFENCE: NOTIFICATION_TITLES.geofence,
    CMD_REBOOT: NOTIFICATION_TITLES.system,
    CMD_CLEAR_OPERATIONAL_LOGS: NOTIFICATION_TITLES.system,
    CMD_POWER_OFF_ONBOARD_SYSTEM: NOTIFICATION_TITLES.system,
    CMD_SET_RELAY: NOTIFICATION_TITLES.system
});

const SILENT_SUCCESS_COMMANDS = new Set([
    'CMD_CONNECT_VEHICLE',
    'CMD_GET_RECENT_LOGS',
    'CMD_QUERY_INFO',
    'CMD_DOWNLOAD_MISSION',
    'CMD_SET_RELAY'
]);

const COMMAND_FAILURE_MESSAGES = Object.freeze({
    CMD_ARM: '飞控解锁失败',
    CMD_DISARM: '飞控上锁失败',
    CMD_SET_MODE: '飞控模式切换失败',
    CMD_SET_OFFBOARD_SUBMODE: '外部控制子模式切换失败',
    CMD_FOLLOW_TARGET: '目标点指令执行失败',
    CMD_MISSION_CONTROL: '任务控制失败',
    CMD_UPLOAD_MISSION: '任务上传失败',
    CMD_DOWNLOAD_MISSION: '任务同步失败',
    CMD_CLEAR_MISSION: '任务清空失败',
    CMD_SET_HOME: '返航点设置失败',
    CMD_RETURN_HOME: '返航失败',
    CMD_SET_BATTERY_THRESHOLD: '低电压返航阈值设置失败',
    CMD_SET_WAYPOINT_ACCEPTANCE_RADIUS: '航点接受半径配置失败',
    CMD_UPLOAD_GEOFENCE: '地理围栏发送失败',
    CMD_DOWNLOAD_GEOFENCE: '地理围栏读取失败',
    CMD_CLEAR_GEOFENCE: '地理围栏清空失败',
    CMD_REBOOT: '飞控重启失败',
    CMD_CLEAR_OPERATIONAL_LOGS: '运行日志清理失败',
    CMD_POWER_OFF_ONBOARD_SYSTEM: '机载系统断电失败',
    CMD_SET_RELAY: '混合器控制失败'
});

export function localizeBackendError(message, fallback = '操作失败') {
    const detail = String(message || '').trim();
    return /[\u3400-\u9fff]/u.test(detail) && !/[A-Za-z]{4,}/.test(detail)
        ? detail
        : fallback;
}

function modeName(mode) {
    const normalized = String(mode || '').toUpperCase();
    return MODE_NAMES[normalized] || `模式 ${normalized || '未知'}`;
}

function missionControlSuccess(action, requestPayload) {
    switch (String(action || '').toUpperCase()) {
        case 'PAUSE':
            return '任务已暂停';
        case 'RESUME':
            return '任务已恢复';
        case 'RESET':
            return '任务进度已重置';
        case 'SET_INDEX': {
            const index = Number(requestPayload?.index);
            return Number.isInteger(index) ? `任务目标已切换至第 ${index + 1} 个航点` : '任务目标航点已更新';
        }
        default:
            return '任务控制指令已执行';
    }
}

export function commandNotificationTitle(commandType) {
    return COMMAND_TITLES[commandType] || NOTIFICATION_TITLES.system;
}

export function formatCommandAck({commandType, success, message, requestPayload = {}, silentSuccess = false}) {
    const title = commandNotificationTitle(commandType);
    if (!success) {
        return {
            title,
            message: localizeBackendError(
                message,
                COMMAND_FAILURE_MESSAGES[commandType] || '操作失败'
            ),
            type: 'error'
        };
    }

    if (silentSuccess || SILENT_SUCCESS_COMMANDS.has(commandType)) return null;

    let displayMessage;
    switch (commandType) {
        case 'CMD_ARM':
            displayMessage = '飞控已确认解锁';
            break;
        case 'CMD_DISARM':
            displayMessage = '飞控已确认上锁';
            break;
        case 'CMD_SET_MODE':
            displayMessage = `飞控已切换至${modeName(requestPayload.mode)}`;
            break;
        case 'CMD_SET_OFFBOARD_SUBMODE':
            displayMessage = `外部控制子模式已切换至 ${requestPayload.submode || 'STEADY'}`;
            break;
        case 'CMD_FOLLOW_TARGET':
            displayMessage = '飞控已接受目标点指令';
            break;
        case 'CMD_MISSION_CONTROL':
            displayMessage = missionControlSuccess(requestPayload.action, requestPayload);
            break;
        case 'CMD_UPLOAD_MISSION': {
            const count = Array.isArray(requestPayload.mission_items) ? requestPayload.mission_items.length : 0;
            displayMessage = `飞控已确认接收 ${count} 个航点`;
            break;
        }
        case 'CMD_SET_HOME':
            displayMessage = '飞控已确认更新返航点';
            break;
        case 'CMD_SET_BATTERY_THRESHOLD':
            displayMessage = Number(requestPayload.threshold_voltage_v) === 0
                ? '低电压告警已禁用'
                : `低电压返航阈值已设为 ${Number(requestPayload.threshold_voltage_v).toFixed(1)} V`;
            break;
        case 'CMD_REBOOT':
            displayMessage = '飞控重启指令已发送';
            break;
        case 'CMD_CLEAR_OPERATIONAL_LOGS':
            displayMessage = '已清理关闭的运行日志';
            break;
        case 'CMD_POWER_OFF_ONBOARD_SYSTEM':
            displayMessage = 'BMS 已确认关闭放电指令';
            break;
        default:
            displayMessage = '操作已完成';
    }

    return {title, message: displayMessage, type: 'success'};
}

export function summarizeMissionSync(receivedCount, validCount) {
    const received = Math.max(0, Number(receivedCount) || 0);
    const valid = Math.max(0, Number(validCount) || 0);
    if (received === 0) {
        return {message: '飞控中没有任务航点', type: 'info'};
    }
    if (valid === 0) {
        return {
            message: `收到 ${received} 个任务项，但未发现有效航点`,
            type: 'warning'
        };
    }
    const skipped = Math.max(0, received - valid);
    if (skipped > 0) {
        return {
            message: `已加载 ${valid} 个有效航点，忽略 ${skipped} 个无效任务项`,
            type: 'warning'
        };
    }
    return {message: `已从飞控加载 ${valid} 个航点`, type: 'success'};
}

import crypto from 'node:crypto'
import ssh2 from 'ssh2'

import {
  BACKEND_MAINTENANCE_ACTIONS,
  BACKEND_MAINTENANCE_EVENT,
  extractWebSocketHost,
} from '../src/services/backendMaintenance.js'

const { Client } = ssh2

// Server-side only. Vite does not expose this module or these credentials to the browser bundle.
const SSH_PORT = 22
const SSH_USERNAME = 'actuvpi'
const SSH_PASSWORD = 'a12345678'
const SSH_READY_TIMEOUT_MS = 10_000
const SSH_TEST_COMMAND_TIMEOUT_MS = 8_000
const CHECK_COMMAND_TIMEOUT_MS = 15_000
const RESTART_COMMAND_TIMEOUT_MS = 55_000
const MAX_COMMAND_OUTPUT_BYTES = 512 * 1024

export const BACKEND_MAINTENANCE_REMOTE_SCRIPT = `set -u

ACTION="\${1:-check}"
BACKEND_DIR='/home/actuvpi/ACTUVPi'
BACKEND_SCRIPT='/home/actuvpi/ACTUVPi/backend.py'
BACKEND_PORT='8765'
BACKEND_SERVICE='actuv-backend.service'
MAVSDK_GRPC_PORT='50051'
MAVSDK_UDP_PORT='1457'
MAVSDK_ADDRESS='udpin://0.0.0.0:1457'
ROUTER_SERVICE='actuv-mavlink-router.service'
ROUTER_TCP_PORT='5760'
ROUTER_PX4_PORT='1456'
ROUTER_QGC_PORT='14550'
ROUTER_TEST_PORT='14600'
HEALTH_FILE='/home/actuvpi/ACTUVPi/.backend-health'
HEALTH_MAX_AGE_SECONDS='5'

find_backend_pids() {
    local proc pid comm cwd arg matched
    for proc in /proc/[0-9]*; do
        pid="\${proc##*/}"
        comm="$(cat "\${proc}/comm" 2>/dev/null)" || continue
        case "\${comm}" in python|python[0-9]*|pypy|pypy[0-9]*) ;; *) continue ;; esac
        cwd="$(readlink -f "\${proc}/cwd" 2>/dev/null)" || cwd=''
        matched=false
        while IFS= read -r -d '' arg; do
            if [[ "\${arg}" == "\${BACKEND_SCRIPT}" ]] \
                || { [[ "\${cwd}" == "\${BACKEND_DIR}" ]] \
                    && [[ "\${arg}" == 'backend.py' || "\${arg}" == './backend.py' ]]; }; then
                matched=true
                break
            fi
        done < "\${proc}/cmdline"
        [[ "\${matched}" == true ]] && printf '%s\n' "\${pid}"
    done
}

find_mavsdk_pids() {
    local proc pid comm arg previous matched
    for proc in /proc/[0-9]*; do
        pid="\${proc##*/}"
        comm="$(cat "\${proc}/comm" 2>/dev/null)" || continue
        [[ "\${comm}" == 'mavsdk_server' ]] || continue
        previous=''
        matched=false
        while IFS= read -r -d '' arg; do
            if [[ "\${arg}" == "\${MAVSDK_ADDRESS}" ]] \
                || [[ "\${previous}" == '-p' && "\${arg}" == "\${MAVSDK_GRPC_PORT}" ]]; then
                matched=true
            fi
            previous="\${arg}"
        done < "\${proc}/cmdline"
        [[ "\${matched}" == true ]] && printf '%s\n' "\${pid}"
    done
}

tcp_port_is_listening() {
    local port="$1"
    ss -H -ltn 2>/dev/null \
        | awk -v suffix=":\${port}" '$4 ~ suffix "$" { found=1 } END { exit !found }'
}

udp_port_is_bound() {
    local port="$1"
    ss -H -lun 2>/dev/null \
        | awk -v suffix=":\${port}" '$4 ~ suffix "$" { found=1 } END { exit !found }'
}

find_runtime_port_owner_pids() {
    ss -H -ltnup 2>/dev/null \
        | awk -v backend=":\${BACKEND_PORT}" -v grpc=":\${MAVSDK_GRPC_PORT}" -v udp=":\${MAVSDK_UDP_PORT}" \
            '$4 ~ backend "$" || $4 ~ grpc "$" || $4 ~ udp "$"' \
        | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -un || true
}

find_runtime_pids() {
    { find_backend_pids; find_mavsdk_pids; find_runtime_port_owner_pids; } | sort -un
}

health_value() {
    local key="$1"
    [[ -r "\${HEALTH_FILE}" ]] || return 1
    awk -F= -v key="\${key}" '$1 == key { print $2; found=1; exit } END { exit !found }' "\${HEALTH_FILE}"
}

router_is_ready() {
    systemctl --user is-active --quiet "\${ROUTER_SERVICE}" \
        && tcp_port_is_listening "\${ROUTER_TCP_PORT}" \
        && udp_port_is_bound "\${ROUTER_PX4_PORT}" \
        && udp_port_is_bound "\${ROUTER_QGC_PORT}" \
        && udp_port_is_bound "\${ROUTER_TEST_PORT}"
}

telemetry_is_fresh() {
    local connected last_telemetry now age
    connected="$(health_value connected 2>/dev/null)" || return 1
    last_telemetry="$(health_value last_telemetry_epoch 2>/dev/null)" || return 1
    [[ "\${connected}" == '1' ]] || return 1
    [[ "\${last_telemetry}" =~ ^[0-9]+([.][0-9]+)?$ ]] || return 1
    now="$(date +%s)"
    age="\${last_telemetry%%.*}"
    ((now - age <= HEALTH_MAX_AGE_SECONDS))
}

collectors_are_healthy() {
    local active total
    active="$(health_value collector_active 2>/dev/null)" || return 1
    total="$(health_value collector_total 2>/dev/null)" || return 1
    [[ "\${active}" =~ ^[0-9]+$ && "\${total}" =~ ^[0-9]+$ ]] || return 1
    ((total > 0 && active == total))
}

runtime_ports_are_clear() {
    ! tcp_port_is_listening "\${BACKEND_PORT}" \
        && ! tcp_port_is_listening "\${MAVSDK_GRPC_PORT}" \
        && ! udp_port_is_bound "\${MAVSDK_UDP_PORT}"
}

runtime_base_is_ready() {
    local -a backend_pids=() mavsdk_pids=()
    mapfile -t backend_pids < <(find_backend_pids)
    mapfile -t mavsdk_pids < <(find_mavsdk_pids)
    systemctl --user is-active --quiet "\${BACKEND_SERVICE}" \
        && ((\${#backend_pids[@]} == 1)) \
        && ((\${#mavsdk_pids[@]} == 1)) \
        && router_is_ready \
        && tcp_port_is_listening "\${BACKEND_PORT}" \
        && tcp_port_is_listening "\${MAVSDK_GRPC_PORT}" \
        && udp_port_is_bound "\${MAVSDK_UDP_PORT}"
}

join_csv() {
    local first=true value
    for value in "$@"; do
        [[ "\${first}" == true ]] || printf ','
        printf '%s' "\${value}"
        first=false
    done
}

bool_value() { "$@" >/dev/null 2>&1 && printf '1' || printf '0'; }

snapshot() {
    local label="$1" now last age
    local -a backend_pids=() mavsdk_pids=()
    mapfile -t backend_pids < <(find_backend_pids)
    mapfile -t mavsdk_pids < <(find_mavsdk_pids)
    now="$(date +%s)"
    last="$(health_value last_telemetry_epoch 2>/dev/null || true)"
    age=''
    if [[ "\${last}" =~ ^[0-9]+([.][0-9]+)?$ ]]; then age="$((now - \${last%%.*}))"; fi

    printf 'ACTUV_SNAPSHOT_BEGIN %s\n' "\${label}"
    printf 'router_service_active=%s\n' "$(bool_value systemctl --user is-active --quiet "\${ROUTER_SERVICE}")"
    printf 'router_tcp_5760=%s\n' "$(bool_value tcp_port_is_listening "\${ROUTER_TCP_PORT}")"
    printf 'router_udp_1456=%s\n' "$(bool_value udp_port_is_bound "\${ROUTER_PX4_PORT}")"
    printf 'router_udp_14550=%s\n' "$(bool_value udp_port_is_bound "\${ROUTER_QGC_PORT}")"
    printf 'router_udp_14600=%s\n' "$(bool_value udp_port_is_bound "\${ROUTER_TEST_PORT}")"
    printf 'backend_service_active=%s\n' "$(bool_value systemctl --user is-active --quiet "\${BACKEND_SERVICE}")"
    printf 'backend_process_count=%s\n' "\${#backend_pids[@]}"
    printf 'backend_pids='; join_csv "\${backend_pids[@]}"; printf '\n'
    printf 'backend_tcp_8765=%s\n' "$(bool_value tcp_port_is_listening "\${BACKEND_PORT}")"
    printf 'mavsdk_process_count=%s\n' "\${#mavsdk_pids[@]}"
    printf 'mavsdk_pids='; join_csv "\${mavsdk_pids[@]}"; printf '\n'
    printf 'mavsdk_udp_1457=%s\n' "$(bool_value udp_port_is_bound "\${MAVSDK_UDP_PORT}")"
    printf 'mavsdk_tcp_50051=%s\n' "$(bool_value tcp_port_is_listening "\${MAVSDK_GRPC_PORT}")"
    printf 'px4_connected=%s\n' "$(health_value connected 2>/dev/null || printf '0')"
    printf 'px4_telemetry_fresh=%s\n' "$(bool_value telemetry_is_fresh)"
    printf 'px4_telemetry_age=%s\n' "\${age}"
    printf 'reconnect_count=%s\n' "$(health_value reconnect_count 2>/dev/null || true)"
    printf 'collector_active=%s\n' "$(health_value collector_active 2>/dev/null || true)"
    printf 'collector_total=%s\n' "$(health_value collector_total 2>/dev/null || true)"
    printf 'ACTUV_SNAPSHOT_END %s\n' "\${label}"
}

progress() { printf 'ACTUV_PROGRESS %s\n' "$1"; }

cleanup_runtime() {
    local -a pids=() survivors=()
    local attempt
    systemctl --user stop "\${BACKEND_SERVICE}" 2>/dev/null || true
    mapfile -t pids < <(find_runtime_pids)
    ((\${#pids[@]} == 0)) || kill -TERM "\${pids[@]}" 2>/dev/null || true
    for attempt in $(seq 1 20); do
        mapfile -t survivors < <(find_runtime_pids)
        if ((\${#survivors[@]} == 0)) && runtime_ports_are_clear; then
            rm -f "\${HEALTH_FILE}" "\${HEALTH_FILE}.tmp"
            return 0
        fi
        sleep 0.5
    done
    mapfile -t survivors < <(find_runtime_pids)
    ((\${#survivors[@]} == 0)) || kill -KILL "\${survivors[@]}" 2>/dev/null || true
    for attempt in $(seq 1 10); do
        mapfile -t survivors < <(find_runtime_pids)
        if ((\${#survivors[@]} == 0)) && runtime_ports_are_clear; then
            rm -f "\${HEALTH_FILE}" "\${HEALTH_FILE}.tmp"
            return 0
        fi
        sleep 0.5
    done
    return 1
}

if [[ "\${ACTION}" == 'check' ]]; then
    snapshot 'current'
    exit 0
fi

if [[ "\${ACTION}" != 'restart' ]]; then
    printf 'ACTUV_OUTCOME invalid_action\n'
    exit 2
fi

progress 'precheck'
snapshot 'before'
if ! router_is_ready; then
    printf 'ACTUV_OUTCOME blocked_router\n'
    exit 20
fi

progress 'stopping'
if ! cleanup_runtime; then
    snapshot 'after'
    printf 'ACTUV_OUTCOME cleanup_failed\n'
    exit 21
fi

progress 'starting'
systemctl --user reset-failed "\${BACKEND_SERVICE}" 2>/dev/null || true
if ! systemctl --user start "\${BACKEND_SERVICE}"; then
    snapshot 'after'
    printf 'ACTUV_OUTCOME start_failed\n'
    exit 22
fi

progress 'waiting_runtime'
outcome='runtime_failed'
for attempt in $(seq 1 20); do
    if runtime_base_is_ready; then
        if telemetry_is_fresh; then
            if collectors_are_healthy; then outcome='healthy'; else outcome='collectors_unhealthy'; fi
            break
        fi
        outcome='degraded_no_telemetry'
    fi
    sleep 1
done

if [[ "\${outcome}" == 'runtime_failed' ]]; then
    progress 'cleanup_failed_runtime'
    cleanup_runtime || true
fi
snapshot 'after'
printf 'ACTUV_OUTCOME %s\n' "\${outcome}"
[[ "\${outcome}" != 'runtime_failed' ]]
`

function publicError(error) {
  const text = String(error?.message || error || '未知错误').slice(0, 300)
  if (error?.level === 'client-authentication') {
    return { code: 'auth_failed', message: 'SSH 认证失败，请检查桥接服务中的账号密码' }
  }
  if (error?.code === 'ETIMEDOUT' || /timed out|timeout/i.test(text)) {
    return { code: 'timeout', message: 'SSH 连接或远程操作超时' }
  }
  if (error?.code === 'ECONNREFUSED') {
    return { code: 'connection_refused', message: '目标地址拒绝 SSH 连接' }
  }
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(error?.code)) {
    return { code: 'host_not_found', message: '无法解析当前 WebSocket 地址中的主机' }
  }
  return { code: 'ssh_error', message: text }
}

function parseScalar(value) {
  if (/^-?\d+$/.test(value)) return Number(value)
  return value
}

export function parseMaintenanceOutput(output) {
  const snapshots = {}
  const progress = []
  let current = null
  let outcome = null
  for (const rawLine of String(output || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.startsWith('ACTUV_SNAPSHOT_BEGIN ')) {
      current = line.slice('ACTUV_SNAPSHOT_BEGIN '.length)
      snapshots[current] = {}
      continue
    }
    if (line.startsWith('ACTUV_SNAPSHOT_END ')) {
      current = null
      continue
    }
    if (line.startsWith('ACTUV_PROGRESS ')) {
      progress.push(line.slice('ACTUV_PROGRESS '.length))
      continue
    }
    if (line.startsWith('ACTUV_OUTCOME ')) {
      outcome = line.slice('ACTUV_OUTCOME '.length)
      continue
    }
    if (current) {
      const separator = line.indexOf('=')
      if (separator >= 0) snapshots[current][line.slice(0, separator)] = parseScalar(line.slice(separator + 1))
    }
  }
  return { snapshots, progress, outcome }
}

function pidList(value) {
  if (!value) return []
  return String(value).split(',').map(Number).filter(Number.isInteger)
}

function asBoolean(value) {
  return value === true || value === 1
}

export function buildHealthSnapshot(raw = {}) {
  const routerHealthy = asBoolean(raw.router_service_active)
    && asBoolean(raw.router_tcp_5760)
    && asBoolean(raw.router_udp_1456)
    && asBoolean(raw.router_udp_14550)
    && asBoolean(raw.router_udp_14600)
  const backendHealthy = asBoolean(raw.backend_service_active)
    && raw.backend_process_count === 1
    && asBoolean(raw.backend_tcp_8765)
  const mavsdkHealthy = raw.mavsdk_process_count === 1
    && asBoolean(raw.mavsdk_udp_1457)
    && asBoolean(raw.mavsdk_tcp_50051)
  const telemetryFresh = asBoolean(raw.px4_telemetry_fresh)
  const collectorsHealthy = Number.isInteger(raw.collector_active)
    && raw.collector_active > 0
    && raw.collector_active === raw.collector_total
  const baseHealthy = routerHealthy && backendHealthy && mavsdkHealthy
  const level = !baseHealthy || (telemetryFresh && !collectorsHealthy)
    ? 'unhealthy'
    : telemetryFresh
      ? 'healthy'
      : 'degraded'
  return {
    level,
    router: { healthy: routerHealthy },
    backend: {
      healthy: backendHealthy,
      service_active: asBoolean(raw.backend_service_active),
      process_count: Number(raw.backend_process_count) || 0,
      pids: pidList(raw.backend_pids),
      websocket_port: asBoolean(raw.backend_tcp_8765),
    },
    mavsdk: {
      healthy: mavsdkHealthy,
      process_count: Number(raw.mavsdk_process_count) || 0,
      pids: pidList(raw.mavsdk_pids),
      udp_port: asBoolean(raw.mavsdk_udp_1457),
      grpc_port: asBoolean(raw.mavsdk_tcp_50051),
    },
    px4: {
      connected: asBoolean(raw.px4_connected),
      fresh: telemetryFresh,
      age_seconds: Number.isInteger(raw.px4_telemetry_age) ? raw.px4_telemetry_age : null,
      reconnect_count: Number.isInteger(raw.reconnect_count) ? raw.reconnect_count : null,
    },
    collectors: {
      healthy: collectorsHealthy,
      active: Number.isInteger(raw.collector_active) ? raw.collector_active : null,
      total: Number.isInteger(raw.collector_total) ? raw.collector_total : null,
    },
  }
}

export function execute(conn, command, input, timeoutMs, onLine = () => {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    let lineBuffer = ''
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error) reject(error)
      else resolve(result)
    }
    const timeout = setTimeout(() => finish(Object.assign(new Error('remote command timeout'), { code: 'ETIMEDOUT' })), timeoutMs)
    conn.exec(command, (error, stream) => {
      if (error) return finish(error)
      stream.setEncoding('utf8')
      stream.on('data', (chunk) => {
        stdout = (stdout + chunk).slice(-MAX_COMMAND_OUTPUT_BYTES)
        lineBuffer += chunk
        let newline
        while ((newline = lineBuffer.indexOf('\n')) >= 0) {
          const line = lineBuffer.slice(0, newline).trim()
          lineBuffer = lineBuffer.slice(newline + 1)
          if (line) onLine(line)
        }
      })
      stream.stderr.setEncoding('utf8')
      stream.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-32_768) })
      stream.once('close', (code, signal) => finish(null, { code: code ?? 0, signal, stdout, stderr }))
      stream.once('error', finish)
      if (input) stream.end(input)
      else stream.end()
    })
  })
}

export function connectSsh(host) {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    let fingerprint = ''
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      conn.end()
      reject(Object.assign(new Error('SSH connection timeout'), { code: 'ETIMEDOUT' }))
    }, SSH_READY_TIMEOUT_MS + 1_000)
    conn.once('ready', () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ conn, fingerprint })
    })
    conn.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    conn.connect({
      host,
      port: SSH_PORT,
      username: SSH_USERNAME,
      password: SSH_PASSWORD,
      readyTimeout: SSH_READY_TIMEOUT_MS,
      keepaliveInterval: 3_000,
      keepaliveCountMax: 2,
      hostVerifier(key) {
        fingerprint = crypto.createHash('sha256').update(key).digest('base64')
        return true
      },
    })
  })
}

export async function verifyRaspberryPi(conn) {
  const command = "model=$(tr -d '\\000' </proc/device-tree/model 2>/dev/null || true); printf 'model=%s\\nhostname=%s\\nuser=%s\\n' \"$model\" \"$(hostname)\" \"$(id -un)\""
  const result = await execute(conn, command, '', SSH_TEST_COMMAND_TIMEOUT_MS)
  if (result.code !== 0) throw new Error(result.stderr || '无法读取远端设备信息')
  const info = {}
  for (const line of result.stdout.split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator >= 0) info[line.slice(0, separator)] = line.slice(separator + 1)
  }
  if (!/raspberry pi/i.test(String(info.model || ''))) {
    const error = new Error('SSH 已连接，但目标设备不是 Raspberry Pi')
    error.code = 'NOT_RASPBERRY_PI'
    throw error
  }
  return info
}

function send(client, payload) {
  try { client.send(BACKEND_MAINTENANCE_EVENT, payload) } catch { /* client disconnected */ }
}

function progressMessage(stage) {
  return {
    precheck: '正在执行重启前健康检查…',
    stopping: '正在停止并清理后端与 MAVSDK…',
    starting: '正在启动后端服务…',
    waiting_runtime: '后端已启动，正在等待端口和 PX4 遥测…',
    cleanup_failed_runtime: '启动未达到基本健康条件，正在清理残留…',
  }[stage] || '正在执行远程运维操作…'
}

export function backendMaintenanceBridgePlugin() {
  let activeOperation = null
  const validatedHosts = new WeakMap()
  return {
    name: 'actuv-backend-maintenance-bridge',
    apply: 'serve',
    configureServer(server) {
      const run = async (action, data, client) => {
        const requestId = String(data?.request_id || '')
        if (!requestId) return
        const host = extractWebSocketHost(data?.ws_url)
        if (!host) {
          send(client, { request_id: requestId, action, phase: 'error', code: 'invalid_ws_url', message: '当前 WebSocket 地址无效' })
          return
        }
        if (activeOperation) {
          send(client, { request_id: requestId, action, phase: 'error', code: 'busy', message: '已有运维任务执行中，请稍后重试' })
          return
        }
        if (action !== BACKEND_MAINTENANCE_ACTIONS.SSH_TEST && validatedHosts.get(client) !== host) {
          send(client, { request_id: requestId, action, phase: 'error', code: 'ssh_test_required', message: '请先完成当前地址的 SSH 连接测试' })
          return
        }

        activeOperation = { action, requestId, host }
        send(client, { request_id: requestId, action, phase: 'running', stage: 'connecting', message: `正在连接 ${host}:${SSH_PORT}…` })
        let conn
        const startedAt = Date.now()
        try {
          const connected = await connectSsh(host)
          conn = connected.conn
          const device = await verifyRaspberryPi(conn)
          const connection = {
            host,
            port: SSH_PORT,
            hostname: device.hostname,
            model: device.model,
            user: device.user,
            fingerprint_sha256: connected.fingerprint,
            latency_ms: Date.now() - startedAt,
          }
          if (action === BACKEND_MAINTENANCE_ACTIONS.SSH_TEST) {
            validatedHosts.set(client, host)
            send(client, { request_id: requestId, action, phase: 'success', message: 'SSH 连接成功，已确认目标为 Raspberry Pi', connection })
            return
          }

          send(client, { request_id: requestId, action, phase: 'running', stage: action === 'check' ? 'checking' : 'precheck', message: action === 'check' ? '正在检查后端服务…' : '正在执行重启前健康检查…' })
          const result = await execute(
            conn,
            `bash -s -- ${action}`,
            BACKEND_MAINTENANCE_REMOTE_SCRIPT,
            action === 'restart' ? RESTART_COMMAND_TIMEOUT_MS : CHECK_COMMAND_TIMEOUT_MS,
            (line) => {
              if (!line.startsWith('ACTUV_PROGRESS ')) return
              const stage = line.slice('ACTUV_PROGRESS '.length)
              send(client, { request_id: requestId, action, phase: 'running', stage, message: progressMessage(stage) })
            },
          )
          const parsed = parseMaintenanceOutput(result.stdout)
          if (action === BACKEND_MAINTENANCE_ACTIONS.CHECK) {
            const health = buildHealthSnapshot(parsed.snapshots.current)
            send(client, {
              request_id: requestId,
              action,
              phase: 'success',
              message: health.level === 'healthy'
                ? '后端及 PX4 通信运行正常'
                : health.level === 'degraded'
                  ? '后端运行正常，但 PX4 遥测异常'
                  : '后端服务存在异常',
              connection,
              health,
            })
            return
          }

          const before = parsed.snapshots.before ? buildHealthSnapshot(parsed.snapshots.before) : null
          const after = parsed.snapshots.after ? buildHealthSnapshot(parsed.snapshots.after) : null
          const outcome = parsed.outcome || 'unknown'
          const outcomeMessages = {
            healthy: '后端重启成功，PX4 遥测正常',
            degraded_no_telemetry: '后端重启成功，但 PX4 遥测异常；后端已保留运行',
            collectors_unhealthy: '后端已重启，但采集器状态异常',
            blocked_router: 'MAVLink 路由服务异常，已停止重启操作',
            cleanup_failed: '无法完全清理旧后端、MAVSDK 进程或端口',
            start_failed: '后端 systemd 服务启动失败',
            runtime_failed: '后端启动未达到基本健康条件，残留运行环境已清理',
          }
          const success = ['healthy', 'degraded_no_telemetry'].includes(outcome)
          send(client, {
            request_id: requestId,
            action,
            phase: success ? 'success' : 'error',
            code: outcome,
            message: outcomeMessages[outcome] || result.stderr || '后端重启结果未知',
            connection,
            before,
            after,
            outcome,
          })
        } catch (error) {
          if (error?.code === 'NOT_RASPBERRY_PI') {
            send(client, { request_id: requestId, action, phase: 'error', code: 'not_raspberry_pi', message: error.message })
          } else {
            const publicResult = publicError(error)
            send(client, { request_id: requestId, action, phase: 'error', ...publicResult })
          }
        } finally {
          conn?.end()
          if (activeOperation?.requestId === requestId) activeOperation = null
        }
      }

      const handlers = {}
      for (const action of Object.values(BACKEND_MAINTENANCE_ACTIONS)) {
        const event = `backend-maintenance:${action}`
        handlers[event] = (data, client) => { void run(action, data, client) }
        server.ws.on(event, handlers[event])
      }
      server.httpServer?.once('close', () => {
        for (const [event, handler] of Object.entries(handlers)) server.ws.off(event, handler)
      })
    },
  }
}

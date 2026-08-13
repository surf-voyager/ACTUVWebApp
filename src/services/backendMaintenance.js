export const BACKEND_MAINTENANCE_EVENT = 'backend-maintenance:status'

export const BACKEND_MAINTENANCE_ACTIONS = Object.freeze({
  SSH_TEST: 'ssh-test',
  CHECK: 'check',
  RESTART: 'restart',
})

export function extractWebSocketHost(value) {
  let url
  try {
    url = new URL(String(value || '').trim())
  } catch {
    return null
  }
  if (!['ws:', 'wss:'].includes(url.protocol)) return null
  const hostname = String(url.hostname || '').replace(/^\[|\]$/g, '').trim()
  return hostname || null
}

export function createMaintenanceRequestId(action) {
  return `backend-maintenance-${action}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function maintenanceLevelLabel(level) {
  return {
    healthy: '运行正常',
    degraded: '降级运行',
    unhealthy: '运行异常',
  }[level] || '状态未知'
}

export function healthComponentRows(health) {
  if (!health) return []
  const router = health.router || {}
  const backend = health.backend || {}
  const mavsdk = health.mavsdk || {}
  const px4 = health.px4 || {}
  const collectors = health.collectors || {}
  return [
    {
      key: 'router',
      label: 'MAVLink 路由',
      ok: router.healthy === true,
      text: router.healthy ? '服务及端口正常' : '服务或端口异常',
    },
    {
      key: 'backend',
      label: '后端服务',
      ok: backend.healthy === true,
      text: backend.healthy
        ? `active · PID ${backend.pids?.join(', ') || '--'} · 8765 正常`
        : `${backend.service_active ? '服务 active' : '服务未运行'} · 进程 ${backend.process_count ?? 0} 个`,
    },
    {
      key: 'mavsdk',
      label: 'MAVSDK',
      ok: mavsdk.healthy === true,
      text: mavsdk.healthy
        ? `PID ${mavsdk.pids?.join(', ') || '--'} · 1457/50051 正常`
        : `进程 ${mavsdk.process_count ?? 0} 个 · 端口异常`,
    },
    {
      key: 'px4',
      label: 'PX4 遥测',
      ok: px4.fresh === true,
      warning: health.level === 'degraded' && px4.fresh !== true,
      text: px4.fresh
        ? `正常 · 数据年龄 ${px4.age_seconds ?? 0}s`
        : '未连接或遥测超过 5 秒未更新',
    },
    {
      key: 'collectors',
      label: '采集器',
      ok: collectors.healthy === true,
      warning: health.level === 'degraded' && px4.fresh !== true,
      text: `${collectors.active ?? '--'}/${collectors.total ?? '--'}${
        health.level === 'degraded' && px4.fresh !== true ? ' · 等待 PX4' : ''
      }`,
    },
  ]
}

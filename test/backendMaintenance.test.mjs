import test from 'node:test'
import assert from 'node:assert/strict'

import {
  extractWebSocketHost,
  healthComponentRows,
  maintenanceLevelLabel,
} from '../src/services/backendMaintenance.js'
import {
  buildHealthSnapshot,
  parseMaintenanceOutput,
} from '../tools/backendMaintenanceBridgePlugin.mjs'

test('extracts IPv4, hostname and IPv6 targets from WebSocket URLs', () => {
  assert.equal(extractWebSocketHost('ws://10.168.1.199:8765/'), '10.168.1.199')
  assert.equal(extractWebSocketHost('wss://pi.local/backend'), 'pi.local')
  assert.equal(extractWebSocketHost('ws://[fd00::10]:8765'), 'fd00::10')
  assert.equal(extractWebSocketHost('http://10.168.1.199'), null)
  assert.equal(extractWebSocketHost('broken'), null)
})

test('parses structured snapshots without treating remote text as commands', () => {
  const parsed = parseMaintenanceOutput(`
ACTUV_PROGRESS precheck
ACTUV_SNAPSHOT_BEGIN current
router_service_active=1
backend_process_count=1
backend_pids=12
collector_active=11
collector_total=11
ACTUV_SNAPSHOT_END current
ACTUV_OUTCOME healthy
`)
  assert.deepEqual(parsed.progress, ['precheck'])
  assert.equal(parsed.outcome, 'healthy')
  assert.equal(parsed.snapshots.current.router_service_active, 1)
  assert.equal(parsed.snapshots.current.backend_process_count, 1)
})

test('classifies missing PX4 telemetry as degraded while backend remains healthy', () => {
  const health = buildHealthSnapshot({
    router_service_active: true,
    router_tcp_5760: true,
    router_udp_1456: true,
    router_udp_14550: true,
    router_udp_14600: true,
    backend_service_active: true,
    backend_process_count: 1,
    backend_pids: '100',
    backend_tcp_8765: true,
    mavsdk_process_count: 1,
    mavsdk_pids: '101',
    mavsdk_udp_1457: true,
    mavsdk_tcp_50051: true,
    px4_connected: false,
    px4_telemetry_fresh: false,
    collector_active: 0,
    collector_total: 0,
  })
  assert.equal(health.level, 'degraded')
  assert.equal(maintenanceLevelLabel(health.level), '降级运行')
  assert.equal(healthComponentRows(health).find((row) => row.key === 'px4').warning, true)
})

test('classifies missing backend runtime as unhealthy', () => {
  const health = buildHealthSnapshot({})
  assert.equal(health.level, 'unhealthy')
})

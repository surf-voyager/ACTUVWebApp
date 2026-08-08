import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  buildGga,
  buildNtripRequest,
  normalizeNtripConfig,
  parseNtripResponseHeader,
  statusIsSuccessful,
} from './ntripProtocol.mjs'

const CONNECT_TIMEOUT_MS = 10_000
const GGA_INTERVAL_MS = 5_000
const RECONNECT_DELAYS_MS = [3_000, 5_000, 10_000, 20_000, 30_000]
const MAX_HEADER_BYTES = 65_536
const MAX_CHUNK_BYTES = 65_536

function isWsl() {
  return process.platform === 'linux' && /microsoft/i.test(os.release())
}

function publicError(error) {
  const code = error?.code ? `${error.code}: ` : ''
  return `${code}${error?.message || 'unknown error'}`.slice(0, 240)
}

export class NtripBridgeSession {
  constructor(client, helperPath, logger) {
    this.client = client
    this.helperPath = helperPath
    this.logger = logger
    this.config = null
    this.position = null
    this.socket = null
    this.child = null
    this.ggaTimer = null
    this.reconnectTimer = null
    this.reconnectAttempt = 0
    this.generation = 0
    this.preferWindowsTransport = false
    this.closed = false
  }

  send(event, payload) {
    try {
      this.client.send(event, payload)
    } catch {
      this.stop()
    }
  }

  setConfig(input) {
    try {
      this.config = normalizeNtripConfig(input)
    } catch (error) {
      this.send('ntrip:status', { code: 'invalid_config', message: publicError(error) })
      this.closeTransport()
      return
    }
    this.preferWindowsTransport = false
    this.reconnectAttempt = 0
    this.restart()
  }

  setPosition(input) {
    const latitude = Number(input?.latitude)
    const longitude = Number(input?.longitude)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      this.position = null
      this.closeTransport()
      this.send('ntrip:status', { code: 'waiting_position' })
      return
    }
    this.position = {
      latitude,
      longitude,
      satellites: Math.max(0, Math.trunc(Number(input?.satellites) || 0)),
    }
    if (this.child?.stdin?.writable) {
      this.child.stdin.write(`POSITION ${JSON.stringify(this.position)}\n`)
    }
    if (!this.socket && !this.child && !this.reconnectTimer) this.connect()
  }

  restart() {
    this.closeTransport()
    if (this.config && this.position && !this.closed) this.connect()
  }

  connect() {
    if (this.closed || !this.config || !this.position || this.socket || this.child) return
    const generation = ++this.generation
    this.send('ntrip:status', {
      code: 'connecting',
      transport: this.preferWindowsTransport ? 'windows-powershell' : 'node',
    })
    if (this.preferWindowsTransport) {
      this.connectPowerShell(generation)
    } else {
      this.connectNode(generation)
    }
  }

  connectNode(generation) {
    let authenticated = false
    let header = Buffer.alloc(0)
    const socket = net.createConnection({ host: this.config.host, port: this.config.port })
    this.socket = socket
    socket.setTimeout(CONNECT_TIMEOUT_MS)

    socket.once('connect', () => {
      if (generation !== this.generation) return
      socket.write(buildNtripRequest(this.config, this.position))
    })
    socket.on('data', (chunk) => {
      if (generation !== this.generation) return
      if (!authenticated) {
        header = Buffer.concat([header, chunk])
        if (header.length > MAX_HEADER_BYTES) {
          socket.destroy(new Error('NTRIP response header too large'))
          return
        }
        const parsed = parseNtripResponseHeader(header)
        if (!parsed) return
        if (!statusIsSuccessful(parsed.status)) {
          const error = new Error(`NTRIP rejected request: ${parsed.status}`)
          error.code = /401|403/.test(parsed.status) ? 'AUTH_FAILED' : 'NTRIP_REJECTED'
          socket.destroy(error)
          return
        }
        authenticated = true
        socket.setTimeout(0)
        this.reconnectAttempt = 0
        this.send('ntrip:status', { code: 'authenticated', transport: 'node', status: parsed.status })
        this.startGgaTimer(generation, () => socket.write(buildGga(this.position)))
        const payload = header.subarray(parsed.payloadOffset)
        header = Buffer.alloc(0)
        if (payload.length) this.emitData(payload)
        return
      }
      this.emitData(chunk)
    })
    socket.once('timeout', () => socket.destroy(Object.assign(new Error('NTRIP connection timed out'), { code: 'ETIMEDOUT' })))
    socket.once('error', (error) => {
      if (generation !== this.generation) return
      if (isWsl() && !authenticated && error.code !== 'AUTH_FAILED' && error.code !== 'NTRIP_REJECTED') {
        this.preferWindowsTransport = true
        this.closeTransport(false)
        this.connect()
        return
      }
      this.handleTransportFailure(error, error.code === 'AUTH_FAILED' ? 'auth_failed' : 'network_error')
    })
    socket.once('close', () => {
      if (generation !== this.generation || this.socket !== socket) return
      this.socket = null
      this.clearGgaTimer()
      if (authenticated) this.handleTransportFailure(new Error('NTRIP stream closed'), 'network_error')
    })
  }

  connectPowerShell(generation) {
    let windowsPath
    try {
      windowsPath = execFileSync('wslpath', ['-w', this.helperPath], { encoding: 'utf8' }).trim()
    } catch (error) {
      this.handleTransportFailure(error, 'bridge_error')
      return
    }

    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', windowsPath,
    ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    let stdoutBuffer = ''
    let stderrBuffer = ''
    let reportedFailure = false
    const fail = (error, code = 'network_error') => {
      if (reportedFailure || generation !== this.generation) return
      reportedFailure = true
      this.handleTransportFailure(error, code)
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (text) => {
      stdoutBuffer += text
      let newline
      while ((newline = stdoutBuffer.indexOf('\n')) >= 0) {
        const line = stdoutBuffer.slice(0, newline).trimEnd()
        stdoutBuffer = stdoutBuffer.slice(newline + 1)
        if (line.startsWith('READY ')) {
          this.reconnectAttempt = 0
          this.send('ntrip:status', { code: 'authenticated', transport: 'windows-powershell', status: line.slice(6) })
        } else if (line.startsWith('DATA ')) {
          const encoded = line.slice(5)
          if (encoded) this.send('ntrip:data', { data: encoded, transport: 'windows-powershell' })
        } else if (line.startsWith('ERROR ')) {
          const message = line.slice(6)
          fail(Object.assign(new Error(message), { code: /401|403|unauthor/i.test(message) ? 'AUTH_FAILED' : 'POWERSHELL_ERROR' }), /401|403|unauthor/i.test(message) ? 'auth_failed' : 'network_error')
        }
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (text) => { stderrBuffer = (stderrBuffer + text).slice(-1000) })
    child.once('error', (error) => fail(error, 'bridge_error'))
    child.once('exit', (code) => {
      if (generation !== this.generation || this.child !== child) return
      this.child = null
      fail(new Error(stderrBuffer.trim() || `PowerShell transport exited (${code})`))
    })
    child.stdin.write(`${JSON.stringify({ ...this.config, ...this.position })}\n`)
  }

  emitData(chunk) {
    for (let offset = 0; offset < chunk.length; offset += MAX_CHUNK_BYTES) {
      this.send('ntrip:data', { data: chunk.subarray(offset, offset + MAX_CHUNK_BYTES).toString('base64'), transport: 'node' })
    }
  }

  startGgaTimer(generation, write) {
    this.clearGgaTimer()
    this.ggaTimer = setInterval(() => {
      if (generation !== this.generation || !this.position) return
      try { write() } catch (error) { this.handleTransportFailure(error, 'network_error') }
    }, GGA_INTERVAL_MS)
  }

  handleTransportFailure(error, code) {
    this.closeTransport(false)
    this.send('ntrip:status', { code, message: publicError(error), transport: this.preferWindowsTransport ? 'windows-powershell' : 'node' })
    if (!this.closed && this.config && this.position && !this.reconnectTimer) {
      const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]
      this.reconnectAttempt += 1
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        this.connect()
      }, delay)
    }
  }

  clearGgaTimer() {
    if (this.ggaTimer) clearInterval(this.ggaTimer)
    this.ggaTimer = null
  }

  closeTransport(invalidate = true) {
    if (invalidate) this.generation += 1
    this.clearGgaTimer()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    const socket = this.socket
    this.socket = null
    socket?.destroy()
    const child = this.child
    this.child = null
    if (child) {
      child.stdin?.end()
      child.kill()
    }
  }

  stop() {
    this.closed = true
    this.closeTransport()
  }
}

export function ntripBridgePlugin() {
  const helperPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ntripTransport.ps1')
  return {
    name: 'actuv-ntrip-bridge',
    apply: 'serve',
    configureServer(server) {
      const sessions = new Map()
      const getSession = (client) => {
        let session = sessions.get(client)
        if (!session) {
          session = new NtripBridgeSession(client, helperPath, server.config.logger)
          sessions.set(client, session)
          client.socket.once('close', () => {
            session.stop()
            sessions.delete(client)
          })
        }
        return session
      }
      const onConfig = (data, client) => getSession(client).setConfig(data)
      const onPosition = (data, client) => getSession(client).setPosition(data)
      const onStop = (_data, client) => {
        sessions.get(client)?.stop()
        sessions.delete(client)
      }
      server.ws.on('ntrip:config', onConfig)
      server.ws.on('ntrip:position', onPosition)
      server.ws.on('ntrip:stop', onStop)
      server.httpServer?.once('close', () => {
        for (const session of sessions.values()) session.stop()
        sessions.clear()
        server.ws.off('ntrip:config', onConfig)
        server.ws.off('ntrip:position', onPosition)
        server.ws.off('ntrip:stop', onStop)
      })
    },
  }
}

import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DEV_HOST = '0.0.0.0'
export const DEV_PORT = 5173
export const BUILD_STATE_SCHEMA = 1
export const BUILD_STATE_NAME = '.actuv-build-state.json'
export const DEPENDENCY_STATE_NAME = 'dependency-state.json'

const ACTUV_PAGE_TITLE = '<title>地面站-分体式特种搅池机器人</title>'
const BUILD_INPUT_DIRECTORIES = ['src', 'public', 'tools']
const BUILD_INPUT_FILES = ['index.html', 'package.json', 'package-lock.json', 'vite.config.js']
const CRITICAL_DEPENDENCIES = ['vite', 'vue', 'ssh2']

const log = (message) => console.log(`[ACTUV启动器] ${message}`)
const warn = (message) => console.warn(`[ACTUV启动器] ${message}`)

export function parseVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/)
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null
}

export function isSupportedNodeVersion(value) {
  const version = parseVersion(value)
  if (!version) return false
  if (version.major === 20) return version.minor >= 19
  if (version.major === 21) return false
  if (version.major === 22) return version.minor >= 12
  return version.major > 22
}

export const npmExecutable = (platform = process.platform) => platform === 'win32' ? 'npm.cmd' : 'npm'

export function isActuvVitePage(html) {
  const content = String(html || '')
  return content.includes(ACTUV_PAGE_TITLE) && content.includes('/@vite/client')
}

async function listFilesRecursive(root, relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory)
  let entries
  try {
    entries = await fsp.readdir(absoluteDirectory, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const files = []
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name)
    if (entry.isDirectory()) files.push(...await listFilesRecursive(root, relativePath))
    else if (entry.isFile()) files.push(relativePath)
  }
  return files
}

export async function collectBuildInputFiles(root = PROJECT_ROOT) {
  const files = []
  for (const directory of BUILD_INPUT_DIRECTORIES) files.push(...await listFilesRecursive(root, directory))
  for (const filename of BUILD_INPUT_FILES) {
    try {
      if ((await fsp.stat(path.join(root, filename))).isFile()) files.push(filename)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    if (entry.isFile() && (entry.name === '.env' || entry.name.startsWith('.env.'))) files.push(entry.name)
  }
  return [...new Set(files.map((filename) => filename.split(path.sep).join('/')))].sort()
}

export async function digestFiles(root, relativeFiles) {
  const digest = crypto.createHash('sha256')
  for (const relativeFile of [...relativeFiles].sort()) {
    digest.update(relativeFile)
    digest.update('\0')
    digest.update(await fsp.readFile(path.join(root, relativeFile)))
    digest.update('\0')
  }
  return digest.digest('hex')
}

export const computeBuildInputDigest = async (root = PROJECT_ROOT) => (
  digestFiles(root, await collectBuildInputFiles(root))
)

export async function computeDistDigest(root = PROJECT_ROOT) {
  const files = (await listFilesRecursive(root, 'dist'))
    .filter((filename) => path.basename(filename) !== BUILD_STATE_NAME)
  return files.length ? digestFiles(root, files) : null
}

export function assessBuildState({ state, sourceDigest, lockDigest, distDigest, hasIndex }) {
  if (!hasIndex) return { valid: false, reason: '缺少 dist/index.html' }
  if (!state || state.schema !== BUILD_STATE_SCHEMA) return { valid: false, reason: '缺少有效的编译状态文件' }
  if (state.source_digest !== sourceDigest) return { valid: false, reason: '源码或构建配置已变化' }
  if (state.lock_digest !== lockDigest) return { valid: false, reason: '依赖锁文件已变化' }
  if (!distDigest || state.dist_digest !== distDigest) return { valid: false, reason: 'dist 编译产物缺失或已变化' }
  return { valid: true, reason: '编译产物与当前源码一致' }
}

async function readJson(filename) {
  try {
    return JSON.parse(await fsp.readFile(filename, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

async function writeJsonAtomic(filename, value) {
  await fsp.mkdir(path.dirname(filename), { recursive: true })
  const temporary = `${filename}.${process.pid}.tmp`
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await fsp.rm(filename, { force: true })
  await fsp.rename(temporary, filename)
}

const hashFile = async (filename) => crypto.createHash('sha256').update(await fsp.readFile(filename)).digest('hex')

function runCommand(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    stdio: options.inherit ? 'inherit' : 'pipe',
  })
  if (result.error) return { ok: false, error: result.error, stdout: '', stderr: result.error.message }
  return { ok: result.status === 0, status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' }
}

async function ensureDependencies(root, npmCommand, lockDigest) {
  const statePath = path.join(root, 'node_modules', '.cache', 'actuv-launcher', DEPENDENCY_STATE_NAME)
  const state = await readJson(statePath)
  const criticalFilesExist = CRITICAL_DEPENDENCIES.every((name) => (
    fs.existsSync(path.join(root, 'node_modules', name, 'package.json'))
  ))
  const dependencyTree = criticalFilesExist && state?.lock_digest === lockDigest
    ? runCommand(npmCommand, ['ls', '--depth=0', '--silent'], root)
    : { ok: false }
  if (state?.lock_digest === lockDigest && criticalFilesExist && dependencyTree.ok) {
    log('依赖检查通过，无需重新安装。')
    return false
  }

  log('依赖缺失、损坏或锁文件已变化，正在执行 npm ci…')
  const install = runCommand(npmCommand, ['ci'], root, { inherit: true })
  if (!install.ok) throw new Error('npm ci 执行失败，请检查网络、npm 配置及上方错误信息')
  await writeJsonAtomic(statePath, { lock_digest: lockDigest, installed_at: new Date().toISOString(), node: process.version })
  log('依赖安装完成。')
  return true
}

function requestPage(port, timeoutMs = 1_500) {
  return new Promise((resolve) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: '/', timeout: timeoutMs }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body = (body + chunk).slice(0, 128 * 1024) })
      response.on('end', () => resolve(body))
    })
    request.once('timeout', () => request.destroy())
    request.once('error', () => resolve(''))
  })
}

export function canListen(port = DEV_PORT, host = DEV_HOST) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', (error) => error.code === 'EADDRINUSE' ? resolve(false) : reject(error))
    server.listen({ port, host, exclusive: true }, () => {
      server.close((error) => error ? reject(error) : resolve(true))
    })
  })
}

async function inspectDevPort() {
  if (await canListen()) return 'free'
  return isActuvVitePage(await requestPage(DEV_PORT)) ? 'actuv' : 'occupied'
}

async function ensurePortAvailable() {
  const status = await inspectDevPort()
  if (status === 'actuv') {
    log(`当前项目已在 http://localhost:${DEV_PORT}/ 运行，无需启动第二个实例。`)
    return false
  }
  if (status === 'occupied') throw new Error(`端口 ${DEV_PORT} 已被其他程序占用，请释放端口后重试`)
  return true
}

async function ensureBuild(root, npmCommand, lockDigest, dependenciesChanged) {
  const statePath = path.join(root, 'dist', BUILD_STATE_NAME)
  const sourceDigest = await computeBuildInputDigest(root)
  const assessment = assessBuildState({
    state: await readJson(statePath),
    sourceDigest,
    lockDigest,
    distDigest: await computeDistDigest(root),
    hasIndex: fs.existsSync(path.join(root, 'dist', 'index.html')),
  })
  if (assessment.valid && !dependenciesChanged) {
    log(`${assessment.reason}，跳过编译。`)
    return false
  }

  log(`${dependenciesChanged ? '依赖已重新安装' : assessment.reason}，正在执行 npm run build…`)
  await fsp.rm(statePath, { force: true })
  const build = runCommand(npmCommand, ['run', 'build'], root, { inherit: true })
  if (!build.ok) throw new Error('前端编译失败，不会启动服务器')
  const completedDistDigest = await computeDistDigest(root)
  if (!completedDistDigest || !fs.existsSync(path.join(root, 'dist', 'index.html'))) {
    throw new Error('编译命令已结束，但未生成有效的 dist 产物')
  }
  await writeJsonAtomic(statePath, {
    schema: BUILD_STATE_SCHEMA,
    source_digest: await computeBuildInputDigest(root),
    lock_digest: lockDigest,
    dist_digest: completedDistDigest,
    built_at: new Date().toISOString(),
    node: process.version,
    npm: runCommand(npmCommand, ['--version'], root).stdout.trim(),
    vite: JSON.parse(await fsp.readFile(path.join(root, 'node_modules', 'vite', 'package.json'), 'utf8')).version,
  })
  log('前端编译完成，编译状态已记录。')
  return true
}

function printAccessAddresses() {
  log(`本机访问地址：http://localhost:${DEV_PORT}/`)
  const addresses = new Set()
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (!entry.internal && (entry.family === 'IPv4' || entry.family === 4)) addresses.add(entry.address)
    }
  }
  for (const address of addresses) log(`局域网访问地址：http://${address}:${DEV_PORT}/`)
}

function startDevServer(root, npmCommand) {
  return new Promise((resolve, reject) => {
    // package.json 中的 dev 命令已包含 `vite --host`，此处只补充固定端口约束。
    const child = spawn(npmCommand, ['run', 'dev', '--', '--port', String(DEV_PORT), '--strictPort'], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
    })
    child.once('error', reject)
    child.once('close', (code, signal) => resolve(signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : (code ?? 1)))
  })
}

export async function main() {
  process.chdir(PROJECT_ROOT)
  log(`项目目录：${PROJECT_ROOT}`)
  if (!isSupportedNodeVersion(process.version)) {
    throw new Error(`当前 Node.js 为 ${process.version}；Vite 7 要求 ^20.19.0 或 >=22.12.0，请升级后重试`)
  }
  const npmCommand = npmExecutable()
  const npmVersion = runCommand(npmCommand, ['--version'], PROJECT_ROOT)
  if (!npmVersion.ok) throw new Error('未找到可用的 npm，请检查 Node.js/npm 安装和 PATH')
  log(`环境检查通过：Node.js ${process.version}，npm ${npmVersion.stdout.trim()}。`)

  if (!await ensurePortAvailable()) return 0
  const lockPath = path.join(PROJECT_ROOT, 'package-lock.json')
  if (!fs.existsSync(lockPath)) throw new Error('缺少 package-lock.json，无法使用 npm ci 安装确定版本的依赖')
  const lockDigest = await hashFile(lockPath)
  const dependenciesChanged = await ensureDependencies(PROJECT_ROOT, npmCommand, lockDigest)
  await ensureBuild(PROJECT_ROOT, npmCommand, lockDigest, dependenciesChanged)
  if (!await ensurePortAvailable()) return 0

  printAccessAddresses()
  log('正在以前台模式启动服务，按 Ctrl+C 停止。')
  return startDevServer(PROJECT_ROOT, npmCommand)
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) {
  main()
    .then((code) => { process.exitCode = code })
    .catch((error) => {
      warn(error?.message || error)
      process.exitCode = 1
    })
}

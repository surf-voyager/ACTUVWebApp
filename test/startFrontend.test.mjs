import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  BUILD_STATE_SCHEMA,
  assessBuildState,
  collectBuildInputFiles,
  computeBuildInputDigest,
  isActuvVitePage,
  isSupportedNodeVersion,
  npmExecutable,
} from '../scripts/startFrontend.mjs'

test('accepts exactly the Node.js versions supported by Vite 7', () => {
  assert.equal(isSupportedNodeVersion('v20.18.1'), false)
  assert.equal(isSupportedNodeVersion('v20.19.0'), true)
  assert.equal(isSupportedNodeVersion('21.7.3'), false)
  assert.equal(isSupportedNodeVersion('v22.11.0'), false)
  assert.equal(isSupportedNodeVersion('v22.12.0'), true)
  assert.equal(isSupportedNodeVersion('v24.1.0'), true)
  assert.equal(isSupportedNodeVersion('invalid'), false)
})

test('selects npm.cmd only on Windows', () => {
  assert.equal(npmExecutable('win32'), 'npm.cmd')
  assert.equal(npmExecutable('linux'), 'npm')
  assert.equal(npmExecutable('darwin'), 'npm')
})

test('recognizes this ACTUV page only when served by Vite', () => {
  const title = '<title>地面站-分体式特种搅池机器人</title>'
  assert.equal(isActuvVitePage(`<script type="module" src="/@vite/client"></script>${title}`), true)
  assert.equal(isActuvVitePage(title), false)
  assert.equal(isActuvVitePage('<script src="/@vite/client"></script><title>其他项目</title>'), false)
})

test('build input digest is stable and changes with source or environment files', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'actuv-launcher-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  await fsp.mkdir(path.join(root, 'src'), { recursive: true })
  await fsp.mkdir(path.join(root, 'tools'), { recursive: true })
  await fsp.writeFile(path.join(root, 'src', 'main.js'), 'one\n')
  await fsp.writeFile(path.join(root, 'tools', 'bridge.mjs'), 'bridge\n')
  await fsp.writeFile(path.join(root, 'index.html'), '<div id="app"></div>\n')
  await fsp.writeFile(path.join(root, 'package.json'), '{}\n')
  await fsp.writeFile(path.join(root, 'package-lock.json'), '{}\n')
  await fsp.writeFile(path.join(root, 'vite.config.js'), 'export default {}\n')
  await fsp.writeFile(path.join(root, '.env.local'), 'PORT=1\n')
  await fsp.writeFile(path.join(root, 'README.md'), 'ignored\n')

  const files = await collectBuildInputFiles(root)
  assert(files.includes('src/main.js'))
  assert(files.includes('tools/bridge.mjs'))
  assert(files.includes('.env.local'))
  assert(!files.includes('README.md'))
  const first = await computeBuildInputDigest(root)
  assert.equal(first, await computeBuildInputDigest(root))
  await fsp.writeFile(path.join(root, 'README.md'), 'still ignored\n')
  assert.equal(await computeBuildInputDigest(root), first)
  await fsp.writeFile(path.join(root, 'src', 'main.js'), 'two\n')
  assert.notEqual(await computeBuildInputDigest(root), first)
})

test('compiled state requires matching source, lock and dist digests', () => {
  const state = { schema: BUILD_STATE_SCHEMA, source_digest: 'source', lock_digest: 'lock', dist_digest: 'dist' }
  assert.equal(assessBuildState({ state, sourceDigest: 'source', lockDigest: 'lock', distDigest: 'dist', hasIndex: true }).valid, true)
  assert.equal(assessBuildState({ state, sourceDigest: 'changed', lockDigest: 'lock', distDigest: 'dist', hasIndex: true }).valid, false)
  assert.equal(assessBuildState({ state, sourceDigest: 'source', lockDigest: 'changed', distDigest: 'dist', hasIndex: true }).valid, false)
  assert.equal(assessBuildState({ state, sourceDigest: 'source', lockDigest: 'lock', distDigest: 'changed', hasIndex: true }).valid, false)
  assert.equal(assessBuildState({ state, sourceDigest: 'source', lockDigest: 'lock', distDigest: 'dist', hasIndex: false }).valid, false)
})

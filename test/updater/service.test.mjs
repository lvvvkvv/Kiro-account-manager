import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-update-state-'))
const control = (globalThis.__updateTest = {
  checks: 0,
  downloads: 0,
  installs: 0,
  arms: [],
  version: '1.8.0',
  manifest: {},
  failNetwork: false,
  failSignature: false,
  offline: false,
  handlers: {}
})
const { outputFiles } = await build({
  entryPoints: ['src/main/updater/service.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  define: { 'process.platform': '"darwin"' },
  plugins: [
    {
      name: 'isolated-backends',
      setup(builder) {
        builder.onResolve({ filter: /^(electron|electron-updater)$|^\.\/mac$/ }, (args) => ({
          path: args.path,
          namespace: 'test'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'test' }, (args) => ({
          loader: 'js',
          contents:
            args.path === 'electron'
              ? `
        export const app = { getVersion: () => '1.7.10', getPath: () => ${JSON.stringify(root)}, isPackaged: true };
        export const BrowserWindow = { getAllWindows: () => [] };
        export const ipcMain = { handle: (key, fn) => globalThis.__updateTest.handlers[key] = fn };
        export const shell = { openExternal: async () => {} };
      `
              : args.path === 'electron-updater'
                ? 'export const autoUpdater = {};'
                : `
        export class UpdateNetworkError extends Error {}
        export async function request() {
          const c = globalThis.__updateTest; c.checks++;
          await new Promise(r => setTimeout(r, 5));
          if(c.offline) throw new UpdateNetworkError('offline');
          return {status:200, ok:true, json:async()=>({tag_name:'v'+c.version,body:'notes'})};
        }
        export class MacUpdateBackend {
          async supported() {return true}
          async initialize() {if(globalThis.__updateTest.failInit) throw new Error('corrupt update cache');return {ready:null,recovery:null}}
          async discard() {}
          async manifest() {if(globalThis.__updateTest.failSignature) throw new Error('bad signature');return globalThis.__updateTest.manifest}
          async download() {globalThis.__updateTest.downloads++; await new Promise(r=>setTimeout(r,10))}
          async prepareInstall() {globalThis.__updateTest.installs++;return async(action)=>{globalThis.__updateTest.arms.push(action)}}
          async acknowledge() {}
        }
      `
        }))
      }
    }
  ]
})
const { AppUpdateService } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
)
const service = new AppUpdateService({
  fetch: async () => {},
  renderer: () => null,
  routingInUse: () => true,
  prepareQuit: async () => {},
  quit: () => {},
  changed: () => {}
})
await service.initialize()

test('one shared state covers duplicate checks, background download, dismiss and withdrawal', async () => {
  const before = control.checks
  await Promise.all([service.check(false), service.check(false), service.check(false)])
  assert.equal(control.checks - before, 1)
  assert.equal(service.snapshot().available.version, '1.8.0')
  await Promise.all([service.download(false), service.download(false)])
  assert.equal(control.downloads, 1)
  assert.equal(service.snapshot().ready.version, '1.8.0')
  await service.dismiss()
  assert.equal(service.snapshot().dismissedVersion, '1.8.0')
  assert.equal(service.snapshot().available.version, '1.8.0')
  control.version = '1.7.10'
  await service.check(false)
  assert.equal(service.snapshot().ready, null)
  assert.equal(service.snapshot().available, null)
})
test('cached package can install offline, but a signature rejection cannot fall back to it', async () => {
  control.version = '1.8.0'
  await service.check(false)
  await service.download(false)
  control.failSignature = true
  await assert.rejects(service.install(), /bad signature/)
  assert.equal(control.installs, 0)
  control.failSignature = false
  control.offline = true
  await Promise.all([service.install(), service.install()])
  assert.equal(control.installs, 1)
  control.offline = false
})
test('IPC rejects a foreign renderer', async () => {
  assert.throws(() => control.handlers['app-update:install']({ sender: {} }), /Untrusted/)
})
test('shutdown failure explicitly cancels an armed update', async () => {
  control.manifest = {}
  const actions = control.arms.length
  let quit = false
  const next = new AppUpdateService({
    fetch: async () => {},
    renderer: () => null,
    routingInUse: () => false,
    prepareQuit: async () => {
      throw new Error('cleanup failed')
    },
    quit: () => {
      quit = true
    },
    changed: () => {}
  })
  await next.initialize()
  await assert.rejects(next.install(), /cleanup failed/)
  assert.deepEqual(control.arms.slice(actions), ['arm', 'cancel'])
  assert.equal(quit, false)
  assert.equal(next.snapshot().installing, false)
})
test('rapid off/on while downloading finishes with ready state enabled', async () => {
  control.manifest = {}
  const next = new AppUpdateService({
    fetch: async () => {},
    renderer: () => null,
    routingInUse: () => false,
    prepareQuit: async () => {},
    quit: () => {},
    changed: () => {}
  })
  await next.initialize()
  await next.check(false)
  const download = next.download(false)
  const off = next.setEnabled(false)
  const on = next.setEnabled(true)
  await Promise.all([download, off, on])
  await next.download(false)
  assert.equal(next.snapshot().enabled, true)
  assert.equal(next.snapshot().ready.version, '1.8.0')
})
test('unsigned releases remain discoverable with manual fallback and corrupt cache does not block startup', async () => {
  control.failInit = true
  control.manifest = null
  const next = new AppUpdateService({
    fetch: async () => {},
    renderer: () => null,
    routingInUse: () => false,
    prepareQuit: async () => {},
    quit: () => {},
    changed: () => {}
  })
  await next.initialize()
  assert.match(next.snapshot().error, /corrupt update cache/)
  control.failInit = false
  await next.check(false)
  assert.equal(next.snapshot().available.installable, false)
  assert.equal(next.snapshot().available.version, '1.8.0')
  await assert.rejects(next.install(), /manual download/)
})
test.after(() => {
  fs.rmSync(root, { recursive: true, force: true })
  delete globalThis.__updateTest
})

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
  supported: true,
  downloadGate: null,
  aborted: 0,
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
                ? 'export const autoUpdater = {}; export class CancellationToken {}'
                : `
        export class UpdateNetworkError extends Error {}
        export async function readUpdateText(response) {return response.text()}
        export async function request() {
          const c = globalThis.__updateTest; c.checks++;
          await new Promise(r => setTimeout(r, 5));
          if(c.offline) throw new UpdateNetworkError('offline');
          return {status:200, ok:true, text:async()=>JSON.stringify({tag_name:'v'+c.version,body:'notes'})};
        }
        export class MacUpdateBackend {
          async supported() {return globalThis.__updateTest.supported}
          async initialize() {if(globalThis.__updateTest.failInit) throw new Error('corrupt update cache');return {ready:null,recovery:null}}
          async discard() {}
          async manifest() {if(globalThis.__updateTest.failSignature) throw new Error('bad signature');return globalThis.__updateTest.manifest}
          async download(_info,_envelope,_progress,signal) {
            const c=globalThis.__updateTest;c.downloads++;
            if(c.downloadGate) await new Promise((resolve,reject)=>{
              c.downloadGate.resolve=resolve;
              signal.addEventListener('abort',()=>{c.aborted++;reject(signal.reason)},{once:true});
            });
            else await new Promise(r=>setTimeout(r,10));
          }
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
test('turning automatic downloads off aborts an active transfer without an error', async () => {
  control.manifest = {}
  control.downloadGate = {}
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
  const downloading = next.download(false)
  assert.equal(next.snapshot().downloading, true)
  await next.setEnabled(false)
  await downloading
  assert.equal(control.aborted, 1)
  assert.equal(next.snapshot().downloading, false)
  assert.equal(next.snapshot().ready, null)
  assert.equal(next.snapshot().progress, null)
  assert.equal(next.snapshot().error, null)
  control.downloadGate = null
  await next.setEnabled(true)
  await next.download(false)
  assert.equal(next.snapshot().ready.version, '1.8.0')
})
test('dismissal remains visible on a disk failure and can be retried', async () => {
  control.version = '1.8.1'
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
  await next.download(false)
  const tmp = path.join(root, 'app-updates/preferences.json.tmp')
  fs.mkdirSync(tmp)
  try {
    const previous = next.snapshot().dismissedVersion
    assert.notEqual(previous, next.snapshot().ready.version)
    await assert.rejects(next.dismiss(), /EISDIR/)
    assert.equal(next.snapshot().dismissedVersion, previous)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  await next.dismiss()
  assert.equal(next.snapshot().dismissedVersion, next.snapshot().ready.version)
  control.version = '1.8.0'
})
test.after(() => {
  fs.rmSync(root, { recursive: true, force: true })
  delete globalThis.__updateTest
})

test('installation waits for accepted account work before arming and quitting', async () => {
  control.manifest = {}
  let release,
    entered = false
  const gate = new Promise((resolve) => (release = resolve)),
    events = [],
    start = control.arms.length
  const next = new AppUpdateService({
    fetch: async () => undefined,
    renderer: () => null,
    routingInUse: () => false,
    beforeQuit: async () => {
      entered = true
      await gate
      events.push('accounts-finished')
    },
    prepareQuit: async () => events.push('cleanup'),
    quit: () => events.push('quit'),
    changed: () => undefined
  })
  await next.initialize()
  const pending = next.install()
  for (let n = 0; n < 100 && !entered; n++) await new Promise((resolve) => setTimeout(resolve, 2))
  assert.equal(entered, true)
  assert.deepEqual(control.arms.slice(start), [])
  release()
  await pending
  assert.deepEqual(events, ['accounts-finished', 'cleanup', 'quit'])
  assert.deepEqual(control.arms.slice(start), ['arm', 'confirm'])
})
test('failed account preparation cancels the staged update and resumes the application', async () => {
  const start = control.arms.length
  let resumed = false,
    quit = false
  const next = new AppUpdateService({
    fetch: async () => undefined,
    renderer: () => null,
    routingInUse: () => false,
    beforeQuit: async () => {
      throw Error('fixture account work failed')
    },
    resume: () => (resumed = true),
    prepareQuit: async () => undefined,
    quit: () => (quit = true),
    changed: () => undefined
  })
  await next.initialize()
  await assert.rejects(next.install(), /fixture account work failed/)
  assert.equal(resumed, true)
  assert.equal(quit, false)
  assert.deepEqual(control.arms.slice(start), ['cancel'])
})

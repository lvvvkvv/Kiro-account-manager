/* eslint @typescript-eslint/explicit-function-return-type: "off" -- Native updater transport is mocked; its real cancellation token is used. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { createRequire } from 'node:module'

test('native updater cancellation uses its token and a later enable starts a fresh download', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-native-download-'))
  const control = (globalThis.__nativeUpdateCancellation = {
    downloads: 0,
    cancelled: 0,
    finish: null
  })
  try {
    const { outputFiles } = await build({
      entryPoints: ['src/main/updater/service.ts'],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      write: false,
      define: { 'process.platform': '"win32"', 'process.env.PORTABLE_EXECUTABLE_DIR': 'undefined' },
      plugins: [
        {
          name: 'native-updater-fixture',
          setup(b) {
            b.onResolve({ filter: /^(electron|electron-updater)$/ }, (a) => ({
              path: a.path,
              namespace: 'fixture'
            }))
            b.onLoad({ filter: /.*/, namespace: 'fixture' }, (a) => ({
              loader: 'js',
              resolveDir: process.cwd(),
              contents:
                a.path === 'electron'
                  ? `export const app={getVersion:()=> '1.7.20',getPath:()=>${JSON.stringify(root)},isPackaged:true};export const BrowserWindow={getAllWindows:()=>[]};export const ipcMain={handle:()=>{}};export const shell={};`
                  : `import{CancellationToken}from'builder-util-runtime';export{CancellationToken};export const autoUpdater={setFeedURL(){},on(){},async checkForUpdates(){return{isUpdateAvailable:true,updateInfo:{version:'1.8.0',releaseNotes:'fixture'}}},downloadUpdate(token){const c=globalThis.__nativeUpdateCancellation;c.downloads++;return token.createPromise((resolve,_reject,onCancel)=>{c.finish=resolve;onCancel(()=>c.cancelled++)})}};`
            }))
          }
        }
      ]
    })
    const module = { exports: {} }
    new Function('require', 'module', 'exports', outputFiles[0].text)(
      createRequire(import.meta.url),
      module,
      module.exports
    )
    const { AppUpdateService } = module.exports
    const service = new AppUpdateService({
      fetch: async () => {
        throw Error('No network allowed')
      },
      renderer: () => null,
      routingInUse: () => false,
      prepareQuit: async () => {},
      quit: () => {},
      changed: () => {}
    })
    await service.initialize()
    await service.check(false)
    const first = service.download(false)
    await service.setEnabled(false)
    await first
    assert.equal(control.cancelled, 1)
    assert.equal(service.snapshot().error, null)
    assert.equal(service.snapshot().ready, null)
    await service.setEnabled(true)
    const second = service.download(false)
    // Enabling starts a fresh check before the transfer.
    while (control.downloads !== 2) await new Promise((resolve) => setImmediate(resolve))
    control.finish([])
    await second
    assert.equal(service.snapshot().enabled, true)
    assert.equal(service.snapshot().ready.version, '1.8.0')
    assert.equal(control.cancelled, 1)
  } finally {
    delete globalThis.__nativeUpdateCancellation
    fs.rmSync(root, { recursive: true, force: true })
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { build } from 'esbuild'

test('a different app copy cannot resume or quit for an old installation transaction', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-update-location-'))
  try {
    const id = crypto.randomUUID()
    const directory = path.join(root, 'app-updates', 'transactions', id)
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(root, 'app-updates/active.json'), JSON.stringify({ id }))
    fs.writeFileSync(
      path.join(directory, 'transaction.json'),
      JSON.stringify({ id, appPath: path.join(root, 'Other.app'), phase: 'prepared', parentPid: 1 })
    )
    const { outputFiles } = await build({
      entryPoints: ['src/main/updater/mac.ts'],
      bundle: true,
      platform: 'node',
      format: 'esm',
      write: false,
      define: {
        'process.execPath': JSON.stringify(path.join(root, 'Current.app/Contents/MacOS/Electron'))
      },
      plugins: [
        {
          name: 'isolated-electron',
          setup(builder) {
            builder.onResolve({ filter: /^electron$/ }, () => ({
              path: 'electron',
              namespace: 'mock'
            }))
            builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
              loader: 'js',
              contents: `export const app={getPath:()=>${JSON.stringify(root)},getVersion:()=> '1.7.11',isPackaged:true}`
            }))
          }
        }
      ]
    })
    const { MacUpdateBackend } = await import(
      `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
    )
    const backend = new MacUpdateBackend(async () => {
      throw new Error('Unexpected network request')
    })
    const state = await backend.initialize()
    assert.equal(state.restarting, undefined)
    assert.match(state.recovery, /another installation/)
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'transaction.json'))).parentPid, 1)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

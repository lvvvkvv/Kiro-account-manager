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

test('an aborted mac download removes its partial file and a retry still verifies the archive', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-update-abort-'))
  try {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64')
    const { outputFiles } = await build({
      entryPoints: ['src/main/updater/mac.ts'],
      bundle: true,
      platform: 'node',
      format: 'esm',
      write: false,
      plugins: [
        {
          name: 'isolated-download',
          setup(b) {
            b.onResolve({ filter: /^electron$/ }, () => ({
              path: 'electron',
              namespace: 'fixture'
            }))
            b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
              contents: `export const app={getPath:()=>${JSON.stringify(root)},getVersion:()=> '1.7.20',isPackaged:true}`,
              loader: 'js'
            }))
            b.onLoad({ filter: /update-public-key.json$/ }, () => ({
              contents: JSON.stringify({ publicKey: raw }),
              loader: 'json'
            }))
          }
        }
      ]
    })
    const { MacUpdateBackend } = await import(
      `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
    )
    const contents = Buffer.from('verified update archive'),
      info = { version: '1.8.0', notes: '', installable: true }
    const payload = Buffer.from(
      JSON.stringify({
        schema: 1,
        version: info.version,
        arch: process.arch,
        bundleId: 'com.kiro.account-manager',
        appName: 'Kiro Account Manager.app',
        file: `kiro-account-manager-1.8.0-${process.arch}-mac.zip`,
        size: contents.length,
        sha256: crypto.createHash('sha256').update(contents).digest('hex')
      })
    )
    const envelope = {
      payload: payload.toString('base64'),
      signature: crypto.sign(null, payload, privateKey).toString('base64')
    }
    let first = true,
      cancelled = false,
      progress
    const started = new Promise((resolve) => {
      progress = resolve
    })
    const backend = new MacUpdateBackend(async () => {
      if (!first) return new Response(contents)
      first = false
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(contents.subarray(0, 4))
          },
          cancel() {
            cancelled = true
          }
        })
      )
    })
    const controller = new AbortController()
    const downloading = backend.download(info, envelope, progress, controller.signal)
    await started
    controller.abort()
    await assert.rejects(downloading, /abort/i)
    assert.equal(cancelled, true)
    assert.equal(fs.existsSync(path.join(root, 'app-updates/payload.partial')), false)
    assert.equal(fs.existsSync(path.join(root, 'app-updates/pending.json')), false)
    await backend.download(info, envelope, () => {})
    assert.deepEqual(fs.readFileSync(path.join(root, 'app-updates/payload.zip')), contents)
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(root, 'app-updates/pending.json'))).info.version,
      info.version
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

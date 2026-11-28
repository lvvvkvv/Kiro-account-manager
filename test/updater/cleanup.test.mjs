/* eslint @typescript-eslint/explicit-function-return-type: "off" -- Native cleanup only uses small, temporary application bundles. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'

const native = process.platform === 'darwin'
let root, helper, appPath, lockHelper
const run = (file, args) =>
  execFileSync(file, args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] })
test.before(() => {
  if (!native) return
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-cleanup-test-')))
  helper = path.join(root, 'kiro-updater')
  const key = path.join(root, 'Key.swift')
  fs.writeFileSync(key, `let trustedUpdatePublicKey = "${Buffer.alloc(32).toString('base64')}"\n`)
  run('/usr/bin/xcrun', [
    'swiftc',
    '-D',
    'UPDATER_TESTING',
    '-o',
    helper,
    'build/macos-updater/main.swift',
    key
  ])
  // A tiny signed Mach-O bundle is sufficient: cleanup never launches or swaps it.
  appPath = path.join(root, 'Fixture.app')
  fs.mkdirSync(path.join(appPath, 'Contents/MacOS'), { recursive: true })
  fs.copyFileSync('/usr/bin/true', path.join(appPath, 'Contents/MacOS/Fixture'))
  fs.writeFileSync(
    path.join(appPath, 'Contents/Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.kiro.updater-integration-test</string><key>CFBundleExecutable</key><string>Fixture</string><key>CFBundleShortVersionString</key><string>1.8.0</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`
  )
  run('/usr/bin/codesign', ['--force', '--sign', '-', appPath])
  const lockSource = path.join(root, 'Lock.swift')
  fs.writeFileSync(
    lockSource,
    'import Darwin\nlet fd = open(CommandLine.arguments[1], O_CREAT | O_RDWR, 0o600)\nflock(fd, LOCK_EX)\nprint("ready"); fflush(stdout)\n_ = readLine()\n'
  )
  lockHelper = path.join(root, 'lock-helper')
  run('/usr/bin/xcrun', ['swiftc', '-o', lockHelper, lockSource])
})
test.after(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true })
})
function fixture(phase, patch = {}) {
  const id = crypto.randomUUID(),
    directory = path.join(root, id),
    work = path.join(root, '.kiro-update-' + id)
  fs.mkdirSync(directory)
  fs.mkdirSync(work)
  fs.writeFileSync(path.join(work, 'bundle-sentinel'), 'staged')
  fs.writeFileSync(path.join(directory, 'payload.zip'), 'archive')
  fs.writeFileSync(path.join(directory, 'kiro-updater'), 'copied-helper')
  const job = path.join(directory, 'transaction.json')
  fs.writeFileSync(
    job,
    JSON.stringify({
      id,
      appPath,
      currentVersion: '1.7.20',
      version: '1.8.0',
      arch: process.arch,
      parentPid: process.pid,
      phase,
      ...patch
    })
  )
  return { directory, work, job }
}
for (const phase of ['committed', 'rolled-back', 'failed', 'cancelled']) {
  test(
    `cleanup removes large ${phase} artifacts and retains the journal`,
    { skip: !native },
    () => {
      const f = fixture(phase)
      run(helper, ['cleanup', f.job])
      assert.equal(fs.existsSync(f.work), false)
      assert.equal(fs.existsSync(path.join(f.directory, 'payload.zip')), false)
      assert.equal(fs.existsSync(path.join(f.directory, 'kiro-updater')), false)
      assert.equal(JSON.parse(fs.readFileSync(f.job)).phase, phase)
      run(helper, ['cleanup', f.job]) // idempotent retry
      assert.equal(fs.existsSync(appPath), true)
    }
  )
}
for (const phase of ['created', 'prepared', 'swapped', 'restarting-old', 'recovery-failed']) {
  test(`cleanup retains ${phase} recovery artifacts`, { skip: !native }, () => {
    const f = fixture(phase)
    run(helper, ['cleanup', f.job])
    assert.equal(fs.existsSync(path.join(f.work, 'bundle-sentinel')), true)
    assert.equal(fs.existsSync(path.join(f.directory, 'payload.zip')), true)
  })
}
test(
  'cleanup rejects newer committed version, forged ID, symlink staging and a live helper lock',
  { skip: !native },
  async () => {
    const newer = fixture('committed', { version: '1.9.0' })
    assert.throws(() => run(helper, ['cleanup', newer.job]), /Retaining rollback/)
    assert.equal(fs.existsSync(newer.work), true)
    const wrong = fixture('cancelled', { id: crypto.randomUUID() })
    assert.throws(() => run(helper, ['cleanup', wrong.job]), /Invalid transaction ID/)
    const link = fixture('cancelled')
    fs.rmSync(link.work, { recursive: true })
    fs.symlinkSync(newer.work, link.work)
    assert.throws(() => run(helper, ['cleanup', link.job]), /Invalid staging location/)
    assert.equal(fs.readFileSync(path.join(newer.work, 'bundle-sentinel'), 'utf8'), 'staged')
    const locked = fixture('cancelled')
    const child = spawn(lockHelper, [path.join(locked.directory, 'lock')], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const exited = new Promise((resolve) => child.once('exit', resolve))
    try {
      await new Promise((resolve, reject) => {
        child.stdout.once('data', resolve)
        child.once('error', reject)
        child.once('exit', (code) => reject(Error('Lock holder exited: ' + code)))
      })
      assert.throws(() => run(helper, ['cleanup', locked.job]), /Another update helper/)
      assert.equal(fs.existsSync(locked.work), true)
    } finally {
      child.stdin.end('\n')
      await exited
    }
    run(helper, ['cleanup', locked.job])
    assert.equal(fs.existsSync(locked.work), false)
  }
)

test(
  'backend startup collects only owned terminal transactions using the bundled helper',
  { skip: !native },
  async () => {
    const { build } = await import('esbuild')
    const profile = path.join(root, 'profile'),
      transactions = path.join(profile, 'app-updates/transactions')
    fs.mkdirSync(transactions, { recursive: true })
    const cases = []
    for (const phase of ['committed', 'cancelled', 'recovery-failed', 'prepared']) {
      const f = fixture(phase)
      const target = path.join(transactions, path.basename(f.directory))
      fs.renameSync(f.directory, target)
      cases.push({ ...f, directory: target, phase })
    }
    const foreign = fixture('cancelled', { appPath: path.join(root, 'Other.app') })
    fs.renameSync(foreign.directory, path.join(transactions, path.basename(foreign.directory)))
    const { outputFiles } = await build({
      entryPoints: ['src/main/updater/mac.ts'],
      bundle: true,
      platform: 'node',
      format: 'esm',
      write: false,
      define: {
        'process.execPath': JSON.stringify(path.join(appPath, 'Contents/MacOS/Fixture')),
        'process.resourcesPath': JSON.stringify(root)
      },
      plugins: [
        {
          name: 'isolated-backend',
          setup(b) {
            b.onResolve({ filter: /^electron$/ }, () => ({
              path: 'electron',
              namespace: 'fixture'
            }))
            b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
              loader: 'js',
              contents: `export const app={getPath:()=>${JSON.stringify(profile)},getVersion:()=> '1.8.0',isPackaged:true}`
            }))
          }
        }
      ]
    })
    const { MacUpdateBackend } = await import(
      `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
    )
    const backend = new MacUpdateBackend(async () => {
      throw Error('No network allowed')
    })
    await backend.initialize()
    const deadline = Date.now() + 10000
    while (
      cases
        .filter((f) => ['committed', 'cancelled'].includes(f.phase))
        .some((f) => fs.existsSync(f.work))
    ) {
      assert.ok(Date.now() < deadline, 'Background collection did not finish')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    for (const f of cases) {
      const retained = ['recovery-failed', 'prepared'].includes(f.phase)
      assert.equal(fs.existsSync(f.work), retained)
      assert.equal(fs.existsSync(path.join(f.directory, 'payload.zip')), retained)
      assert.equal(fs.existsSync(path.join(f.directory, 'transaction.json')), true)
    }
    assert.equal(fs.existsSync(foreign.work), true)
  }
)

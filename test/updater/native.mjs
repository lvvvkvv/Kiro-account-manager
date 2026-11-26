// Integration tests exercise the production Swift source, not the earlier JS proof of concept.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') throw new Error('macOS desktop session required')
const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')
const root = path.join(
  repo,
  'dist/native-updater-tests',
  new Date().toISOString().replace(/[:.]/g, '-')
)
fs.mkdirSync(root, { recursive: true })
console.log(`Native helper tests: ${root}`)
const run = (exe, args) => execFileSync(exe, args, { encoding: 'utf8', timeout: 180000 })
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const save = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(condition, timeout = 40000) {
  const end = Date.now() + timeout
  while (!condition()) {
    if (Date.now() > end) throw new Error('Test deadline exceeded')
    await sleep(100)
  }
}
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64')
const keySource = path.join(root, 'TrustedKey.swift')
fs.writeFileSync(keySource, `let trustedUpdatePublicKey = "${raw}"\n`)
const helper = path.join(root, 'kiro-updater')
run('/usr/bin/xcrun', [
  'swiftc',
  '-O',
  '-D',
  'UPDATER_TESTING',
  '-o',
  helper,
  path.join(repo, 'build/macos-updater/main.swift'),
  keySource
])
run('/usr/bin/codesign', ['--force', '--sign', '-', helper])
const name = 'Kiro Account Manager.app'
const versions = {}
for (const version of ['0.0.1', '0.0.2']) {
  console.log(`Preparing ${version}`)
  const appPath = path.join(root, version, name)
  run('/usr/bin/ditto', [path.join(repo, 'node_modules/electron/dist/Electron.app'), appPath])
  const plist = path.join(appPath, 'Contents/Info.plist')
  for (const [key, value] of Object.entries({
    CFBundleIdentifier: 'dev.kiro.updater-integration-test',
    CFBundleShortVersionString: version,
    CFBundleVersion: version
  })) {
    run('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist])
  }
  const resources = path.join(appPath, 'Contents/Resources/app')
  fs.mkdirSync(resources)
  save(path.join(resources, 'package.json'), {
    name: 'kiro-native-updater-test',
    version,
    main: 'main.cjs'
  })
  fs.copyFileSync(path.join(here, 'native-fixture.cjs'), path.join(resources, 'main.cjs'))
  run('/usr/bin/codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    '--entitlements',
    path.join(repo, 'build/entitlements.mac.plist'),
    appPath
  ])
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath])
  versions[version] = appPath
}
const archive = path.join(root, 'payload.zip')
run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', versions['0.0.2'], archive])
const manifest = {
  schema: 1,
  version: '0.0.2',
  arch: process.arch,
  bundleId: 'dev.kiro.updater-integration-test',
  appName: name,
  file: `kiro-account-manager-0.0.2-${process.arch}-mac.zip`,
  size: fs.statSync(archive).size,
  sha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
}
const results = []
for (const scenario of [
  'success',
  'invalid-signature',
  'invalid-digest',
  'invalid-architecture',
  'before-swap',
  'after-swap',
  'crash-after-swap',
  'health-timeout',
  'early-startup-hang',
  'cancel-before-exit'
]) {
  console.log(`Running ${scenario}`)
  const caseRoot = path.join(root, scenario)
  fs.mkdirSync(caseRoot)
  const id = crypto.randomUUID()
  const caseArch =
    scenario === 'invalid-architecture'
      ? process.arch === 'arm64'
        ? 'x64'
        : 'arm64'
      : process.arch
  const transaction = path.join(caseRoot, id)
  fs.mkdirSync(transaction, { mode: 0o700 })
  const appPath = path.join(caseRoot, name)
  run('/usr/bin/ditto', [versions['0.0.1'], appPath])
  fs.mkdirSync(path.join(caseRoot, 'user-data'))
  save(path.join(caseRoot, 'fixture.json'), {
    transaction,
    helper,
    failHealth: scenario === 'health-timeout',
    failEarly: scenario === 'early-startup-hang',
    cancelInstall: scenario === 'cancel-before-exit'
  })
  fs.copyFileSync(archive, path.join(transaction, 'payload.zip'))
  const payload = Buffer.from(
    JSON.stringify({
      ...manifest,
      arch: caseArch,
      file: `kiro-account-manager-0.0.2-${caseArch}-mac.zip`,
      ...(scenario === 'invalid-digest' ? { sha256: '0'.repeat(64) } : {})
    })
  )
  save(path.join(transaction, 'envelope.json'), {
    payload: payload.toString('base64'),
    signature: (scenario === 'invalid-signature'
      ? crypto.randomBytes(64)
      : crypto.sign(null, payload, privateKey)
    ).toString('base64')
  })
  const jobPath = path.join(transaction, 'transaction.json')
  let first
  try {
    run('/usr/bin/open', ['-n', appPath])
    await until(() => fs.existsSync(path.join(caseRoot, 'fixture-ready.json')))
    first = read(path.join(caseRoot, 'fixture-ready.json'))
    save(jobPath, {
      id,
      appPath,
      currentVersion: '0.0.1',
      version: '0.0.2',
      arch: caseArch,
      parentPid: first.pid,
      phase: 'created',
      fault: scenario
    })
    if (scenario.startsWith('invalid-')) {
      assert.throws(
        () => run(helper, ['prepare', jobPath]),
        scenario === 'invalid-signature'
          ? /Update signature rejected/
          : scenario === 'invalid-architecture'
            ? /architecture mismatch/
            : /Archive digest mismatch/
      )
      assert.equal(read(jobPath).phase, 'failed')
      process.kill(first.pid, 0)
      assert.equal(
        run('/usr/libexec/PlistBuddy', [
          '-c',
          'Print :CFBundleShortVersionString',
          path.join(appPath, 'Contents/Info.plist')
        ]).trim(),
        '0.0.1'
      )
      results.push({ scenario, passed: true, phase: 'rejected-before-exit' })
    } else {
      run(helper, ['prepare', jobPath])
      assert.equal(read(jobPath).phase, 'prepared')
      fs.writeFileSync(path.join(caseRoot, 'install-now'), '')
      await until(() =>
        ['committed', 'rolled-back', 'recovery-failed', 'failed', 'cancelled'].includes(
          read(jobPath).phase
        )
      )
      const tx = read(jobPath)
      assert.equal(
        tx.phase,
        scenario === 'success'
          ? 'committed'
          : scenario === 'cancel-before-exit'
            ? 'cancelled'
            : 'rolled-back',
        JSON.stringify(tx)
      )
      const health =
        scenario === 'cancel-before-exit' ? first : read(path.join(transaction, 'health.json'))
      assert.equal(health.version, scenario === 'success' ? '0.0.2' : '0.0.1')
      if (scenario === 'cancel-before-exit') {
        process.kill(first.pid, 0)
        // Quit after cancellation and ensure the pending installer never swaps the app.
        process.kill(first.pid, 'SIGTERM')
        await sleep(1000)
        assert.equal(
          run('/usr/libexec/PlistBuddy', [
            '-c',
            'Print :CFBundleShortVersionString',
            path.join(appPath, 'Contents/Info.plist')
          ]).trim(),
          '0.0.1'
        )
      } else assert.notEqual(health.pid, first.pid)
      assert.equal(
        fs.readFileSync(path.join(caseRoot, 'user-data/sentinel'), 'utf8'),
        'created-by-0.0.1'
      )
      run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath])
      results.push({ scenario, passed: true, phase: tx.phase, health, error: tx.error })
    }
    console.log(`PASS ${scenario}`)
  } catch (error) {
    results.push({
      scenario,
      passed: false,
      error: String(error),
      transaction: fs.existsSync(jobPath) ? read(jobPath) : null
    })
    console.error(`FAIL ${scenario}: ${error}`)
  } finally {
    const instanceFile = path.join(caseRoot, 'fixture-instance.json')
    if (fs.existsSync(instanceFile)) {
      const instance = read(instanceFile)
      if (instance.executable.startsWith(appPath + '/')) {
        try {
          process.kill(instance.pid, 'SIGTERM')
        } catch {}
      }
    }
  }
}
save(path.join(root, 'report.json'), {
  os: run('/usr/bin/sw_vers', []),
  arch: process.arch,
  results
})
console.log(`Report: ${path.join(root, 'report.json')}`)
process.exitCode = results.every((result) => result.passed) ? 0 : 1

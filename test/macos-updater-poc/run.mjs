import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'

if (process.platform !== 'darwin') throw new Error('This experiment requires macOS')
const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const root = path.join(repo, 'dist', 'macos-updater-poc', stamp)
fs.mkdirSync(root, { recursive: true })
fs.writeFileSync(path.join(root, '.isolated-updater-poc'), 'Independent Electron update experiment\n')
const bundleId = 'dev.kiro.updater-isolated-poc'
const appName = 'Kiro Update Probe.app'
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2))
const command = (file, args) => execFileSync(file, args, { encoding: 'utf8', timeout: 120000 })
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const publicKeyPath = path.join(root, 'update-public.pem')
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }))
// Ephemeral private key stays in this process; no Apple certificate or keychain access.
const helperPath = path.join(root, 'helper.mjs')
fs.copyFileSync(path.join(here, 'helper.mjs'), helperPath)
const versions = {}
const signatures = {}
console.log(`Lab: ${root}`)
for (const version of ['0.0.1', '0.0.2']) {
  const appPath = path.join(root, 'versions', version, appName)
  console.log(`Building ad-hoc Electron probe ${version}`)
  command('/usr/bin/ditto', [path.join(repo, 'node_modules/electron/dist/Electron.app'), appPath])
  const plist = path.join(appPath, 'Contents/Info.plist')
  for (const [key, value] of Object.entries({ CFBundleIdentifier: bundleId, CFBundleName: 'Kiro Update Probe', CFBundleDisplayName: 'Kiro Update Probe', CFBundleShortVersionString: version, CFBundleVersion: version })) {
    try { command('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist]) }
    catch { command('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plist]) }
  }
  const resources = path.join(appPath, 'Contents/Resources/app')
  fs.mkdirSync(resources)
  save(path.join(resources, 'package.json'), { name: 'kiro-update-isolated-probe', version, main: 'main.cjs' })
  fs.copyFileSync(path.join(here, 'fixture.cjs'), path.join(resources, 'main.cjs'))
  command('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--entitlements', path.join(repo, 'build/entitlements.mac.plist'), appPath])
  command('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath])
  try { execFileSync('/usr/bin/codesign', ['-d', '--verbose=4', appPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  catch (error) { throw new Error(`Could not inspect signature: ${error}`) }
  // codesign's informational output is on stderr.
  signatures[version] = execFileSync('/bin/sh', ['-c', 'exec /usr/bin/codesign -d --verbose=4 "$1" 2>&1', 'codesign-info', appPath], { encoding: 'utf8' })
  assert.match(signatures[version], /Signature=adhoc/)
  assert.match(signatures[version], /TeamIdentifier=not set/)
  versions[version] = appPath
}
save(path.join(root, 'signatures.json'), signatures)
const archivePath = path.join(root, 'update-0.0.2.zip')
command('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', versions['0.0.2'], archivePath])
const manifest = Buffer.from(JSON.stringify({ version: '0.0.2', arch: process.arch, bundleId, sha256: crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex') }))
const manifestPath = path.join(root, 'manifest.json')
const signaturePath = path.join(root, 'manifest.sig')
fs.writeFileSync(manifestPath, manifest)
fs.writeFileSync(signaturePath, crypto.sign(null, manifest, privateKey))
const scenarios = ['success', 'bad-signature', 'after-backup', 'after-replace', 'new-health-timeout', 'helper-crash']
const results = []
for (const scenario of scenarios) {
  console.log(`Running ${scenario}`)
  const caseRoot = path.join(root, scenario)
  fs.mkdirSync(caseRoot)
  const appPath = path.join(caseRoot, appName)
  command('/usr/bin/ditto', [versions['0.0.1'], appPath])
  const configPath = path.join(caseRoot, 'config.json')
  const jobPath = path.join(caseRoot, 'job.json')
  const config = {
    userData: path.join(caseRoot, 'user-data'), token: crypto.randomUUID(), sentinel: crypto.randomUUID(),
    instancePath: path.join(caseRoot, 'instance.json'), healthPath: path.join(caseRoot, 'health.json'),
    eventsPath: path.join(caseRoot, 'events.jsonl'), requestedPath: path.join(caseRoot, 'update-requested'),
    helperLogPath: path.join(caseRoot, 'helper.log'), nodePath: process.execPath, helperPath, jobPath,
    failNewHealth: scenario === 'new-health-timeout'
  }
  fs.mkdirSync(config.userData)
  save(configPath, config)
  const job = {
    root, appPath, backupPath: path.join(caseRoot, 'previous.app'), stagePath: path.join(caseRoot, 'staging'),
    configPath, journalPath: path.join(caseRoot, 'journal.json'), resultPath: path.join(caseRoot, 'result.json'),
    archivePath, manifestPath, signaturePath, publicKeyPath, bundleId, healthTimeoutMs: 12000, fault: scenario
  }
  if (scenario === 'bad-signature') {
    job.signaturePath = path.join(caseRoot, 'invalid.sig')
    fs.writeFileSync(job.signaturePath, crypto.randomBytes(64))
  }
  save(jobPath, job)
  const started = Date.now()
  let recovering = false
  try {
    command('/usr/bin/open', ['-n', appPath, '--args', '--poc-config', configPath])
    while (!fs.existsSync(job.resultPath)) {
      if (Date.now() - started > 90000) throw new Error(`Scenario timeout: ${scenario}`)
      if (scenario === 'helper-crash' && !recovering && fs.existsSync(job.journalPath) && read(job.journalPath).phase === 'backed-up') {
        await delay(1000)
        recovering = true
        const log = fs.openSync(config.helperLogPath, 'a')
        const recovery = spawn(process.execPath, [helperPath, jobPath, String(read(config.instancePath).pid), '--recover'], { stdio: ['ignore', log, log] })
        fs.closeSync(log)
        recovery.on('error', error => console.error(error))
      }
      await delay(200)
    }
    const result = read(job.resultPath)
    assert.equal(result.status, scenario === 'success' ? 'updated' : 'rolled-back')
    assert.equal(result.health.version, scenario === 'success' ? '0.0.2' : '0.0.1')
    assert.equal(result.health.rendererReady, true)
    assert.equal(result.health.sentinel.value, config.sentinel)
    const events = fs.readFileSync(config.eventsPath, 'utf8').trim().split('\n').map(JSON.parse)
    assert.equal(events[0].version, '0.0.1')
    assert.notEqual(result.health.pid, events[0].pid)
    assert(events.some(event => event.event === 'old-exiting'))
    const expectedReason = {
      'bad-signature': /signature rejected/,
      'after-backup': /Injected failure after old bundle backup/,
      'after-replace': /Injected failure after new bundle replacement/,
      'new-health-timeout': /Health timeout for 0.0.2/,
      'helper-crash': /Recovered after helper process interruption/
    }[scenario]
    if (expectedReason) assert.match(result.reason, expectedReason)
    command('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath])
    results.push({ scenario, passed: true, seconds: (Date.now() - started) / 1000, ...result })
    console.log(`PASS ${scenario}: ${result.status}, version ${result.health.version}, PID ${result.health.pid}`)
  } catch (error) {
    results.push({ scenario, passed: false, error: String(error) })
    console.error(`FAIL ${scenario}: ${error}`)
  } finally {
    if (fs.existsSync(config.instancePath)) {
      const instance = read(config.instancePath)
      if (instance.executable.startsWith(appPath + '/')) {
        try { process.kill(instance.pid, 'SIGTERM') } catch {}
      }
    }
  }
}
const report = { time: new Date().toISOString(), os: command('/usr/bin/sw_vers', []), arch: process.arch, electron: read(path.join(repo, 'node_modules/electron/package.json')).version, node: process.version, root, signatures, results }
save(path.join(root, 'report.json'), report)
console.log(`Report: ${path.join(root, 'report.json')}`)
process.exitCode = results.every(result => result.passed) ? 0 : 1

// Experimental external helper. Requires a host Node executable; not a shipping updater.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const [jobPath, oldPidText, mode] = process.argv.slice(2)
const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'))
const root = fs.realpathSync(job.root)
if (!fs.existsSync(path.join(root, '.isolated-updater-poc'))) throw new Error('Missing lab marker')
// Never accept a production installation path or an arbitrary cleanup target.
for (const key of ['appPath', 'backupPath', 'stagePath', 'configPath', 'journalPath', 'resultPath']) {
  if (!path.resolve(job[key]).startsWith(root + path.sep)) throw new Error(`Outside lab: ${key}`)
}
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const save = (file, value) => {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2))
  fs.renameSync(`${file}.tmp`, file)
}
const command = (file, args) => execFileSync(file, args, { encoding: 'utf8', timeout: 120000 })
const exists = file => fs.existsSync(file)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const alive = pid => {
  try { process.kill(pid, 0); return true } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}
async function waitExit(pid, timeout = 15000) {
  const until = Date.now() + timeout
  while (alive(pid)) {
    if (Date.now() > until) throw new Error(`Process did not exit: ${pid}`)
    await delay(100)
  }
}
function journal(phase, extra = {}) {
  save(job.journalPath, { phase, time: new Date().toISOString(), ...extra })
}
function plist(appPath, key) {
  return command('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, path.join(appPath, 'Contents/Info.plist')]).trim()
}
async function stopLaunchedApp() {
  const config = read(job.configPath)
  if (!exists(config.instancePath)) return
  const instance = read(config.instancePath)
  if (instance.token !== config.token || !instance.executable.startsWith(job.appPath + '/')) return
  if (alive(instance.pid)) {
    process.kill(instance.pid, 'SIGTERM')
    await waitExit(instance.pid)
  }
}
async function launch(version) {
  const config = read(job.configPath)
  config.token = crypto.randomUUID()
  save(job.configPath, config)
  command('/usr/bin/open', ['-n', job.appPath, '--args', '--poc-config', job.configPath])
  const until = Date.now() + (job.healthTimeoutMs ?? 15000)
  while (Date.now() < until) {
    if (exists(config.healthPath)) {
      const health = read(config.healthPath)
      if (health.token === config.token && health.version === version && health.rendererReady && alive(health.pid)) {
        if (health.sentinel.value !== config.sentinel || health.sentinel.createdBy !== '0.0.1') {
          throw new Error('Isolated user data did not survive')
        }
        return health
      }
    }
    await delay(100)
  }
  throw new Error(`Health timeout for ${version}`)
}
async function restore(reason) {
  await stopLaunchedApp()
  if (exists(job.backupPath)) {
    fs.rmSync(job.appPath, { recursive: true, force: true })
    fs.renameSync(job.backupPath, job.appPath)
  }
  command('/usr/bin/codesign', ['--verify', '--deep', '--strict', job.appPath])
  const health = await launch('0.0.1')
  journal('rolled-back', { reason })
  save(job.resultPath, { status: 'rolled-back', reason, health })
}

try {
  await waitExit(Number(oldPidText))
  if (mode === '--recover') {
    if (!exists(job.journalPath) || !exists(job.backupPath)) throw new Error('No interrupted transaction to recover')
    await restore('Recovered after helper process interruption')
  } else {
    journal('validating')
    const manifestBytes = fs.readFileSync(job.manifestPath)
    if (!crypto.verify(null, manifestBytes, fs.readFileSync(job.publicKeyPath), fs.readFileSync(job.signaturePath))) {
      throw new Error('Update manifest signature rejected')
    }
    const manifest = JSON.parse(manifestBytes)
    const hash = crypto.createHash('sha256').update(fs.readFileSync(job.archivePath)).digest('hex')
    if (hash !== manifest.sha256) throw new Error('Update archive digest rejected')
    if (manifest.version !== '0.0.2' || manifest.arch !== process.arch || manifest.bundleId !== job.bundleId) {
      throw new Error('Wrong version, architecture or application identity')
    }
    if (exists(job.backupPath) || exists(job.stagePath)) throw new Error('Unfinished transaction exists')
    fs.mkdirSync(job.stagePath)
    command('/usr/bin/ditto', ['-x', '-k', job.archivePath, job.stagePath])
    const stagedApp = path.join(job.stagePath, path.basename(job.appPath))
    command('/usr/bin/codesign', ['--verify', '--deep', '--strict', stagedApp])
    if (plist(stagedApp, 'CFBundleIdentifier') !== manifest.bundleId || plist(stagedApp, 'CFBundleShortVersionString') !== manifest.version) {
      throw new Error('Extracted bundle does not match signed manifest')
    }
    // Both renames are on the installation volume. Keep backup until new renderer is healthy.
    journal('staged')
    fs.renameSync(job.appPath, job.backupPath)
    journal('backed-up')
    if (job.fault === 'after-backup') throw new Error('Injected failure after old bundle backup')
    if (job.fault === 'helper-crash') process.exit(86)
    fs.renameSync(stagedApp, job.appPath)
    journal('replaced')
    if (job.fault === 'after-replace') throw new Error('Injected failure after new bundle replacement')
    const health = await launch('0.0.2')
    journal('healthy')
    save(job.resultPath, { status: 'updated', health, backupRetained: true })
  }
} catch (error) {
  try {
    await restore(String(error))
  } catch (recoveryError) {
    save(job.resultPath, { status: 'recovery-failed', reason: String(error), recoveryError: String(recoveryError), backupRetained: exists(job.backupPath) })
    process.exitCode = 1
  }
}

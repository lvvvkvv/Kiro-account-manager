import { app } from 'electron'
import { constants, createReadStream, createWriteStream } from 'node:fs'
import { access, chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import publicKey from '../../../resources/update-public-key.json'
import type { AppUpdateInfo, SignedMacManifest, UpdateEnvelope } from '../../shared/update'
import { UPDATE_REPO, newerThan, verifyMacManifest } from './manifest'

const exec = promisify(execFile)
export type UpdateFetch = (url: string, options: RequestInit) => Promise<Response>
export class UpdateNetworkError extends Error {}

export async function request(
  fetcher: UpdateFetch,
  url: string,
  timeout = 30000
): Promise<Response> {
  try {
    const response = await fetcher(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Kiro-Account-Manager' },
      signal: AbortSignal.timeout(timeout)
    })
    if (response.status >= 500 || response.status === 429 || response.status === 403)
      throw new UpdateNetworkError(`Update server: HTTP ${response.status}`)
    return response
  } catch (error) {
    throw error instanceof UpdateNetworkError ? error : new UpdateNetworkError(String(error))
  }
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
interface MacTransaction {
  id: string
  appPath: string
  currentVersion: string
  version: string
  arch: string
  parentPid: number
  phase: string
  helperPid?: number | null
  launchToken?: string
  error?: string
}
async function json<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T
}
async function save(file: string, value: unknown): Promise<void> {
  await writeFile(`${file}.tmp`, JSON.stringify(value), { mode: 0o600 })
  await rename(`${file}.tmp`, file)
}

export class MacUpdateBackend {
  readonly root = join(app.getPath('userData'), 'app-updates')
  readonly appPath = resolve(process.execPath, '../../..')
  private cached: {
    info: AppUpdateInfo
    envelope: UpdateEnvelope
    manifest: SignedMacManifest
  } | null = null
  private readonly archive = join(this.root, 'payload.zip')

  constructor(private fetcher: UpdateFetch) {}

  async supported(): Promise<boolean> {
    if (
      !app.isPackaged ||
      !this.appPath.endsWith('.app') ||
      this.appPath.startsWith('/Volumes/') ||
      this.appPath.includes('/AppTranslocation/')
    )
      return false
    try {
      await access(dirname(this.appPath), constants.W_OK)
      await access(join(process.resourcesPath, 'kiro-updater'), constants.X_OK)
      return true
    } catch {
      return false
    }
  }

  async initialize(): Promise<{
    ready: AppUpdateInfo | null
    recovery: string | null
    restarting?: boolean
  }> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    let recovery: string | null = null
    const active = await this.activeDirectory()
    if (active) {
      const tx = await json<MacTransaction>(join(active, 'transaction.json'))
      if (['rolled-back', 'recovery-failed', 'failed', 'cancelled'].includes(tx.phase)) {
        recovery = tx.error || '上次更新未完成 / Previous update did not complete'
      } else if (tx.phase !== 'committed' && tx.phase !== 'created') {
        let running = false
        try {
          if (typeof tx.helperPid === 'number' && tx.helperPid > 1) {
            process.kill(tx.helperPid, 0)
            const processInfo = await exec('/bin/ps', ['-p', String(tx.helperPid), '-o', 'comm='])
            running = processInfo.stdout.trim() === join(active, 'kiro-updater')
          }
        } catch {
          /* interrupted helper */
        }
        if (!running) {
          // A manually started app must exit before recovery swaps its bundle.
          tx.parentPid = process.pid
          tx.helperPid = null
          await save(join(active, 'transaction.json'), tx)
          const armed = join(active, 'recovery-armed')
          await rm(armed, { force: true })
          await this.spawnHelper(active, 'recover')
          // A successful spawn does not mean the helper accepted the transaction.
          // Keep the current app open if validation/locking fails before recovery is armed.
          await this.waitForMarker(armed)
          return { ready: null, recovery: null, restarting: true }
        }
      }
      await this.acknowledge(false)
    }
    try {
      const cached = await json<{ info: AppUpdateInfo; envelope: UpdateEnvelope }>(
        join(this.root, 'pending.json')
      )
      const manifest = verifyMacManifest(
        cached.envelope,
        publicKey.publicKey,
        cached.info.version,
        process.arch
      )
      if (
        newerThan(manifest.version, app.getVersion()) &&
        (await hashFile(this.archive)) === manifest.sha256
      ) {
        this.cached = { ...cached, manifest }
      } else await this.discard()
    } catch {
      await this.discard()
    }
    return { ready: this.cached?.info ?? null, recovery }
  }

  private async activeDirectory(): Promise<string | null> {
    try {
      const active = await json<{ id: string }>(join(this.root, 'active.json'))
      if (typeof active.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(active.id)) return null
      return join(this.root, 'transactions', active.id)
    } catch {
      return null
    }
  }

  async acknowledge(healthy: boolean): Promise<void> {
    const directory = await this.activeDirectory()
    if (!directory) return
    const tx = await json<MacTransaction>(join(directory, 'transaction.json'))
    const index = process.argv.indexOf('--kiro-update-token')
    const token = index >= 0 ? process.argv[index + 1] : null
    if (!token || token !== tx.launchToken || tx.appPath !== this.appPath) return
    const data = {
      token,
      pid: process.pid,
      version: app.getVersion(),
      executable: process.execPath
    }
    await save(join(directory, healthy ? 'health.json' : 'instance.json'), data)
  }

  async manifest(version: string): Promise<UpdateEnvelope | null> {
    const response = await request(
      this.fetcher,
      `https://github.com/${UPDATE_REPO}/releases/download/v${version}/kiro-update-mac-${process.arch}.json`
    )
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Update manifest: HTTP ${response.status}`)
    const text = await response.text()
    if (text.length > 32768) throw new Error('Update manifest is too large')
    const envelope = JSON.parse(text) as UpdateEnvelope
    verifyMacManifest(envelope, publicKey.publicKey, version, process.arch)
    return envelope
  }

  async download(
    info: AppUpdateInfo,
    envelope: UpdateEnvelope,
    progress: (percent: number) => void
  ): Promise<void> {
    const manifest = verifyMacManifest(envelope, publicKey.publicKey, info.version, process.arch)
    if (
      this.cached?.manifest.sha256 === manifest.sha256 &&
      (await hashFile(this.archive).catch(() => '')) === manifest.sha256
    )
      return
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const partial = join(this.root, 'payload.partial')
    try {
      const response = await request(
        this.fetcher,
        `https://github.com/${UPDATE_REPO}/releases/download/v${manifest.version}/${manifest.file}`,
        15 * 60 * 1000
      )
      if (!response.ok || !response.body)
        throw new Error(`Download failed: HTTP ${response.status}`)
      let downloaded = 0
      let notifiedAt = 0
      const hash = createHash('sha256')
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          downloaded += chunk.length
          if (downloaded > manifest.size) {
            callback(new Error('Update size exceeds signed size'))
            return
          }
          hash.update(chunk)
          if (Date.now() - notifiedAt >= 250 || downloaded === manifest.size) {
            notifiedAt = Date.now()
            progress((downloaded / manifest.size) * 100)
          }
          callback(null, chunk)
        }
      })
      await pipeline(
        Readable.fromWeb(response.body as never),
        meter,
        createWriteStream(partial, { mode: 0o600 })
      )
      if (downloaded !== manifest.size || hash.digest('hex') !== manifest.sha256)
        throw new Error('更新包校验失败 / Update digest mismatch')
      await rename(partial, this.archive)
      this.cached = { info, envelope, manifest }
      await save(join(this.root, 'pending.json'), { info, envelope })
    } finally {
      await rm(partial, { force: true })
    }
  }

  async discard(): Promise<void> {
    this.cached = null
    await rm(join(this.root, 'pending.json'), { force: true })
    await rm(this.archive, { force: true })
  }

  async prepareInstall(
    info: AppUpdateInfo
  ): Promise<(action: 'arm' | 'confirm' | 'cancel') => Promise<void>> {
    if (!(await this.supported()))
      throw new Error('请从下载页面手动安装 / Please install manually from Releases')
    if (!this.cached || this.cached.info.version !== info.version)
      throw new Error('Update has not been downloaded')
    const id = randomUUID()
    const directory = join(this.root, 'transactions', id)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await copyFile(this.archive, join(directory, 'payload.zip'))
    await save(join(directory, 'envelope.json'), this.cached.envelope)
    await copyFile(join(process.resourcesPath, 'kiro-updater'), join(directory, 'kiro-updater'))
    await chmod(join(directory, 'kiro-updater'), 0o700)
    await save(join(directory, 'transaction.json'), {
      id,
      appPath: this.appPath,
      currentVersion: app.getVersion(),
      version: info.version,
      arch: process.arch,
      parentPid: process.pid,
      phase: 'created'
    })
    // All expensive validation/extraction happens while the old app is still usable.
    await exec(join(directory, 'kiro-updater'), ['prepare', join(directory, 'transaction.json')], {
      timeout: 180000
    })
    await save(join(this.root, 'active.json'), { id })
    return async (action) => {
      if (action === 'cancel') {
        const tx = await json<MacTransaction>(join(directory, 'transaction.json'))
        if (tx.phase === 'prepared') {
          tx.phase = 'cancelled'
          tx.error = '安装已取消 / Installation cancelled'
          await save(join(directory, 'transaction.json'), tx)
        }
        return
      }
      if (action === 'confirm') {
        const tx = await json<MacTransaction>(join(directory, 'transaction.json'))
        if (tx.phase !== 'prepared' || !tx.helperPid)
          throw new Error('更新已取消，应用保持打开 / Update was cancelled')
        process.kill(tx.helperPid, 0)
        return
      }
      await this.spawnHelper(directory, 'install')
      await this.waitForMarker(join(directory, 'armed'))
    }
  }

  private async waitForMarker(file: string): Promise<void> {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      try {
        await access(file)
        return
      } catch {
        /* waiting for helper */
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('更新辅助程序未就绪，应用保持打开 / Update helper did not become ready')
  }

  private async spawnHelper(directory: string, mode: 'install' | 'recover'): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        join(directory, 'kiro-updater'),
        [mode, join(directory, 'transaction.json')],
        {
          detached: true,
          stdio: 'ignore'
        }
      )
      child.once('error', reject)
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
    })
  }
}

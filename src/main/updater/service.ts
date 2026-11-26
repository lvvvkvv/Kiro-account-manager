import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppUpdateInfo, AppUpdateState, UpdateEnvelope } from '../../shared/update'
import { MacUpdateBackend, request, UpdateNetworkError, type UpdateFetch } from './mac'
import { newerThan, RELEASES_URL, UPDATE_REPO } from './manifest'

interface Options {
  fetch: UpdateFetch
  routingInUse: () => boolean
  prepareQuit: () => Promise<void>
  quit: (nativeInstall?: () => void) => void
  changed: () => void
  renderer: () => BrowserWindow | null
}

export class AppUpdateService {
  private state: AppUpdateState = {
    revision: 0,
    currentVersion: app.getVersion(),
    supported: false,
    enabled: false,
    checking: false,
    downloading: false,
    installing: false,
    available: null,
    ready: null,
    progress: null,
    error: null,
    recovery: null,
    routingInUse: false,
    dismissedVersion: null
  }
  private mac: MacUpdateBackend | null
  private envelope: UpdateEnvelope | null = null
  private checking: Promise<AppUpdateState> | null = null
  private downloading: Promise<void> | null = null
  private installing: Promise<void> | null = null
  private changingPreference: Promise<unknown> = Promise.resolve()
  private preferences = join(app.getPath('userData'), 'app-updates', 'preferences.json')
  private savePreferences: Promise<void> = Promise.resolve()
  private quitAck: { token: string; resolve: () => void; reject: (error: Error) => void } | null =
    null

  constructor(private options: Options) {
    this.mac = process.platform === 'darwin' ? new MacUpdateBackend(options.fetch) : null
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowDowngrade = false
    autoUpdater.allowPrerelease = false
  }

  snapshot(): AppUpdateState {
    return { ...this.state, routingInUse: this.options.routingInUse() }
  }
  private patch(change: Partial<AppUpdateState>): void {
    Object.assign(this.state, change, { revision: this.state.revision + 1 })
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send('app-update-state', this.snapshot())
    if (change.ready !== undefined || change.installing !== undefined) this.options.changed()
  }
  private error(error: unknown): void {
    this.patch({ error: error instanceof Error ? error.message : String(error) })
  }

  async initialize(): Promise<void> {
    try {
      await mkdir(join(app.getPath('userData'), 'app-updates'), { recursive: true, mode: 0o700 })
    } catch (error) {
      this.error(error)
    }
    try {
      const prefs = JSON.parse(await readFile(this.preferences, 'utf8'))
      this.state.enabled = prefs.enabled === true
      this.state.dismissedVersion =
        typeof prefs.dismissedVersion === 'string' ? prefs.dismissedVersion : null
    } catch {
      /* default: manual download */
    }
    this.state.supported =
      app.isPackaged &&
      (this.mac
        ? await this.mac.supported()
        : process.platform === 'win32'
          ? !process.env.PORTABLE_EXECUTABLE_DIR
          : !!process.env.APPIMAGE)
    if (!this.state.supported)
      this.state.unsupportedReason =
        '此安装位置或安装方式不支持自动安装，请使用下载页面。 / Use the download page for this installation.'
    if (this.mac) {
      try {
        const cached = await this.mac.initialize()
        if (cached.restarting) {
          this.options.quit()
          return
        }
        this.state.recovery = cached.recovery
        if (this.state.enabled) this.state.ready = this.state.available = cached.ready
        else await this.mac.discard()
      } catch (error) {
        // Damaged update cache must never prevent the main application from opening.
        this.error(error)
      }
    } else {
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'lvvvkvv',
        repo: 'Kiro-account-manager',
        ...(process.platform === 'win32' ? { channel: `latest-${process.arch}` } : {})
      })
      autoUpdater.on('download-progress', (progress) => this.patch({ progress: progress.percent }))
      autoUpdater.on('error', (error) => {
        this.error(error)
        this.patch({ installing: false })
      })
    }
    this.registerIPC()
    this.patch({ ready: this.state.ready })
    if (app.isPackaged) {
      setTimeout(() => {
        void this.check().catch(() => {})
      }, 1000).unref()
      setTimeout(() => {
        if (this.state.enabled) void this.download().catch(() => {})
      }, 60000).unref()
      setInterval(
        () => {
          if (this.state.enabled) void this.download().catch(() => {})
        },
        6 * 60 * 60 * 1000
      ).unref()
    }
  }

  private persist(): Promise<void> {
    const value = JSON.stringify({
      enabled: this.state.enabled,
      dismissedVersion: this.state.dismissedVersion
    })
    this.savePreferences = this.savePreferences
      .catch(() => {})
      .then(async () => {
        await writeFile(`${this.preferences}.tmp`, value, { mode: 0o600 })
        await rename(`${this.preferences}.tmp`, this.preferences)
      })
    return this.savePreferences
  }

  private async inspect(): Promise<AppUpdateInfo | null> {
    if (!this.mac && this.state.supported) {
      const result = await autoUpdater.checkForUpdates().catch((error: NodeJS.ErrnoException) => {
        if (
          ['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH'].includes(
            error.code || ''
          )
        ) {
          throw new UpdateNetworkError(error.message)
        }
        throw error
      })
      if (!result?.isUpdateAvailable) return null
      const info = result.updateInfo
      return {
        version: info.version,
        notes:
          typeof info.releaseNotes === 'string' ? info.releaseNotes.replace(/<[^>]*>/g, '') : '',
        publishedAt: info.releaseDate,
        installable: this.state.supported
      }
    }
    const response = await request(
      this.options.fetch,
      `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`
    )
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`检查更新失败 / Update check: HTTP ${response.status}`)
    const release = (await response.json()) as {
      tag_name: string
      body?: string
      published_at?: string
      draft?: boolean
      prerelease?: boolean
    }
    if (release.draft || release.prerelease) return null
    const version = release.tag_name?.replace(/^v/, '')
    if (!newerThan(version, app.getVersion())) return null
    this.envelope = this.mac ? await this.mac.manifest(version) : null
    return {
      version,
      notes: release.body || '',
      publishedAt: release.published_at,
      installable: this.state.supported && !!this.envelope
    }
  }

  check(autoDownload = true): Promise<AppUpdateState> {
    if (this.checking) return this.checking
    if (this.state.downloading || this.state.installing) return Promise.resolve(this.snapshot())
    this.checking = (async () => {
      this.patch({ checking: true, error: null })
      try {
        const available = await this.inspect()
        if (
          !available ||
          this.state.ready?.version !== available.version ||
          !available.installable
        ) {
          this.patch({ ready: null })
          if (this.mac) await this.mac.discard()
        }
        this.patch({ available })
        return this.snapshot()
      } catch (error) {
        this.error(error)
        throw error
      } finally {
        this.patch({ checking: false })
        this.checking = null
      }
    })()
    const result = this.checking
    if (autoDownload)
      void result.then(
        () => {
          if (this.state.enabled && this.state.available?.installable && !this.state.ready)
            void this.download(false).catch(() => {})
        },
        () => {}
      )
    return result
  }

  download(checkFirst = true): Promise<void> {
    if (this.downloading) return this.downloading
    if (this.state.installing) return Promise.resolve()
    this.downloading = this.downloadNow(checkFirst).finally(() => {
      this.downloading = null
    })
    return this.downloading
  }
  private async downloadNow(checkFirst: boolean): Promise<void> {
    try {
      if (checkFirst) await this.check(false)
      const info = this.state.available
      if (!info) return
      if (!info.installable)
        throw new Error(
          '此版本无法自动安装，请使用手动下载。 / This release requires manual download.'
        )
      if (this.state.ready?.version === info.version) return
      this.patch({ downloading: true, progress: 0, error: null })
      if (this.mac && this.envelope)
        await this.mac.download(info, this.envelope, (progress) => this.patch({ progress }))
      else await autoUpdater.downloadUpdate()
      this.patch({ ready: info, progress: 100 })
    } catch (error) {
      this.error(error)
      throw error
    } finally {
      this.patch({ downloading: false })
    }
  }

  install(): Promise<void> {
    if (this.installing) return this.installing
    this.installing = this.installNow().finally(() => {
      this.installing = null
    })
    return this.installing
  }
  private async installNow(): Promise<void> {
    let arm: Awaited<ReturnType<MacUpdateBackend['prepareInstall']>> | null = null
    try {
      if (this.downloading) await this.downloading
      // Refresh before installation. Only a network failure permits verified cached installation.
      try {
        await this.check(false)
      } catch (error) {
        if (!this.state.ready || !(error instanceof UpdateNetworkError)) throw error
      }
      if (!this.state.available && !this.state.ready) return
      await this.download(false)
      const info = this.state.ready
      if (!info || !this.state.supported)
        throw new Error('请手动下载安装 / Please download and install manually')
      this.patch({ installing: true, error: null })
      arm = this.mac ? await this.mac.prepareInstall(info) : null
      await this.flushRenderer()
      if (arm) await arm('arm')
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          this.options.prepareQuit(),
          new Promise<never>((_resolve, reject) => {
            cleanupTimer = setTimeout(
              () =>
                reject(
                  new Error(
                    '退出清理超时，已取消更新；请检查反代状态。 / Shutdown timed out; check proxy status.'
                  )
                ),
              20000
            )
          })
        ])
      } finally {
        clearTimeout(cleanupTimer)
      }
      if (arm) {
        await arm('confirm')
        this.options.quit()
      } else {
        this.options.quit(() => autoUpdater.quitAndInstall(false, true))
      }
    } catch (error) {
      await arm?.('cancel').catch((cancelError) =>
        console.error('[Updater] Cancellation failed:', cancelError)
      )
      this.error(error)
      this.patch({ installing: false })
      throw error
    }
  }

  setEnabled(enabled: boolean): Promise<AppUpdateState> {
    const operation = this.changingPreference
      .catch(() => {})
      .then(() => this.changeEnabled(enabled))
    this.changingPreference = operation
    return operation
  }

  private async changeEnabled(enabled: boolean): Promise<AppUpdateState> {
    if (this.installing) throw new Error('正在准备安装 / Installation is in progress')
    if (typeof enabled !== 'boolean') throw new Error('Invalid update preference')
    if (enabled && !this.state.supported) throw new Error(this.state.unsupportedReason)
    const previous = this.state.enabled
    this.patch({ enabled })
    try {
      await this.persist()
    } catch (error) {
      this.patch({ enabled: previous })
      throw error
    }
    if (enabled) void this.download().catch(() => {})
    else {
      if (this.downloading) await this.downloading.catch(() => {})
      if (this.mac) await this.mac.discard()
      this.patch({ ready: null })
    }
    return this.snapshot()
  }

  async dismiss(): Promise<AppUpdateState> {
    this.patch({ dismissedVersion: this.state.ready?.version ?? null })
    await this.persist()
    return this.snapshot()
  }

  async openDownload(): Promise<void> {
    await shell.openExternal(RELEASES_URL)
  }

  private async flushRenderer(): Promise<void> {
    const renderer = this.options.renderer()
    if (!renderer || renderer.isDestroyed()) return
    const token = randomUUID()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.quitAck = null
        reject(new Error('保存数据超时，已取消更新 / Saving data timed out'))
      }, 15000)
      this.quitAck = {
        token,
        resolve: () => {
          clearTimeout(timer)
          this.quitAck = null
          resolve()
        },
        reject: (error) => {
          clearTimeout(timer)
          this.quitAck = null
          reject(error)
        }
      }
      renderer.webContents.send('app-update:prepare-quit', token)
    })
  }

  private registerIPC(): void {
    const handle = (channel: string, action: (...args: unknown[]) => unknown): void => {
      ipcMain.handle(channel, (event, ...args) => {
        if (
          event.sender !== this.options.renderer()?.webContents ||
          event.senderFrame !== event.sender.mainFrame
        )
          throw new Error('Untrusted update caller')
        return action(...args)
      })
    }
    handle('app-update:get', () => this.snapshot())
    handle('app-update:check', () => this.check())
    handle('app-update:install', () => this.install())
    handle('app-update:enabled', (value) => {
      if (typeof value !== 'boolean') throw new Error('Invalid update preference')
      return this.setEnabled(value)
    })
    handle('app-update:dismiss', () => this.dismiss())
    handle('app-update:download-page', () => this.openDownload())
    handle('app-update:renderer-ready', () => this.mac?.acknowledge(true))
    handle('app-update:quit-ready', (token, error) => {
      if (token !== this.quitAck?.token) return
      if (error) this.quitAck?.reject(new Error(String(error)))
      else this.quitAck?.resolve()
    })
  }
}

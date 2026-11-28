import { randomUUID } from 'crypto'
import { ipcMain, type BrowserWindow } from 'electron'
import { waitFor, withDeadline } from '../shared/async'

/** One exit preparation shared by close, tray exit and an authorized restart. */
export class AppQuitCoordinator {
  private pending: Promise<void> | undefined
  private ack:
    | {
        token: string
        sender: Electron.WebContents
        resolve: () => void
        reject: (error: Error) => void
      }
    | undefined
  private finished = false
  private flushing: Promise<void> | undefined
  constructor(
    private renderer: () => BrowserWindow | null,
    private cleanup: () => Promise<void>,
    private finish: () => void,
    private failed: (error: unknown) => void = (error) =>
      console.error('[Exit] Shutdown preparation failed:', error),
    private beforeFlush: () => Promise<void> = async () => {},
    private resume: () => void = () => {}
  ) {
    ipcMain.handle('app-quit:ready', (event, token: string, error?: string) => {
      if (
        !this.ack ||
        event.sender !== this.ack.sender ||
        event.senderFrame !== event.sender.mainFrame ||
        token !== this.ack.token
      )
        return
      if (error) this.ack.reject(new Error(error))
      else this.ack.resolve()
    })
  }
  get isPreparing(): boolean {
    return !!this.pending
  }
  async flushRenderer(): Promise<void> {
    if (this.flushing) return this.flushing
    const window = this.renderer()
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
    // No renderer data exists before its first document has loaded.
    if (!window.webContents.getURL()) return
    this.flushing = withDeadline(
      () =>
        new Promise<void>((resolve, reject) => {
          const token = randomUUID()
          this.ack = { token, sender: window.webContents, resolve, reject }
          window.webContents.send('app-quit:prepare', token)
        }),
      15000,
      undefined,
      '保存窗口数据超时'
    ).finally(() => {
      this.ack = undefined
      this.flushing = undefined
    })
    return this.flushing
  }
  prepare(): Promise<void> {
    return (this.pending ??= withDeadline(
      async (signal) => {
        await waitFor(this.beforeFlush(), signal)
        await this.flushRenderer()
        signal.throwIfAborted()
        await this.cleanup()
      },
      30000,
      undefined,
      '退出清理超时'
    )
      .catch((error) => {
        this.resume()
        throw error
      })
      .finally(() => {
        this.pending = undefined
      }))
  }
  async request(): Promise<void> {
    if (this.finished) return
    try {
      await this.prepare()
    } catch (error) {
      this.failed(error)
      return
    }
    if (!this.finished) {
      this.finished = true
      this.finish()
    }
  }
}

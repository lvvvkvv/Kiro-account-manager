/** One pending snapshot and one write; failed optional backups remain retryable. */
export class AccountBackupScheduler {
  private pending: unknown = null
  private writing: Promise<void> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private lastSuccess: number | undefined
  private failures = 0
  constructor(
    private write: (data: unknown) => Promise<void>,
    private changed: (error: string | null) => void,
    private interval = 5 * 60 * 1000
  ) {}

  request(data: unknown): void {
    this.pending = data
    this.failures = 0
    if (!this.writing)
      this.schedule(
        this.lastSuccess === undefined
          ? 0
          : Math.max(0, this.interval - (Date.now() - this.lastSuccess))
      )
  }

  private schedule(delay: number): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.run()
    }, delay)
  }

  private run(): Promise<void> {
    if (this.writing) return this.writing
    if (this.pending == null) return Promise.resolve()
    const data = this.pending
    this.pending = null
    this.writing = Promise.resolve()
      .then(async () => {
        try {
          await this.write(data)
          this.lastSuccess = Date.now()
          this.failures = 0
          this.changed(null)
        } catch (error) {
          if (this.pending == null) this.pending = data
          this.failures++
          this.changed(error instanceof Error ? error.message : String(error))
        }
      })
      .finally(() => {
        this.writing = undefined
        if (this.pending != null && this.failures < 3) {
          this.schedule(this.failures ? this.failures * 5000 : this.interval)
        }
      })
    return this.writing
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.writing) await this.writing
    // A newer snapshot may have arrived during the active write. Retry a failed snapshot once.
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    while (this.pending != null) {
      await this.run()
      if (this.failures) break
    }
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }
}

import { globalShortcut } from 'electron'
export class WindowShortcut {
  private active = ''
  private tail: Promise<unknown> = Promise.resolve()
  value = ''
  constructor(
    private show: () => void,
    private persist: (value: string) => Promise<void>
  ) {}
  start(value: string): void {
    this.value = value
    if (value && globalShortcut.register(value, this.show)) this.active = value
  }
  set(value: string): Promise<{ success: boolean; error?: string }> {
    const job = this.tail
      .catch(() => {})
      .then(async () => {
        if (typeof value !== 'string') return { success: false, error: '快捷键格式无效' }
        const previous = this.active
        let registered = false
        try {
          if (value && value !== previous) {
            registered = globalShortcut.register(value, this.show)
            if (!registered) throw new Error('快捷键已被占用或不受支持')
          }
          await this.persist(value)
          if (previous && previous !== value) globalShortcut.unregister(previous)
          this.active = value
          this.value = value
          return { success: true }
        } catch (error) {
          if (registered) globalShortcut.unregister(value)
          return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
      })
    this.tail = job
    return job
  }
}

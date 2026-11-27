import { tokenRefreshConcurrency } from '../shared/tokenRefresh'

/** One queue across manual, background, IDE and proxy refresh paths. */
export class TokenRefreshCoordinator<T> {
  private readonly inFlight = new Map<string, Promise<T>>()
  private readonly queue: Array<() => void> = []
  private active = 0

  constructor(private readonly getConcurrency: () => number | undefined) {}

  run(key: string, refresh: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key)
    if (existing) return existing

    const task = new Promise<T>((resolve, reject) => {
      this.queue.push(() => {
        this.active++
        const finish = (): void => {
          this.active--
          this.inFlight.delete(key)
          this.drain()
        }
        void Promise.resolve()
          .then(refresh)
          .then(
            (value) => {
              finish()
              resolve(value)
            },
            (error) => {
              finish()
              reject(error)
            }
          )
      })
    })
    this.inFlight.set(key, task)
    this.drain()
    return task
  }

  private drain(): void {
    const limit = tokenRefreshConcurrency(this.getConcurrency())
    while (this.active < limit && this.queue.length > 0) this.queue.shift()!()
  }
}

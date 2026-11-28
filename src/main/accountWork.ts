/** Track accepted account jobs so exit can wait for credential commits without starting more. */
export class AccountWork {
  paused = false
  private active = new Set<Promise<unknown>>()

  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.paused)
      return Promise.reject(new Error('正在准备退出，请稍后重试 / Preparing to quit'))
    const task = Promise.resolve().then(work)
    this.active.add(task)
    const finished = (): void => {
      this.active.delete(task)
    }
    void task.then(finished, finished)
    return task
  }

  async pause(): Promise<void> {
    this.paused = true
    while (this.active.size) await Promise.allSettled([...this.active])
  }
}

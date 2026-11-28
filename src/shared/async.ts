export function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error && signal.reason.name !== 'AbortError'
      ? signal.reason
      : new Error('任务已取消')
  }
}

/** Race a wait, while still observing a late rejection from the underlying operation. */
export function waitFor<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      try {
        checkAborted(signal)
      } catch (error) {
        reject(error)
      }
    }
    signal.addEventListener('abort', abort, { once: true })
    work.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        if (signal.aborted) abort()
        else resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      }
    )
    if (signal.aborted) {
      signal.removeEventListener('abort', abort)
      abort()
    }
  })
}

export async function withDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number,
  parent?: AbortSignal,
  message = '请求超时'
): Promise<T> {
  checkAborted(parent)
  const controller = new AbortController()
  const abort = (): void => controller.abort(parent?.reason)
  parent?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error(message)), Math.max(0, ms))
  try {
    return await waitFor(
      Promise.resolve().then(() => {
        checkAborted(controller.signal)
        return work(controller.signal)
      }),
      controller.signal
    )
  } finally {
    clearTimeout(timer)
    parent?.removeEventListener('abort', abort)
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  checkAborted(signal)
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer)
      try {
        checkAborted(signal)
      } catch (error) {
        reject(error)
      }
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

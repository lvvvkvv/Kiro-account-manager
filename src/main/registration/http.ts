import {
  fetch as undiciFetch,
  type Dispatcher,
  type RequestInit as UndiciRequestInit
} from 'undici'
import { safeCreateProxyAgent } from '../proxy/systemProxy'
import { checkAborted, withDeadline } from './async'

/** One owner reuses its current proxy dispatcher; idle mailbox owners release it automatically. */
export class RegistrationHttpClient {
  private agent?: Dispatcher
  private proxy?: string
  private idleTimer?: ReturnType<typeof setTimeout>
  private active = 0

  private release(agent?: Dispatcher): void {
    if (!agent) return
    const timer = setTimeout(() => {
      void agent.destroy().catch(() => {})
    }, 25000)
    timer.unref?.()
    void agent
      .close()
      .catch(() => agent.destroy())
      .catch(() => {})
      .finally(() => clearTimeout(timer))
  }

  close(): void {
    clearTimeout(this.idleTimer)
    this.release(this.agent)
    this.agent = undefined
    this.proxy = undefined
  }

  async read<T>(
    url: string,
    proxy: string | undefined,
    options: RequestInit,
    consume: (response: Response) => Promise<T>,
    timeoutMs = 15000
  ): Promise<T> {
    checkAborted(options.signal ?? undefined)
    clearTimeout(this.idleTimer)
    if (proxy !== this.proxy) {
      this.release(this.agent)
      this.proxy = proxy
      this.agent = safeCreateProxyAgent(proxy)
    }
    const dispatcher = this.agent
    this.active++
    try {
      return await withDeadline(
        async (signal) => {
          const response = dispatcher
            ? ((await undiciFetch(url, {
                ...options,
                signal,
                dispatcher
              } as UndiciRequestInit)) as unknown as Response)
            : await fetch(url, { ...options, signal })
          return await consume(response)
        },
        timeoutMs,
        options.signal ?? undefined
      )
    } finally {
      if (--this.active === 0) {
        this.idleTimer = setTimeout(() => this.close(), 30000)
        this.idleTimer.unref?.()
      }
    }
  }
}

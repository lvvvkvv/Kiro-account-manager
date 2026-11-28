import { ipcMain } from 'electron'
import { checkAborted, sleep, waitFor, withDeadline } from '../../shared/async'
import type { WebhookDeliveryInput, WebhookDeliveryResult } from '../../shared/webhooks'

type Fetcher = (url: string, options: RequestInit) => Promise<Response>

/** One request at a time per destination; no more than four destinations use sockets concurrently. */
export function registerWebhookIPC(fetcher: Fetcher): void {
  const active = new Map<string, Set<AbortController>>()
  const queues = new Map<
    string,
    { tail: Promise<unknown>; pending: number; timestamps: number[] }
  >()
  const slots: Array<{
    resolve: (release: () => void) => void
    reject: (error: Error) => void
    signal: AbortSignal
    abort: () => void
  }> = []
  let running = 0
  function release(): void {
    const next = slots.shift()
    if (next) {
      next.signal.removeEventListener('abort', next.abort)
      next.resolve(release)
    } else running--
  }
  async function acquire(signal: AbortSignal): Promise<() => void> {
    checkAborted(signal)
    if (running < 4) {
      running++
      return release
    }
    if (slots.length >= 100) throw new Error('Webhook 发送队列已满')
    return new Promise((resolve, reject) => {
      const item = {
        resolve,
        reject,
        signal,
        abort: (): void => {
          const index = slots.indexOf(item)
          if (index >= 0) slots.splice(index, 1)
          reject(new Error('通知已取消'))
        }
      }
      slots.push(item)
      signal.addEventListener('abort', item.abort, { once: true })
    })
  }
  ipcMain.handle('webhook-cancel', (_event, id: string) => {
    for (const controller of active.get(id) || []) controller.abort(new Error('通知已取消'))
  })
  ipcMain.handle(
    'webhook-send',
    async (_event, input: WebhookDeliveryInput): Promise<WebhookDeliveryResult> => {
      let controller: AbortController | undefined
      try {
        if (
          !input ||
          typeof input.id !== 'string' ||
          !input.id ||
          typeof input.body !== 'string' ||
          input.body.length > 1024 * 1024
        )
          throw new Error('Webhook 参数无效')
        const url = new URL(input.url)
        if (!['https:', 'http:'].includes(url.protocol))
          throw new Error('Webhook 仅支持 HTTP/HTTPS')
        const key = url.href
        const queue = queues.get(key) || { tail: Promise.resolve(), pending: 0, timestamps: [] }
        if (queue.pending >= 20)
          return { success: false, error: 'Webhook 发送队列已满', rateLimited: true }
        queues.set(key, queue)
        queue.pending++
        controller = new AbortController()
        const group = active.get(input.id) || new Set<AbortController>()
        group.add(controller)
        active.set(input.id, group)
        const previous = queue.tail
        const task = withDeadline(
          async (signal) => {
            await waitFor(previous, signal)
            checkAborted(signal)
            let lastError = '通知发送失败'
            for (let attempt = 0; attempt <= 3; attempt++) {
              if (attempt) await sleep(1500 * 2 ** (attempt - 1), signal)
              const releaseSlot = await acquire(signal)
              try {
                checkAborted(signal)
                const now = Date.now()
                queue.timestamps = queue.timestamps.filter((time) => now - time < 60000)
                if (queue.timestamps.length >= 20)
                  return {
                    success: false,
                    error: 'Webhook 发送频率超限，请稍后重试',
                    rateLimited: true
                  }
                queue.timestamps.push(now)
                const result = await withDeadline(
                  async (signal) => {
                    const response = await fetcher(key, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: input.body,
                      signal
                    })
                    const body = await response.text()
                    return { ok: response.ok, status: response.status, body }
                  },
                  8000,
                  signal,
                  'Webhook 请求超时'
                )
                if (result.ok) {
                  // Providers may report a rejected delivery in a successful HTTP response.
                  try {
                    const ack = JSON.parse(result.body)
                    const code =
                      input.kind === 'feishu'
                        ? ack.code
                        : ['dingtalk', 'wechat-work'].includes(input.kind)
                          ? ack.errcode
                          : undefined
                    if (
                      (input.kind === 'telegram' && ack.ok === false) ||
                      (typeof code === 'number' && code !== 0)
                    )
                      return {
                        success: false,
                        error: String(
                          ack.description || ack.errmsg || ack.msg || 'Webhook 服务拒绝了消息'
                        )
                      }
                  } catch {
                    /* Empty/text acknowledgements are valid for Discord and custom receivers. */
                  }
                  return { success: true }
                }
                lastError = `HTTP ${result.status}`
                if (
                  result.status >= 400 &&
                  result.status < 500 &&
                  ![408, 429].includes(result.status)
                )
                  return { success: false, error: lastError }
              } catch (error) {
                checkAborted(signal)
                lastError = error instanceof Error ? error.message : String(error)
              } finally {
                releaseSlot()
              }
            }
            return { success: false, error: lastError }
          },
          45000,
          controller.signal,
          'Webhook 等待超时'
        )
        queue.tail = previous.then(() => task).catch(() => {})
        try {
          return await task
        } finally {
          queue.pending--
          const timer = setTimeout(() => {
            if (
              !queue.pending &&
              queues.get(key) === queue &&
              queue.timestamps.every((time) => Date.now() - time >= 60000)
            )
              queues.delete(key)
          }, 60000)
          timer.unref?.()
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      } finally {
        if (controller) {
          const group = active.get(input.id)
          group?.delete(controller)
          if (!group?.size) active.delete(input.id)
        }
      }
    }
  )
}

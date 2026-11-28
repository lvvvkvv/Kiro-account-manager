import { fetch, type Dispatcher } from 'undici'
import { safeCreateProxyAgent } from './proxy/systemProxy'

const tasks = new Map<string, Set<AbortController>>()

export function beginDiagnostic(requestId?: string): {
  controller: AbortController
  finish: () => void
} {
  const controller = new AbortController()
  if (requestId) {
    const group = tasks.get(requestId) || new Set<AbortController>()
    group.add(controller)
    tasks.set(requestId, group)
  }
  return {
    controller,
    finish: () => {
      if (!requestId) return
      const group = tasks.get(requestId)
      group?.delete(controller)
      if (!group?.size) tasks.delete(requestId)
    }
  }
}

export function cancelDiagnostic(requestId: string): void {
  for (const controller of tasks.get(requestId) || []) controller.abort(new Error('已取消'))
}

export async function runDiagnostics(params: {
  requestId?: string
  proxyUrl?: string
  targets: Array<{
    id: string
    label: string
    url: string
    timeoutMs?: number
    expectStatus?: number[]
  }>
}): Promise<{
  results: Array<{
    id: string
    label: string
    url: string
    success: boolean
    httpStatus?: number
    latencyMs: number
    error?: string
  }>
}> {
  let agent: Dispatcher | null = null
  try {
    agent = params.proxyUrl ? safeCreateProxyAgent(params.proxyUrl) || null : null
    return {
      results: await Promise.all(
        params.targets.map(async (target) => {
          const { controller, finish } = beginDiagnostic(params.requestId)
          const timer = setTimeout(() => controller.abort(), target.timeoutMs ?? 8000)
          const start = Date.now()
          try {
            if (params.proxyUrl && !agent) throw new Error('代理 URL 无效或协议不支持')
            const response = await fetch(target.url, {
              dispatcher: agent || undefined,
              signal: controller.signal,
              headers: { 'User-Agent': 'KiroAccountManager-Diagnose/1.0' }
            })
            const success = target.expectStatus
              ? target.expectStatus.includes(response.status)
              : response.status >= 200 && response.status < 400
            // Only response headers are needed. Cancel unread streams before disposing the dispatcher.
            await response.body?.cancel()
            return {
              id: target.id,
              label: target.label,
              url: target.url,
              success,
              httpStatus: response.status,
              latencyMs: Date.now() - start,
              error: success ? undefined : `HTTP ${response.status}`
            }
          } catch (error) {
            return {
              id: target.id,
              label: target.label,
              url: target.url,
              success: false,
              latencyMs: Date.now() - start,
              error: controller.signal.aborted
                ? controller.signal.reason?.message === '已取消'
                  ? '已取消'
                  : '超时'
                : error instanceof Error
                  ? error.message
                  : String(error)
            }
          } finally {
            clearTimeout(timer)
            finish()
          }
        })
      )
    }
  } finally {
    await agent?.destroy()
  }
}

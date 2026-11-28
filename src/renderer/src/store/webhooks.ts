import { isRecord } from '../../../shared/kiroSettings'
import { create } from 'zustand'

/**
 * Webhook 通知中心
 *
 * 用于把关键事件（批量完成、风控触发、单账号注册成功/失败等）推送到外部 IM。
 * 内置常见 IM 的消息模板：钉钉 / 企微 / Telegram / Discord / 自定义 JSON。
 */

import type { WebhookKind } from '../../../shared/webhooks'
export type { WebhookKind } from '../../../shared/webhooks'

export interface WebhookEntry {
  id: string
  kind: WebhookKind
  url: string
  label?: string
  enabled: boolean
  /** Telegram bot 模式需要 chat_id */
  telegramChatId?: string
  /** 自定义模式的 JSON 模板，{{title}} {{message}} {{level}} 占位符 */
  customTemplate?: string
  /** 订阅哪些事件 */
  events: WebhookEvent[]
  createdAt: number
}

export type WebhookEvent =
  | 'batch-completed' // 批量任务完成
  | 'batch-error' // 批量任务严重错误
  | 'risk-warning' // 风控警告触发
  | 'account-banned' // 账号被封禁
  | 'register-success' // 单账号注册成功
  | 'register-failed' // 单账号注册失败
  | 'token-expired' // Token 过期/刷新失败

export const ALL_WEBHOOK_EVENTS: { value: WebhookEvent; label: string; labelEn: string }[] = [
  { value: 'batch-completed', label: '批量任务完成', labelEn: 'Batch completed' },
  { value: 'batch-error', label: '批量任务严重错误', labelEn: 'Batch error' },
  { value: 'risk-warning', label: '风控警告触发', labelEn: 'Risk warning' },
  { value: 'account-banned', label: '账号被封禁', labelEn: 'Account banned' },
  { value: 'register-success', label: '注册成功（单账号）', labelEn: 'Register success' },
  { value: 'register-failed', label: '注册失败（单账号）', labelEn: 'Register failed' },
  { value: 'token-expired', label: 'Token 过期/刷新失败', labelEn: 'Token expired' }
]

export interface WebhookMessage {
  title: string
  message: string
  level: 'info' | 'warn' | 'error' | 'success'
  /** 可选的额外字段（追加到 message 后） */
  fields?: Record<string, string | number>
}

export type WebhookInput = Omit<WebhookEntry, 'id' | 'createdAt'>

interface WebhooksState {
  webhooks: Map<string, WebhookEntry>
}

interface WebhooksActions {
  addWebhook: (input: WebhookInput) => string
  importWebhooks: (entries: WebhookInput[]) => { added: number; skipped: number }
  updateWebhook: (id: string, updates: Partial<WebhookEntry>) => void
  removeWebhook: (id: string) => void
  toggleWebhook: (id: string) => void
  /** 触发某个事件：自动给所有订阅了该事件的启用 webhook 发推送 */
  triggerEvent: (event: WebhookEvent, payload: WebhookMessage) => Promise<void>
  /** 测试单个 webhook（发一条测试消息） */
  testWebhook: (id: string) => Promise<{ success: boolean; error?: string }>
  /** 持久化加载（在 store 初始化时调用） */
  loadFromStorage: () => void
  saveToStorage: () => void
}

type WebhooksStore = WebhooksState & WebhooksActions

const STORAGE_KEY = 'kiro-webhooks'

export const useWebhookStore = create<WebhooksStore>()((set, get) => ({
  webhooks: new Map(),

  addWebhook: (input) => {
    const id = crypto.randomUUID()
    const entry: WebhookEntry = {
      ...input,
      id,
      createdAt: Date.now()
    }
    set((state) => {
      const next = new Map(state.webhooks)
      next.set(id, entry)
      return { webhooks: next }
    })
    get().saveToStorage()
    return id
  },

  importWebhooks: (inputs) => {
    const next = new Map(get().webhooks)
    const keys = new Set(Array.from(next.values(), webhookIdentity))
    let added = 0
    for (const input of inputs) {
      const entry = parseWebhookInput(input)
      const key = webhookIdentity(entry)
      if (keys.has(key)) continue
      keys.add(key)
      const id = crypto.randomUUID()
      next.set(id, { ...entry, id, createdAt: Date.now() })
      added++
    }
    if (added) {
      // Persist before publishing; a quota error must not be reported as a successful import.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next.values())))
      set({ webhooks: next })
    }
    return { added, skipped: inputs.length - added }
  },

  updateWebhook: (id, updates) => {
    const existing = get().webhooks.get(id)
    if (
      existing &&
      (updates.enabled === false ||
        ['url', 'kind', 'telegramChatId', 'customTemplate'].some(
          (key) =>
            key in updates &&
            updates[key as keyof WebhookEntry] !== existing[key as keyof WebhookEntry]
        ))
    )
      cancelDelivery(id)
    set((state) => {
      const next = new Map(state.webhooks)
      const existing = next.get(id)
      if (existing) next.set(id, { ...existing, ...updates })
      return { webhooks: next }
    })
    get().saveToStorage()
  },

  removeWebhook: (id) => {
    cancelDelivery(id)
    set((state) => {
      const next = new Map(state.webhooks)
      next.delete(id)
      return { webhooks: next }
    })
    get().saveToStorage()
  },

  toggleWebhook: (id) => {
    if (get().webhooks.get(id)?.enabled) cancelDelivery(id)
    set((state) => {
      const next = new Map(state.webhooks)
      const existing = next.get(id)
      if (existing) next.set(id, { ...existing, enabled: !existing.enabled })
      return { webhooks: next }
    })
    get().saveToStorage()
  },

  triggerEvent: async (event, payload) => {
    const webhooks = Array.from(get().webhooks.values()).filter(
      (w) => w.enabled && w.events.includes(event)
    )
    if (webhooks.length === 0) return
    await Promise.allSettled(webhooks.map((w) => sendWebhook(w, payload)))
  },

  testWebhook: async (id) => {
    const webhook = get().webhooks.get(id)
    if (!webhook) return { success: false, error: 'Webhook 不存在' }
    try {
      return await sendWebhook(webhook, {
        title: '🧪 测试通知',
        message: '这是来自 Kiro 账号管理器的测试消息。如果你看到这条消息，说明 Webhook 配置正确。',
        level: 'info',
        fields: { 时间: new Date().toLocaleString('zh-CN') }
      })
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  loadFromStorage: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const arr = JSON.parse(raw) as WebhookEntry[]
      if (!Array.isArray(arr)) return
      const map = new Map<string, WebhookEntry>()
      for (const w of arr) {
        if (
          !w ||
          typeof w.id !== 'string' ||
          typeof w.url !== 'string' ||
          !['dingtalk', 'wechat-work', 'telegram', 'discord', 'feishu', 'custom'].includes(
            w.kind
          ) ||
          !Array.isArray(w.events)
        )
          continue
        map.set(w.id, {
          ...w,
          enabled: w.enabled === true,
          createdAt: Number.isFinite(w.createdAt) ? w.createdAt : Date.now(),
          events: w.events.filter((event) =>
            ALL_WEBHOOK_EVENTS.some((item) => item.value === event)
          )
        })
      }
      set({ webhooks: map })
    } catch (err) {
      console.warn('[Webhook] Load failed:', err)
    }
  },

  saveToStorage: () => {
    try {
      const arr = Array.from(get().webhooks.values())
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr))
    } catch (err) {
      console.warn('[Webhook] Save failed:', err)
    }
  }
}))

// ==================== Webhook 发送实现 ====================

/** The main process owns transport, deadlines, retry limits and cancellation. */
async function sendWebhook(
  webhook: WebhookEntry,
  payload: WebhookMessage
): Promise<{ success: boolean; error?: string }> {
  const url = webhook.kind === 'telegram' ? buildTelegramUrl(webhook) : webhook.url
  try {
    const result = await window.api.webhookSend({
      id: webhook.id,
      kind: webhook.kind,
      url,
      body: JSON.stringify(buildWebhookBody(webhook, payload))
    })
    if (!result.success)
      console.warn(
        `[Webhook] ${webhook.kind} ${webhook.label || webhook.id}: ${result.error || '发送失败'}`
      )
    return result
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function cancelDelivery(id: string): void {
  void window.api.webhookCancel(id).catch(() => {})
}

function buildTelegramUrl(webhook: WebhookEntry): string {
  // Telegram 的 URL 直接是 https://api.telegram.org/bot<token>/sendMessage
  return webhook.url.endsWith('/sendMessage')
    ? webhook.url
    : `${webhook.url.replace(/\/$/, '')}/sendMessage`
}

function buildWebhookBody(webhook: WebhookEntry, payload: WebhookMessage): unknown {
  const icon = ({ info: 'ℹ️', warn: '⚠️', error: '❌', success: '✅' } as const)[payload.level]
  const fieldsText = payload.fields
    ? '\n' +
      Object.entries(payload.fields)
        .map(([k, v]) => `**${k}**: ${v}`)
        .join('\n')
    : ''
  const plainFields = payload.fields
    ? '\n' +
      Object.entries(payload.fields)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')
    : ''
  const fullText = `${icon} ${payload.title}\n\n${payload.message}${plainFields}`

  switch (webhook.kind) {
    case 'dingtalk':
      // 钉钉机器人 markdown
      return {
        msgtype: 'markdown',
        markdown: {
          title: payload.title,
          text: `### ${icon} ${payload.title}\n\n${payload.message}${fieldsText}`
        }
      }
    case 'wechat-work':
      // 企业微信机器人 markdown
      return {
        msgtype: 'markdown',
        markdown: {
          content: `## ${icon} ${payload.title}\n\n${payload.message}${fieldsText}`
        }
      }
    case 'feishu':
      // 飞书机器人 text
      return {
        msg_type: 'text',
        content: { text: fullText }
      }
    case 'telegram':
      return {
        chat_id: webhook.telegramChatId,
        text: fullText,
        parse_mode: 'Markdown'
      }
    case 'discord':
      // Discord webhook
      return {
        username: 'Kiro Account Manager',
        embeds: [
          {
            title: `${icon} ${payload.title}`,
            description: payload.message,
            color:
              payload.level === 'error'
                ? 0xff0000
                : payload.level === 'warn'
                  ? 0xffaa00
                  : payload.level === 'success'
                    ? 0x00ff00
                    : 0x4a9eff,
            fields: payload.fields
              ? Object.entries(payload.fields).map(([name, value]) => ({
                  name,
                  value: String(value),
                  inline: true
                }))
              : undefined,
            timestamp: new Date().toISOString()
          }
        ]
      }
    case 'custom':
    default: {
      if (webhook.customTemplate) {
        // 简易模板替换
        try {
          const tpl = webhook.customTemplate
            .replace(/\{\{title\}\}/g, escapeJsonString(payload.title))
            .replace(/\{\{message\}\}/g, escapeJsonString(payload.message))
            .replace(/\{\{level\}\}/g, payload.level)
            .replace(/\{\{icon\}\}/g, icon)
          return JSON.parse(tpl)
        } catch {
          // 模板解析失败：退回简单 JSON
        }
      }
      return {
        title: payload.title,
        message: payload.message,
        level: payload.level,
        fields: payload.fields,
        timestamp: new Date().toISOString()
      }
    }
  }
}

function escapeJsonString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

export function parseWebhookInput(value: unknown): WebhookInput {
  if (
    !isRecord(value) ||
    !['dingtalk', 'wechat-work', 'telegram', 'discord', 'feishu', 'custom'].includes(
      String(value.kind)
    ) ||
    typeof value.url !== 'string' ||
    !Array.isArray(value.events) ||
    !value.events.every((event) => ALL_WEBHOOK_EVENTS.some((item) => item.value === event))
  )
    throw new Error('Webhook 配置无效')
  const url = new URL(value.url)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Webhook 地址无效')
  const result: WebhookInput = {
    kind: value.kind as WebhookKind,
    url: value.url,
    enabled: value.enabled === true,
    events: [...new Set(value.events)]
  }
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean')
    throw new Error('Webhook 启用状态无效')
  for (const key of ['label', 'telegramChatId', 'customTemplate'] as const) {
    if (value[key] === undefined) continue
    if (typeof value[key] !== 'string') throw new Error(`Webhook 字段无效: ${key}`)
    result[key] = value[key]
  }
  return result
}
function webhookIdentity(entry: WebhookInput): string {
  return JSON.stringify([
    entry.kind,
    entry.url,
    entry.enabled,
    entry.label || '',
    entry.telegramChatId || '',
    entry.customTemplate || '',
    [...entry.events].sort()
  ])
}

export type WebhookKind = 'dingtalk' | 'wechat-work' | 'telegram' | 'discord' | 'feishu' | 'custom'
export interface WebhookDeliveryInput {
  id: string
  kind: WebhookKind
  url: string
  body: string
}
export interface WebhookDeliveryResult {
  success: boolean
  error?: string
  rateLimited?: boolean
}

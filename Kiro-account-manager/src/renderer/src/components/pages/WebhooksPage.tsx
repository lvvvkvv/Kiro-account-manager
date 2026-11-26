import { PageHeader } from '../layout/PageHeader'
import { useState, useMemo } from 'react'
import {
  Bell,
  Plus,
  Trash2,
  Send,
  Power,
  PowerOff,
  CheckCircle2,
  XCircle,
  Loader2,
  Edit2,
  MessageSquare
} from 'lucide-react'
import {
  useWebhookStore,
  ALL_WEBHOOK_EVENTS,
  type WebhookEntry,
  type WebhookKind
} from '@/store/webhooks'
import { useTranslation } from '@/hooks/useTranslation'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Label,
  Switch,
  Badge
} from '../ui'
import { cn } from '@/lib/utils'

const KIND_OPTIONS: { value: WebhookKind; label: string; labelEn: string; placeholder: string }[] =
  [
    {
      value: 'dingtalk',
      label: '钉钉',
      labelEn: 'DingTalk',
      placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=xxx'
    },
    {
      value: 'wechat-work',
      label: '企业微信',
      labelEn: 'WeCom',
      placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx'
    },
    {
      value: 'feishu',
      label: '飞书',
      labelEn: 'Feishu',
      placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxx'
    },
    {
      value: 'telegram',
      label: 'Telegram',
      labelEn: 'Telegram',
      placeholder: 'https://api.telegram.org/bot<token>'
    },
    {
      value: 'discord',
      label: 'Discord',
      labelEn: 'Discord',
      placeholder: 'https://discord.com/api/webhooks/xxx'
    },
    {
      value: 'custom',
      label: '自定义',
      labelEn: 'Custom',
      placeholder: 'https://your-server.com/webhook'
    }
  ]

export function WebhooksPage(): React.ReactNode {
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'
  const { webhooks, addWebhook, updateWebhook, removeWebhook, toggleWebhook, testWebhook } =
    useWebhookStore()

  const [editing, setEditing] = useState<Partial<WebhookEntry> | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<
    Record<string, { success: boolean; error?: string; time: number }>
  >({})

  const webhookList = useMemo(() => Array.from(webhooks.values()), [webhooks])

  const handleSave = (): void => {
    if (!editing || !editing.kind || !editing.url) return
    const data = {
      kind: editing.kind,
      url: editing.url,
      label: editing.label,
      enabled: editing.enabled ?? true,
      telegramChatId: editing.telegramChatId,
      customTemplate: editing.customTemplate,
      events: editing.events ?? ['batch-completed', 'risk-warning', 'account-banned']
    }
    if (editing.id) {
      updateWebhook(editing.id, data)
    } else {
      addWebhook(data)
    }
    setEditing(null)
  }

  const handleTest = async (id: string): Promise<void> => {
    setTestingId(id)
    const result = await testWebhook(id)
    setTestResult((prev) => ({ ...prev, [id]: { ...result, time: Date.now() } }))
    setTestingId(null)
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto text-body">
      {/* Header */}
      <PageHeader
        icon={<Bell />}
        title={<>{isEn ? 'Webhook Notifications' : 'Webhook 通知'}</>}
        subtitle={
          <>
            {isEn
              ? 'Push critical events (batch completed, risk warning, account banned, etc.) to DingTalk / WeCom / Feishu / Telegram / Discord / custom endpoints.'
              : '把关键事件（批量完成、风控警告、账号封禁等）推送到钉钉/企微/飞书/Telegram/Discord/自定义服务'}
          </>
        }
      />
      <div className="space-y-7 px-6 pt-4 pb-6">
        {/* Webhook 列表 */}
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-section flex items-center gap-2 min-w-0 flex-wrap [&_svg]:text-muted-foreground">
              <MessageSquare className="h-4 w-4 text-primary" />
              {isEn ? `Webhooks (${webhookList.length})` : `Webhook 列表 (${webhookList.length})`}
            </CardTitle>
            <Button
              size="sm"
              onClick={() =>
                setEditing({
                  kind: 'dingtalk',
                  enabled: true,
                  events: ['batch-completed', 'risk-warning', 'account-banned']
                })
              }
            >
              <Plus className="h-4 w-4 mr-0" />
              {isEn ? 'Add Webhook' : '添加 Webhook'}
            </Button>
          </CardHeader>
          <CardContent>
            {webhookList.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <Bell className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-body">{isEn ? 'No webhooks configured.' : '尚未配置 Webhook'}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {webhookList.map((w) => {
                  const result = testResult[w.id]
                  const kindOpt = KIND_OPTIONS.find((o) => o.value === w.kind)
                  const kindLabel = kindOpt ? (isEn ? kindOpt.labelEn : kindOpt.label) : w.kind
                  return (
                    <div
                      key={w.id}
                      className={cn(
                        'flex items-start gap-3 p-3 rounded-panel border',
                        w.enabled ? 'bg-card' : 'bg-muted/30 opacity-70'
                      )}
                    >
                      <button
                        onClick={() => toggleWebhook(w.id)}
                        className="flex h-control w-control shrink-0 items-center justify-center rounded-control hover:bg-muted"
                        title={w.enabled ? '点击停用' : '点击启用'}
                      >
                        {w.enabled ? (
                          <Power className="h-4 w-4 text-green-500" />
                        ) : (
                          <PowerOff className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-body">{w.label || kindLabel}</span>
                          <Badge variant="outline" className="text-badge">
                            {kindLabel}
                          </Badge>
                          {result && Date.now() - result.time < 60000 && (
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-badge',
                                result.success
                                  ? 'text-green-600 border-green-200'
                                  : 'text-red-600 border-red-200'
                              )}
                            >
                              {result.success ? (
                                <>
                                  <CheckCircle2 className="h-2.5 w-2.5 mr-0.5 inline" />{' '}
                                  {isEn ? 'Test OK' : '测试成功'}
                                </>
                              ) : (
                                <>
                                  <XCircle className="h-2.5 w-2.5 mr-0.5 inline" />{' '}
                                  {isEn ? 'Test failed' : '测试失败'}
                                </>
                              )}
                            </Badge>
                          )}
                        </div>
                        <p
                          className="text-caption text-muted-foreground font-mono mt-0.5 truncate"
                          title={w.url}
                        >
                          {w.url}
                        </p>
                        {w.events.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {w.events.map((ev) => {
                              const evOpt = ALL_WEBHOOK_EVENTS.find((e) => e.value === ev)
                              const evLabel = evOpt ? (isEn ? evOpt.labelEn : evOpt.label) : ev
                              return (
                                <span
                                  key={ev}
                                  className="inline-flex h-5 items-center rounded-full px-[7px] text-badge font-medium bg-muted text-muted-foreground"
                                >
                                  {evLabel}
                                </span>
                              )
                            })}
                          </div>
                        )}
                        {result && !result.success && result.error && (
                          <p className="text-caption text-red-500 mt-1">{result.error}</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          title={isEn ? 'Test' : '测试'}
                          onClick={() => handleTest(w.id)}
                          disabled={testingId === w.id}
                        >
                          {testingId === w.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Send className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title={isEn ? 'Edit' : '编辑'}
                          onClick={() => setEditing({ ...w })}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive h-control w-control p-0 rounded-control [&_svg]:size-4"
                          title={isEn ? 'Delete' : '删除'}
                          onClick={() => {
                            if (
                              confirm(
                                isEn
                                  ? `Delete webhook "${w.label || kindLabel}"?`
                                  : `删除 Webhook "${w.label || kindLabel}"？`
                              )
                            ) {
                              removeWebhook(w.id)
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 编辑对话框 */}
        {editing && (
          <Card className="border-primary/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-section min-w-0 flex-wrap [&_svg]:text-muted-foreground">
                {editing.id
                  ? isEn
                    ? 'Edit Webhook'
                    : '编辑 Webhook'
                  : isEn
                    ? 'New Webhook'
                    : '新建 Webhook'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label className="text-body">{isEn ? 'Type' : '类型'}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {KIND_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setEditing({ ...editing, kind: opt.value })}
                      className={cn(
                        'h-control px-3.5 rounded-control border text-body font-medium transition-colors',
                        editing.kind === opt.value
                          ? 'border-primary bg-primary/10 text-primary font-medium'
                          : 'border-border hover:border-primary/50'
                      )}
                    >
                      {isEn ? opt.labelEn : opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-body">{isEn ? 'Label (optional)' : '备注名（可选）'}</Label>
                <Input
                  value={editing.label || ''}
                  onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                  placeholder={isEn ? 'e.g. Dev group' : '例如：开发群'}
                  className="min-w-0 rounded-control border border-input bg-card px-2.5 text-body focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-body">Webhook URL</Label>
                <Input
                  value={editing.url || ''}
                  onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                  placeholder={KIND_OPTIONS.find((o) => o.value === editing.kind)?.placeholder}
                  className="font-mono min-w-0 rounded-control border border-input bg-card px-2.5 text-body focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                />
              </div>

              {editing.kind === 'telegram' && (
                <div className="space-y-1">
                  <Label className="text-body">Chat ID</Label>
                  <Input
                    value={editing.telegramChatId || ''}
                    onChange={(e) => setEditing({ ...editing, telegramChatId: e.target.value })}
                    placeholder={isEn ? '123456789 or @channel_name' : '123456789 或 @channel_name'}
                    className="font-mono min-w-0 rounded-control border border-input bg-card px-2.5 text-body focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                  />
                </div>
              )}

              {editing.kind === 'custom' && (
                <div className="space-y-1">
                  <Label className="text-body">
                    {isEn ? 'Custom JSON template (placeholders: ' : '自定义 JSON 模板（占位符：'}
                    {`{{title}} {{message}} {{level}} {{icon}}`}
                    {isEn ? ')' : '）'}
                  </Label>
                  <textarea
                    value={editing.customTemplate || ''}
                    onChange={(e) => setEditing({ ...editing, customTemplate: e.target.value })}
                    rows={4}
                    className="w-full border bg-background font-mono min-w-0 rounded-control border-input bg-card px-2.5 text-body focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20 py-2 min-h-[120px]"
                    placeholder='{"text": "{{title}}", "body": "{{message}}"}'
                  />
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-body">{isEn ? 'Subscribed events' : '订阅事件'}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_WEBHOOK_EVENTS.map((ev) => {
                    const checked = editing.events?.includes(ev.value) ?? false
                    return (
                      <button
                        key={ev.value}
                        aria-pressed={checked}
                        onClick={() => {
                          const current = editing.events ?? []
                          const next = checked
                            ? current.filter((e) => e !== ev.value)
                            : [...current, ev.value]
                          setEditing({ ...editing, events: next })
                        }}
                        className={cn(
                          'h-control-sm px-3 rounded-control border text-caption font-medium transition-colors',
                          checked
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border hover:border-primary/50'
                        )}
                      >
                        {isEn ? ev.labelEn : ev.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Switch
                  checked={editing.enabled ?? true}
                  onCheckedChange={(v) => setEditing({ ...editing, enabled: v })}
                />
                <Label className="text-body cursor-pointer">{isEn ? 'Enabled' : '启用'}</Label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                  {isEn ? 'Cancel' : '取消'}
                </Button>
                <Button size="sm" onClick={handleSave} disabled={!editing.kind || !editing.url}>
                  {isEn ? 'Save' : '保存'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

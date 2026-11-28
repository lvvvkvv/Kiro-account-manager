import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  RefreshCw,
  Eye,
  EyeOff,
  BarChart3,
  Clock,
  Zap,
  MessageSquare,
  ExternalLink
} from 'lucide-react'
import { Select } from '@/components/ui'
import { cn } from '@/lib/utils'
import { useAccountsStore } from '@/store/accounts'
import { ApiKeyUsageDialog } from './ApiKeyUsageDialog'

type ApiKeyFormat = 'sk' | 'simple' | 'token'

interface UsageRecord {
  timestamp: number
  model: string
  inputTokens: number
  outputTokens: number
  credits: number
  path: string
}

interface ApiKey {
  id: string
  name: string
  key: string
  format?: ApiKeyFormat
  enabled: boolean
  createdAt: number
  lastUsedAt?: number
  creditsLimit?: number
  usage: {
    totalRequests: number
    totalCredits: number
    totalInputTokens: number
    totalOutputTokens: number
    daily: Record<
      string,
      {
        requests: number
        credits: number
        inputTokens: number
        outputTokens: number
      }
    >
    byModel?: Record<
      string,
      {
        requests: number
        credits: number
        inputTokens: number
        outputTokens: number
      }
    >
  }
  usageHistory?: UsageRecord[]
}

export function ApiKeyManager() {
  const language = useAccountsStore(state => state.language)
  const isEn = language === 'en'

  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyFormat, setNewKeyFormat] = useState<ApiKeyFormat>('sk')
  const [newKeyCreditsLimit, setNewKeyCreditsLimit] = useState<string>('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showKeys, setShowKeys] = useState<Set<string>>(new Set())
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [showUsageDialog, setShowUsageDialog] = useState(false)

  const loadApiKeys = useCallback(async () => {
    try {
      const result = await window.api.proxyGetApiKeys()
      if (result.success) {
        setApiKeys(result.apiKeys)
      }
    } catch (error) {
      console.error('Failed to load API keys:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadApiKeys()
  }, [loadApiKeys])

  const handleAddKey = async () => {
    if (!newKeyName.trim()) return

    try {
      const creditsLimit = newKeyCreditsLimit ? parseFloat(newKeyCreditsLimit) : undefined
      const result = await window.api.proxyAddApiKey({
        name: newKeyName.trim(),
        format: newKeyFormat,
        creditsLimit: creditsLimit && creditsLimit > 0 ? creditsLimit : undefined
      })
      if (result.success && result.apiKey) {
        setApiKeys((prev) => [...prev, result.apiKey!])
        setNewKeyName('')
        setNewKeyCreditsLimit('')
      }
    } catch (error) {
      console.error('Failed to add API key:', error)
    }
  }

  const handleDeleteKey = async (id: string) => {
    if (!confirm(isEn ? 'Delete this API key?' : '确定删除此 API Key？')) return

    try {
      const result = await window.api.proxyDeleteApiKey(id)
      if (result.success) {
        setApiKeys((prev) => prev.filter((k) => k.id !== id))
        if (selectedKey === id) setSelectedKey(null)
      }
    } catch (error) {
      console.error('Failed to delete API key:', error)
    }
  }

  const handleToggleKey = async (id: string, enabled: boolean) => {
    try {
      const result = await window.api.proxyUpdateApiKey(id, { enabled })
      if (result.success) {
        setApiKeys((prev) => prev.map((k) => (k.id === id ? { ...k, enabled } : k)))
      }
    } catch (error) {
      console.error('Failed to toggle API key:', error)
    }
  }

  const handleResetUsage = async (id: string) => {
    if (!confirm(isEn ? 'Reset usage statistics?' : '确定重置用量统计？')) return

    try {
      const result = await window.api.proxyResetApiKeyUsage(id)
      if (result.success) {
        setApiKeys((prev) =>
          prev.map((k) =>
            k.id === id
              ? {
                  ...k,
                  usage: {
                    totalRequests: 0,
                    totalCredits: 0,
                    totalInputTokens: 0,
                    totalOutputTokens: 0,
                    daily: {}
                  }
                }
              : k
          )
        )
      }
    } catch (error) {
      console.error('Failed to reset usage:', error)
    }
  }

  const copyToClipboard = (id: string, key: string) => {
    navigator.clipboard.writeText(key)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const toggleShowKey = (id: string) => {
    setShowKeys((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
  }

  const maskKey = (key: string) => {
    return key.substring(0, 8) + '...' + key.substring(key.length - 4)
  }

  const selectedKeyData = apiKeys.find((k) => k.id === selectedKey)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Key className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-section">{isEn ? 'API Keys' : 'API 密钥'}</CardTitle>
            </div>
            <span className="text-body text-muted-foreground">
              {apiKeys.length} {isEn ? 'keys' : '个'}
            </span>
          </div>
          <CardDescription>
            {isEn ? 'Manage API keys for authentication' : '管理用于身份验证的 API 密钥'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Input
                placeholder={isEn ? 'Key name...' : '密钥名称...'}
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddKey()}
                className="flex-1 rounded-control text-body h-control"
              />
              <Select
                value={newKeyFormat}
                options={[
                  { value: 'sk', label: 'sk-xxx' },
                  { value: 'simple', label: 'PROXY_KEY' },
                  { value: 'token', label: 'KEY:TOKEN' }
                ]}
                onChange={(v) => setNewKeyFormat(v as ApiKeyFormat)}
                className="w-[120px] rounded-control text-body h-control"
              />
              <Button onClick={handleAddKey} disabled={!newKeyName.trim()}>
                <Plus className="h-4 w-4" />
                {isEn ? 'Add' : '添加'}
              </Button>
            </div>
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                placeholder={isEn ? 'Credits limit (optional)' : 'Credits 额度限制（可选）'}
                value={newKeyCreditsLimit}
                onChange={(e) => setNewKeyCreditsLimit(e.target.value)}
                className="flex-1 rounded-control text-body h-control"
              />
              <span className="text-caption text-muted-foreground whitespace-nowrap">
                {isEn ? '0 = unlimited' : '0 = 无限制'}
              </span>
            </div>
          </div>

          {apiKeys.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {isEn ? 'No API keys yet' : '暂无 API 密钥'}
            </div>
          ) : (
            <div className="space-y-2">
              {apiKeys.map((apiKey) => (
                <div
                  key={apiKey.id}
                  className={cn(
                    'ui-list-row flex-wrap border transition-colors cursor-pointer',
                    selectedKey === apiKey.id ? 'bg-primary/5 border-primary' : 'hover:bg-muted/50',
                    !apiKey.enabled && 'opacity-50'
                  )}
                  onClick={() => setSelectedKey(selectedKey === apiKey.id ? null : apiKey.id)}
                >
                  <div onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={apiKey.enabled}
                      onCheckedChange={(enabled) => handleToggleKey(apiKey.id, enabled)}
                    />
                  </div>

                  <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="text-strong font-medium truncate">{apiKey.name}</div>
                    <div className="flex items-center gap-2 text-caption text-muted-foreground">
                      <code className="min-w-0 break-all bg-muted px-1 rounded-control">
                        {showKeys.has(apiKey.id) ? apiKey.key : maskKey(apiKey.key)}
                      </code>
                      <button
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control hover:bg-muted hover:text-foreground [&_svg]:size-4"
                        title={isEn ? 'Show or hide key' : '显示或隐藏密钥'}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleShowKey(apiKey.id)
                        }}
                      >
                        {showKeys.has(apiKey.id) ? (
                          <EyeOff className="h-3 w-3" />
                        ) : (
                          <Eye className="h-3 w-3" />
                        )}
                      </button>
                      <button
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control hover:bg-muted hover:text-foreground [&_svg]:size-4"
                        title={isEn ? 'Copy key' : '复制密钥'}
                        onClick={(e) => {
                          e.stopPropagation()
                          copyToClipboard(apiKey.id, apiKey.key)
                        }}
                      >
                        {copiedId === apiKey.id ? (
                          <Check className="h-3 w-3 text-success" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="text-right text-caption text-muted-foreground">
                    <div>
                      {apiKey.usage.totalRequests} {isEn ? 'requests' : '请求'}
                    </div>
                    <div
                      className={cn(
                        apiKey.creditsLimit &&
                          apiKey.usage.totalCredits >= apiKey.creditsLimit &&
                          'text-destructive font-medium'
                      )}
                    >
                      {apiKey.usage.totalCredits.toFixed(2)}
                      {apiKey.creditsLimit ? `/${apiKey.creditsLimit}` : ''} credits
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    title={isEn ? 'Delete key' : '删除密钥'}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteKey(apiKey.id)
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedKeyData && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-section">
                  {isEn ? 'Usage Details' : '用量详情'}: {selectedKeyData.name}
                </CardTitle>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowUsageDialog(true)}>
                  <ExternalLink className="h-3 w-3" />
                  {isEn ? 'View Details' : '查看详情'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleResetUsage(selectedKeyData.id)}
                >
                  <RefreshCw className="h-3 w-3" />
                  {isEn ? 'Reset Usage' : '重置用量'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-muted rounded-panel p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <MessageSquare className="h-4 w-4" />
                  <span className="text-caption">{isEn ? 'Total Requests' : '总请求数'}</span>
                </div>
                <div className="text-metric font-semibold">
                  {selectedKeyData.usage.totalRequests}
                </div>
              </div>

              <div className="bg-muted rounded-panel p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Zap className="h-4 w-4" />
                  <span className="text-caption">{isEn ? 'Total Credits' : '总 Credits'}</span>
                </div>
                <div className="text-metric font-semibold">
                  {selectedKeyData.usage.totalCredits.toFixed(2)}
                </div>
              </div>

              <div className="bg-muted rounded-panel p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <span className="text-caption">{isEn ? 'Input Tokens' : '输入 Tokens'}</span>
                </div>
                <div className="text-metric font-semibold">
                  {selectedKeyData.usage.totalInputTokens.toLocaleString()}
                </div>
              </div>

              <div className="bg-muted rounded-panel p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <span className="text-caption">{isEn ? 'Output Tokens' : '输出 Tokens'}</span>
                </div>
                <div className="text-metric font-semibold">
                  {selectedKeyData.usage.totalOutputTokens.toLocaleString()}
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body text-muted-foreground">
                  {isEn ? 'Credits Limit:' : 'Credits 额度限制:'}
                </span>
                <Input
                  type="number"
                  placeholder={isEn ? 'Unlimited' : '无限制'}
                  value={selectedKeyData.creditsLimit || ''}
                  onChange={async (e) => {
                    const limit = e.target.value ? parseFloat(e.target.value) : null
                    const result = await window.api.proxyUpdateApiKey(selectedKeyData.id, {
                      creditsLimit: limit && limit > 0 ? limit : null
                    })
                    if (result.success) {
                      setApiKeys((prev) =>
                        prev.map((k) =>
                          k.id === selectedKeyData.id
                            ? { ...k, creditsLimit: limit && limit > 0 ? limit : undefined }
                            : k
                        )
                      )
                    }
                  }}
                  className="w-32 rounded-control text-body h-control"
                />
                <span className="text-caption text-muted-foreground">
                  {isEn ? '(0 = unlimited)' : '(0 = 无限制)'}
                </span>
              </div>
              <div className="text-caption text-muted-foreground space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Clock className="h-3 w-3" />
                  <span>
                    {isEn ? 'Created:' : '创建时间:'} {formatDate(selectedKeyData.createdAt)}
                  </span>
                </div>
                {selectedKeyData.lastUsedAt && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Clock className="h-3 w-3" />
                    <span>
                      {isEn ? 'Last used:' : '最后使用:'} {formatDate(selectedKeyData.lastUsedAt)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 用量详情对话框 */}
      <ApiKeyUsageDialog
        open={showUsageDialog}
        onOpenChange={setShowUsageDialog}
        apiKey={selectedKeyData || null}
      />
    </div>
  )
}

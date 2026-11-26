import { useState, useEffect } from 'react'
import {
  X,
  RefreshCw,
  Loader2,
  Cpu,
  FileText,
  Image,
  Hash,
  Sparkles,
  Zap,
  Shuffle,
  Brain,
  Database,
  AlertTriangle,
  Globe
} from 'lucide-react'
import { Button, Card, CardContent, CardHeader, CardTitle, Badge } from '../ui'
import { cn } from '@/lib/utils'

interface ModelInfo {
  id: string
  name: string
  description: string
  inputTypes?: string[]
  maxInputTokens?: number | null
  maxOutputTokens?: number | null
  rateMultiplier?: number
  rateUnit?: string
  supportsThinking?: boolean
  thinkingEfforts?: string[]
  supportsPromptCaching?: boolean
  modelProvider?: string
}

interface ModelsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isEn: boolean
  onOpenModelMapping?: () => void
  mappingCount?: number
}

export function ModelsDialog({
  open,
  onOpenChange,
  isEn,
  onOpenModelMapping,
  mappingCount = 0
}: ModelsDialogProps) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [fromCache, setFromCache] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // IP 限制提示是否显示 (用户点击关闭后持久化)
  const [showIpTip, setShowIpTip] = useState(() => {
    return localStorage.getItem('models_dialog_ip_tip_dismissed') !== '1'
  })

  const dismissIpTip = () => {
    localStorage.setItem('models_dialog_ip_tip_dismissed', '1')
    setShowIpTip(false)
  }

  const fetchModels = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.proxyGetModels()
      if (result.success) {
        setModels(result.models)
        setFromCache(result.fromCache || false)
      } else {
        setError(result.error || 'Failed to fetch models')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      fetchModels()
    }
  }, [open])

  if (!open) return null

  const formatTokens = (tokens: number | null | undefined) => {
    if (tokens === null || tokens === undefined) return '-'
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`
    return tokens.toString()
  }

  return (
    <div className="ui-dialog-overlay">
      <div className="absolute inset-0" onClick={() => onOpenChange(false)} />
      <Card
        role="dialog"
        aria-modal="true"
        aria-label={isEn ? 'Available Models' : '可用模型'}
        className="ui-dialog-panel rounded-dialog max-w-[min(672px,calc(100vw-32px))]"
      >
        <CardHeader className="ui-dialog-header px-6 pt-5 pb-3">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-title font-semibold flex min-w-0 flex-wrap items-center gap-2">
              <div className="shrink-0 text-muted-foreground [&>svg]:size-4">
                <Cpu className="h-6 w-6 text-primary" />
              </div>
              <div>
                <span className="font-semibold">{isEn ? 'Available Models' : '可用模型'}</span>
                <div className="flex items-center gap-2 mt-1">
                  <Badge className="bg-primary/10 text-primary border-primary/20">
                    {models.length} {isEn ? 'models' : '个模型'}
                  </Badge>
                  {fromCache && (
                    <Badge variant="secondary" className="bg-warning/10 text-warning border-0">
                      <Sparkles className="h-3 w-3" />
                      {isEn ? 'Cached' : '缓存'}
                    </Badge>
                  )}
                </div>
              </div>
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {onOpenModelMapping && (
                <Button variant="outline" size="sm" onClick={onOpenModelMapping}>
                  <Shuffle className="h-4 w-4" />
                  <span className="">{isEn ? 'Mapping' : '映射'}</span>
                  {mappingCount > 0 && (
                    <Badge className="ml-1.5 bg-primary/20 text-primary">{mappingCount}</Badge>
                  )}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={fetchModels} disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                <span className="">{isEn ? 'Refresh' : '刷新'}</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => onOpenChange(false)}
                title={isEn ? 'Close' : '关闭'}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="ui-dialog-body px-6 pt-0 pb-5">
          {/* IP 限制提示横幅 (Pro+ 订阅但缺失高级模型) */}
          {showIpTip && (
            <div className="mb-3 rounded-panel border border-warning/30 p-3.5 relative">
              <div className="flex items-start gap-3">
                <div className="shrink-0 p-1.5 rounded-panel bg-warning/20">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                </div>
                <div className="flex-1 min-w-0 pr-6">
                  <p className="text-body font-semibold text-warning mb-1.5 flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5" />
                    {isEn
                      ? 'Pro/Pro Max subscription but missing advanced models?'
                      : '订阅 Pro/Pro Max 但看不到高级模型？'}
                  </p>
                  <p className="text-caption text-warning/90 mb-1">
                    {isEn
                      ? 'This is likely caused by regional restrictions on China-mainland IPs. Try the following:'
                      : '这通常是国内 IP 被限制导致的。请尝试以下方案：'}
                  </p>
                  <ul className="text-caption text-warning/90 space-y-0.5 list-disc list-inside">
                    <li>
                      {isEn
                        ? 'Enable VPN/proxy (system-level or app-level)'
                        : '开启 VPN / 代理（系统级或应用级均可）'}
                    </li>
                    <li>
                      {isEn
                        ? 'Switch to high-quality outbound IP (US/EU residential preferred)'
                        : '切换到优质外网 IP（推荐美国 / 欧洲住宅 IP）'}
                    </li>
                    <li>
                      {isEn
                        ? 'Click Refresh after IP change to reload models'
                        : 'IP 切换后点击右上角「刷新」重新加载模型'}
                    </li>
                  </ul>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 h-7 w-7 hover:bg-warning/20 text-warning"
                  onClick={dismissIpTip}
                  title={isEn ? "Don't show again" : '不再显示'}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
          <div className="min-w-0">
            {loading && models.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <div className="p-4 rounded-full bg-primary/10 mb-4">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
                <p className="font-medium">{isEn ? 'Loading models...' : '加载模型中...'}</p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <div className="p-4 rounded-full bg-destructive/10 mb-4">
                  <X className="h-8 w-8 text-destructive" />
                </div>
                <p className="text-destructive font-medium">{error}</p>
                <p className="text-body mt-2">
                  {isEn
                    ? 'Make sure proxy is running and has synced accounts'
                    : '请确保代理服务已启动且已同步账号'}
                </p>
              </div>
            ) : models.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <div className="p-4 rounded-full bg-muted mb-4">
                  <Cpu className="h-8 w-8" />
                </div>
                <p className="font-medium">{isEn ? 'No models available' : '暂无可用模型'}</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {models.map((model, index) => (
                  <div
                    key={model.id}
                    className={cn(
                      'group p-3 rounded-panel border hover:border-border-strong transition-all duration-200',
                      index === 0 ? 'border-border-strong bg-muted' : 'bg-card'
                    )}
                  >
                    <div className="flex items-start gap-2 mb-2">
                      <div
                        className={cn(
                          'w-2 h-2 rounded-full mt-1.5 shrink-0',
                          index === 0 ? 'bg-primary' : 'bg-muted-foreground/30'
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <code className="text-strong font-medium text-foreground">{model.id}</code>
                        {model.name && model.name !== model.id && (
                          <p className="text-caption text-primary/70 font-medium truncate">
                            {model.name}
                          </p>
                        )}
                      </div>
                    </div>
                    <p className="text-caption text-muted-foreground line-clamp-2 mb-2 pl-4">
                      {model.description || (isEn ? 'No description' : '无描述')}
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-1">
                          {model.inputTypes?.includes('TEXT') && (
                            <Badge
                              variant="secondary"
                              className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-0"
                            >
                              <FileText className="h-3 w-3" />
                            </Badge>
                          )}
                          {model.inputTypes?.includes('IMAGE') && (
                            <Badge
                              variant="secondary"
                              className="bg-purple-500/10 text-purple-600 dark:text-purple-400 border-0"
                            >
                              <Image className="h-3 w-3" />
                            </Badge>
                          )}
                        </div>
                        {model.supportsThinking && (
                          <Badge
                            variant="secondary"
                            className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-0"
                            title={model.thinkingEfforts?.join(', ')}
                          >
                            <Brain className="h-3 w-3" />
                          </Badge>
                        )}
                        {model.supportsPromptCaching && (
                          <Badge
                            variant="secondary"
                            className="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-0"
                          >
                            <Database className="h-3 w-3" />
                          </Badge>
                        )}
                        {model.rateMultiplier !== undefined && (
                          <Badge
                            variant="secondary"
                            className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-0"
                          >
                            <Zap className="h-3 w-3" />
                            {model.rateMultiplier}x {model.rateUnit || 'credit'}
                          </Badge>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1 whitespace-nowrap text-caption font-mono text-muted-foreground">
                        <Hash className="h-3 w-3" />
                        <span className="text-green-600 dark:text-green-400">
                          {formatTokens(model.maxInputTokens)}
                        </span>
                        <span>/</span>
                        <span className="text-orange-600 dark:text-orange-400">
                          {formatTokens(model.maxOutputTokens)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

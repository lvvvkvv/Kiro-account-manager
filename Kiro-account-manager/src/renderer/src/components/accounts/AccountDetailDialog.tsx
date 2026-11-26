import { createPortal } from 'react-dom'
import { useState, useEffect } from 'react'
import {
  X,
  RefreshCw,
  User,
  CreditCard,
  Key,
  Cpu,
  Loader2,
  FileText,
  Image,
  Hash,
  Zap
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import type { Account } from '@/types/account'
import { cn } from '@/lib/utils'
import { useAccountsStore } from '@/store/accounts'
import { useTranslation } from '@/hooks/useTranslation'

interface ModelInfo {
  id: string
  name: string
  description: string
  inputTypes?: string[]
  maxInputTokens?: number | null
  maxOutputTokens?: number | null
  rateMultiplier?: number
  rateUnit?: string
}

interface AccountDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  account: Account | null
  onRefresh?: () => void
  isRefreshing?: boolean
}

// 获取账户显示名称：昵称优先，无则邮箱，无邮箱则 userId
function getDisplayName(account: Account): string {
  if (account.nickname) return account.nickname
  if (account.email) return account.email
  if (account.userId) return account.userId
  return 'Unknown'
}

// 订阅类型对应颜色
const getSubscriptionColor = (type: string, title?: string): string => {
  const text = (title || type).toUpperCase()
  // KIRO PRO+ / PRO_PLUS - 紫色
  if (text.includes('PRO+') || text.includes('PRO_PLUS') || text.includes('PROPLUS'))
    return 'bg-purple-500'
  // KIRO POWER - 金色
  if (text.includes('POWER')) return 'bg-amber-500'
  // KIRO PRO - 蓝色
  if (text.includes('PRO')) return 'bg-blue-500'
  // KIRO FREE - 灰色
  return 'bg-gray-500'
}

// 格式化日期
const formatDate = (date: unknown): string => {
  if (!date) return '-'
  try {
    if (typeof date === 'string') return date.split('T')[0]
    if (date instanceof Date) return date.toISOString().split('T')[0]
    return new Date(date as string | number).toISOString().split('T')[0]
  } catch {
    return String(date).split('T')[0]
  }
}

// 格式化完整日期时间
const formatDateTime = (date: unknown): string => {
  if (!date) return '-'
  try {
    const d =
      typeof date === 'string'
        ? new Date(date)
        : date instanceof Date
          ? date
          : new Date(date as number)
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return String(date)
  }
}

export function AccountDetailDialog({
  open,
  onOpenChange,
  account,
  onRefresh,
  isRefreshing
}: AccountDetailDialogProps) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const { maskEmail, maskNickname, privacyMode, usagePrecision } = useAccountsStore()
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'

  // 获取账户可用模型
  useEffect(() => {
    if (open && account?.credentials?.accessToken) {
      setModelsLoading(true)
      setModelsError(null)
      window.api
        .accountGetModels(
          account.credentials.accessToken,
          account.credentials?.region,
          account.profileArn,
          account.machineId,
          account.credentials.provider || account.idp,
          account.credentials.authMethod,
          account.id
        )
        .then((result) => {
          if (result.success) {
            setModels(result.models)
          } else {
            setModelsError(result.error || 'Failed to fetch models')
          }
        })
        .catch((err) => setModelsError(err.message))
        .finally(() => setModelsLoading(false))
    } else {
      setModels([])
    }
  }, [
    open,
    account?.credentials?.accessToken,
    account?.credentials?.region,
    account?.profileArn,
    account?.machineId,
    account?.credentials?.provider,
    account?.idp,
    account?.credentials?.authMethod,
    account?.id
  ])

  if (!open || !account) return null

  const usage = account.usage
  const subscription = account.subscription
  const credentials = account.credentials

  // 格式化使用量数值
  const formatUsage = (value: number): string => {
    if (usagePrecision) {
      return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    }
    return Math.floor(value).toLocaleString()
  }

  // 计算奖励总计
  const bonusTotal = usage.bonuses?.reduce((sum, b) => sum + b.limit, 0) ?? 0
  const bonusUsed = usage.bonuses?.reduce((sum, b) => sum + b.current, 0) ?? 0

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[var(--overlay)]" onClick={() => onOpenChange(false)} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEn ? 'Account details' : '账号详情'}
        className="ui-dialog-panel max-w-2xl"
      >
        {/* 头部 */}
        <div className="ui-dialog-header flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="size-8 rounded-control bg-muted flex items-center justify-center shrink-0">
              <User className="h-4 w-4 text-foreground" />
              <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-success border-2 border-background" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="font-semibold text-title text-foreground truncate"
                  title={
                    account.email ? maskEmail(account.email) : maskNickname(getDisplayName(account))
                  }
                >
                  {account.email ? maskEmail(account.email) : maskNickname(getDisplayName(account))}
                </span>
                <Badge
                  className={cn(
                    getSubscriptionColor(subscription.type, subscription.title),
                    'hover:opacity-90 text-white flex-shrink-0 px-[7px]'
                  )}
                >
                  {subscription.title || subscription.type}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-caption text-muted-foreground">
                <span className="inline-flex h-5 items-center px-[7px] text-badge bg-muted rounded-full font-medium border border-border/50">
                  {account.idp}
                </span>
                <span className="opacity-50">·</span>
                <span>
                  {isEn ? 'Added ' : '添加于 '}
                  {formatDate(account.createdAt)}
                </span>
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            className="rounded-control hover:bg-muted transition-colors shrink-0"
            title={isEn ? 'Close' : '关闭'}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* 内容 */}
        <div className="ui-dialog-body pb-5 space-y-7">
          {/* 配额总览 */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-semibold text-section text-foreground">
                <div className="p-1.5 rounded-panel bg-primary/10">
                  <CreditCard className="h-4 w-4 text-primary" />
                </div>
                {isEn ? 'Quota Overview' : '配额总览'}
              </h3>
              {onRefresh && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRefresh}
                  disabled={isRefreshing}
                  className="h-8 rounded-control"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5 ', isRefreshing && 'animate-spin')} />
                  {isEn ? 'Refresh' : '刷新数据'}
                </Button>
              )}
            </div>

            <div className="bg-muted/30 border border-primary/15 rounded-panel p-5 space-y-5 ">
              {/* 总使用量 */}
              <div>
                <div className="flex items-end justify-between mb-3">
                  <div className="space-y-1">
                    <div className="text-caption text-muted-foreground font-semibold uppercase ">
                      {isEn ? 'Total Usage' : '总使用量'}
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-metric font-semibold bg-muted/30 text-foreground">
                        {formatUsage(usage.current)}
                      </span>
                      <span className="text-title text-muted-foreground font-medium">
                        / {formatUsage(usage.limit)}
                      </span>
                    </div>
                  </div>
                  <div
                    className={cn(
                      'text-body font-semibold px-3 py-1.5 rounded-full border ',
                      usage.percentUsed > 0.9
                        ? 'bg-destructive/10 text-destructive border-destructive/30'
                        : 'bg-success/10 text-success border-success/30'
                    )}
                  >
                    {(usage.percentUsed * 100).toFixed(usagePrecision ? 2 : 1)}%{' '}
                    {isEn ? 'used' : '已使用'}
                  </div>
                </div>
                <Progress
                  value={usage.percentUsed * 100}
                  className="h-1.5 rounded-full"
                  indicatorClassName={usage.percentUsed > 0.9 ? 'bg-red-500' : 'bg-primary'}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                {/* 主配额 */}
                <div className="p-4 bg-background/60 rounded-panel border border-primary/15 hover:border-primary/30 hover:bg-background/80 transition-all ">
                  <div className="flex items-center gap-2 text-caption font-semibold text-primary mb-2">
                    <div className="w-2 h-2 rounded-full bg-primary " />
                    {isEn ? 'Base' : '主配额'}
                  </div>
                  <div className="text-title font-semibold ">
                    {formatUsage(usage.baseCurrent ?? 0)}{' '}
                    <span className="text-body text-muted-foreground font-normal">
                      / {formatUsage(usage.baseLimit ?? 0)}
                    </span>
                  </div>
                  <div className="text-caption text-muted-foreground mt-1 font-medium">
                    {formatDate(usage.nextResetDate)} {isEn ? 'reset' : '重置'}
                  </div>
                </div>

                {/* 免费试用 */}
                <div
                  className={cn(
                    'p-4 bg-background/60 rounded-panel border border-warning/15 hover:border-warning/30 hover:bg-background/80 transition-all ',
                    (usage.freeTrialLimit ?? 0) === 0 && 'opacity-60 grayscale'
                  )}
                >
                  <div className="flex items-center gap-2 text-caption font-semibold text-warning mb-2">
                    <div className="w-2 h-2 rounded-full bg-warning " />
                    {isEn ? 'Trial' : '免费试用'}
                    {(usage.freeTrialLimit ?? 0) > 0 && (
                      <Badge variant="secondary" className="text-badge px-[7px] h-5 ml-auto">
                        ACTIVE
                      </Badge>
                    )}
                  </div>
                  <div className="text-title font-semibold ">
                    {formatUsage(usage.freeTrialCurrent ?? 0)}{' '}
                    <span className="text-body text-muted-foreground font-normal">
                      / {formatUsage(usage.freeTrialLimit ?? 0)}
                    </span>
                  </div>
                  <div className="text-caption text-muted-foreground mt-1 font-medium">
                    {usage.freeTrialExpiry
                      ? `${formatDate(usage.freeTrialExpiry)} ${isEn ? 'expires' : '过期'}`
                      : isEn
                        ? 'No trial'
                        : '无试用额度'}
                  </div>
                </div>

                {/* 奖励总计 */}
                <div
                  className={cn(
                    'p-4 bg-background/60 rounded-panel border border-success/15 hover:border-success/30 hover:bg-background/80 transition-all ',
                    bonusTotal === 0 && 'opacity-60 grayscale'
                  )}
                >
                  <div className="flex items-center gap-2 text-caption font-semibold text-success mb-2">
                    <div className="w-2 h-2 rounded-full bg-success " />
                    {isEn ? 'Bonus' : '奖励总计'}
                  </div>
                  <div className="text-title font-semibold ">
                    {formatUsage(bonusUsed)}{' '}
                    <span className="text-body text-muted-foreground font-normal">
                      / {formatUsage(bonusTotal)}
                    </span>
                  </div>
                  <div className="text-caption text-muted-foreground mt-1 font-medium">
                    {isEn
                      ? `${usage.bonuses?.length ?? 0} active`
                      : `${usage.bonuses?.length ?? 0} 个生效奖励`}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 奖励详情 */}
          {usage.bonuses && usage.bonuses.length > 0 && (
            <section className="space-y-3">
              <h3 className="font-semibold text-body text-muted-foreground uppercase pl-1">
                {isEn ? 'Active Bonuses' : '生效奖励明细'}
              </h3>
              <div className="grid grid-cols-1 gap-2">
                {usage.bonuses.map((bonus) => (
                  <div
                    key={bonus.code}
                    className="flex items-center justify-between p-4 bg-background border rounded-panel transition-shadow"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-body">{bonus.name}</span>
                        <Badge
                          variant="outline"
                          className="text-badge h-5 px-[7px] text-green-600 border-green-200 bg-green-50"
                        >
                          ACTIVE
                        </Badge>
                      </div>
                      <div className="text-caption text-muted-foreground font-mono">
                        Code: {bonus.code} · {formatDateTime(bonus.expiresAt)} 过期
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-body font-semibold">
                        {formatUsage(bonus.current)}{' '}
                        <span className="text-muted-foreground font-normal">
                          / {formatUsage(bonus.limit)}
                        </span>
                      </div>
                      <div className="text-caption text-blue-600 font-medium">
                        {isEn ? 'Used' : '已用'}{' '}
                        {((bonus.current / bonus.limit) * 100).toFixed(usagePrecision ? 2 : 0)}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 基本信息 & Token 凭证 - 并排布局 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 基本信息 */}
            <section className="space-y-3">
              <h3 className="flex items-center gap-2 font-semibold text-section text-foreground">
                <div className="p-1.5 rounded-panel bg-primary/10">
                  <User className="h-4 w-4 text-primary" />
                </div>
                {isEn ? 'Basic Info' : '基本信息'}
              </h3>
              <div className="bg-muted/30 border border-primary/15 rounded-panel p-5 space-y-4 ">
                <div className="space-y-1">
                  <label className="text-caption font-medium text-muted-foreground">
                    {isEn ? 'Email/ID' : '邮箱/ID'}
                  </label>
                  <div className="text-body font-mono break-all select-all">
                    {account.email
                      ? maskEmail(account.email)
                      : maskNickname(getDisplayName(account))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1 min-w-0">
                    <label className="text-caption font-medium text-muted-foreground">
                      {isEn ? 'Nickname' : '账号别名'}
                    </label>
                    <div className="text-body font-medium truncate" title={account.nickname || '-'}>
                      {maskNickname(account.nickname) || '-'}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-caption font-medium text-muted-foreground">
                      {isEn ? 'Provider' : '身份提供商'}
                    </label>
                    <div className="text-body font-medium">{account.idp}</div>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-caption font-medium text-muted-foreground">
                    {isEn ? 'User ID' : '用户 ID'}
                  </label>
                  <div className="text-caption font-mono break-all bg-primary/[0.06] px-3 py-2 rounded-panel border border-primary/15 select-all text-foreground/80">
                    {privacyMode ? '********' : account.userId || '-'}
                  </div>
                </div>
                {/* 代理绑定（B4） */}
                <ProxyBindingSection
                  accountId={account.id}
                  accountEmail={account.email || ''}
                  isEn={isEn}
                />
              </div>
            </section>

            {/* Token 凭证 */}
            <section className="space-y-3">
              <h3 className="flex items-center gap-2 font-semibold text-section text-foreground">
                <div className="p-1.5 rounded-panel bg-primary/10">
                  <Key className="h-4 w-4 text-primary" />
                </div>
                {isEn ? 'Subscription' : '订阅详情'}
              </h3>
              <div className="bg-muted/30 border border-primary/15 rounded-panel p-5 text-body space-y-3 ">
                <div className="flex justify-between items-center py-1 border-b border-primary/10 last:border-0">
                  <span className="text-muted-foreground text-caption">Region</span>
                  <Badge variant="outline" className="font-mono">
                    {credentials.region || 'us-east-1'}
                  </Badge>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-primary/10 last:border-0">
                  <span className="text-muted-foreground text-caption">
                    {isEn ? 'Token Expires' : 'Token 到期'}
                  </span>
                  <span className="font-medium text-caption">
                    {credentials.expiresAt ? formatDateTime(credentials.expiresAt) : '-'}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-primary/10 last:border-0">
                  <span className="text-muted-foreground text-caption">
                    {isEn ? 'Plan Type' : '订阅类型'}
                  </span>
                  <span className="font-mono text-caption" title={subscription.rawType}>
                    {subscription.rawType || '-'}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-primary/10 last:border-0">
                  <span className="text-muted-foreground text-caption">
                    {isEn ? 'Overage Rate' : '超额费率'}
                  </span>
                  <span className="font-mono text-caption">
                    {usage.resourceDetail?.overageRate
                      ? `$${usage.resourceDetail.overageRate}/${usage.resourceDetail.unit || 'INV'}`
                      : '-'}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-primary/10 last:border-0">
                  <span className="text-muted-foreground text-caption">
                    {isEn ? 'Resource Type' : '资源类型'}
                  </span>
                  <span className="font-mono text-caption">
                    {usage.resourceDetail?.resourceType || '-'}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-muted-foreground text-caption">
                    {isEn ? 'Upgradable' : '可升级'}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-badge px-[7px] h-5 font-semibold',
                      subscription.upgradeCapability === 'UPGRADE_CAPABLE'
                        ? 'bg-success/10 text-success border-success/30'
                        : 'bg-muted text-muted-foreground border-border'
                    )}
                  >
                    {subscription.upgradeCapability === 'UPGRADE_CAPABLE' ? 'YES' : 'NO'}
                  </Badge>
                </div>
              </div>
            </section>
          </div>

          {/* 账户可用模型 */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 font-semibold text-section text-foreground">
              <div className="p-1.5 rounded-panel bg-primary/10">
                <Cpu className="h-4 w-4 text-primary" />
              </div>
              {isEn ? 'Available Models' : '账户可用模型'}
              <Badge className="ml-auto bg-primary/10 text-primary border-primary/20">
                {models.length}
              </Badge>
            </h3>
            <div className="bg-muted/30 border rounded-panel p-4">
              {modelsLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin " />
                  {isEn ? 'Loading models...' : '加载模型中...'}
                </div>
              ) : modelsError ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p className="text-red-500 text-body">{modelsError}</p>
                </div>
              ) : models.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-body">
                  {isEn ? 'No models available' : '暂无可用模型'}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[320px] overflow-y-auto pr-1">
                  {models.map((model, index) => (
                    <div
                      key={model.id}
                      className={cn(
                        'group p-3 bg-background rounded-panel border hover:border-primary/30 transition-all duration-200',
                        index === 0 && 'ring-1 ring-primary/20'
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5">
                            <div
                              className={cn(
                                'w-2 h-2 rounded-full shrink-0',
                                index === 0 ? 'bg-primary animate-pulse' : 'bg-muted-foreground/40'
                              )}
                            />
                            <code className="text-caption font-semibold text-foreground truncate">
                              {model.id}
                            </code>
                          </div>
                          {model.name && model.name !== model.id && (
                            <p className="text-caption text-primary/80 font-medium mb-1 truncate">
                              {model.name}
                            </p>
                          )}
                          <p className="text-caption text-muted-foreground line-clamp-2 leading-relaxed">
                            {model.description || (isEn ? 'No description' : '无描述')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
                        <div className="flex items-center gap-1.5">
                          {model.inputTypes?.includes('TEXT') && (
                            <Badge
                              variant="secondary"
                              className="text-badge px-[7px] h-5 bg-blue-500/10 text-blue-600 dark:text-blue-400 border-0"
                            >
                              <FileText className="h-3 w-3 mr-0.5" />
                              Text
                            </Badge>
                          )}
                          {model.inputTypes?.includes('IMAGE') && (
                            <Badge
                              variant="secondary"
                              className="text-badge px-[7px] h-5 bg-purple-500/10 text-purple-600 dark:text-purple-400 border-0"
                            >
                              <Image className="h-3 w-3 mr-0.5" />
                              Image
                            </Badge>
                          )}
                          {model.rateMultiplier !== undefined && (
                            <Badge
                              variant="secondary"
                              className="text-badge px-[7px] h-5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-0"
                            >
                              <Zap className="h-3 w-3 mr-0.5" />
                              {model.rateMultiplier}x
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-caption text-muted-foreground font-mono">
                          <Hash className="h-3 w-3" />
                          <span className="text-green-600 dark:text-green-400">
                            {model.maxInputTokens
                              ? model.maxInputTokens >= 1000000
                                ? `${(model.maxInputTokens / 1000000).toFixed(0)}M`
                                : `${(model.maxInputTokens / 1000).toFixed(0)}K`
                              : '-'}
                          </span>
                          <span>/</span>
                          <span className="text-orange-600 dark:text-orange-400">
                            {model.maxOutputTokens
                              ? model.maxOutputTokens >= 1000000
                                ? `${(model.maxOutputTokens / 1000000).toFixed(0)}M`
                                : `${(model.maxOutputTokens / 1000).toFixed(0)}K`
                              : '-'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body
  )
}

/** 账号详情对话框内的"代理绑定"段（B4 边缘修复） */
function ProxyBindingSection({
  accountId,
  accountEmail,
  isEn
}: {
  accountId: string
  accountEmail: string
  isEn: boolean
}): React.ReactNode {
  const { proxyPool, accountProxyBindings, bindAccountsToProxy, unbindAccountFromProxy } =
    useAccountsStore()
  const [open, setOpen] = useState(false)

  const boundProxyId = accountProxyBindings[accountId]
  const boundProxy = boundProxyId ? proxyPool.get(boundProxyId) : null

  const aliveProxies = Array.from(proxyPool.values()).filter(
    (p) => p.enabled && p.status !== 'dead'
  )

  return (
    <div className="space-y-1 mt-3">
      <label className="text-caption font-medium text-muted-foreground">
        {isEn ? 'Bound Proxy (Reverse Proxy)' : '反代绑定代理'}
      </label>
      {boundProxy ? (
        <div className="flex items-center gap-2 bg-cyan-500/10 border border-cyan-500/30 px-3 py-2 rounded-panel">
          <span
            className="text-cyan-700 dark:text-cyan-300 text-caption font-mono flex-1 truncate"
            title={boundProxy.url}
          >
            {boundProxy.protocol}://{boundProxy.host}:{boundProxy.port}
            {boundProxy.label && (
              <span className="text-muted-foreground ml-1.5">({boundProxy.label})</span>
            )}
          </span>
          <Badge variant="outline" className="text-badge">
            {boundProxy.status}
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOpen(!open)}
            className="h-7 text-body"
          >
            {isEn ? 'Change' : '更换'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-body text-destructive"
            onClick={() => {
              if (confirm(isEn ? `Unbind ${accountEmail}?` : `解绑 ${accountEmail}？`)) {
                unbindAccountFromProxy(accountId)
              }
            }}
          >
            {isEn ? 'Unbind' : '解绑'}
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setOpen(!open)}
          className="h-7 text-body w-full"
        >
          {isEn ? '+ Bind to Proxy' : '+ 绑定代理'}
        </Button>
      )}

      {open && (
        <div className="ui-menu mt-2 space-y-1 max-h-48 overflow-y-auto">
          {aliveProxies.length === 0 ? (
            <p className="text-caption text-muted-foreground p-2">
              {isEn
                ? 'No alive proxies. Add and validate in "Proxy Pool".'
                : '无可用代理。请先在"代理池"添加并验活。'}
            </p>
          ) : (
            aliveProxies.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  bindAccountsToProxy([accountId], p.id)
                  setOpen(false)
                }}
                className={cn(
                  'w-full flex min-h-[30px] items-center gap-2 px-2 py-1 rounded-control text-body text-left hover:bg-muted',
                  p.id === boundProxyId && 'bg-primary/10 text-primary'
                )}
              >
                <span className="font-mono flex-1 truncate">
                  {p.host}:{p.port}
                  {p.label && <span className="text-muted-foreground ml-1.5">({p.label})</span>}
                </span>
                {p.latencyMs !== undefined && (
                  <span className="text-caption text-muted-foreground">{p.latencyMs}ms</span>
                )}
                {p.id === boundProxyId && <span className="text-primary">✓</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

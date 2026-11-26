import { useMemo } from 'react'
import { useAccountsStore, isBannedAccountError } from '@/store/accounts'
import { Card, CardContent, CardHeader, CardTitle } from '../ui'
import {
  Users,
  CheckCircle,
  AlertTriangle,
  Clock,
  Zap,
  Shield,
  Fingerprint,
  FolderPlus,
  Tag,
  TrendingUp,
  Activity,
  BarChart3,
  Ban,
  ChevronRight,
  Home
} from 'lucide-react'
import { PageHeader } from '../layout/PageHeader'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/hooks/useTranslation'
import type { Account, AccountFilter } from '@/types/account'

// 额度告急阈值（usage.percentUsed 为 0-1 小数）
const QUOTA_WARN_RATIO = 0.9
// 即将到期阈值（天）
const EXPIRE_WARN_DAYS = 7

// 订阅类型颜色映射
const getSubscriptionColor = (type: string, title?: string): string => {
  const text = (title || type).toUpperCase()
  // KIRO PRO+ / PRO_PLUS - 紫色
  if (text.includes('PRO+') || text.includes('PRO_PLUS') || text.includes('PROPLUS'))
    return 'bg-violet-500/10 text-violet-600 dark:text-violet-400'
  // KIRO POWER - 金色
  if (text.includes('POWER')) return 'bg-warning-soft text-warning-text'
  // KIRO PRO - 蓝色
  if (text.includes('PRO')) return 'bg-chart-1/10 text-chart-1'
  // KIRO FREE - 灰色
  return 'bg-muted text-muted-foreground'
}

export function HomePage() {
  const {
    accounts,
    activeAccountId,
    getStats,
    usagePrecision,
    setFilter,
    setActiveGroupTab,
    maskEmail,
    maskNickname
  } = useAccountsStore()
  const { t } = useTranslation()
  const stats = getStats()

  // 告警聚合：封禁 / 即将到期 / 额度告急（一次遍历，复用已有数据）
  const warnings = useMemo(() => {
    const banned: Account[] = []
    const expiring: Account[] = []
    const quotaHigh: Account[] = []
    for (const a of accounts.values()) {
      if (isBannedAccountError(a.lastError)) {
        banned.push(a)
        continue // 已封禁的不再重复计入其它告警
      }
      const days = a.subscription.daysRemaining
      if (days !== undefined && days <= EXPIRE_WARN_DAYS) expiring.push(a)
      if (a.status === 'active' && a.usage.limit > 0 && a.usage.percentUsed >= QUOTA_WARN_RATIO) {
        quotaHigh.push(a)
      }
    }
    return { banned, expiring, quotaHigh }
  }, [accounts])

  // 点击告警 → 应用筛选并跳转到账号页（清掉分组 Tab 限制，确保跨组可见）
  const jumpToAccounts = (patch: AccountFilter): void => {
    setActiveGroupTab('all')
    setFilter(patch)
    window.dispatchEvent(new CustomEvent('navigate-page', { detail: 'accounts' }))
  }

  // 计算额度统计
  const usageStats = useMemo(() => {
    let totalLimit = 0
    let totalUsed = 0
    let validAccountCount = 0

    Array.from(accounts.values()).forEach((account) => {
      // 只统计正常状态的账号
      if (account.status === 'active' && account.usage) {
        const limit = account.usage.limit ?? 0
        const used = account.usage.current ?? 0
        if (limit > 0) {
          totalLimit += limit
          totalUsed += used
          validAccountCount++
        }
      }
    })

    const remaining = totalLimit - totalUsed
    const percentUsed = totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0

    return {
      totalLimit,
      totalUsed,
      remaining,
      percentUsed,
      validAccountCount
    }
  }, [accounts])

  const isEn = t('common.unknown') === 'Unknown'
  const statCards = [
    {
      label: isEn ? 'Total Accounts' : '总账号数',
      value: stats.total,
      icon: Users,
      color: 'text-chart-1',
      bgColor: 'bg-chart-1/10'
    },
    {
      label: isEn ? 'Active' : '正常账号',
      value: stats.byStatus?.active || 0,
      icon: CheckCircle,
      color: 'text-success-text',
      bgColor: 'bg-success-soft'
    },
    {
      label: isEn ? 'Banned' : '已封禁',
      value: stats.byStatus?.error || 0,
      icon: AlertTriangle,
      color: 'text-danger-text',
      bgColor: 'bg-danger-soft'
    },
    {
      label: isEn ? 'Expiring Soon' : '即将过期',
      value: stats.expiringSoonCount,
      icon: Clock,
      color: 'text-warning-text',
      bgColor: 'bg-warning-soft'
    }
  ]

  // 获取当前活跃账号：用 activeAccountId 直接 O(1) 命中，避免每次 re-render 都 O(n) 遍历
  const activeAccount = useMemo(
    () => (activeAccountId ? (accounts.get(activeAccountId) ?? null) : null),
    [accounts, activeAccountId]
  )

  // 告警卡行配置（仅渲染非空类别）
  const warnRows = [
    {
      key: 'banned',
      list: warnings.banned,
      icon: Ban,
      iconBg: 'bg-danger-soft',
      iconColor: 'text-danger-text',
      label: isEn ? 'Banned' : '已封禁',
      hint: isEn ? 'Need manual unban' : '需人工解封',
      onClick: () => jumpToAccounts({ bannedOnly: true })
    },
    {
      key: 'expiring',
      list: warnings.expiring,
      icon: Clock,
      iconBg: 'bg-warning-soft',
      iconColor: 'text-warning-text',
      label: isEn ? `Expiring (≤${EXPIRE_WARN_DAYS}d)` : `即将到期 (≤${EXPIRE_WARN_DAYS}天)`,
      hint: isEn ? 'Renew soon' : '尽快续期',
      onClick: () => jumpToAccounts({ daysRemainingMax: EXPIRE_WARN_DAYS })
    },
    {
      key: 'quota',
      list: warnings.quotaHigh,
      icon: Zap,
      iconBg: 'bg-warning-soft',
      iconColor: 'text-warning-text',
      label: isEn
        ? `Quota ≥${Math.round(QUOTA_WARN_RATIO * 100)}%`
        : `额度告急 (≥${Math.round(QUOTA_WARN_RATIO * 100)}%)`,
      hint: isEn ? 'Almost exhausted' : '即将耗尽',
      onClick: () => jumpToAccounts({ usageMin: QUOTA_WARN_RATIO })
    }
  ].filter((r) => r.list.length > 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader icon={<Home />} title={t('nav.home')} />
      <div className="min-h-0 flex-1 overflow-auto p-6 space-y-7" data-home-content>
        <div className="space-y-1">
          <h2 className="text-section">
            {isEn ? 'Welcome to Kiro Account Manager' : '欢迎使用 Kiro 账户管理器'}
          </h2>
          <p className="text-body text-muted-foreground">
            {isEn
              ? 'Manage your Kiro IDE accounts, one-click switch'
              : '管理你的 Kiro IDE 账号，一键切换，高效开发'}
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-home-stats>
          {statCards.map((stat) => {
            const Icon = stat.icon
            return (
              <Card key={stat.label}>
                <CardContent className="p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={`shrink-0 rounded-control p-2 ${stat.bgColor}`}>
                      <Icon className={`h-4 w-4 ${stat.color}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-metric break-all">{stat.value}</p>
                      <p className="text-caption text-muted-foreground">{stat.label}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* 告警预警卡：有封禁/到期/额度告急时才显示 */}
        {warnRows.length > 0 && (
          <Card className="border-border" data-home-warnings>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2">
                <div className="text-warning-text">
                  <AlertTriangle className="h-4 w-4 text-warning-text" />
                </div>
                {isEn ? 'Attention Needed' : '需要关注'}
                <span className="text-caption font-normal text-muted-foreground">
                  {isEn ? 'Click a row to view affected accounts' : '点击查看受影响的账号'}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {warnRows.map((row) => {
                const Icon = row.icon
                const preview = row.list
                  .slice(0, 3)
                  .map((a) => (a.nickname ? maskNickname(a.nickname) : maskEmail(a.email)))
                  .join('、')
                const more =
                  row.list.length > 3
                    ? isEn
                      ? ` +${row.list.length - 3} more`
                      : ` 等 ${row.list.length} 个`
                    : ''
                return (
                  <button
                    key={row.key}
                    onClick={row.onClick}
                    className="ui-list-row w-full flex-wrap text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    data-risk={row.key}
                  >
                    <div className={cn('p-2 rounded-control shrink-0', row.iconBg)}>
                      <Icon className={cn('h-4 w-4', row.iconColor)} />
                    </div>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-title tabular-nums">{row.list.length}</span>
                      <span className="text-body font-medium">{row.label}</span>
                    </div>
                    <span className="text-caption text-muted-foreground truncate flex-1 min-w-0">
                      {preview}
                      {more}
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                )
              })}
            </CardContent>
          </Card>
        )}

        {/* Usage Stats */}
        {usageStats.validAccountCount > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2">
                <div className="text-muted-foreground">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                </div>
                {isEn ? 'Usage Stats' : '额度统计'}
                <span className="text-caption font-normal text-muted-foreground">
                  (
                  {isEn
                    ? `Based on ${usageStats.validAccountCount} valid accounts`
                    : `基于 ${usageStats.validAccountCount} 个有效账号`}
                  )
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4" data-home-usage>
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp className="h-4 w-4 text-chart-1" />
                    <span className="text-caption text-muted-foreground">
                      {isEn ? 'Total' : '总额度'}
                    </span>
                  </div>
                  <p className="text-metric break-all">{usageStats.totalLimit.toLocaleString()}</p>
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Activity className="h-4 w-4 text-warning-text" />
                    <span className="text-caption text-muted-foreground">
                      {isEn ? 'Used' : '已使用'}
                    </span>
                  </div>
                  <p className="text-metric break-all">{usageStats.totalUsed.toLocaleString()}</p>
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Zap className="h-4 w-4 text-success-text" />
                    <span className="text-caption text-muted-foreground">
                      {isEn ? 'Remaining' : '剩余额度'}
                    </span>
                  </div>
                  <p className="text-metric text-success-text">
                    {usageStats.remaining.toLocaleString()}
                  </p>
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 mb-1">
                    <BarChart3 className="h-4 w-4 text-purple-500" />
                    <span className="text-caption text-muted-foreground">
                      {isEn ? 'Usage %' : '使用率'}
                    </span>
                  </div>
                  <p className="text-metric break-all">
                    {usageStats.percentUsed.toFixed(usagePrecision ? 2 : 1)}%
                  </p>
                </div>
              </div>
              {/* 进度条 - 超额时双段显示 */}
              {(() => {
                const isOverQuota = usageStats.percentUsed > 100
                const overPercent = isOverQuota ? usageStats.percentUsed - 100 : 0
                const overAmount = isOverQuota ? Math.abs(usageStats.remaining) : 0
                // 超额段视觉宽度：按超额比例占整条进度条比例，最多 60% 避免完全遮盖
                const overBarWidth = isOverQuota
                  ? Math.min((overPercent / usageStats.percentUsed) * 100, 60)
                  : 0
                const precision = usagePrecision ? 2 : 1

                return (
                  <div className="space-y-2">
                    <div className="flex flex-wrap justify-between items-center gap-2 text-caption">
                      <span className="text-muted-foreground">
                        {isEn ? 'Overall Progress' : '总体使用进度'}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                          {usageStats.totalUsed.toLocaleString(undefined, {
                            maximumFractionDigits: 2
                          })}{' '}
                          / {usageStats.totalLimit.toLocaleString()}
                        </span>
                        <span
                          className={cn(
                            'font-semibold px-2 py-0.5 rounded-control',
                            isOverQuota && 'bg-danger-soft text-danger-text',
                            !isOverQuota &&
                              usageStats.percentUsed >= 80 &&
                              'bg-warning-soft text-warning-text',
                            !isOverQuota &&
                              usageStats.percentUsed >= 50 &&
                              usageStats.percentUsed < 80 &&
                              'bg-warning-soft text-warning-text',
                            !isOverQuota &&
                              usageStats.percentUsed < 50 &&
                              'bg-success-soft text-success-text'
                          )}
                        >
                          {usageStats.percentUsed.toFixed(precision)}%
                        </span>
                      </span>
                    </div>
                    <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
                      {/* 基础进度段 */}
                      <div
                        className={cn(
                          'absolute inset-y-0 left-0 transition-all',
                          isOverQuota && 'bg-destructive',
                          !isOverQuota && usageStats.percentUsed >= 80 && 'bg-warning',
                          !isOverQuota &&
                            usageStats.percentUsed >= 50 &&
                            usageStats.percentUsed < 80 &&
                            'bg-warning',
                          !isOverQuota && usageStats.percentUsed < 50 && 'bg-success'
                        )}
                        style={{ width: `${Math.min(usageStats.percentUsed, 100)}%` }}
                      />
                      {/* 超额段 - 深红条纹动画从右侧叠加 */}
                      {isOverQuota && (
                        <div
                          className="absolute inset-y-0 right-0 bg-danger-text"
                          style={{
                            width: `${overBarWidth}%`
                          }}
                        />
                      )}
                    </div>
                    {/* 超额警示横幅 */}
                    {isOverQuota && (
                      <div
                        className="ui-notice mt-3 flex-wrap justify-between"
                        data-variant="danger"
                      >
                        <div className="flex items-center gap-2 text-caption">
                          <AlertTriangle className="h-3.5 w-3.5 text-danger-text shrink-0" />
                          <span className="font-semibold text-danger-text">
                            {isEn ? 'Over Quota' : '已超额'}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-danger-soft text-danger-text font-semibold">
                            +{overPercent.toFixed(precision)}%
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-caption">
                          <span className="text-muted-foreground">
                            {isEn ? 'Excess: ' : '超额积分：'}
                          </span>
                          <span className="font-semibold text-danger-text">
                            {overAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}
            </CardContent>
          </Card>
        )}

        {/* Current Account */}
        {activeAccount && (
          <Card data-home-account>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2">
                <Zap className="h-4 w-4 text-muted-foreground" />
                {isEn ? 'Current Account' : '当前使用账号'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              {/* 基本信息 */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="size-8 shrink-0 rounded-control bg-muted flex items-center justify-center text-strong">
                    {(activeAccount.nickname
                      ? maskNickname(activeAccount.nickname)
                      : maskEmail(activeAccount.email) || '?')[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-strong break-all">
                      {activeAccount.nickname
                        ? maskNickname(activeAccount.nickname)
                        : maskEmail(activeAccount.email)}
                    </p>
                    <p className="text-body text-muted-foreground break-all">
                      {maskEmail(activeAccount.email)}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span
                    className={cn(
                      'inline-flex items-center min-h-5 max-w-full px-[7px] rounded-full text-badge font-medium break-all',
                      getSubscriptionColor(
                        activeAccount.subscription?.type || 'Free',
                        activeAccount.subscription?.title
                      )
                    )}
                  >
                    {activeAccount.subscription?.title ||
                      activeAccount.subscription?.type ||
                      'Free'}
                  </span>
                </div>
              </div>

              {/* 详细信息网格 */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t">
                {/* 用量 */}
                <div className="space-y-1">
                  <p className="text-caption text-muted-foreground">
                    {isEn ? 'Monthly Usage' : '本月用量'}
                  </p>
                  <p className="text-body font-medium">
                    {activeAccount.usage?.current || 0} / {activeAccount.usage?.limit || 0}
                  </p>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        (activeAccount.usage?.percentUsed || 0) > 0.8
                          ? 'bg-destructive'
                          : (activeAccount.usage?.percentUsed || 0) > 0.5
                            ? 'bg-warning'
                            : 'bg-success'
                      }`}
                      style={{
                        width: `${Math.min((activeAccount.usage?.percentUsed || 0) * 100, 100)}%`
                      }}
                    />
                  </div>
                </div>

                {/* 订阅剩余 */}
                <div className="space-y-1">
                  <p className="text-caption text-muted-foreground">
                    {isEn ? 'Subscription' : '订阅剩余'}
                  </p>
                  <p className="text-body font-medium">
                    {activeAccount.subscription?.daysRemaining != null
                      ? isEn
                        ? `${activeAccount.subscription.daysRemaining} days`
                        : `${activeAccount.subscription.daysRemaining} 天`
                      : isEn
                        ? 'Permanent'
                        : '永久'}
                  </p>
                </div>

                {/* Token 状态 */}
                <div className="space-y-1">
                  <p className="text-caption text-muted-foreground">
                    {isEn ? 'Token Status' : 'Token 状态'}
                  </p>
                  {(() => {
                    const expiresAt = activeAccount.credentials?.expiresAt
                    if (!expiresAt)
                      return (
                        <p className="text-body font-medium text-muted-foreground">
                          {isEn ? 'Unknown' : '未知'}
                        </p>
                      )
                    const now = Date.now()
                    const remaining = expiresAt - now
                    if (remaining <= 0)
                      return (
                        <p className="text-body font-medium text-danger-text">
                          {isEn ? 'Expired' : '已过期'}
                        </p>
                      )
                    const minutes = Math.floor(remaining / 60000)
                    if (minutes < 60)
                      return (
                        <p className="text-body font-medium text-warning-text">
                          {isEn ? `${minutes} min` : `${minutes} 分钟`}
                        </p>
                      )
                    const hours = Math.floor(minutes / 60)
                    return (
                      <p className="text-body font-medium text-success-text">
                        {isEn ? `${hours} hours` : `${hours} 小时`}
                      </p>
                    )
                  })()}
                </div>

                {/* 登录方式 */}
                <div className="space-y-1">
                  <p className="text-caption text-muted-foreground">
                    {isEn ? 'Auth Method' : '登录方式'}
                  </p>
                  <p className="text-body font-medium">
                    {activeAccount.credentials?.authMethod === 'social'
                      ? activeAccount.credentials?.provider || 'Social'
                      : 'Builder ID'}
                  </p>
                </div>
              </div>

              {/* 订阅详情 */}
              <div className="pt-4 border-t space-y-3">
                <p className="text-caption font-medium text-muted-foreground">
                  {isEn ? 'Subscription Details' : '订阅详情'}
                </p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-4 gap-y-2 text-caption [&>div]:flex-wrap [&>div]:break-all">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{isEn ? 'Type:' : '订阅类型:'}</span>
                    <span className="font-medium">
                      {activeAccount.subscription?.title ||
                        activeAccount.subscription?.type ||
                        'Free'}
                    </span>
                  </div>
                  {activeAccount.subscription?.rawType && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {isEn ? 'Raw Type:' : '原始类型:'}
                      </span>
                      <span className="font-mono text-caption">
                        {activeAccount.subscription.rawType}
                      </span>
                    </div>
                  )}
                  {activeAccount.subscription?.expiresAt && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {isEn ? 'Expires:' : '到期时间:'}
                      </span>
                      <span className="font-medium">
                        {new Date(activeAccount.subscription.expiresAt).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                  )}
                  {activeAccount.subscription?.upgradeCapability && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {isEn ? 'Upgradeable:' : '可升级:'}
                      </span>
                      <span className="font-medium">
                        {activeAccount.subscription.upgradeCapability}
                      </span>
                    </div>
                  )}
                  {activeAccount.subscription?.overageCapability && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {isEn ? 'Overage:' : '超额能力:'}
                      </span>
                      <span className="font-medium">
                        {activeAccount.subscription.overageCapability}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* 额度明细 */}
              {(activeAccount.usage?.baseLimit ||
                activeAccount.usage?.freeTrialLimit ||
                activeAccount.usage?.bonuses?.length) && (
                <div className="pt-4 border-t space-y-3">
                  <p className="text-caption font-medium text-muted-foreground">
                    {isEn ? 'Quota Details' : '额度明细'}
                  </p>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 [&>div]:flex-wrap">
                    {/* 基础额度 */}
                    {activeAccount.usage?.baseLimit !== undefined &&
                      activeAccount.usage.baseLimit > 0 && (
                        <div className="flex items-center gap-2 text-caption">
                          <div className="w-2 h-2 rounded-full bg-blue-500" />
                          <span className="text-muted-foreground">
                            {isEn ? 'Base:' : '基础额度:'}
                          </span>
                          <span className="font-medium">
                            {activeAccount.usage.baseCurrent ?? 0} / {activeAccount.usage.baseLimit}
                          </span>
                        </div>
                      )}
                    {/* 试用额度 */}
                    {activeAccount.usage?.freeTrialLimit !== undefined &&
                      activeAccount.usage.freeTrialLimit > 0 && (
                        <div className="flex items-center gap-2 text-caption">
                          <div className="w-2 h-2 rounded-full bg-purple-500" />
                          <span className="text-muted-foreground">
                            {isEn ? 'Trial:' : '试用额度:'}
                          </span>
                          <span className="font-medium">
                            {activeAccount.usage.freeTrialCurrent ?? 0} /{' '}
                            {activeAccount.usage.freeTrialLimit}
                          </span>
                          {activeAccount.usage.freeTrialExpiry && (
                            <span className="text-muted-foreground/70 text-caption">
                              (至{' '}
                              {(() => {
                                const d = activeAccount.usage.freeTrialExpiry as unknown
                                try {
                                  return (
                                    typeof d === 'string' ? d : new Date(d as Date).toISOString()
                                  ).split('T')[0]
                                } catch {
                                  return ''
                                }
                              })()}
                              )
                            </span>
                          )}
                        </div>
                      )}
                    {/* 奖励额度 */}
                    {activeAccount.usage?.bonuses?.map((bonus) => (
                      <div key={bonus.code} className="flex items-center gap-2 text-caption">
                        <div className="w-2 h-2 rounded-full bg-cyan-500" />
                        <span className="text-muted-foreground truncate">{bonus.name}:</span>
                        <span className="font-medium">
                          {bonus.current} / {bonus.limit}
                        </span>
                        {bonus.expiresAt && (
                          <span className="text-muted-foreground/70 text-caption">
                            (至{' '}
                            {(() => {
                              const d = bonus.expiresAt as unknown
                              try {
                                return (
                                  typeof d === 'string' ? d : new Date(d as Date).toISOString()
                                ).split('T')[0]
                              } catch {
                                return ''
                              }
                            })()}
                            )
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 账户信息 */}
              <div className="pt-4 border-t space-y-3">
                <p className="text-caption font-medium text-muted-foreground">
                  {isEn ? 'Account Info' : '账户信息'}
                </p>
                <div className="space-y-1.5 text-caption">
                  <div className="flex items-start gap-2">
                    <span className="text-muted-foreground shrink-0">User ID:</span>
                    <span className="font-mono text-caption break-all select-all">
                      {activeAccount.userId}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">IDP:</span>
                    <span className="font-medium">{activeAccount.idp || 'BuilderId'}</span>
                  </div>
                  {activeAccount.usage?.nextResetDate && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {isEn ? 'Reset Date:' : '重置日期:'}
                      </span>
                      <span className="font-medium">
                        {(() => {
                          const d = activeAccount.usage.nextResetDate as unknown
                          try {
                            return (
                              typeof d === 'string' ? d : new Date(d as Date).toISOString()
                            ).split('T')[0]
                          } catch {
                            return isEn ? 'Unknown' : '未知'
                          }
                        })()}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick Tips */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <div className="text-muted-foreground">
                <Shield className="h-4 w-4 text-muted-foreground" />
              </div>
              {isEn ? 'Quick Tips' : '快速提示'}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="space-y-2 text-body text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                {isEn
                  ? 'Click "Accounts" to view and manage all accounts'
                  : '点击左侧「账户管理」可以查看和管理所有账号'}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                {isEn
                  ? 'Click power icon on account card to switch'
                  : '在账号卡片上点击电源图标可以快速切换账号'}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                {isEn
                  ? 'Tokens auto-refresh 5 minutes before expiry'
                  : 'Token 会在过期前 5 分钟自动刷新，无需手动操作'}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                {isEn
                  ? 'Use "Privacy Mode" to hide sensitive info'
                  : '使用「隐私模式」可以隐藏邮箱和账号信息'}
              </li>
            </ul>
          </CardContent>
        </Card>

        {/* Feature Highlights */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="text-muted-foreground">
                  <Fingerprint className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium text-body">{isEn ? 'Machine ID' : '机器码管理'}</p>
                  <p className="text-caption text-muted-foreground mt-1">
                    {isEn
                      ? 'Modify device ID, auto-switch, account binding'
                      : '修改设备标识符，切号时自动更换，支持账户绑定'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="text-muted-foreground">
                  <FolderPlus className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium text-body">{isEn ? 'Groups' : '分组管理'}</p>
                  <p className="text-caption text-muted-foreground mt-1">
                    {isEn
                      ? 'Batch set groups for selected accounts'
                      : '多选账户后可批量设置分组，一键移动账号'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="text-muted-foreground">
                  <Tag className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium text-body">{isEn ? 'Tags' : '标签管理'}</p>
                  <p className="text-caption text-muted-foreground mt-1">
                    {isEn
                      ? 'Batch add/remove tags, multi-tag support'
                      : '多选账户后可批量添加/移除标签，支持多标签'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

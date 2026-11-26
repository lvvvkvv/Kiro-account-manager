import { memo, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Card, CardContent, Badge, Button } from '../ui'
import { useAccountsStore } from '@/store/accounts'
import { useTranslation } from '@/hooks/useTranslation'
import type { Account, AccountTag, AccountGroup } from '@/types/account'
import {
  Check,
  RefreshCw,
  Trash2,
  Edit,
  Copy,
  AlertTriangle,
  Clock,
  Loader2,
  Info,
  FolderOpen,
  Power,
  Calendar,
  AlertCircle,
  KeyRound,
  X,
  ExternalLink,
  CreditCard,
  Sparkles,
  LogOut,
  RotateCcw
} from 'lucide-react'
import { cn } from '@/lib/utils'

// 解析 ARGB 颜色转换为 CSS rgba
function toRgba(argbColor: string): string {
  // 支持格式: #AARRGGBB 或 #RRGGBB
  let alpha = 255
  let rgb = argbColor
  if (argbColor.length === 9 && argbColor.startsWith('#')) {
    alpha = parseInt(argbColor.slice(1, 3), 16)
    rgb = '#' + argbColor.slice(3)
  }
  const hex = rgb.startsWith('#') ? rgb.slice(1) : rgb
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha / 255})`
}

interface AccountCardProps {
  account: Account
  tags: Map<string, AccountTag>
  groups: Map<string, AccountGroup>
  isSelected: boolean
  onSelect: () => void
  onEdit: () => void
  onShowDetail: () => void
}

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

const StatusLabelsZh: Record<string, string> = {
  active: '正常',
  expired: '已过期',
  error: '错误',
  refreshing: '刷新中',
  unknown: '未知'
}

const StatusLabelsEn: Record<string, string> = {
  active: 'Active',
  expired: 'Expired',
  error: 'Error',
  refreshing: 'Refreshing',
  unknown: 'Unknown'
}

// 获取账户显示名称：昵称优先，无则邮箱，无邮箱则 userId
function getDisplayName(account: Account): string {
  if (account.nickname) return account.nickname
  if (account.email) return account.email
  if (account.userId) return account.userId
  return 'Unknown'
}

// 格式化 Token 到期时间
function formatTokenExpiry(expiresAt: number, isEn: boolean): string {
  const now = Date.now()
  const diff = expiresAt - now

  if (diff <= 0) return isEn ? 'Expired' : '已过期'

  const minutes = Math.floor(diff / (60 * 1000))
  const hours = Math.floor(diff / (60 * 60 * 1000))

  if (minutes < 60) {
    return isEn ? `${minutes}m` : `${minutes} 分钟`
  } else if (hours < 24) {
    const remainingMinutes = minutes % 60
    return isEn
      ? remainingMinutes > 0
        ? `${hours}h ${remainingMinutes}m`
        : `${hours}h`
      : remainingMinutes > 0
        ? `${hours} 小时 ${remainingMinutes} 分`
        : `${hours} 小时`
  } else {
    const days = Math.floor(hours / 24)
    const remainingHours = hours % 24
    return isEn
      ? remainingHours > 0
        ? `${days}d ${remainingHours}h`
        : `${days}d`
      : remainingHours > 0
        ? `${days} 天 ${remainingHours} 小时`
        : `${days} 天`
  }
}

export const AccountCard = memo(function AccountCard({
  account,
  tags,
  groups,
  isSelected,
  onSelect,
  onEdit,
  onShowDetail
}: AccountCardProps) {
  const {
    setActiveAccount,
    removeAccount,
    checkAccountStatus,
    refreshAccountToken,
    toggleSelection,
    maskEmail,
    maskNickname,
    usagePrecision,
    updateAccountStatus,
    accountProxyBindings,
    proxyPool,
    unbindAccountFromProxy
  } = useAccountsStore()

  // 该账号绑定的代理（如有）
  const boundProxy = useMemo(() => {
    const proxyId = accountProxyBindings[account.id]
    if (!proxyId) return null
    return proxyPool.get(proxyId) || null
  }, [accountProxyBindings, account.id, proxyPool])

  // 解除封禁标记中（loading 状态）
  const [isClearingSuspended, setIsClearingSuspended] = useState(false)

  // 手动解除封禁标记：调用后端 IPC → 清反代池 suspended + 清前端 lastError
  const handleClearSuspended = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isClearingSuspended) return
    setIsClearingSuspended(true)
    try {
      const result = await window.api.proxyClearAccountSuspended(account.id)
      if (result.success) {
        // 前端 store 同步：status → active, lastError → undefined
        updateAccountStatus(account.id, 'active', undefined)
        setShowBanDialog(false)
      } else {
        console.error('[AccountCard] Clear suspended failed:', result.error)
      }
    } catch (err) {
      console.error('[AccountCard] Clear suspended error:', err)
    } finally {
      setIsClearingSuspended(false)
    }
  }

  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'

  // 格式化使用量数值
  const formatUsage = (value: number): string => {
    if (usagePrecision) {
      return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    }
    return Math.floor(value).toLocaleString()
  }

  const handleSwitch = async (): Promise<void> => {
    const { credentials } = account
    const { switchTarget } = useAccountsStore.getState()

    // 社交登录只需要 refreshToken，IdC 登录需要 clientId 和 clientSecret
    if (!credentials.refreshToken) {
      alert(isEn ? 'Incomplete credentials, cannot switch' : '账号凭证不完整，无法切换')
      return
    }
    if (
      credentials.authMethod !== 'social' &&
      (!credentials.clientId || !credentials.clientSecret)
    ) {
      alert(isEn ? 'Incomplete credentials, cannot switch' : '账号凭证不完整，无法切换')
      return
    }

    const cliPayload = {
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      region: credentials.region || 'us-east-1',
      profileArn: account.profileArn,
      provider: credentials.provider
    }
    const idePayload = {
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      clientId: credentials.clientId || '',
      clientSecret: credentials.clientSecret || '',
      region: credentials.region || 'us-east-1',
      startUrl: credentials.startUrl,
      authMethod: credentials.authMethod,
      provider: credentials.provider,
      profileArn: account.profileArn,
      accountId: account.id
    }

    let success = true
    let errorMsg = ''

    // 根据 switchTarget 设置决定切换目标
    if (switchTarget === 'ide' || switchTarget === 'both') {
      const result = await window.api.switchAccount(idePayload)
      if (!result.success) {
        success = false
        errorMsg = result.error || ''
      } else if (result.refreshedCredentials) {
        // 同步 main 进程 refresh 后的最新 credentials 到 store，避免反代 store 留下已作废的 refreshToken
        const rc = result.refreshedCredentials
        useAccountsStore.setState((state) => {
          const accounts = new Map(state.accounts)
          const acc = accounts.get(account.id)
          if (acc) {
            accounts.set(account.id, {
              ...acc,
              credentials: {
                ...acc.credentials,
                accessToken: rc.accessToken,
                refreshToken: rc.refreshToken,
                expiresAt: Date.now() + rc.expiresIn * 1000
              }
            })
          }
          return { accounts }
        })
        useAccountsStore.getState().saveToStorage()
      }
    }
    if (switchTarget === 'cli' || switchTarget === 'both') {
      const result = await window.api.switchAccountCli(cliPayload)
      if (!result.success && switchTarget === 'cli') {
        success = false
        errorMsg = result.error || ''
      }
    }

    if (success) {
      setActiveAccount(account.id)
    } else {
      alert(isEn ? `Switch failed: ${errorMsg}` : `切换失败: ${errorMsg}`)
    }
  }

  const handleRefresh = async (): Promise<void> => {
    // 获取最新的使用量数据
    await checkAccountStatus(account.id)
  }

  const handleLogout = async (): Promise<void> => {
    if (
      !confirm(
        isEn
          ? 'This will clear local SSO cache and logout from Kiro. Continue?'
          : '这将清除本地 SSO 缓存并退出 Kiro 登录，是否继续？'
      )
    ) {
      return
    }

    const result = await window.api.logoutAccount()
    if (result.success) {
      // 取消当前账号的激活状态
      setActiveAccount(null)
      alert(
        isEn
          ? `Logged out successfully, cleared ${result.deletedCount} cache files`
          : `退出成功，已清除 ${result.deletedCount} 个缓存文件`
      )
    } else {
      alert(isEn ? `Logout failed: ${result.error}` : `退出失败: ${result.error}`)
    }
  }

  const [isRefreshingToken, setIsRefreshingToken] = useState(false)
  const handleRefreshToken = async (): Promise<void> => {
    setIsRefreshingToken(true)
    try {
      await refreshAccountToken(account.id)
    } finally {
      setIsRefreshingToken(false)
    }
  }

  const handleDelete = (): void => {
    if (
      confirm(
        isEn
          ? `Delete account ${getDisplayName(account)}?`
          : `确定要删除账号 ${getDisplayName(account)} 吗？`
      )
    ) {
      removeAccount(account.id)
    }
  }

  const [copied, setCopied] = useState(false)
  const [emailCopied, setEmailCopied] = useState(false)

  const handleCopyCredentials = (): void => {
    const credentials = {
      accessToken: account.credentials.accessToken,
      refreshToken: account.credentials.refreshToken,
      clientId: account.credentials.clientId,
      clientSecret: account.credentials.clientSecret
    }
    navigator.clipboard.writeText(JSON.stringify(credentials, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const accountTags = account.tags
    .map((id) => tags.get(id))
    .filter((t): t is AccountTag => t !== undefined)

  // 获取分组信息
  const accountGroup = account.groupId ? groups.get(account.groupId) : undefined

  const isExpiringSoon =
    account.subscription.daysRemaining !== undefined && account.subscription.daysRemaining <= 7

  // percentUsed 是 0~1 的小数（如 0.85 = 85%），超 1 表示 >100%
  const isHighUsage = account.usage.percentUsed > 0.8
  const isCritical = account.usage.percentUsed > 1

  // 检测账号是否被封禁/暂停（多种错误格式）
  const lowerError = account.lastError?.toLowerCase()
  const isUnauthorized =
    !!lowerError &&
    (lowerError.includes('accountsuspendedexception') ||
      lowerError.includes('account suspended') ||
      lowerError.includes('temporarily_suspended') ||
      lowerError.includes('temporarily suspended') ||
      (lowerError.includes('user id is') && lowerError.includes('suspended')) ||
      lowerError.includes('账户已封禁') ||
      lowerError.includes('已封禁') ||
      /\b423\b/.test(lowerError))

  // 封禁详情弹窗状态
  const [showBanDialog, setShowBanDialog] = useState(false)

  // 订阅管理弹窗状态
  const [showSubscriptionDialog, setShowSubscriptionDialog] = useState(false)
  const [subscriptionLoading, setSubscriptionLoading] = useState(false)
  const [subscriptionPlans, setSubscriptionPlans] = useState<
    Array<{
      name: string
      qSubscriptionType: string
      description: {
        title: string
        billingInterval: string
        featureHeader: string
        features: string[]
      }
      pricing: { amount: number; currency: string }
    }>
  >([])
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null)
  const [paymentLoading, setPaymentLoading] = useState(false)

  // 是否为首次用户（需要选择订阅类型）
  const [isFirstTimeUser, setIsFirstTimeUser] = useState(false)
  // 订阅错误信息
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null)
  // 订阅成功提示
  const [subscriptionSuccess, setSubscriptionSuccess] = useState<string | null>(null)

  // 点击订阅标签打开订阅管理
  const handleSubscriptionClick = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    if (subscriptionLoading || !account.credentials?.accessToken) return

    setSubscriptionLoading(true)
    try {
      // 统一先获取可用订阅列表
      const result = await window.api.accountGetSubscriptions(
        account.credentials.accessToken,
        account.credentials?.region,
        account.profileArn,
        account.machineId,
        account.credentials?.provider || account.idp,
        account.credentials?.authMethod,
        account.id
      )
      if (result.success && result.plans.length > 0) {
        setSubscriptionPlans(result.plans)
        // 检查是否是首次用户（当前订阅类型为 FREE 或无订阅）
        const currentType = account.subscription.type?.toUpperCase() || ''
        const isFirstTime = currentType === '' || currentType.includes('FREE')
        setIsFirstTimeUser(isFirstTime)
        setShowSubscriptionDialog(true)
      } else {
        console.error('[AccountCard] Failed to get subscriptions:', result.error)
      }
    } catch (error) {
      console.error('[AccountCard] Subscription click error:', error)
    } finally {
      setSubscriptionLoading(false)
    }
  }

  // 选择订阅计划并获取支付链接
  const handleSelectPlan = async (planName: string): Promise<void> => {
    if (paymentLoading || !account.credentials?.accessToken) return

    setSelectedPlan(planName)
    setPaymentLoading(true)
    setSubscriptionError(null)
    try {
      const result = await window.api.accountGetSubscriptionUrl(
        account.credentials.accessToken,
        planName,
        account.credentials?.region,
        account.profileArn,
        account.machineId,
        account.credentials?.provider || account.idp,
        account.credentials?.authMethod,
        account.id
      )
      if (result.success && result.url) {
        // 自动复制链接到剪贴板
        await navigator.clipboard.writeText(result.url)
        // 显示复制成功提示
        setSubscriptionSuccess(isEn ? 'Link copied to clipboard!' : '链接已复制到剪贴板！')
        // 短暂显示后关闭弹窗并打开链接
        const urlToOpen = result.url
        setTimeout(async () => {
          setShowSubscriptionDialog(false)
          setSubscriptionSuccess(null)
          await window.api.openSubscriptionWindow(urlToOpen)
        }, 800)
      } else {
        const errorMsg = result.error || (isEn ? 'Failed to get payment URL' : '获取支付链接失败')
        setSubscriptionError(errorMsg)
        console.error('[AccountCard] Failed to get payment URL:', result.error)
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : isEn ? 'Unknown error' : '未知错误'
      setSubscriptionError(errorMsg)
      console.error('[AccountCard] Payment URL error:', error)
    } finally {
      setPaymentLoading(false)
      setSelectedPlan(null)
    }
  }

  // 获取订阅管理链接（已有订阅用户）
  const handleManageSubscription = async (): Promise<void> => {
    if (paymentLoading || !account.credentials?.accessToken) return

    setPaymentLoading(true)
    setSubscriptionError(null)
    try {
      const result = await window.api.accountGetSubscriptionUrl(
        account.credentials.accessToken,
        undefined,
        account.credentials?.region,
        account.profileArn,
        account.machineId,
        account.credentials?.provider || account.idp,
        account.credentials?.authMethod,
        account.id
      )
      if (result.success && result.url) {
        setShowSubscriptionDialog(false)
        await window.api.openSubscriptionWindow(result.url)
      } else {
        // 显示错误信息
        const errorMsg =
          result.error || (isEn ? 'Failed to get management URL' : '获取管理链接失败')
        setSubscriptionError(errorMsg)
        console.error('[AccountCard] Failed to get management URL:', result.error)
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : isEn ? 'Unknown error' : '未知错误'
      setSubscriptionError(errorMsg)
      console.error('[AccountCard] Management URL error:', error)
    } finally {
      setPaymentLoading(false)
    }
  }

  return (
    <Card
      className={cn(
        'relative cursor-pointer h-full flex flex-col overflow-hidden bg-solid-card',
        'rounded-panel border bg-card hover:bg-muted/20',
        account.isActive && 'border-border-strong',
        isSelected && 'ring-2 ring-inset ring-ring bg-muted/30',
        isUnauthorized && 'border-destructive/50'
      )}
      data-account-id={account.id}
      onClick={() => toggleSelection(account.id)}
    >
      <CardContent className="p-4 min-h-0 flex-1 flex flex-col gap-3 overflow-hidden">
        {/* Header: Checkbox, Email/Nickname, Group */}
        <div className="flex gap-3 items-start">
          {/* Checkbox */}
          <div
            className={cn(
              'w-4 h-4 rounded-[4px] border-[1.5px] flex items-center justify-center transition-colors flex-shrink-0 mt-0.5 cursor-pointer',
              isSelected
                ? 'bg-primary border-primary text-primary-foreground'
                : 'border-muted-foreground/30 hover:border-primary'
            )}
            onClick={(e) => {
              e.stopPropagation()
              onSelect()
            }}
          >
            {isSelected && <Check className="h-3.5 w-3.5" />}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h3
                className={cn(
                  'font-medium text-strong truncate cursor-pointer transition-colors',
                  emailCopied ? 'text-success' : 'text-foreground/90 hover:text-primary'
                )}
                title={`${account.email ? maskEmail(account.email) : maskNickname(getDisplayName(account))} (${isEn ? 'Click to copy' : '点击复制'})`}
                onClick={(e) => {
                  e.stopPropagation()
                  const text = account.email || account.userId || ''
                  if (text) {
                    navigator.clipboard.writeText(text)
                    setEmailCopied(true)
                    setTimeout(() => setEmailCopied(false), 1500)
                  }
                }}
              >
                {emailCopied
                  ? isEn
                    ? 'Copied!'
                    : '已复制!'
                  : account.email
                    ? maskEmail(account.email)
                    : maskNickname(getDisplayName(account))}
              </h3>
              {/* Status Badge */}
              <div
                className={cn(
                  'text-badge font-medium h-5 px-[7px] rounded-full flex items-center gap-1 flex-shrink-0',
                  isUnauthorized
                    ? 'text-destructive bg-destructive/10'
                    : account.status === 'active'
                      ? 'text-success bg-success/10'
                      : account.status === 'error'
                        ? 'text-destructive bg-destructive/10'
                        : account.status === 'expired'
                          ? 'text-warning bg-warning/10'
                          : account.status === 'refreshing'
                            ? 'text-primary bg-primary/10'
                            : 'text-muted-foreground bg-muted'
                )}
              >
                {account.status === 'refreshing' && <Loader2 className="h-3 w-3 animate-spin" />}
                {isUnauthorized && <AlertCircle className="h-3 w-3" />}
                {isUnauthorized ? (
                  <span
                    className="cursor-pointer hover:underline"
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowBanDialog(true)
                    }}
                  >
                    {isEn ? 'Banned' : '已封禁'}
                  </span>
                ) : (
                  (isEn ? StatusLabelsEn : StatusLabelsZh)[account.status]
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-1">
              {account.nickname && (
                <span className="text-caption text-muted-foreground truncate">
                  {maskNickname(account.nickname)}
                </span>
              )}
              {accountGroup && (
                <span
                  className="text-badge h-5 px-[7px] rounded-full bg-muted text-muted-foreground flex items-center gap-1"
                  style={{ color: accountGroup.color, backgroundColor: accountGroup.color + '15' }}
                >
                  <FolderOpen className="w-3 h-3" /> {accountGroup.name}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Badges Row */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            className={cn(
              'text-white text-badge h-5 px-[7px] border-0 cursor-pointer transition-all hover:opacity-80 ',
              getSubscriptionColor(account.subscription.type, account.subscription.title),
              subscriptionLoading && 'opacity-60 cursor-wait'
            )}
            onClick={handleSubscriptionClick}
            title={isEn ? 'Click to manage subscription' : '点击管理订阅'}
          >
            {subscriptionLoading
              ? isEn
                ? 'Loading...'
                : '加载中...'
              : account.subscription.title || account.subscription.type}
          </Badge>
          <Badge
            variant="outline"
            className="text-badge h-5 px-[7px] text-muted-foreground font-medium border-muted-foreground/30 bg-muted/30"
          >
            {account.idp}
          </Badge>
          {/* 代理绑定徽章：可点击解绑 */}
          {boundProxy && (
            <Badge
              variant="outline"
              className={cn(
                'text-badge h-5 px-[7px] font-medium cursor-pointer transition-colors group',
                boundProxy.enabled && boundProxy.status !== 'dead'
                  ? 'border-cyan-500/40 text-cyan-700 dark:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20'
                  : 'border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10'
              )}
              title={`${isEn ? 'Bound proxy:' : '绑定代理：'} ${boundProxy.host}:${boundProxy.port}${boundProxy.label ? ` (${boundProxy.label})` : ''}\n${isEn ? 'Click to unbind' : '点击解绑'}`}
              onClick={(e) => {
                e.stopPropagation()
                if (
                  confirm(
                    isEn
                      ? `Unbind ${account.email} from ${boundProxy.host}:${boundProxy.port}?`
                      : `解绑 ${account.email} 与 ${boundProxy.host}:${boundProxy.port}？`
                  )
                ) {
                  unbindAccountFromProxy(account.id)
                }
              }}
            >
              <span className="opacity-70 group-hover:hidden">⇄</span>
              <span className="hidden group-hover:inline">✕</span>
              <span className="ml-0.5">
                {boundProxy.host.length > 15 ? boundProxy.host.slice(0, 12) + '…' : boundProxy.host}
              </span>
            </Badge>
          )}
          {account.isActive && (
            <Badge
              variant="default"
              className="ml-auto h-5 bg-success text-white border-0 hover:bg-success/90"
            >
              {isEn ? 'Active' : '当前使用'}
            </Badge>
          )}
        </div>

        {/* Usage Section */}
        <div className="space-y-2">
          <div className="flex justify-between items-end text-caption">
            <span className="text-muted-foreground font-medium">{isEn ? 'Usage' : '使用量'}</span>
            <span
              className={cn(
                'font-mono font-medium tabular-nums',
                isCritical ? 'text-destructive' : isHighUsage ? 'text-warning' : 'text-foreground'
              )}
            >
              {(account.usage.percentUsed * 100).toFixed(usagePrecision ? 2 : 0)}%
              {isCritical && (
                <span className="ml-1.5 text-caption text-red-600 font-semibold">
                  (+{((account.usage.percentUsed - 1) * 100).toFixed(usagePrecision ? 2 : 0)}%{' '}
                  {isEn ? 'over' : '超'})
                </span>
              )}
            </span>
          </div>
          {/* 自定义双层进度条：超额时分段显示套餐内（amber）+ 超额（red） */}
          {(() => {
            const percent = account.usage.percentUsed
            if (isCritical) {
              // 套餐部分占总进度的比例 = 1 / percent
              const planRatioPct = (1 / percent) * 100
              return (
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                  <div
                    className="absolute inset-y-0 left-0 bg-warning transition-all duration-300"
                    style={{ width: `${planRatioPct}%` }}
                  />
                  <div
                    className="absolute inset-y-0 right-0 bg-red-500 transition-all duration-300"
                    style={{ left: `${planRatioPct}%` }}
                  />
                </div>
              )
            }
            return (
              <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                <div
                  className={cn(
                    'absolute inset-y-0 left-0 transition-all duration-300',
                    isHighUsage ? 'bg-warning' : 'bg-primary'
                  )}
                  style={{ width: `${Math.min(percent * 100, 100)}%` }}
                />
              </div>
            )
          })()}
          <div className="flex justify-between text-caption text-muted-foreground pt-0.5">
            <span className="flex items-center gap-1.5">
              <span>
                {formatUsage(account.usage.current)} / {formatUsage(account.usage.limit)}
              </span>
              {isCritical && (
                <span className="text-red-600 font-semibold">
                  (+{formatUsage(account.usage.current - account.usage.limit)})
                </span>
              )}
            </span>
            {account.usage.nextResetDate && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {(() => {
                  const d = account.usage.nextResetDate as unknown
                  try {
                    return (typeof d === 'string' ? d : new Date(d as Date).toISOString()).split(
                      'T'
                    )[0]
                  } catch {
                    return 'Unknown'
                  }
                })()}{' '}
                {isEn ? 'reset' : '重置'}
              </span>
            )}
          </div>
        </div>

        {/* Detailed Quotas - Compact list */}
        <div className="space-y-1 min-h-0 flex-1 overflow-y-auto pr-1 text-caption max-h-24">
          {/* 基础额度 */}
          {account.usage.baseLimit !== undefined && account.usage.baseLimit > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
              <span className="text-muted-foreground">{isEn ? 'Base:' : '基础:'}</span>
              <span className="font-medium">
                {formatUsage(account.usage.baseCurrent ?? 0)}/{formatUsage(account.usage.baseLimit)}
              </span>
              {account.usage.nextResetDate && (
                <span className="text-muted-foreground/70 ml-auto">
                  {isEn ? 'to' : '至'}{' '}
                  {(() => {
                    const d = account.usage.nextResetDate as unknown
                    try {
                      return (typeof d === 'string' ? d : new Date(d as Date).toISOString()).split(
                        'T'
                      )[0]
                    } catch {
                      return ''
                    }
                  })()}
                </span>
              )}
            </div>
          )}
          {/* 试用额度 */}
          {account.usage.freeTrialLimit !== undefined && account.usage.freeTrialLimit > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-warning flex-shrink-0" />
              <span className="text-muted-foreground">{isEn ? 'Trial:' : '试用:'}</span>
              <span className="font-medium">
                {formatUsage(account.usage.freeTrialCurrent ?? 0)}/
                {formatUsage(account.usage.freeTrialLimit)}
              </span>
              {account.usage.freeTrialExpiry && (
                <span className="text-muted-foreground/70 ml-auto">
                  {isEn ? 'to' : '至'}{' '}
                  {(() => {
                    const d = account.usage.freeTrialExpiry as unknown
                    try {
                      return (typeof d === 'string' ? d : new Date(d as Date).toISOString()).split(
                        'T'
                      )[0]
                    } catch {
                      return ''
                    }
                  })()}
                </span>
              )}
            </div>
          )}
          {/* 奖励额度 */}
          {account.usage.bonuses?.map((bonus) => (
            <div key={bonus.code} className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0" />
              <span className="text-muted-foreground truncate max-w-[80px]" title={bonus.name}>
                {bonus.name}:
              </span>
              <span className="font-medium">
                {formatUsage(bonus.current)}/{formatUsage(bonus.limit)}
              </span>
              {bonus.expiresAt && (
                <span className="text-muted-foreground/70 ml-auto">
                  {isEn ? 'to' : '至'}{' '}
                  {(() => {
                    const d = bonus.expiresAt as unknown
                    try {
                      return (typeof d === 'string' ? d : new Date(d as Date).toISOString()).split(
                        'T'
                      )[0]
                    } catch {
                      return ''
                    }
                  })()}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Tags - placed before footer */}
        {accountTags.length > 0 && (
          <div className="flex gap-1 overflow-x-auto shrink-0">
            {accountTags.slice(0, 4).map((tag) => (
              <span
                key={tag.id}
                className="h-5 shrink-0 px-[7px] text-badge inline-flex items-center rounded-full text-white font-medium "
                style={{ backgroundColor: toRgba(tag.color) }}
              >
                {tag.name}
              </span>
            ))}
            {accountTags.length > 4 && (
              <span className="h-5 px-[7px] text-badge inline-flex items-center text-muted-foreground bg-muted rounded-full">
                +{accountTags.length - 4}
              </span>
            )}
          </div>
        )}

        {/* Footer Actions */}
        <div className="pt-3 border-t flex flex-col items-stretch mt-auto gap-2 shrink-0">
          {/* Left: Token expiry info */}
          <div className="text-caption text-muted-foreground flex flex-wrap justify-between gap-2">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span className={isExpiringSoon ? 'text-warning font-medium' : ''}>
                {account.subscription.daysRemaining !== undefined
                  ? isEn
                    ? `${account.subscription.daysRemaining}d left`
                    : `剩 ${account.subscription.daysRemaining} 天`
                  : '-'}
              </span>
            </div>
            <div
              className="flex items-center gap-1"
              title={
                account.credentials.expiresAt
                  ? new Date(account.credentials.expiresAt).toLocaleString(isEn ? 'en-US' : 'zh-CN')
                  : isEn
                    ? 'Unknown'
                    : '未知'
              }
            >
              <KeyRound className="h-3 w-3" />
              <span
                className={
                  account.credentials.expiresAt &&
                  account.credentials.expiresAt - Date.now() < 5 * 60 * 1000
                    ? 'text-red-500 font-medium'
                    : ''
                }
              >
                Token:{' '}
                {account.credentials.expiresAt
                  ? formatTokenExpiry(account.credentials.expiresAt, isEn)
                  : '-'}
              </span>
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center justify-end gap-2 [&_svg]:size-4 [&_svg]:stroke-[1.5]">
            {account.isActive ? (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 hover:bg-destructive/10 hover:text-destructive transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  handleLogout()
                }}
                title={isEn ? 'Logout (clear SSO cache)' : '退出登录（清除 SSO 缓存）'}
              >
                <LogOut className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 hover:bg-primary/10 hover:text-primary transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  handleSwitch()
                }}
                title={isEn ? 'Switch to this account' : '切换到此账号'}
              >
                <Power className="h-3.5 w-3.5" />
              </Button>
            )}

            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation()
                handleRefresh()
              }}
              disabled={account.status === 'refreshing'}
              title={isEn ? 'Check account info' : '检查账户信息（用量、订阅、封禁状态）'}
            >
              <RefreshCw
                className={cn('h-3.5 w-3.5', account.status === 'refreshing' && 'animate-spin')}
              />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation()
                handleRefreshToken()
              }}
              disabled={isRefreshingToken}
              title={isEn ? 'Refresh Token' : '刷新 Token（仅刷新访问令牌）'}
            >
              <KeyRound className={cn('h-3.5 w-3.5', isRefreshingToken && 'animate-pulse')} />
            </Button>

            <Button
              size="icon"
              variant="ghost"
              className={cn(
                'h-7 w-7 text-muted-foreground hover:text-foreground',
                copied && 'text-success'
              )}
              onClick={(e) => {
                e.stopPropagation()
                handleCopyCredentials()
              }}
              title={isEn ? 'Copy credentials' : '复制凭证'}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>

            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation()
                onShowDetail()
              }}
              title={isEn ? 'Details' : '详情'}
            >
              <Info className="h-3.5 w-3.5" />
            </Button>

            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation()
                onEdit()
              }}
              title={isEn ? 'Edit' : '编辑'}
            >
              <Edit className="h-3.5 w-3.5" />
            </Button>

            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-destructive transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                handleDelete()
              }}
              title={isEn ? 'Delete' : '删除'}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Error Message (Non-banned) */}
        {account.lastError && !isUnauthorized && (
          <div
            className="bg-destructive/10 text-destructive text-caption p-2 rounded-control flex items-center gap-1.5 truncate mt-1"
            title={account.lastError}
          >
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="truncate">{account.lastError}</span>
          </div>
        )}
      </CardContent>

      {/* 封禁详情弹窗 */}
      {showBanDialog &&
        isUnauthorized &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-[var(--overlay)]"
              onClick={() => setShowBanDialog(false)}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={isEn ? 'Account Suspended' : '账户已封禁'}
              className="ui-dialog-panel"
            >
              <div className="ui-dialog-header flex-row items-center justify-between">
                <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                  <AlertCircle className="h-5 w-5" />
                  <span className="text-title font-semibold">
                    {isEn ? 'Account Suspended' : '账户已封禁'}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-control hover:bg-muted transition-colors"
                  onClick={() => setShowBanDialog(false)}
                  title={isEn ? 'Close' : '关闭'}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="ui-dialog-body pb-5 space-y-4">
                <div className="space-y-2">
                  <label className="text-caption font-medium text-muted-foreground">
                    {isEn ? 'Account' : '账户'}
                  </label>
                  <div className="text-body font-medium">
                    {maskNickname(getDisplayName(account))}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-caption font-medium text-muted-foreground">
                    {isEn ? 'Error Details' : '错误详情'}
                  </label>
                  <div className="text-caption font-mono bg-muted/50 p-3 rounded-panel border break-all whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                    {account.lastError}
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2 gap-2 flex-wrap">
                  <a
                    href="https://support.aws.amazon.com/#/contacts/kiro"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-caption text-primary hover:underline flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-3 w-3" />
                    {isEn ? 'Contact Support' : '联系支持'}
                  </a>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleClearSuspended}
                      disabled={isClearingSuspended}
                      title={
                        isEn
                          ? 'Mark as recovered — proxy pool will use this account again'
                          : '标记为已恢复 — 反代池会重新使用该账号'
                      }
                    >
                      {isClearingSuspended ? (
                        <RefreshCw className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3 " />
                      )}
                      {isEn ? 'Reset Suspended' : '重置封禁状态'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowBanDialog(false)}>
                      {isEn ? 'Close' : '关闭'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* 订阅管理弹窗 */}
      {showSubscriptionDialog &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-[var(--overlay)]"
              onClick={() => {
                setShowSubscriptionDialog(false)
                setIsFirstTimeUser(false)
                setSubscriptionError(null)
                setSubscriptionSuccess(null)
              }}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={isEn ? 'Subscription Plans' : '订阅计划'}
              className="ui-dialog-panel max-w-2xl"
            >
              <div className="ui-dialog-header flex-row items-center justify-between">
                <div className="flex items-center gap-2 text-primary">
                  <CreditCard className="h-5 w-5" />
                  <span className="text-title font-semibold">
                    {isEn
                      ? isFirstTimeUser
                        ? 'Choose Your Plan'
                        : 'Subscription Plans'
                      : isFirstTimeUser
                        ? '选择订阅计划'
                        : '订阅计划'}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-control hover:bg-muted transition-colors"
                  onClick={() => {
                    setShowSubscriptionDialog(false)
                    setIsFirstTimeUser(false)
                    setSubscriptionError(null)
                    setSubscriptionSuccess(null)
                  }}
                  title={isEn ? 'Close' : '关闭'}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="ui-dialog-body pb-5 space-y-4">
                {isFirstTimeUser ? (
                  <div className="text-caption text-muted-foreground mb-2 bg-warning/10 text-warning p-2 rounded-panel">
                    {isEn
                      ? 'Please select a subscription plan to continue.'
                      : '请选择一个订阅计划以继续使用。'}
                  </div>
                ) : (
                  <div className="text-caption text-muted-foreground mb-2">
                    {isEn ? 'Current subscription: ' : '当前订阅: '}
                    <span className="font-medium text-foreground">
                      {account.subscription.title || account.subscription.type}
                    </span>
                  </div>
                )}

                {subscriptionError && (
                  <div className="text-caption bg-red-500/10 text-red-600 dark:text-red-400 p-2 rounded-panel flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{subscriptionError}</span>
                  </div>
                )}

                {subscriptionSuccess && (
                  <div className="text-caption bg-success/10 text-success p-2 rounded-panel flex items-center gap-2">
                    <Check className="h-4 w-4 shrink-0" />
                    <span>{subscriptionSuccess}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {subscriptionPlans.map((plan) => {
                    const isCurrent =
                      plan.name === account.subscription.type ||
                      plan.description.title === account.subscription.title
                    const isLoading = paymentLoading && selectedPlan === plan.qSubscriptionType
                    return (
                      <div
                        key={plan.name}
                        className={cn(
                          'relative p-4 rounded-panel border-2 transition-all cursor-pointer ',
                          isCurrent
                            ? 'border-border-strong bg-muted/30'
                            : 'border-border hover:border-primary/50',
                          isLoading && 'opacity-70 cursor-wait'
                        )}
                        onClick={() => !isCurrent && handleSelectPlan(plan.qSubscriptionType)}
                      >
                        {isCurrent && (
                          <div className="absolute -top-2 -right-2 bg-muted text-foreground h-5 px-[7px] text-badge inline-flex items-center rounded-full font-medium">
                            {isEn ? 'Current' : '当前'}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles
                            className={cn(
                              'h-4 w-4',
                              plan.pricing.amount === 0 ? 'text-green-500' : 'text-amber-500'
                            )}
                          />
                          <span className="font-semibold text-body">{plan.description.title}</span>
                        </div>
                        <div className="text-metric font-semibold mb-2">
                          {plan.pricing.amount === 0
                            ? isEn
                              ? 'Free'
                              : '免费'
                            : `$${plan.pricing.amount}`}
                          {plan.pricing.amount > 0 && (
                            <span className="text-caption font-normal text-muted-foreground">
                              /{plan.description.billingInterval}
                            </span>
                          )}
                        </div>
                        <ul className="space-y-1.5">
                          {plan.description.features.slice(0, 4).map((feature, idx) => (
                            <li
                              key={idx}
                              className="text-caption text-muted-foreground flex items-start gap-1.5"
                            >
                              <Check className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                              <span>{feature}</span>
                            </li>
                          ))}
                        </ul>
                        {!isCurrent && (
                          <Button
                            size="sm"
                            className="w-full mt-3"
                            variant={plan.pricing.amount === 0 ? 'outline' : 'default'}
                            disabled={isLoading}
                          >
                            {isLoading ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                {isEn ? 'Loading...' : '加载中...'}
                              </>
                            ) : isEn ? (
                              'Select'
                            ) : (
                              '选择'
                            )}
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="flex items-center justify-between pt-3 border-t">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleManageSubscription}
                    disabled={paymentLoading}
                    className="text-body"
                  >
                    {paymentLoading && !selectedPlan ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {isEn ? 'Loading...' : '加载中...'}
                      </>
                    ) : (
                      <>
                        <ExternalLink className="h-3 w-3 " />
                        {isEn ? 'Manage Billing' : '管理账单'}
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowSubscriptionDialog(false)
                      setIsFirstTimeUser(false)
                      setSubscriptionError(null)
                      setSubscriptionSuccess(null)
                    }}
                  >
                    {isEn ? 'Close' : '关闭'}
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </Card>
  )
})

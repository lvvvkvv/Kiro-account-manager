import { useShallow } from 'zustand/react/shallow'
import { TokenRefreshSchedule } from './TokenRefreshSchedule'
import { memo, useState, useId } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../ui'
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
  ArrowRightLeft,
  AlertCircle,
  KeyRound,
  X,
  ExternalLink,
  CreditCard,
  Sparkles,
  LogOut,
  RotateCcw,
  UserRound,
  CheckCircle2,
  CircleHelp,
  Ban,
  Network,
  ChevronDown
} from 'lucide-react'
import { cn } from '@/lib/utils'

import {
  toRgba,
  getDisplayName,
  formatTokenExpiry,
  formatDateSafe,
  isBannedError,
  StatusLabelsZh,
  StatusLabelsEn
} from './_helpers'
import { AccountListMoreMenu, type AccountListAction } from './AccountListMoreMenu'
import './AccountGrid.css'

interface AccountCardProps {
  account: Account
  tags: Map<string, AccountTag>
  groups: Map<string, AccountGroup>
  isSelected: boolean
  onSelect: (id: string) => void
  onEdit: (account: Account) => void
  onShowDetail: (account: Account) => void
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
    maskEmail,
    maskNickname,
    usagePrecision,
    updateAccountStatus,
    boundProxy,
    unbindAccountFromProxy
  } = useAccountsStore(
    useShallow((state) => ({
      setActiveAccount: state.setActiveAccount,
      removeAccount: state.removeAccount,
      checkAccountStatus: state.checkAccountStatus,
      refreshAccountToken: state.refreshAccountToken,
      maskEmail: state.maskEmail,
      maskNickname: state.maskNickname,
      usagePrecision: state.usagePrecision,
      updateAccountStatus: state.updateAccountStatus,
      // 脱敏函数引用稳定，仍需订阅隐私设置以更新显示。
      privacyMode: state.privacyMode,
      boundProxy: state.proxyPool.get(state.accountProxyBindings[account.id]) ?? null,
      unbindAccountFromProxy: state.unbindAccountFromProxy
    }))
  )

  // 解除封禁标记中（loading 状态）
  const [isClearingSuspended, setIsClearingSuspended] = useState(false)

  // 手动解除封禁标记：调用后端 IPC → 清反代池 suspended + 清前端 lastError
  const handleClearSuspended = async (e: React.MouseEvent): Promise<void> => {
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

  const performSwitch = async (): Promise<void> => {
    const result = await useAccountsStore.getState().switchAccount(account.id)
    if (!result.success) alert(isEn ? `Switch failed: ${result.error}` : `切换失败：${result.error}`)
  }

  const [isSwitching, setIsSwitching] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showAllTags, setShowAllTags] = useState(false)
  const [showQuotas, setShowQuotas] = useState(false)
  const quotasId = useId()

  const handleSwitch = async (): Promise<void> => {
    if (isSwitching) return
    setIsSwitching(true)
    try {
      await performSwitch()
    } catch (error) {
      alert(isEn ? `Switch failed: ${String(error)}` : `切换失败：${String(error)}`)
    } finally {
      setIsSwitching(false)
    }
  }

  const handleRefresh = async (): Promise<void> => {
    if (isRefreshing || account.status === 'refreshing') return
    setIsRefreshing(true)
    try {
      await checkAccountStatus(account.id)
    } finally {
      setIsRefreshing(false)
    }
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
    if (isRefreshingToken) return
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

  const handleCopyCredentials = async (): Promise<void> => {
    const credentials = {
      accessToken: account.credentials.accessToken,
      refreshToken: account.credentials.refreshToken,
      clientId: account.credentials.clientId,
      clientSecret: account.credentials.clientSecret
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(credentials, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('[AccountCard] Copy credentials failed:', error)
    }
  }

  const accountTags = account.tags
    .map((id) => tags.get(id))
    .filter((t): t is AccountTag => t !== undefined)

  // 获取分组信息
  const accountGroup = account.groupId ? groups.get(account.groupId) : undefined

  const isUnauthorized = isBannedError(account.lastError)

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

  // 未验证的数据不显示为 0% 或“正常”；用量、订阅及 Token 各自独立呈现。
  const displayName = account.nickname
    ? maskNickname(account.nickname)
    : maskEmail(account.email || account.userId || '')
  const maskedEmail = maskEmail(account.email)
  const isBusy = isRefreshing || account.status === 'refreshing'
  const effectiveStatus = isBusy ? 'refreshing' : account.status
  const statusTone =
    isUnauthorized || effectiveStatus === 'error'
      ? 'danger'
      : effectiveStatus === 'expired'
        ? 'warning'
        : effectiveStatus === 'refreshing'
          ? 'info'
          : effectiveStatus === 'active'
            ? 'success'
            : 'neutral'
  const statusLabel = isUnauthorized
    ? isEn
      ? 'Suspended'
      : '已封禁'
    : (isEn ? StatusLabelsEn : StatusLabelsZh)[effectiveStatus] || (isEn ? 'Unknown' : '未知')
  const StatusIcon = isUnauthorized
    ? Ban
    : isBusy
      ? Loader2
      : effectiveStatus === 'active'
        ? CheckCircle2
        : effectiveStatus === 'expired'
          ? Clock
          : effectiveStatus === 'error'
            ? AlertCircle
            : CircleHelp
  const usageKnown =
    Number.isFinite(account.usage.current) &&
    account.usage.current >= 0 &&
    Number.isFinite(account.usage.limit) &&
    account.usage.limit >= 0 &&
    !(['unknown', 'refreshing'].includes(account.status) && !account.lastCheckedAt)
  const used = usageKnown ? account.usage.current : 0
  const limit = usageKnown ? account.usage.limit : 0
  const percentage = limit > 0 ? (used / limit) * 100 : 0
  const exceeded = usageKnown && used > limit
  const exhausted = usageKnown && (limit === 0 || used >= limit)
  const usageTone = exceeded ? 'danger' : exhausted || percentage >= 80 ? 'warning' : 'default'
  const usageHint = !usageKnown
    ? isBusy
      ? isEn
        ? 'Syncing usage…'
        : '正在获取用量…'
      : isEn
        ? 'Check to sync usage'
        : '检查账号后同步用量'
    : exceeded
      ? isEn
        ? `${formatUsage(used - limit)} credits over limit`
        : `已超额 ${formatUsage(used - limit)} Credits`
      : limit === 0
        ? isEn
          ? 'No quota available'
          : '暂无可用额度'
        : exhausted
          ? isEn
            ? 'Quota exhausted'
            : '本期额度已用尽'
          : isEn
            ? `${formatUsage(limit - used)} credits available`
            : `剩余 ${formatUsage(limit - used)} Credits`
  const subscriptionDays = Number.isFinite(account.subscription.daysRemaining)
    ? account.subscription.daysRemaining
    : account.subscription.expiresAt && Number.isFinite(account.subscription.expiresAt)
      ? Math.ceil((account.subscription.expiresAt - Date.now()) / 86400000)
      : undefined
  const subscriptionTone =
    subscriptionDays !== undefined && subscriptionDays <= 0
      ? 'danger'
      : subscriptionDays !== undefined && subscriptionDays <= 7
        ? 'warning'
        : 'default'
  const subscriptionText =
    subscriptionDays === undefined
      ? isEn
        ? 'Not synced'
        : '未获取'
      : subscriptionDays <= 0
        ? isEn
          ? 'Expired'
          : '已到期'
        : isEn
          ? `${subscriptionDays}d left`
          : `剩余 ${subscriptionDays} 天`
  const tokenKnown =
    Number.isFinite(account.credentials.expiresAt) && account.credentials.expiresAt > 0
  const tokenTone =
    tokenKnown && account.credentials.expiresAt <= Date.now()
      ? 'danger'
      : tokenKnown && account.credentials.expiresAt - Date.now() < 300000
        ? 'warning'
        : 'default'
  const tokenText = tokenKnown
    ? formatTokenExpiry(account.credentials.expiresAt, isEn)
    : isEn
      ? 'Not synced'
      : '未获取'
  const hasCredentials = Boolean(
    account.credentials.refreshToken &&
    (account.credentials.authMethod === 'social' ||
      (account.credentials.clientId && account.credentials.clientSecret))
  )
  const proxyStateLabel = !boundProxy
    ? ''
    : !boundProxy.enabled
      ? isEn
        ? 'Disabled'
        : '已停用'
      : (isEn
          ? {
              untested: 'Untested',
              testing: 'Testing',
              alive: 'Available',
              slow: 'Slow',
              dead: 'Unavailable'
            }
          : { untested: '待检测', testing: '检测中', alive: '可用', slow: '较慢', dead: '不可用' })[
          boundProxy.status
        ]
  const proxyTone =
    boundProxy && (!boundProxy.enabled || ['dead', 'slow'].includes(boundProxy.status))
      ? 'warning'
      : boundProxy?.status === 'testing'
        ? 'info'
        : 'neutral'
  const resetDate = account.usage.nextResetDate ? formatDateSafe(account.usage.nextResetDate) : ''
  const quotas = [
    ...(account.usage.baseLimit !== undefined && account.usage.baseLimit > 0
      ? [
          {
            key: 'base',
            name: isEn ? 'Base' : '基础额度',
            current: account.usage.baseCurrent ?? 0,
            limit: account.usage.baseLimit,
            expiry: resetDate
          }
        ]
      : []),
    ...(account.usage.freeTrialLimit !== undefined && account.usage.freeTrialLimit > 0
      ? [
          {
            key: 'trial',
            name: isEn ? 'Trial' : '试用额度',
            current: account.usage.freeTrialCurrent ?? 0,
            limit: account.usage.freeTrialLimit,
            expiry: account.usage.freeTrialExpiry
              ? formatDateSafe(account.usage.freeTrialExpiry)
              : ''
          }
        ]
      : []),
    ...(account.usage.bonuses || []).map((bonus, index) => ({
      key: `bonus-${bonus.code}-${index}`,
      name: bonus.name,
      current: bonus.current,
      limit: bonus.limit,
      expiry: bonus.expiresAt ? formatDateSafe(bonus.expiresAt) : ''
    }))
  ]
  const actions: AccountListAction[] = [
    { label: isEn ? 'Details' : '详情', icon: <Info />, onClick: () => onShowDetail(account) },
    { label: isEn ? 'Edit' : '编辑', icon: <Edit />, onClick: () => onEdit(account) },
    {
      label: isRefreshingToken
        ? isEn
          ? 'Refreshing Token…'
          : '正在刷新 Token…'
        : isEn
          ? 'Refresh Token'
          : '刷新 Token',
      icon: <KeyRound />,
      onClick: () => {
        void handleRefreshToken()
      },
      disabled: isRefreshingToken
    },
    {
      label: copied
        ? isEn
          ? 'Credentials copied'
          : '凭证已复制'
        : isEn
          ? 'Copy credentials'
          : '复制凭证',
      icon: copied ? <Check /> : <Copy />,
      onClick: () => {
        void handleCopyCredentials()
      }
    },
    ...(isUnauthorized
      ? [
          {
            label: isEn ? 'Reset Suspended' : '重置封禁状态',
            icon: <RotateCcw />,
            onClick: handleClearSuspended,
            disabled: isClearingSuspended
          },
          {
            label: isEn ? 'Contact Support' : '联系支持',
            icon: <ExternalLink />,
            href: 'https://support.aws.amazon.com/#/contacts/kiro'
          }
        ]
      : []),
    ...(account.isActive
      ? [
          {
            label: isEn ? 'Logout (clear SSO cache)' : '退出登录（清除 SSO 缓存）',
            icon: <LogOut />,
            onClick: () => {
              void handleLogout()
            },
            destructive: true
          }
        ]
      : []),
    { label: isEn ? 'Delete' : '删除', icon: <Trash2 />, onClick: handleDelete, destructive: true }
  ]
  const primaryLabel = isUnauthorized
    ? isEn
      ? 'View reason'
      : '查看原因'
    : !hasCredentials
      ? isEn
        ? 'Set up'
        : '补全凭证'
      : isBusy
        ? isEn
          ? 'Syncing'
          : '刷新中'
        : account.isActive
          ? isEn
            ? 'In use'
            : '使用中'
          : isSwitching
            ? isEn
              ? 'Switching'
              : '切换中…'
            : isEn
              ? 'Switch account'
              : '切换账号'

  return (
    <article
      className={cn('account-card', isSelected && 'is-selected', account.isActive && 'is-current')}
      role="listitem"
      data-account-id={account.id}
      data-state={isUnauthorized ? 'banned' : effectiveStatus}
      lang={isEn ? 'en' : 'zh-CN'}
      onClick={(event) => {
        if (event.currentTarget.contains(event.target as Node)) onSelect(account.id)
      }}
    >
      <header className="account-card-header">
        <div className="account-card-avatar" aria-hidden="true">
          <UserRound />
          {account.isActive && <i />}
        </div>
        <div className="account-card-identity">
          <div className="account-card-name-line">
            <button
              type="button"
              className="account-card-name"
              title={displayName}
              onClick={(event) => {
                event.stopPropagation()
                onShowDetail(account)
              }}
            >
              {displayName || (isEn ? 'Unnamed account' : '未命名账号')}
            </button>
            {account.isActive && (
              <span className="account-card-current">{isEn ? 'CURRENT' : '当前账号'}</span>
            )}
          </div>
          <div className="account-card-email-line">
            <span title={maskedEmail}>
              {account.nickname ? maskedEmail : isEn ? 'No nickname' : '未设置昵称'}
            </span>
            <button
              type="button"
              className="account-card-copy"
              aria-label={
                emailCopied
                  ? isEn
                    ? 'Email copied'
                    : '邮箱已复制'
                  : isEn
                    ? 'Copy email'
                    : '复制邮箱'
              }
              title={emailCopied ? (isEn ? 'Copied' : '已复制') : isEn ? 'Copy email' : '复制邮箱'}
              onClick={async (event) => {
                event.stopPropagation()
                try {
                  await navigator.clipboard.writeText(account.email || account.userId || '')
                  setEmailCopied(true)
                  setTimeout(() => setEmailCopied(false), 1500)
                } catch (error) {
                  console.error('[AccountCard] Copy email failed:', error)
                }
              }}
            >
              {emailCopied ? <Check /> : <Copy />}
            </button>
          </div>
        </div>
        <input
          type="checkbox"
          checked={isSelected}
          aria-label={isEn ? `Select ${displayName}` : `选择 ${displayName}`}
          onClick={(event) => event.stopPropagation()}
          onChange={() => onSelect(account.id)}
        />
      </header>

      <div className="account-card-badges">
        <span className="account-card-status" data-tone={statusTone}>
          <StatusIcon className={isBusy && !isUnauthorized ? 'animate-spin' : undefined} />
          {statusLabel}
        </span>
        <span className="account-card-provider" title={account.idp}>
          {account.idp || (isEn ? 'Unknown provider' : '未知登录方式')}
        </span>
        <button
          type="button"
          className="account-card-plan"
          aria-label={isEn ? 'Manage subscription' : '管理订阅'}
          title={
            isEn
              ? `Manage subscription: ${account.subscription.title || account.subscription.type}`
              : `管理订阅：${account.subscription.title || account.subscription.type}`
          }
          disabled={subscriptionLoading || !account.credentials.accessToken}
          onClick={handleSubscriptionClick}
        >
          {subscriptionLoading ? <Loader2 className="animate-spin" /> : <CreditCard />}
          <span>{account.subscription.title || account.subscription.type}</span>
        </button>
      </div>

      <section
        className="account-card-usage"
        data-tone={usageTone}
        aria-label={isEn ? 'Credit usage' : '使用额度'}
      >
        <div className="account-card-usage-heading">
          <span>{isEn ? 'CREDIT USAGE' : '本期用量'}</span>
          <span className="account-card-percentage">
            {usageKnown && limit > 0 ? `${percentage.toFixed(usagePrecision ? 2 : 0)}%` : '—'}
          </span>
        </div>
        <div className="account-card-usage-numbers">
          <strong>{usageKnown ? formatUsage(used) : '—'}</strong>
          <span>/ {usageKnown ? formatUsage(limit) : '—'} Credits</span>
        </div>
        <div
          className={cn('account-card-progress', !usageKnown && 'is-unknown')}
          role={usageKnown ? 'progressbar' : undefined}
          aria-label={usageKnown ? (isEn ? 'Credit usage' : '额度使用情况') : undefined}
          aria-valuemin={usageKnown ? 0 : undefined}
          aria-valuemax={usageKnown ? 100 : undefined}
          aria-valuenow={usageKnown ? Math.min(percentage, 100) : undefined}
          aria-valuetext={
            usageKnown ? `${formatUsage(used)} / ${formatUsage(limit)} Credits` : undefined
          }
        >
          <span style={{ width: `${Math.min(percentage, 100)}%` }} />
        </div>
        <p className="account-card-usage-hint">{usageHint}</p>
        <div className="account-card-usage-meta">
          <span>{resetDate ? `${resetDate} ${isEn ? 'reset' : '重置'}` : ''}</span>
          {quotas.length > 0 && (
            <button
              type="button"
              aria-expanded={showQuotas}
              aria-controls={quotasId}
              onClick={(event) => {
                event.stopPropagation()
                setShowQuotas(!showQuotas)
              }}
            >
              {isEn ? 'Breakdown' : '额度明细'}
              <ChevronDown className={showQuotas ? 'is-open' : undefined} />
            </button>
          )}
        </div>
        {showQuotas && (
          <div id={quotasId} className="account-card-quotas">
            {quotas.map((quota) => (
              <div key={quota.key} className="account-card-quota">
                <span title={quota.name}>{quota.name}</span>
                <strong>
                  {formatUsage(quota.current)} / {formatUsage(quota.limit)}
                </strong>
                {quota.expiry && (
                  <small>
                    {isEn ? 'Until ' : '有效至 '}
                    {quota.expiry}
                  </small>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="account-card-validity">
        <div data-tone={subscriptionTone}>
          <span>
            <Clock />
            {isEn ? 'SUBSCRIPTION' : '订阅有效期'}
          </span>
          <strong className="account-card-expiry-value">{subscriptionText}</strong>
        </div>
        <div
          data-tone={tokenTone}
          title={
            tokenKnown
              ? new Date(account.credentials.expiresAt).toLocaleString(isEn ? 'en-US' : 'zh-CN')
              : undefined
          }
        >
          <span>
            <KeyRound />
            {isEn ? 'ACCESS TOKEN' : '访问令牌'}
          </span>
          <strong className="account-card-expiry-value">{tokenText}</strong>
        </div>
        <TokenRefreshSchedule account={account} isEn={isEn} variant="card" />
      </div>

      {(accountGroup || accountTags.length > 0 || boundProxy) && (
        <div className="account-card-metadata">
          {accountGroup && (
            <span className="account-card-tag" title={accountGroup.name}>
              <FolderOpen
                style={{ color: accountGroup.color ? toRgba(accountGroup.color) : undefined }}
              />
              <span>{accountGroup.name}</span>
            </span>
          )}
          {boundProxy && (
            <button
              type="button"
              className="account-card-proxy"
              data-tone={proxyTone}
              title={`${boundProxy.label || boundProxy.host}:${boundProxy.port} · ${proxyStateLabel} · ${isEn ? 'Click to unbind' : '点击解绑'}`}
              onClick={(event) => {
                event.stopPropagation()
                if (
                  confirm(
                    isEn
                      ? `Unbind ${account.email} from ${boundProxy.host}:${boundProxy.port}?`
                      : `解绑 ${account.email} 与 ${boundProxy.host}:${boundProxy.port}？`
                  )
                )
                  unbindAccountFromProxy(account.id)
              }}
            >
              {boundProxy.enabled && boundProxy.status === 'testing' ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Network />
              )}
              <span>
                {boundProxy.label || boundProxy.host} · {proxyStateLabel}
              </span>
            </button>
          )}
          {(showAllTags ? accountTags : accountTags.slice(0, 2)).map((tag) => (
            <span key={tag.id} className="account-card-tag" title={tag.name}>
              <i style={{ background: toRgba(tag.color) }} />
              <span>{tag.name}</span>
            </span>
          ))}
          {accountTags.length > 2 && (
            <button
              type="button"
              className="account-card-tag-toggle"
              aria-expanded={showAllTags}
              aria-label={
                showAllTags
                  ? isEn
                    ? 'Collapse tags'
                    : '收起标签'
                  : isEn
                    ? `Show all ${accountTags.length} tags`
                    : `展开全部 ${accountTags.length} 个标签`
              }
              onClick={(event) => {
                event.stopPropagation()
                setShowAllTags(!showAllTags)
              }}
            >
              {showAllTags ? (isEn ? 'Less' : '收起') : `+${accountTags.length - 2}`}
            </button>
          )}
        </div>
      )}

      {account.lastError && (
        <button
          type="button"
          className="account-card-notice"
          data-tone={isUnauthorized || account.status === 'error' ? 'danger' : 'warning'}
          title={account.lastError}
          onClick={(event) => {
            event.stopPropagation()
            if (isUnauthorized) setShowBanDialog(true)
            else onShowDetail(account)
          }}
        >
          <AlertTriangle />
          <span>{account.lastError}</span>
          <Info />
        </button>
      )}

      <footer className="account-card-actions" onClick={(event) => event.stopPropagation()}>
        <Button
          type="button"
          variant="outline"
          className="account-card-primary"
          disabled={
            !isUnauthorized && hasCredentials && (account.isActive || isBusy || isSwitching)
          }
          onClick={() => {
            if (isUnauthorized) setShowBanDialog(true)
            else if (!hasCredentials) onEdit(account)
            else void handleSwitch()
          }}
        >
          {isUnauthorized ? (
            <Info />
          ) : !hasCredentials ? (
            <Edit />
          ) : isBusy || isSwitching ? (
            <Loader2 className="animate-spin" />
          ) : account.isActive ? (
            <Check />
          ) : (
            <ArrowRightLeft />
          )}
          {primaryLabel}
        </Button>
        <div className="account-card-secondary">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="account-card-refresh"
            aria-label={isEn ? 'Refresh account info' : '刷新账号信息'}
            title={isEn ? 'Refresh account info' : '刷新账号信息'}
            disabled={isBusy}
            onClick={() => {
              void handleRefresh()
            }}
          >
            <RefreshCw className={isBusy ? 'animate-spin' : undefined} />
          </Button>
          <AccountListMoreMenu
            label={isEn ? `More actions for ${displayName}` : `${displayName} 的更多操作`}
            actions={actions}
          />
        </div>
      </footer>

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
                  <div className="text-body font-medium">{displayName}</div>
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
    </article>
  )
})

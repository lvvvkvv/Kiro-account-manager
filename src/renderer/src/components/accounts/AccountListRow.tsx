import { useShallow } from 'zustand/react/shallow'
import { TokenRefreshSchedule } from './TokenRefreshSchedule'
import { memo, useState, useMemo, useCallback } from 'react'
import { useAccountsStore } from '@/store/accounts'
import { useTranslation } from '@/hooks/useTranslation'
import { Button } from '../ui'
import type { Account, AccountTag, AccountGroup } from '@/types/account'
import {
  Check,
  RefreshCw,
  Trash2,
  Edit,
  Info,
  AlertCircle,
  ArrowRightLeft,
  LogOut,
  RotateCcw,
  ExternalLink,
  Loader2,
  Clock,
  KeyRound,
  FolderOpen,
  Copy,
  UserRound,
  CheckCircle2,
  CircleHelp,
  Ban,
  Network,
  ChevronRight
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AccountListMoreMenu, type AccountListAction } from './AccountListMoreMenu'
import {
  toRgba,
  StatusLabelsZh,
  StatusLabelsEn,
  formatTokenExpiry,
  isBannedError
} from './_helpers'

interface AccountListRowProps {
  account: Account
  tags: Map<string, AccountTag>
  groups: Map<string, AccountGroup>
  isSelected: boolean
  position: number
  total: number
  onEdit: (account: Account) => void
  onShowDetail: (account: Account) => void
}

// 账号列表：身份、额度、有效期与操作独立分区，窄容器重排为卡片。
function AccountListRowComponent({
  account,
  tags,
  groups,
  isSelected,
  position,
  total,
  onEdit,
  onShowDetail
}: AccountListRowProps): React.ReactNode {
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
    boundProxy,
    unbindAccountFromProxy
  } = useAccountsStore(
    useShallow((state) => ({
      setActiveAccount: state.setActiveAccount,
      removeAccount: state.removeAccount,
      checkAccountStatus: state.checkAccountStatus,
      refreshAccountToken: state.refreshAccountToken,
      toggleSelection: state.toggleSelection,
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

  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'

  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isClearingSuspended, setIsClearingSuspended] = useState(false)
  const [emailCopied, setEmailCopied] = useState(false)
  const [isSwitching, setIsSwitching] = useState(false)
  const [showAllTags, setShowAllTags] = useState(false)

  // 封禁判定
  const isUnauthorized = isBannedError(account.lastError)

  // 标签
  const accountTags = useMemo(
    () => (account.tags || []).map((id) => tags.get(id)).filter((t): t is AccountTag => !!t),
    [account.tags, tags]
  )

  // 分组
  const accountGroup = useMemo(() => {
    if (!account.groupId) return null
    return groups.get(account.groupId) || null
  }, [account.groupId, groups])

  // 脱敏函数读取当前隐私设置，每次渲染都重新计算，避免切换隐私模式后保留旧文本。
  const displayName = account.nickname ? maskNickname(account.nickname) : maskEmail(account.email)
  const maskedEmail = maskEmail(account.email)

  // Credits
  const formatUsage = (value: number): string => {
    if (usagePrecision) {
      return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    }
    return Math.floor(value).toLocaleString()
  }
  // 到期
  const daysRemaining = account.subscription.daysRemaining
  const isTokenExpiringSoon =
    account.credentials.expiresAt !== undefined &&
    account.credentials.expiresAt - Date.now() < 5 * 60 * 1000

  // === Handlers ===
  const handleSwitch = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      if (isSwitching) return
      setIsSwitching(true)
      try {
        const result = await useAccountsStore.getState().switchAccount(account.id)
        if (!result.success) alert(isEn ? `Switch failed: ${result.error}` : `切换失败：${result.error}`)
      } catch (error) {
        alert(isEn ? `Switch failed: ${String(error)}` : `切换失败：${String(error)}`)
      } finally {
        setIsSwitching(false)
      }
    },
    [account, isEn, isSwitching, setActiveAccount]
  )

  const handleRefresh = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      if (isRefreshing) return
      setIsRefreshing(true)
      try {
        await refreshAccountToken(account.id)
        await checkAccountStatus(account.id)
      } finally {
        setIsRefreshing(false)
      }
    },
    [account.id, isRefreshing, refreshAccountToken, checkAccountStatus]
  )

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (
        !confirm(isEn ? `Delete account "${account.email}"?` : `确定删除账号 "${account.email}"？`)
      )
        return
      removeAccount(account.id)
    },
    [account.id, account.email, isEn, removeAccount]
  )

  const handleLogout = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      if (
        !confirm(
          isEn
            ? 'Clear local SSO cache and logout from Kiro?'
            : '清除本地 SSO 缓存并退出 Kiro 登录？'
        )
      )
        return
      const result = await window.api.logoutAccount()
      if (result.success) {
        setActiveAccount(null)
      } else {
        alert(isEn ? `Logout failed: ${result.error}` : `退出失败：${result.error}`)
      }
    },
    [isEn, setActiveAccount]
  )

  const handleClearSuspended = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      if (isClearingSuspended) return
      setIsClearingSuspended(true)
      try {
        const result = await window.api.proxyClearAccountSuspended(account.id)
        if (result.success) {
          updateAccountStatus(account.id, 'active', undefined)
        }
      } finally {
        setIsClearingSuspended(false)
      }
    },
    [account.id, isClearingSuspended, updateAccountStatus]
  )

  const handleCopyEmail = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      const text = account.email || account.userId || ''
      if (text) {
        try {
          await navigator.clipboard.writeText(text)
          setEmailCopied(true)
          setTimeout(() => setEmailCopied(false), 1500)
        } catch {
          alert(isEn ? 'Copy failed. Please try again.' : '复制失败，请重试。')
        }
      }
    },
    [account.email, account.userId, isEn]
  )

  const secondaryActions: AccountListAction[] = [
    ...(isUnauthorized
      ? [
          {
            label: isEn ? 'Reset Suspended' : '重置封禁状态',
            icon: isClearingSuspended ? (
              <RefreshCw className="animate-spin text-warning" />
            ) : (
              <RotateCcw className="text-warning" />
            ),
            onClick: handleClearSuspended,
            disabled: isClearingSuspended
          },
          {
            label: isEn ? 'Contact Support' : '联系支持',
            icon: <ExternalLink className="text-primary" />,
            href: 'https://support.aws.amazon.com/#/contacts/kiro'
          }
        ]
      : []),
    {
      label: isEn ? 'Details' : '详情',
      icon: <Info />,
      onClick: (event) => {
        event.stopPropagation()
        onShowDetail(account)
      }
    },
    {
      label: isEn ? 'Edit' : '编辑',
      icon: <Edit />,
      onClick: (event) => {
        event.stopPropagation()
        onEdit(account)
      }
    },
    {
      label: account.isActive
        ? isEn
          ? 'Logout (clear SSO cache)'
          : '退出登录（清除 SSO 缓存）'
        : isEn
          ? 'Delete'
          : '删除',
      icon: account.isActive ? <LogOut /> : <Trash2 />,
      onClick: account.isActive ? handleLogout : handleDelete,
      destructive: true
    }
  ]

  const hasCredentials = Boolean(
    account.credentials.refreshToken &&
    (account.credentials.authMethod === 'social' ||
      (account.credentials.clientId && account.credentials.clientSecret))
  )
  const isBusy = isRefreshing || account.status === 'refreshing'
  const effectiveStatus = isBusy ? 'refreshing' : account.status
  const statusLabel = isUnauthorized
    ? isEn
      ? 'Suspended'
      : '已封禁'
    : (isEn ? StatusLabelsEn : StatusLabelsZh)[effectiveStatus] || (isEn ? 'Unknown' : '未知')
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
  const StatusIcon = isUnauthorized
    ? Ban
    : effectiveStatus === 'refreshing'
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
  const percentage = usageKnown && limit > 0 ? (used / limit) * 100 : 0
  const exhausted = usageKnown && (limit === 0 || used >= limit)
  const exceeded = usageKnown && used > limit
  const usageTone = exceeded ? 'danger' : exhausted || percentage >= 80 ? 'warning' : 'default'
  const usageHint = !usageKnown
    ? isBusy
      ? isEn
        ? 'Syncing usage…'
        : '正在获取用量…'
      : isEn
        ? 'Check account to sync usage'
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
  const subscriptionDays = Number.isFinite(daysRemaining)
    ? daysRemaining
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
  const tokenExpired = tokenKnown && account.credentials.expiresAt <= Date.now()
  const tokenTone = tokenExpired
    ? 'danger'
    : isTokenExpiringSoon && tokenKnown
      ? 'warning'
      : 'default'
  const tokenText = tokenKnown
    ? formatTokenExpiry(account.credentials.expiresAt, isEn)
    : isEn
      ? 'Not synced'
      : '未获取'
  const proxyTone =
    boundProxy && (!boundProxy.enabled || ['dead', 'slow'].includes(boundProxy.status))
      ? 'warning'
      : boundProxy?.status === 'testing'
        ? 'info'
        : 'default'
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

  const hasMetadata = Boolean(accountGroup || accountTags.length || boundProxy)
  const primaryLabel = isUnauthorized
    ? isEn
      ? 'Details'
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
              ? 'Switch'
              : '切换账号'

  return (
    <article
      className={cn(
        'account-list-row',
        isSelected && 'is-selected',
        account.isActive && 'is-current'
      )}
      role="listitem"
      aria-posinset={position}
      aria-setsize={total}
      data-account-id={account.id}
      data-state={isUnauthorized ? 'banned' : effectiveStatus}
      lang={isEn ? 'en' : 'zh-CN'}
      onClick={() => toggleSelection(account.id)}
    >
      <div className="account-list-select">
        <input
          type="checkbox"
          checked={isSelected}
          aria-label={isEn ? `Select ${displayName}` : `选择 ${displayName}`}
          onClick={(event) => event.stopPropagation()}
          onChange={() => toggleSelection(account.id)}
        />
      </div>

      <div className="account-list-identity">
        <div className="account-list-avatar" aria-hidden="true">
          <UserRound />
          {account.isActive && <span className="account-list-active-dot" />}
        </div>
        <div className="account-list-identity-content">
          <div className="account-list-name-line">
            <button
              type="button"
              className="account-list-name"
              onClick={(event) => {
                event.stopPropagation()
                onShowDetail(account)
              }}
              title={displayName}
            >
              {displayName || (isEn ? 'Unnamed account' : '未命名账号')}
            </button>
            {account.isActive && (
              <span className="account-list-current-label">{isEn ? 'CURRENT' : '当前账号'}</span>
            )}
          </div>
          <div className="account-list-email-line">
            <span className="account-list-email" title={maskedEmail}>
              {account.nickname ? maskedEmail : isEn ? 'No nickname' : '未设置昵称'}
            </span>
            <button
              type="button"
              className={cn('account-list-copy', emailCopied && 'is-copied')}
              onClick={handleCopyEmail}
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
            >
              {emailCopied ? <Check /> : <Copy />}
            </button>
          </div>
          <div className="account-list-identity-meta">
            <span className="account-list-status" data-tone={statusTone}>
              <StatusIcon className={isBusy && !isUnauthorized ? 'animate-spin' : undefined} />
              {statusLabel}
            </span>
            <span className="account-list-provider">
              {account.idp || (isEn ? 'Unknown provider' : '未知登录方式')}
            </span>
            <span
              className="account-list-plan"
              title={account.subscription.title || account.subscription.type}
            >
              {account.subscription.title || account.subscription.type}
            </span>
          </div>
        </div>
      </div>

      <div className="account-list-metrics">
        <section
          className="account-list-usage"
          aria-label={isEn ? 'Credit usage' : '额度使用情况'}
          data-tone={usageTone}
        >
          <span className="account-list-mobile-label">{isEn ? 'CREDIT USAGE' : '使用额度'}</span>
          <div className="account-list-usage-numbers">
            {usageKnown ? (
              <span>
                <strong>{formatUsage(used)}</strong>
                <span className="account-list-usage-limit"> / {formatUsage(limit)}</span>
              </span>
            ) : (
              <strong className="account-list-value-unknown">—</strong>
            )}
            {usageKnown && limit > 0 && (
              <span className="account-list-percentage">
                {percentage.toFixed(usagePrecision ? 2 : 0)}%
              </span>
            )}
          </div>
          <div
            className={cn('account-list-progress', !usageKnown && 'is-unknown')}
            role={usageKnown && limit > 0 ? 'progressbar' : undefined}
            aria-label={isEn ? 'Credits used' : '已使用额度'}
            aria-valuemin={usageKnown && limit > 0 ? 0 : undefined}
            aria-valuemax={usageKnown && limit > 0 ? 100 : undefined}
            aria-valuenow={usageKnown && limit > 0 ? Math.min(percentage, 100) : undefined}
            aria-valuetext={usageKnown ? `${formatUsage(used)} / ${formatUsage(limit)}` : undefined}
          >
            {usageKnown && (
              <span style={{ width: `${limit === 0 ? 0 : Math.min(percentage, 100)}%` }} />
            )}
          </div>
          <span className="account-list-usage-hint">
            {exhausted && <AlertCircle />}
            {usageHint}
          </span>
        </section>

        <section
          className="account-list-validity"
          aria-label={isEn ? 'Subscription and access token' : '订阅与访问令牌'}
        >
          <span className="account-list-mobile-label">{isEn ? 'VALIDITY' : '有效期'}</span>
          <div className="account-list-expiry-item" data-tone={subscriptionTone}>
            <span className="account-list-expiry-label">
              <Clock />
              {isEn ? 'Plan' : '订阅'}
            </span>
            <span className="account-list-expiry-value">{subscriptionText}</span>
          </div>
          <div
            className="account-list-expiry-item"
            data-tone={tokenTone}
            title={
              tokenKnown
                ? new Date(account.credentials.expiresAt).toLocaleString(isEn ? 'en-US' : 'zh-CN')
                : undefined
            }
          >
            <span className="account-list-expiry-label">
              <KeyRound />
              {isEn ? 'Token' : '令牌'}
            </span>
            <span className="account-list-expiry-value">{tokenText}</span>
          </div>
          <TokenRefreshSchedule account={account} isEn={isEn} variant="list" />
        </section>
      </div>

      <div className="account-list-actions">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="account-list-primary-action"
          data-tone={isUnauthorized ? 'danger' : 'default'}
          onClick={
            isUnauthorized
              ? (event) => {
                  event.stopPropagation()
                  onShowDetail(account)
                }
              : !hasCredentials
                ? (event) => {
                    event.stopPropagation()
                    onEdit(account)
                  }
                : handleSwitch
          }
          disabled={
            !isUnauthorized && hasCredentials && (account.isActive || isBusy || isSwitching)
          }
          title={primaryLabel}
        >
          {isUnauthorized ? (
            <AlertCircle />
          ) : !hasCredentials ? (
            <KeyRound />
          ) : isBusy ? (
            <RefreshCw />
          ) : account.isActive ? (
            <Check />
          ) : isSwitching ? (
            <Loader2 className="animate-spin" />
          ) : (
            <ArrowRightLeft />
          )}
          <span>{primaryLabel}</span>
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="account-list-refresh h-8 w-8"
          onClick={handleRefresh}
          disabled={isBusy || isSwitching}
          aria-label={isEn ? 'Refresh account information' : '刷新账号信息'}
          title={isEn ? 'Refresh account information' : '刷新账号信息'}
        >
          <RefreshCw className={isBusy ? 'animate-spin' : undefined} />
        </Button>
        <AccountListMoreMenu
          label={isEn ? `More actions for ${displayName}` : `${displayName} 的更多操作`}
          actions={secondaryActions}
        />
      </div>

      {hasMetadata && (
        <div className="account-list-metadata">
          {accountGroup && (
            <span className="account-list-meta-chip" title={accountGroup.name}>
              <FolderOpen style={{ color: toRgba(accountGroup.color || '#65656e') }} />
              <span>{accountGroup.name}</span>
            </span>
          )}
          {accountTags.slice(0, showAllTags ? undefined : 3).map((tag) => (
            <span key={tag.id} className="account-list-meta-chip" title={tag.name}>
              <span
                className="account-list-tag-dot"
                style={{ backgroundColor: toRgba(tag.color) }}
              />
              <span>{tag.name}</span>
            </span>
          ))}
          {accountTags.length > 3 && (
            <button
              type="button"
              className="account-list-meta-chip"
              onClick={(event) => {
                event.stopPropagation()
                setShowAllTags(!showAllTags)
              }}
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
              title={accountTags
                .slice(3)
                .map((tag) => tag.name)
                .join(', ')}
            >
              {showAllTags ? (isEn ? 'Less' : '收起') : `+${accountTags.length - 3}`}
            </button>
          )}
          {boundProxy && (
            <button
              type="button"
              className="account-list-meta-chip account-list-proxy"
              data-tone={proxyTone}
              title={`${isEn ? 'Proxy' : '代理'}: ${boundProxy.host}:${boundProxy.port}${boundProxy.label ? ` (${boundProxy.label})` : ''} · ${isEn ? 'Click to unbind' : '点击解绑'}`}
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
              <span>{boundProxy.label || `${boundProxy.host}:${boundProxy.port}`}</span>
              <span>{proxyStateLabel}</span>
            </button>
          )}
        </div>
      )}

      {(isUnauthorized || account.lastError) && (
        <div
          className="account-list-notice"
          data-tone={isUnauthorized || account.status === 'error' ? 'danger' : 'warning'}
        >
          <AlertCircle />
          <span title={account.lastError}>
            {account.lastError ||
              (isEn
                ? 'Account suspended. View details for recovery options.'
                : '账号已封禁，请查看详情了解恢复方式。')}
          </span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onShowDetail(account)
            }}
          >
            {isEn ? 'Details' : '查看详情'}
            <ChevronRight />
          </button>
        </div>
      )}
    </article>
  )
}

export const AccountListRow = memo(AccountListRowComponent)

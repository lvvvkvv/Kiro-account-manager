import { RefreshCw } from 'lucide-react'
import { isBannedAccountError, useAccountsStore } from '@/store/accounts'
import type { Account } from '@/types/account'
import { tokenRefreshAt } from '../../../../shared/tokenRefresh'
import './TokenRefreshSchedule.css'

interface TokenRefreshScheduleProps {
  account: Account
  isEn: boolean
  variant: 'card' | 'list' | 'detail'
}

export function TokenRefreshSchedule({
  account,
  isEn,
  variant
}: TokenRefreshScheduleProps): React.ReactNode {
  // Detail dialogs may retain an account snapshot while a background refresh updates the store.
  const currentAccount = useAccountsStore((state) => state.accounts.get(account.id) ?? account)
  const autoRefreshEnabled = useAccountsStore((state) => state.autoRefreshEnabled)
  const ideRenewalEnabled = useAccountsStore(
    (state) => state.proactiveRenewalEnabled && state.activeAccountId === account.id
  )
  const { expiresAt, refreshToken } = currentAccount.credentials
  const scheduledAt =
    Number.isFinite(expiresAt) && expiresAt > 0
      ? tokenRefreshAt(currentAccount.id, expiresAt)
      : undefined
  const locale = isEn ? 'en-US' : 'zh-CN'
  const fullTime = scheduledAt
    ? new Date(scheduledAt).toLocaleString(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      })
    : undefined
  const shortTime = scheduledAt
    ? new Date(scheduledAt).toLocaleString(locale, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
    : undefined

  let state = 'scheduled'
  let message: string | undefined
  if (!autoRefreshEnabled && !ideRenewalEnabled) {
    state = 'disabled'
    message = isEn ? 'Auto refresh off' : '自动刷新已关闭'
  } else if (isBannedAccountError(currentAccount.lastError) && !ideRenewalEnabled) {
    state = 'paused'
    message = isEn ? 'Account suspended' : '账号已暂停刷新'
  } else if (!refreshToken) {
    state = 'unavailable'
    message = isEn ? 'No refresh token' : '缺少刷新凭证'
  } else if (!scheduledAt) {
    state = 'unknown'
    message = isEn ? 'Expiry unknown' : '未获取到期时间'
  } else if (currentAccount.status === 'refreshing') {
    state = 'refreshing'
    message = isEn ? 'Refreshing…' : '正在刷新…'
  } else if (scheduledAt <= Date.now()) {
    state = 'pending'
  }

  const label = isEn ? 'Next refresh' : '下次刷新'
  const description =
    message ||
    (isEn
      ? `Scheduled: ${fullTime}. Randomized 10–30 minutes before expiry; execution is subject to the concurrency limit.`
      : `计划时间：${fullTime}。在过期前 10～30 分钟随机安排，实际执行受并发上限影响。`)

  return (
    <div
      className={`token-refresh-schedule token-refresh-schedule--${variant}`}
      data-state={state}
      role="group"
      aria-label={label}
      title={description}
    >
      <span className="token-refresh-schedule-label">
        <RefreshCw />
        {label}
      </span>
      <strong className="token-refresh-schedule-value">
        {message || (
          <>
            <time dateTime={new Date(scheduledAt!).toISOString()}>
              {variant === 'detail' ? fullTime : shortTime}
            </time>
            {state === 'pending' && (
              <small className="token-refresh-schedule-pending">
                {isEn ? 'Pending' : '等待刷新'}
              </small>
            )}
          </>
        )}
      </strong>
    </div>
  )
}

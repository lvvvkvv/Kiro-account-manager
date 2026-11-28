import type { Account, AccountRisk } from '../types/account'

interface AccountIdentityIndex {
  add: (email: string, userId?: string, provider?: string) => void
  has: (email: string, userId?: string, provider?: string) => boolean
}

export function createAccountIdentityIndex(
  accounts: Iterable<Omit<Account, 'isActive'>>
): AccountIdentityIndex {
  const userIds = new Set<string>()
  const emails = new Map<string, Set<string | undefined>>()
  const add = (email: string, userId?: string, provider?: string): void => {
    if (userId) userIds.add(userId)
    // 企业账号允许没有邮箱，不能把所有空邮箱视为同一个账号。
    if (!email) return
    let providers = emails.get(email)
    if (!providers) {
      providers = new Set()
      emails.set(email, providers)
    }
    providers.add(provider)
  }
  for (const account of accounts) add(account.email, account.userId, account.credentials.provider)
  return {
    add,
    has: (email: string, userId?: string, provider?: string): boolean =>
      !!((userId && userIds.has(userId)) || (email && emails.get(email)?.has(provider)))
  }
}

export function isBannedAccountError(error?: string): boolean {
  if (!error) return false
  const lower = error.toLowerCase()
  return (
    lower.includes('accountsuspendedexception') ||
    lower.includes('account suspended') ||
    lower.includes('temporarily_suspended') ||
    lower.includes('temporarily suspended') ||
    (lower.includes('user id is') && lower.includes('suspended')) ||
    lower.includes('账户已封禁') ||
    lower.includes('已封禁') ||
    /\b423\b/.test(lower)
  )
}

/** 保留导出结构与非敏感元数据，移除可用于登录的凭证。 */
export function withoutAccountCredentials(
  account: Omit<Account, 'isActive'>
): Omit<Account, 'isActive'> {
  return {
    ...account,
    password: undefined,
    credentials: {
      ...account.credentials,
      accessToken: '',
      refreshToken: '',
      csrfToken: '',
      clientSecret: undefined
    }
  }
}

export const QUOTA_WARN_RATIO = 0.9
export const EXPIRE_WARN_DAYS = 7

/** One risk definition for home counts, previews and account-list navigation. */
export function matchesAccountRisk(account: Account, risk: AccountRisk): boolean {
  if (risk === 'banned') return isBannedAccountError(account.lastError)
  if (risk === 'expiring')
    return (
      account.subscription.daysRemaining !== undefined &&
      account.subscription.daysRemaining <= EXPIRE_WARN_DAYS &&
      !isBannedAccountError(account.lastError)
    )
  return (
    account.status === 'active' &&
    account.usage.limit > 0 &&
    account.usage.percentUsed >= QUOTA_WARN_RATIO &&
    !isBannedAccountError(account.lastError)
  )
}

/** Retain the legacy timestamp fallback for imported data as well as API date strings. */
export function formatAccountDate(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.split('T')[0]
  if (typeof value !== 'number' && !(value instanceof Date)) return fallback
  try {
    return new Date(value).toISOString().split('T')[0]
  } catch {
    return fallback
  }
}

/** Older backups can omit optional UI fields; only migrate records that need defaults. */
export function normalizeStoredAccount(id: string, account: Account): Account {
  const credentials = account.credentials,
    usage = account.usage,
    subscription = account.subscription
  if (
    account.id === id &&
    typeof account.email === 'string' &&
    account.idp &&
    account.status &&
    credentials &&
    typeof credentials.accessToken === 'string' &&
    typeof credentials.csrfToken === 'string' &&
    typeof credentials.expiresAt === 'number' &&
    usage &&
    typeof usage.current === 'number' &&
    typeof usage.limit === 'number' &&
    typeof usage.percentUsed === 'number' &&
    subscription?.type &&
    Array.isArray(account.tags) &&
    typeof account.createdAt === 'number' &&
    typeof account.lastUsedAt === 'number'
  )
    return account
  return {
    ...account,
    id,
    email: account.email ?? '',
    idp: account.idp || 'BuilderId',
    status: account.status || 'unknown',
    credentials: {
      ...credentials,
      accessToken: credentials?.accessToken ?? '',
      csrfToken: credentials?.csrfToken ?? '',
      expiresAt: credentials?.expiresAt ?? 0
    },
    usage: {
      ...usage,
      current: usage?.current ?? 0,
      limit: usage?.limit ?? 0,
      percentUsed:
        usage?.percentUsed ?? (usage?.limit > 0 ? (usage.current ?? 0) / usage.limit : 0),
      lastUpdated: usage?.lastUpdated ?? 0
    },
    subscription: { ...subscription, type: subscription?.type || 'Free' },
    tags: account.tags ?? [],
    createdAt: account.createdAt ?? 0,
    lastUsedAt: account.lastUsedAt ?? 0,
    isActive: account.isActive === true
  }
}

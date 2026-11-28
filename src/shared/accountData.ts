/** Runtime storage boundary: accept older optional fields, reject structures that cannot be loaded. */
export function validateAccountData(value: unknown): void {
  const record = (input: unknown): input is Record<string, unknown> =>
    !!input && typeof input === 'object' && !Array.isArray(input)
  if (!record(value) || !record(value.accounts)) throw new Error('账号数据缺少有效的 accounts 对象')
  for (const [id, account] of Object.entries(value.accounts)) {
    if (!record(account)) throw new Error(`账号记录无效: ${id}`)
    for (const key of ['credentials', 'usage', 'subscription']) {
      if (account[key] !== undefined && !record(account[key]))
        throw new Error(`账号字段无效: ${id}.${key}`)
    }
    for (const key of ['id', 'email', 'nickname', 'idp', 'machineId', 'lastError']) {
      if (account[key] !== undefined && typeof account[key] !== 'string')
        throw new Error(`账号字段无效: ${id}.${key}`)
    }
    const numeric = (input: Record<string, unknown>, keys: string[]): void => {
      for (const key of keys) {
        const value = input[key]
        if (value != null && (typeof value !== 'number' || !Number.isFinite(value)))
          throw new Error(`账号数值无效: ${id}.${key}`)
      }
    }
    numeric(account, ['createdAt', 'lastUsedAt', 'lastCheckedAt'])
    if (record(account.credentials)) {
      numeric(account.credentials, ['expiresAt'])
      for (const key of ['accessToken', 'refreshToken', 'csrfToken', 'clientId', 'clientSecret']) {
        if (account.credentials[key] != null && typeof account.credentials[key] !== 'string')
          throw new Error(`账号凭证无效: ${id}.${key}`)
      }
    }
    if (record(account.usage))
      numeric(account.usage, ['current', 'limit', 'percentUsed', 'lastUpdated'])
    if (record(account.subscription)) {
      numeric(account.subscription, ['daysRemaining', 'expiresAt'])
      if (account.subscription.type !== undefined && typeof account.subscription.type !== 'string')
        throw new Error(`账号订阅类型无效: ${id}`)
    }
    if (
      account.tags !== undefined &&
      (!Array.isArray(account.tags) || !account.tags.every((tag) => typeof tag === 'string'))
    )
      throw new Error(`账号标签无效: ${id}`)
  }
  for (const key of ['groups', 'tags', 'proxyPool', 'accountMachineIds', 'accountProxyBindings']) {
    if (value[key] !== undefined && value[key] !== null && !record(value[key]))
      throw new Error(`账号数据字段无效: ${key}`)
  }
  for (const key of ['groups', 'tags', 'proxyPool']) {
    if (record(value[key]) && Object.values(value[key]).some((entry) => !record(entry)))
      throw new Error(`账号数据条目无效: ${key}`)
  }
}

export interface AccountStorageStatus {
  backupError: string | null
  writeError: string | null
}

import type { Account } from '@/types/account'
export type EligibilityReason =
  | 'ok'
  | 'no-token'
  | 'already-pro'
  | 'banned'
  | 'cant-upgrade'
  | 'unknown-status'

export function checkUpgradeEligibility(account: Account): {
  eligible: boolean
  reason: EligibilityReason
  detail?: string
} {
  if (!account.credentials?.accessToken) return { eligible: false, reason: 'no-token' }
  const type = (account.subscription?.type || '').toUpperCase()
  const title = (account.subscription?.title || '').toUpperCase()
  if (isSubscribed(account))
    return {
      eligible: false,
      reason: 'already-pro',
      detail: account.subscription?.title || account.subscription?.type
    }
  if (!(type.includes('FREE') || title.includes('FREE') || (!type && !title)))
    return {
      eligible: false,
      reason: 'unknown-status',
      detail: account.subscription?.title || account.subscription?.type || '未检测'
    }
  if (account.status === 'error' && /suspended|封禁|temporarily/i.test(account.lastError || ''))
    return { eligible: false, reason: 'banned', detail: account.lastError }
  if (account.subscription?.upgradeCapability?.toUpperCase().includes('NOT'))
    return {
      eligible: false,
      reason: 'cant-upgrade',
      detail: account.subscription.upgradeCapability
    }
  return { eligible: true, reason: 'ok' }
}

export function isSubscribed(account: Account): boolean {
  return [account.subscription?.type, account.subscription?.title].some((value) =>
    /PRO|ENTERPRISE|TEAMS/i.test(value || '')
  )
}

export function parseImportedLinks(text: string): Array<{ email: string; url: string }> {
  const out: Array<{ email: string; url: string }> = []
  for (const raw of text.split(/\r?\n/)) {
    const match = raw.trim().match(/https?:\/\/[^\s,|]+/i)
    if (!match || match.index === undefined) continue
    // Retain URL parentheses and other valid token characters; remove only surrounding quote/bracket punctuation.
    let url = match[0].replace(/[\]}>.,;'"]+$/, '')
    if (url.endsWith(')') && (url.match(/\)/g)?.length || 0) > (url.match(/\(/g)?.length || 0))
      url = url.slice(0, -1)
    try {
      if (!['http:', 'https:'].includes(new URL(url).protocol)) continue
    } catch {
      continue
    }
    const prefix = raw
      .trim()
      .slice(0, match.index)
      .replace(/[-,|\s]+$/, '')
    const email = prefix.match(/[^\s,|<>"']+@[^\s,|<>"']+\.[^\s,|<>"']+/)?.[0] || ''
    out.push({ email, url })
  }
  return out
}

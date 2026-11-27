const MIN_LEAD_MS = 10 * 60 * 1000
const MAX_LEAD_MS = 30 * 60 * 1000

/** Stable pseudo-random deadline: both processes and app restarts agree for this token. */
export function tokenRefreshAt(accountId: string, expiresAt: number): number {
  let hash = 2166136261
  for (const char of `${accountId}:${expiresAt}`) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  }
  // Mix nearby IDs/expiry timestamps before mapping to the 10–30 minute window.
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b)
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35)
  hash = (hash ^ (hash >>> 16)) >>> 0
  return expiresAt - MIN_LEAD_MS - Math.floor((hash / 0x100000000) * (MAX_LEAD_MS - MIN_LEAD_MS))
}

export function isTokenRefreshDue(
  accountId: string,
  expiresAt: number | undefined,
  now: number
): boolean {
  return !!expiresAt && Number.isFinite(expiresAt) && now >= tokenRefreshAt(accountId, expiresAt)
}

export function tokenRefreshConcurrency(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(500, Math.floor(value!))) : 100
}

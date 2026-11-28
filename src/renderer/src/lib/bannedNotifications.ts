import type { Account } from '../types/account'
import type { Language } from './language'
import { isBannedAccountError } from './account'

const KEY = 'kiro-notified-banned-ids'
interface NotificationState {
  accounts: Map<string, Account>
  language: Language
  maskEmail: (email: string) => string
  maskNickname: (nickname?: string) => string
}

/** Session-local notification bookkeeping; browser I/O occurs only when the banned set changes. */
export class BannedAccountNotifications {
  private known: Set<string>
  private baseline = false
  private pending = new Set<string>()
  private permission: Promise<void> | undefined
  private active = true

  constructor(
    private current: () => NotificationState,
    private graceUntil: number
  ) {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(KEY) || '[]')
      this.known = new Set(
        Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []
      )
    } catch {
      this.known = new Set()
    }
  }

  update(accounts: Map<string, Account>): void {
    if (!this.active) return
    const banned = new Set<string>()
    for (const account of accounts.values()) {
      if (isBannedAccountError(account.lastError)) banned.add(account.id)
    }
    const fresh = [...banned].filter((id) => !this.known.has(id))
    const changed = banned.size !== this.known.size || fresh.length > 0
    this.known = banned
    for (const id of this.pending) if (!banned.has(id)) this.pending.delete(id)
    if (changed) {
      try {
        localStorage.setItem(KEY, JSON.stringify([...banned]))
      } catch {
        /* Notification dedupe remains valid in memory. */
      }
    }
    // The first loaded snapshot is always a baseline, even after a slow cold start.
    const baseline = this.baseline
    this.baseline = true
    if (!baseline || Date.now() < this.graceUntil || Notification.permission === 'denied') return
    for (const id of fresh) this.pending.add(id)
    if (!this.pending.size) return
    if (Notification.permission === 'granted') this.fire()
    else if (!this.permission) {
      this.permission = Notification.requestPermission()
        .then((permission) => {
          if (permission === 'granted') this.fire()
          else this.pending.clear()
        })
        .catch(() => this.pending.clear())
        .finally(() => {
          this.permission = undefined
        })
    }
  }

  private fire(): void {
    if (!this.active) return
    const state = this.current()
    const accounts = [...this.pending].flatMap((id) => {
      const account = state.accounts.get(id)
      return account && isBannedAccountError(account.lastError) ? [account] : []
    })
    this.pending.clear()
    if (!accounts.length) return
    const isEn = state.language === 'en'
    const title =
      accounts.length === 1
        ? isEn
          ? 'Account banned'
          : '账号被封禁'
        : isEn
          ? `${accounts.length} accounts banned`
          : `${accounts.length} 个账号被封禁`
    const names = accounts
      .slice(0, 3)
      .map((a) => (a.nickname ? state.maskNickname(a.nickname) : state.maskEmail(a.email)))
    const body =
      names.join('\n') +
      (accounts.length > 3
        ? isEn
          ? `\n+${accounts.length - 3} more`
          : `\n等 ${accounts.length} 个`
        : '')
    try {
      new Notification(title, { body })
    } catch {
      /* Native notifications may be unavailable. */
    }
  }

  dispose(): void {
    this.active = false
    this.pending.clear()
  }
}

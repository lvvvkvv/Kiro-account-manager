/**
 * 账号视图共享工具 — AccountCard / AccountListRow 复用
 * 保证两种视图（卡片 / 列表）视觉系统一致
 */
import type { Account, AccountFilter } from '@/types/account'
export { isBannedAccountError as isBannedError } from '@/lib/account'

// 高级筛选面板与工具栏共用，搜索关键词由独立搜索框展示。
export function hasActiveAccountFilters(filter: AccountFilter): boolean {
  return Boolean(
    filter.subscriptionTypes?.length ||
    filter.statuses?.length ||
    filter.idps?.length ||
    filter.tagIds?.length ||
    filter.emailDomains?.length ||
    filter.usageMin !== undefined ||
    filter.usageMax !== undefined ||
    filter.daysRemainingMin !== undefined ||
    filter.daysRemainingMax !== undefined ||
    filter.risk ||
    filter.bannedOnly
  )
}

// ============ 颜色解析 ============

// 解析 ARGB 颜色转换为 CSS rgba（支持 #AARRGGBB 与 #RRGGBB）
export function toRgba(argbColor: string): string {
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

// ============ 状态文本 ============

export const StatusLabelsZh: Record<string, string> = {
  active: '正常',
  expired: '已过期',
  error: '错误',
  refreshing: '刷新中',
  unknown: '未知'
}

export const StatusLabelsEn: Record<string, string> = {
  active: 'Active',
  expired: 'Expired',
  error: 'Error',
  refreshing: 'Refreshing',
  unknown: 'Unknown'
}

// ============ 显示名 ============

export function getDisplayName(account: Account): string {
  if (account.nickname) return account.nickname
  if (account.email) return account.email
  if (account.userId) return account.userId
  return 'Unknown'
}

// ============ Token 过期格式化 ============

export function formatTokenExpiry(expiresAt: number, isEn: boolean): string {
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

// ============ 日期格式化 ============

// 把 nextResetDate / freeTrialExpiry 等多种类型安全格式化为 YYYY-MM-DD
export function formatDateSafe(d: unknown): string {
  try {
    return (typeof d === 'string' ? d : new Date(d as Date).toISOString()).split('T')[0]
  } catch {
    return ''
  }
}

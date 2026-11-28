import { VirtualRows } from '../ui/VirtualRows'
import { useState, useMemo } from 'react'
import { X, Search, Check, User, CreditCard, Zap, Mail, AlertCircle, Ban } from 'lucide-react'
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Badge } from '../ui'
import type { Account } from '../../types/account'

interface AccountSelectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: Map<string, Account>
  selectedAccountId?: string
  onSelect: (accountId: string | undefined) => void
  isEn: boolean
}

export function AccountSelectDialog({
  open,
  onOpenChange,
  accounts,
  selectedAccountId,
  onSelect,
  isEn
}: AccountSelectDialogProps): React.ReactNode {
  const [searchQuery, setSearchQuery] = useState('')

  const accountList = useMemo(() => {
    return open ? Array.from(accounts.values()) : []
  }, [accounts, open])

  const filteredAccounts = useMemo(() => {
    if (!searchQuery.trim()) return accountList
    const query = searchQuery.toLowerCase()
    return accountList.filter(
      (acc) =>
        acc.email?.toLowerCase().includes(query) ||
        acc.id.toLowerCase().includes(query) ||
        acc.subscription?.title?.toLowerCase().includes(query)
    )
  }, [accountList, searchQuery])

  const handleSelect = (accountId: string | undefined): void => {
    onSelect(accountId)
    onOpenChange(false)
  }

  const getUsagePercent = (acc: Account): number => {
    const usage = acc.usage
    if (!usage) return 0
    // 直接通过 current/limit 计算百分比，确保准确性
    if (usage.limit > 0) {
      return Math.min(100, (usage.current / usage.limit) * 100)
    }
    return usage.percentUsed || 0
  }

  const getUsageText = (acc: Account): string => {
    const usage = acc.usage
    if (!usage) return '-'
    return `${usage.current.toFixed(1)} / ${usage.limit}`
  }

  const getSubscriptionColor = (title?: string): string => {
    if (!title) return 'bg-gray-500 text-white'
    const t = title.toUpperCase()
    // KIRO PRO+ / PRO_PLUS - 紫色
    if (t.includes('PRO+') || t.includes('PRO_PLUS') || t.includes('PROPLUS'))
      return 'bg-purple-500 text-white'
    // KIRO POWER - 金色
    if (t.includes('POWER')) return 'bg-amber-500 text-white'
    // KIRO PRO - 蓝色
    if (t.includes('PRO')) return 'bg-blue-500 text-white'
    // KIRO FREE - 灰色
    return 'bg-gray-500 text-white'
  }

  // 检测是否为封禁账号（通过 lastError 判断）
  const isBannedAccount = (acc: Account): boolean => {
    const lowerError = acc.lastError?.toLowerCase()
    if (!lowerError) return false
    const hasSuspendedSignal =
      lowerError.includes('accountsuspendedexception') ||
      lowerError.includes('account suspended') ||
      lowerError.includes('temporarily_suspended') ||
      lowerError.includes('temporarily suspended') ||
      (lowerError.includes('user id is') && lowerError.includes('suspended')) ||
      lowerError.includes('账户已封禁') ||
      lowerError.includes('已封禁') ||
      /\b423\b/.test(lowerError)
    if (hasSuspendedSignal) return true
    if (
      lowerError.includes('fetch failed') ||
      lowerError.includes('network') ||
      lowerError.includes('token expired') ||
      lowerError.includes('token 过期') ||
      lowerError.includes('刷新失败') ||
      lowerError.includes('unauthorizedexception')
    ) {
      return false
    }
    return false
  }

  const getStatusInfo = (
    acc: Account
  ): { icon: React.ReactNode; text: string; color: string } | null => {
    // 优先检测封禁状态
    if (isBannedAccount(acc)) {
      return {
        icon: <Ban className="h-3.5 w-3.5" />,
        text: isEn ? 'Banned' : '已封禁',
        color: 'bg-destructive/10 text-destructive'
      }
    }

    switch (acc.status) {
      case 'error':
        return {
          icon: <AlertCircle className="h-3.5 w-3.5" />,
          text: isEn ? 'Error' : '错误',
          color: 'bg-destructive/10 text-destructive'
        }
      case 'expired':
        return {
          icon: <Ban className="h-3.5 w-3.5" />,
          text: isEn ? 'Expired' : '已过期',
          color: 'bg-warning/10 text-warning'
        }
      case 'refreshing':
        return {
          icon: <Zap className="h-3.5 w-3.5" />,
          text: isEn ? 'Refreshing' : '刷新中',
          color: 'bg-warning/10 text-warning'
        }
      case 'active':
        return null // 正常状态不显示标签
      default:
        return null
    }
  }

  if (!open) return null

  return (
    <div className="ui-dialog-overlay">
      <div className="absolute inset-0" onClick={() => onOpenChange(false)} />
      <Card
        role="dialog"
        aria-modal="true"
        aria-label={isEn ? 'Select Account' : '选择账号'}
        className="ui-dialog-panel rounded-dialog max-w-[min(512px,calc(100vw-32px))]"
      >
        <CardHeader className="ui-dialog-header px-6 pt-5 pb-3">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-title font-semibold flex min-w-0 flex-wrap items-center gap-2">
              {isEn ? 'Select Account' : '选择账号'}
            </CardTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => onOpenChange(false)}
              title={isEn ? 'Close' : '关闭'}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={
                isEn ? 'Search by email, ID or subscription...' : '搜索邮箱、ID 或订阅类型...'
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 rounded-control text-body h-control"
            />
          </div>
        </CardHeader>
        <CardContent className="ui-dialog-body space-y-2 px-6 pt-0 pb-5">
          {/* 默认选项：第一个可用账号 */}
          <div
            className={`ui-list-row block cursor-pointer transition-colors hover:bg-muted ${
              !selectedAccountId ? 'bg-muted border-border-strong' : ''
            }`}
            onClick={() => handleSelect(undefined)}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-[8px] bg-muted flex items-center justify-center">
                  <Zap className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <div className="ui-list-title">{isEn ? 'First Available' : '第一个可用账号'}</div>
                  <div className="ui-list-description">
                    {isEn
                      ? 'Automatically use the first available account'
                      : '自动使用第一个可用的账号'}
                  </div>
                </div>
              </div>
              {!selectedAccountId && <Check className="h-4 w-4 text-primary" />}
            </div>
          </div>

          {/* 账号列表 */}
          {filteredAccounts.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {searchQuery
                ? isEn
                  ? 'No accounts found'
                  : '未找到匹配的账号'
                : isEn
                  ? 'No accounts available'
                  : '暂无可用账号'}
            </div>
          ) : (
            <VirtualRows
              items={filteredAccounts}
              estimateSize={152}
              maxHeight="50vh"
              renderRow={(acc) => {
                const isSelected = selectedAccountId === acc.id
                const usagePercent = getUsagePercent(acc)
                const usageText = getUsageText(acc)
                const statusInfo = getStatusInfo(acc)
                const isBanned = isBannedAccount(acc)
                const hasError = acc.status === 'error' || acc.status === 'expired' || isBanned

                return (
                  <div
                    key={acc.id}
                    className={`ui-list-row block cursor-pointer transition-colors hover:bg-muted ${
                      isSelected ? 'bg-muted border-border-strong' : ''
                    }  ${hasError ? 'opacity-60' : ''}`}
                    onClick={() => handleSelect(acc.id)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div
                          className={`w-8 h-8 rounded-[8px] flex items-center justify-center flex-shrink-0 ${
                            hasError ? 'bg-destructive/10' : 'bg-primary/10'
                          }`}
                        >
                          {hasError ? (
                            <AlertCircle className="h-5 w-5 text-destructive" />
                          ) : (
                            <User className="h-5 w-5 text-primary" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          {/* 邮箱 */}
                          <div className="flex flex-wrap items-center gap-2">
                            <Mail className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="ui-list-title min-w-0 truncate">
                              {acc.email || acc.id.substring(0, 12) + '...'}
                            </span>
                            {/* 状态标签 */}
                            {statusInfo && (
                              <Badge className={` ${statusInfo.color}`}>
                                {statusInfo.icon}
                                <span className="">{statusInfo.text}</span>
                              </Badge>
                            )}
                          </div>

                          {/* 错误信息 */}
                          {acc.lastError && (
                            <div className="text-caption text-destructive mt-1 truncate">
                              {acc.lastError}
                            </div>
                          )}

                          {/* 订阅类型和使用量 */}
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            <Badge className={` ${getSubscriptionColor(acc.subscription?.title)}`}>
                              <CreditCard className="h-3 w-3" />
                              {acc.subscription?.title || 'Unknown'}
                            </Badge>
                            <span className="text-caption text-muted-foreground">
                              {isEn ? 'Usage' : '使用量'}: {usageText}
                            </span>
                          </div>

                          {/* 使用量进度条 */}
                          <div className="mt-2 w-full bg-muted rounded-full h-1.5 overflow-hidden">
                            <div
                              className={`h-full transition-all ${
                                usagePercent > 80
                                  ? 'bg-destructive'
                                  : usagePercent > 50
                                    ? 'bg-warning'
                                    : 'bg-success'
                              }`}
                              style={{ width: `${usagePercent}%` }}
                            />
                          </div>

                          {/* ID */}
                          <div className="text-caption text-muted-foreground mt-1.5 font-mono">
                            ID: {acc.id.substring(0, 20)}...
                          </div>
                        </div>
                      </div>
                      {isSelected && <Check className="h-4 w-4 text-primary flex-shrink-0 mt-2" />}
                    </div>
                  </div>
                )
              }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

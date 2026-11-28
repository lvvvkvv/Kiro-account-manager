import type { Account as AccountType } from '@/types/account'
import { subscriptionConcurrency, type SubscriptionLink } from '../../../../shared/subscription'
import {
  checkUpgradeEligibility,
  isSubscribed,
  parseImportedLinks,
  type EligibilityReason
} from '@/subscription/helpers'
import {
  useSubscriptionStore,
  setSubscriptionLinks,
  setSubscriptionOverage,
  fetchSubscriptionLinks,
  regenerateSubscriptionLink,
  loadSubscriptionPlans,
  validateSubscriptionLinks,
  setAccountOverages,
  openSubscriptionPortals,
  openSubscriptionLinks,
  importSubscriptionLinks,
  cancelSubscriptionOperation
} from '@/subscription/runtime'
import { SubscriptionRows } from '../subscriptions/SubscriptionRows'
import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useAccountsStore } from '@/store/accounts'
import { Button, Card, CardContent } from '../ui'
import {
  CreditCard,
  ExternalLink,
  Copy,
  Download,
  Loader2,
  CheckCircle,
  XCircle,
  CheckSquare,
  Square,
  Minus,
  RefreshCw,
  Trash2,
  Zap,
  ShieldCheck,
  AlertTriangle,
  Ban,
  Upload,
  ListChecks,
  X
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageHeader } from '../layout/PageHeader'
import { useTranslation } from '@/hooks/useTranslation'

type SubTab = 'overage' | 'links' | 'manage'
export { appendSubscriptionLink, updateSubscriptionLink } from '@/subscription/runtime'

export function SubscriptionPage() {
  const { accounts, selectedIds, removeAccounts } = useAccountsStore()
  const { actualLanguage } = useTranslation()
  const isEn = actualLanguage === 'en'

  const {
    activeTab,
    links,
    isFetching,
    selectedLinkIds,
    quickPickCount,
    quickPickCursor,
    availablePlans,
    selectedPlanType,
    isLoadingPlans,
    overageItems,
    isSettingOverage,
    isValidatingLinks,
    isBatchOpening,
    concurrency
  } = useSubscriptionStore()
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [deleteAlsoAccount, setDeleteAlsoAccount] = useState(false)
  const overageListRef = useRef<HTMLDivElement>(null)
  const setActiveTab = (activeTab: SubTab): void => useSubscriptionStore.setState({ activeTab })
  const setLinks = setSubscriptionLinks
  const setOverageItems = setSubscriptionOverage
  const setSelectedPlanType = (selectedPlanType: string): void =>
    useSubscriptionStore.setState({ selectedPlanType })
  const setConcurrency = (value: number): void =>
    useSubscriptionStore.setState({ concurrency: subscriptionConcurrency(value) })
  const setQuickPickCount = (quickPickCount: number): void =>
    useSubscriptionStore.setState({ quickPickCount })
  const setQuickPickCursor = (quickPickCursor: number): void =>
    useSubscriptionStore.setState({ quickPickCursor })
  const setSelectedLinkIds = (value: Set<string> | ((ids: Set<string>) => Set<string>)): void => {
    useSubscriptionStore.setState((state) => ({
      selectedLinkIds: typeof value === 'function' ? value(state.selectedLinkIds) : value
    }))
  }
  const sourceAccounts = useMemo(
    () =>
      selectedIds.size
        ? Array.from(selectedIds).flatMap((id) => {
            const account = accounts.get(id)
            return account ? [account] : []
          })
        : Array.from(accounts.values()),
    [accounts, selectedIds]
  )
  // 超额列表自动滚动到底部
  useEffect(() => {
    const el = overageListRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [overageItems])

  const preflightReport = useMemo(() => {
    const eligible: AccountType[] = []
    const blocked: Array<{ account: AccountType; reason: EligibilityReason; detail?: string }> = []
    const reasonBuckets: Record<EligibilityReason, number> = {
      ok: 0,
      'no-token': 0,
      'already-pro': 0,
      banned: 0,
      'cant-upgrade': 0,
      'unknown-status': 0
    }
    for (const account of sourceAccounts) {
      const result = checkUpgradeEligibility(account)
      if (result.eligible) eligible.push(account)
      else blocked.push({ account, reason: result.reason, detail: result.detail })
      reasonBuckets[result.reason]++
    }
    return { eligible, blocked, reasonBuckets, totalScanned: sourceAccounts.length }
  }, [sourceAccounts])
  const getUpgradeableAccounts = (): AccountType[] => preflightReport.eligible
  const subscribedAccounts = useMemo(
    () =>
      sourceAccounts.filter((account) => account.credentials?.accessToken && isSubscribed(account)),
    [sourceAccounts]
  )
  const overageableAccounts = useMemo(
    () =>
      subscribedAccounts.filter(
        (account) =>
          account.subscription?.overageCapability === 'OVERAGE_CAPABLE' &&
          account.usage?.resourceDetail?.overageEnabled !== true
      ),
    [subscribedAccounts]
  )
  // 加载可用订阅计划（用任一可用账户调用）
  const handleLoadPlans = async (): Promise<void> => {
    await loadSubscriptionPlans(
      getUpgradeableAccounts(),
      isEn ? 'Load subscription plans' : '加载订阅计划'
    )
  }

  // 并发数

  // 删除失败链接时是否同时删除账号本身（封号账号清理）

  // 批量并发获取订阅链接
  const handleBatchFetch = async (): Promise<void> => {
    await fetchSubscriptionLinks(
      getUpgradeableAccounts(),
      selectedPlanType,
      concurrency,
      isEn ? 'Get subscription links' : '批量获取订阅链接'
    )
  }

  // 选择/取消选择链接（允许任意状态）
  const toggleLinkSelection = (accountId: string) => {
    setSelectedLinkIds((prev) => {
      const next = new Set(prev)
      if (next.has(accountId)) {
        next.delete(accountId)
      } else {
        next.add(accountId)
      }
      return next
    })
  }

  // 全选 / 取消全选当前列表所有链接（不再限制只能选 success）
  const toggleSelectAll = () => {
    if (selectedLinkIds.size === links.length && links.length > 0) {
      setSelectedLinkIds(new Set())
    } else {
      setSelectedLinkIds(new Set(links.map((l) => l.accountId)))
    }
  }

  // 反选
  const invertSelection = () => {
    setSelectedLinkIds((prev) => {
      const next = new Set<string>()
      for (const l of links) {
        if (!prev.has(l.accountId)) next.add(l.accountId)
      }
      return next
    })
  }

  // 取消多选（清空选择）
  const clearSelection = () => {
    setSelectedLinkIds(new Set())
  }

  // 按状态选择：把指定状态的链接加入到当前选择集（保留已有选择）
  const selectByStatus = (status: SubscriptionLink['status']) => {
    setSelectedLinkIds((prev) => {
      const next = new Set(prev)
      for (const l of links) {
        if (l.status === status) next.add(l.accountId)
      }
      return next
    })
  }

  // 快选：从顶部开始选中前 N 个可用（success）链接，便于分批打开
  const quickPickTop = () => {
    const successList = links.filter((l) => l.status === 'success' && l.url)
    const n = Math.max(1, quickPickCount)
    const picked = successList.slice(0, n)
    setSelectedLinkIds(new Set(picked.map((l) => l.accountId)))
    setQuickPickCursor(picked.length)
  }

  // 快选下一批：从上次游标继续选 N 个可用链接，到末尾后循环回到开头
  const quickPickNext = () => {
    const successList = links.filter((l) => l.status === 'success' && l.url)
    if (successList.length === 0) return
    const n = Math.max(1, quickPickCount)
    let start = quickPickCursor
    if (start >= successList.length) start = 0
    const picked = successList.slice(start, start + n)
    setSelectedLinkIds(new Set(picked.map((l) => l.accountId)))
    setQuickPickCursor(start + picked.length)
  }

  // 批量导入外部链接：解析后以 success 状态追加进列表（按 url 去重），即可与现有链接一样多选/打开/导出
  const handleImportLinks = (text: string): number => importSubscriptionLinks(text, isEn)

  // 批量删除选中的链接（从结果列表中移除，不会调用任何 API）
  const handleBatchDelete = () => {
    if (selectedLinkIds.size === 0) return
    if (
      !confirm(
        isEn
          ? `Remove ${selectedLinkIds.size} selected links from the list?`
          : `从列表移除选中的 ${selectedLinkIds.size} 个链接？`
      )
    )
      return
    setLinks((prev) => prev.filter((l) => !selectedLinkIds.has(l.accountId)))
    setSelectedLinkIds(new Set())
  }

  // 批量删除"失败 + 过期"：清理无效项，保留可用链接；勾选 deleteAlsoAccount 时连带删除账号
  const handleDeleteFailed = () => {
    const failedLinks = links.filter((l) => l.status === 'error' || l.status === 'expired')
    const count = failedLinks.length
    if (count === 0) return
    const confirmMsg = deleteAlsoAccount
      ? isEn
        ? `Remove ${count} failed/expired links AND delete their accounts permanently?`
        : `移除 ${count} 个失败/过期的链接，并永久删除这些账号？`
      : isEn
        ? `Remove ${count} failed/expired links?`
        : `移除 ${count} 个失败/过期的链接？`
    if (!confirm(confirmMsg)) return

    const removedIds = failedLinks.map((l) => l.accountId)

    // 连带删除账号（封号账号清理）
    if (deleteAlsoAccount && removedIds.length > 0) {
      removeAccounts(removedIds)
    }

    setLinks((prev) => {
      const filtered = prev.filter((l) => l.status !== 'error' && l.status !== 'expired')
      if (removedIds.length > 0) {
        setSelectedLinkIds((s) => {
          const next = new Set(s)
          for (const id of removedIds) next.delete(id)
          return next
        })
      }
      return filtered
    })
  }

  // 获取目标链接列表（选中的或全部成功的）
  const getTargetLinks = (mode: 'selected' | 'all'): SubscriptionLink[] => {
    const successLinks = links.filter((l) => l.status === 'success' && l.url)
    if (mode === 'selected') {
      return successLinks.filter((l) => selectedLinkIds.has(l.accountId))
    }
    return successLinks
  }

  // 打开单个链接
  const handleOpenLink = async (url: string) => {
    const result = await window.api.openSubscriptionWindow(url)
    if (!result.success) alert(result.error || (isEn ? 'Failed to open URL' : '打开链接失败'))
  }

  // 重新生成单个链接（链接过期时调用）
  const handleRegenerateLink = async (accountId: string): Promise<void> => {
    if (!selectedPlanType) {
      alert(isEn ? 'Please select a plan first' : '请先选择计划')
      return
    }
    await regenerateSubscriptionLink(
      accountId,
      selectedPlanType,
      isEn ? 'Regenerate subscription link' : '重新生成订阅链接'
    )
  }

  // 检测所有链接有效性：基于生成时间 + 真实 HTTP HEAD 探测（C5）

  const handleValidateLinks = async (): Promise<void> => {
    await validateSubscriptionLinks(
      concurrency,
      isEn ? 'Validate subscription links' : '检测订阅链接'
    )
  }

  // 批量打开链接（全部同时打开）
  const handleBatchOpen = async (mode: 'selected' | 'all'): Promise<void> => {
    await openSubscriptionLinks(
      getTargetLinks(mode),
      concurrency,
      isEn ? 'Open subscription links' : '批量打开订阅链接'
    )
  }

  // 复制单个链接
  const handleCopyLink = async (url: string) => {
    await navigator.clipboard.writeText(url)
  }

  // 导出链接
  const handleExport = async (mode: 'selected' | 'all') => {
    const targetLinks = getTargetLinks(mode)
    const text = targetLinks.map((l) => l.url).join('\n')
    await navigator.clipboard.writeText(text)
  }

  // ===== 一键超额功能 =====
  // 获取可设置超额的账号（仅未开启）：已订阅（非 Free）、有 token、超额能力可用、超额未开启
  const getOverageableAccounts = () => overageableAccounts

  // 获取所有已订阅账号（不限制超额能力，不限制是否已开启）
  const getAllSubscribedAccounts = () => subscribedAccounts

  const handleBatchSetOverage = async (customTargets?: AccountType[]): Promise<void> => {
    await setAccountOverages(
      customTargets ?? getOverageableAccounts(),
      true,
      concurrency,
      isEn ? 'Enable overage' : '批量开启超额'
    )
  }

  const overageableCount = getOverageableAccounts().length
  const allSubscribedCount = getAllSubscribedAccounts().length
  const overageSuccessCount = overageItems.filter((i) => i.status === 'success').length
  const overageErrorCount = overageItems.filter((i) => i.status === 'error').length

  const successCount = links.filter((l) => l.status === 'success').length
  const errorCount = links.filter((l) => l.status === 'error').length
  const selectedCount = selectedLinkIds.size
  const upgradeableCount = getUpgradeableAccounts().length

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <PageHeader icon={<CreditCard />} title={isEn ? 'Batch Subscription' : '批量订阅'} />
      {(isFetching ||
        isValidatingLinks ||
        isSettingOverage ||
        isBatchOpening ||
        isLoadingPlans) && (
        <div className="px-6 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              ['links', 'validation', 'overage', 'opening', 'plans'].forEach(
                cancelSubscriptionOperation
              )
            }
          >
            {isEn ? 'Stop current tasks' : '停止当前任务'}
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-7 overflow-auto px-6 pb-6 pt-4">
        <p className="text-body text-muted-foreground">
          {selectedIds.size > 0
            ? isEn
              ? `Using ${selectedIds.size} selected accounts`
              : `使用已选中的 ${selectedIds.size} 个账户`
            : isEn
              ? 'Using all accounts'
              : '使用全部账户'}
        </p>

        {/* 内部 Tab 切换 */}
        <div
          className="ui-segmented max-w-full overflow-x-auto"
          role="group"
          aria-label={isEn ? 'Subscription workflow' : '订阅工作流'}
        >
          <button
            onClick={() => setActiveTab('overage')}
            aria-pressed={activeTab === 'overage'}
            className="shrink-0"
          >
            <Zap className="h-4 w-4" />
            {isEn ? 'Overage Settings' : '超额设置'}
          </button>
          <button
            onClick={() => setActiveTab('links')}
            aria-pressed={activeTab === 'links'}
            className="shrink-0"
          >
            <CreditCard className="h-4 w-4" />
            {isEn ? 'Subscription Links' : '获取链接'}
          </button>
          <button
            onClick={() => setActiveTab('manage')}
            aria-pressed={activeTab === 'manage'}
            className="shrink-0"
          >
            <ShieldCheck className="h-4 w-4" />
            {isEn ? 'Manage Subscriptions' : '订阅管理'}
          </button>
        </div>

        {/* ===== 超额设置 Tab ===== */}
        {activeTab === 'overage' && (
          <>
            {/* 操作栏 */}
            <Card>
              <CardContent className="p-4 flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  onClick={() => handleBatchSetOverage()}
                  disabled={isSettingOverage || overageableCount === 0}
                >
                  {isSettingOverage ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4" />
                  )}
                  {isEn ? `Enable Overage (${overageableCount})` : `一键超额 (${overageableCount})`}
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleBatchSetOverage(getAllSubscribedAccounts())}
                  disabled={isSettingOverage || allSubscribedCount === 0}
                >
                  {isSettingOverage ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4" />
                  )}
                  {isEn ? `Set All (${allSubscribedCount})` : `全部设置 (${allSubscribedCount})`}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setOverageItems([])}
                  disabled={isSettingOverage || overageItems.length === 0}
                >
                  <Trash2 className="h-4 w-4" />
                  {isEn ? 'Clear' : '清空'}
                </Button>

                {/* 仅删除失败项（保留成功结果便于审计） */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setOverageItems((prev) => prev.filter((it) => it.status !== 'error'))
                  }
                  disabled={isSettingOverage || overageErrorCount === 0}
                  title={isEn ? 'Remove failed items only' : '仅移除失败项'}
                >
                  <XCircle className="h-4 w-4" />
                  {isEn ? `Clear Failed (${overageErrorCount})` : `清失败 (${overageErrorCount})`}
                </Button>

                {/* 并发数控制 */}
                <div className="flex items-center gap-2 text-caption">
                  <span className="text-muted-foreground">{isEn ? 'Concurrency:' : '并发:'}</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={concurrency}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10)
                      if (val > 0) setConcurrency(val)
                    }}
                    disabled={isSettingOverage}
                    className="h-control w-14 border border-border bg-background text-center rounded-control px-2.5 text-body focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring py-0"
                  />
                </div>

                <span className="text-caption text-muted-foreground ml-2">
                  {overageableCount > 0
                    ? isEn
                      ? `${overageableCount} subscribed accounts without overage enabled`
                      : `${overageableCount} 个已订阅账号未开启超额`
                    : isEn
                      ? 'No accounts need overage enablement'
                      : '没有需要开启超额的账号'}
                </span>

                {/* 统计 */}
                {overageItems.length > 0 && (
                  <div className="ml-auto flex items-center gap-3 text-caption text-muted-foreground">
                    {overageSuccessCount > 0 && (
                      <span className="flex items-center gap-2 text-success-text">
                        <CheckCircle className="h-3 w-3" /> {overageSuccessCount}
                      </span>
                    )}
                    {overageErrorCount > 0 && (
                      <span className="flex items-center gap-2 text-danger-text">
                        <XCircle className="h-3 w-3" /> {overageErrorCount}
                      </span>
                    )}
                    {isSettingOverage && (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {
                          overageItems.filter(
                            (i) => i.status === 'pending' || i.status === 'loading'
                          ).length
                        }
                      </span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 超额结果列表 */}
            {overageItems.length > 0 && (
              <Card>
                <CardContent className="p-0 overflow-x-auto [&>div]:min-w-[640px]">
                  {/* 表头 */}
                  <div className="flex items-center gap-3 py-2 px-2.5 border-b text-caption font-medium text-muted-foreground">
                    <span className="shrink-0 w-8 text-center">#</span>
                    <span className="min-w-0 flex-1">{isEn ? 'Email' : '邮箱'}</span>
                    <span className="shrink-0 w-20 text-center">{isEn ? 'Status' : '状态'}</span>
                    <span className="flex-1 text-right">{isEn ? 'Details' : '详情'}</span>
                  </div>

                  {/* 列表 */}
                  <div className="max-h-[60vh] overflow-y-auto">
                    <SubscriptionRows
                      items={overageItems}
                      scrollRef={overageListRef}
                      renderRow={(item, idx) => (
                        <div
                          key={item.accountId}
                          className="flex items-center gap-3 py-[9px] px-2.5 border-b last:border-b-0 hover:bg-muted/50 transition-colors"
                        >
                          <span className="shrink-0 w-8 text-center text-caption text-muted-foreground">
                            {idx + 1}
                          </span>
                          <span className="min-w-0 flex-1 text-caption truncate" title={item.email}>
                            {item.email}
                          </span>
                          <span className="shrink-0 w-20 flex justify-center">
                            {item.status === 'pending' && (
                              <span className="text-caption text-muted-foreground">
                                {isEn ? 'Pending' : '等待中'}
                              </span>
                            )}
                            {item.status === 'cancelled' && (
                              <span className="text-caption text-muted-foreground">
                                {isEn ? 'Cancelled' : '已取消'}
                              </span>
                            )}
                            {item.status === 'loading' && (
                              <Loader2 className="h-4 w-4 animate-spin text-text-secondary" />
                            )}
                            {item.status === 'success' && (
                              <CheckCircle className="h-4 w-4 text-success-text" />
                            )}
                            {item.status === 'error' && (
                              <XCircle className="h-4 w-4 text-danger-text" />
                            )}
                            {item.status === 'skipped' && (
                              <span className="text-caption text-muted-foreground">
                                {isEn ? 'Skipped' : '跳过'}
                              </span>
                            )}
                          </span>
                          <span className="flex-1 text-right text-caption truncate">
                            {item.status === 'success' && (
                              <span className="text-success-text">
                                {isEn ? 'Overage enabled' : '超额已开启'}
                              </span>
                            )}
                            {item.status === 'error' && (
                              <span className="text-danger-text" title={item.error}>
                                {item.error}
                              </span>
                            )}
                          </span>
                        </div>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 账号超额状态总览（未执行批量操作时显示） */}
            {overageItems.length === 0 && (
              <Card>
                <CardContent className="p-0 overflow-x-auto [&>div]:min-w-[640px]">
                  <div className="flex items-center gap-3 py-2 px-2.5 border-b text-caption font-medium text-muted-foreground">
                    <span className="shrink-0 w-8 text-center">#</span>
                    <span className="min-w-0 flex-1">{isEn ? 'Email' : '邮箱'}</span>
                    <span className="shrink-0 w-24 text-center">
                      {isEn ? 'Subscription' : '订阅类型'}
                    </span>
                    <span className="shrink-0 w-24 text-center">
                      {isEn ? 'Overage Capable' : '超额能力'}
                    </span>
                    <span className="shrink-0 w-24 text-center">
                      {isEn ? 'Overage Status' : '超额状态'}
                    </span>
                  </div>
                  {allSubscribedCount > 0 ? (
                    <div className="max-h-[60vh] overflow-y-auto">
                      <SubscriptionRows
                        items={getAllSubscribedAccounts()}
                        renderRow={(acc, idx) => {
                          if (!acc) return null
                          const capable = acc.subscription?.overageCapability === 'OVERAGE_CAPABLE'
                          const enabled = acc.usage?.resourceDetail?.overageEnabled === true
                          return (
                            <div
                              key={acc.id}
                              className="flex items-center gap-3 py-[9px] px-2.5 border-b last:border-b-0 hover:bg-muted/50 transition-colors"
                            >
                              <span className="shrink-0 w-8 text-center text-caption text-muted-foreground">
                                {idx + 1}
                              </span>
                              <span
                                className="min-w-0 flex-1 text-caption truncate"
                                title={acc.email}
                              >
                                {acc.email}
                              </span>
                              <span className="shrink-0 w-24 text-center text-caption">
                                {acc.subscription?.title || acc.subscription?.type || '-'}
                              </span>
                              <span className="shrink-0 w-24 flex justify-center">
                                {capable ? (
                                  <CheckCircle className="h-4 w-4 text-success-text" />
                                ) : (
                                  <XCircle className="h-4 w-4 text-muted-foreground/40" />
                                )}
                              </span>
                              <span className="shrink-0 w-24 flex justify-center">
                                {enabled ? (
                                  <span className="text-caption text-success-text font-medium">
                                    {isEn ? 'ENABLED' : '已开启'}
                                  </span>
                                ) : capable ? (
                                  <span className="text-caption text-warning-text font-medium">
                                    {isEn ? 'DISABLED' : '未开启'}
                                  </span>
                                ) : (
                                  <span className="text-caption text-muted-foreground">-</span>
                                )}
                              </span>
                            </div>
                          )
                        }}
                      />
                    </div>
                  ) : (
                    <div className="py-12 text-center text-muted-foreground">
                      <Zap className="h-12 w-12 mx-auto mb-3 opacity-30" />
                      <p className="text-body">
                        {isEn
                          ? 'No subscribed accounts found. Ensure accounts are checked first.'
                          : '未找到已订阅账号。请先检测账号状态。'}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* ===== 订阅管理 Tab ===== */}
        {activeTab === 'manage' && (
          <ManageSubscriptionsTab
            subscribed={subscribedAccounts}
            concurrency={concurrency}
            isEn={isEn}
          />
        )}

        {/* ===== 获取链接 Tab ===== */}
        {activeTab === 'links' && (
          <>
            {/* 预检面板：展示可升级 / 阻塞原因 */}
            {preflightReport.totalScanned > 0 && (
              <Card
                className={cn(
                  preflightReport.eligible.length === 0 && 'border-warning/20 bg-warning-soft'
                )}
              >
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <span className="text-body font-medium">
                      {isEn ? 'Pre-flight Check' : '升级预检'}
                    </span>
                    <span className="text-caption text-muted-foreground">
                      {isEn
                        ? `Scanned ${preflightReport.totalScanned} accounts: ${preflightReport.eligible.length} eligible, ${preflightReport.blocked.length} blocked`
                        : `扫描 ${preflightReport.totalScanned} 个账号：${preflightReport.eligible.length} 可升级，${preflightReport.blocked.length} 不可升级`}
                    </span>
                  </div>

                  {/* 阻塞分类徽章 */}
                  {preflightReport.blocked.length > 0 && (
                    <div className="flex flex-wrap gap-2 text-caption">
                      {preflightReport.reasonBuckets['already-pro'] > 0 && (
                        <span className="inline-flex h-5 items-center px-[7px] rounded-full text-badge font-medium bg-success-soft text-success-text gap-2">
                          <CheckCircle className="h-2.5 w-2.5" />
                          {isEn
                            ? `Already subscribed: ${preflightReport.reasonBuckets['already-pro']}`
                            : `已订阅 ${preflightReport.reasonBuckets['already-pro']}`}
                        </span>
                      )}
                      {preflightReport.reasonBuckets['no-token'] > 0 && (
                        <span className="inline-flex h-5 items-center px-[7px] rounded-full text-badge font-medium bg-muted text-muted-foreground gap-2">
                          <XCircle className="h-2.5 w-2.5" />
                          {isEn
                            ? `No token: ${preflightReport.reasonBuckets['no-token']}`
                            : `无 Token ${preflightReport.reasonBuckets['no-token']}`}
                        </span>
                      )}
                      {preflightReport.reasonBuckets['banned'] > 0 && (
                        <span className="inline-flex h-5 items-center px-[7px] rounded-full text-badge font-medium bg-danger-soft text-danger-text gap-2">
                          <Ban className="h-2.5 w-2.5" />
                          {isEn
                            ? `Banned: ${preflightReport.reasonBuckets['banned']}`
                            : `已封禁 ${preflightReport.reasonBuckets['banned']}`}
                        </span>
                      )}
                      {preflightReport.reasonBuckets['cant-upgrade'] > 0 && (
                        <span className="inline-flex h-5 items-center px-[7px] rounded-full text-badge font-medium bg-warning-soft text-warning-text gap-2">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          {isEn
                            ? `Can't upgrade: ${preflightReport.reasonBuckets['cant-upgrade']}`
                            : `不可升级 ${preflightReport.reasonBuckets['cant-upgrade']}`}
                        </span>
                      )}
                      {preflightReport.reasonBuckets['unknown-status'] > 0 && (
                        <span className="inline-flex h-5 items-center px-[7px] rounded-full text-badge font-medium bg-muted text-text-secondary gap-2">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          {isEn
                            ? `Unknown status: ${preflightReport.reasonBuckets['unknown-status']}`
                            : `状态未知 ${preflightReport.reasonBuckets['unknown-status']}`}
                        </span>
                      )}
                    </div>
                  )}

                  {preflightReport.eligible.length === 0 && preflightReport.totalScanned > 0 && (
                    <p className="text-caption text-warning-text">
                      {isEn
                        ? 'No eligible accounts. Run "Check Accounts" on the accounts page first to get latest status.'
                        : '无可升级账号。建议先在账户管理页"批量检查"获取最新状态。'}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* 计划选择 */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLoadPlans}
                    disabled={isLoadingPlans || upgradeableCount === 0}
                  >
                    {isLoadingPlans ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    {isEn ? 'Load Plans' : '加载计划'}
                  </Button>
                  <span className="text-caption text-muted-foreground">
                    {availablePlans.length > 0
                      ? isEn
                        ? `${availablePlans.length} plans available`
                        : `已加载 ${availablePlans.length} 个计划`
                      : isEn
                        ? 'Click to load available subscription plans'
                        : '点击加载可用订阅计划'}
                  </span>
                </div>

                {availablePlans.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {availablePlans.map((plan) => (
                      <button
                        key={plan.qSubscriptionType}
                        onClick={() => setSelectedPlanType(plan.qSubscriptionType)}
                        className={cn(
                          'inline-flex min-h-[58px] flex-col items-start justify-center gap-0.5 rounded-panel border px-3 py-2 text-body font-medium transition-colors',
                          selectedPlanType === plan.qSubscriptionType
                            ? 'border-border-strong bg-accent text-foreground'
                            : 'border-border hover:border-primary/50'
                        )}
                      >
                        <div>{plan.description.title || plan.name}</div>
                        <div className="text-caption opacity-70">
                          ${plan.pricing.amount / 100}/{plan.description.billingInterval}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 操作栏 */}
            <Card>
              <CardContent className="p-4 flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  onClick={handleBatchFetch}
                  disabled={isFetching || upgradeableCount === 0 || !selectedPlanType}
                >
                  {isFetching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CreditCard className="h-4 w-4" />
                  )}
                  {isEn ? `Fetch Links (${upgradeableCount})` : `获取链接 (${upgradeableCount})`}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setLinks([])
                    setSelectedLinkIds(new Set())
                  }}
                  disabled={isFetching || links.length === 0}
                  title={isEn ? 'Clear results' : '清空结果'}
                >
                  <Trash2 className="h-4 w-4" />
                  {isEn ? 'Clear' : '清空'}
                </Button>

                {/* 批量导入外部链接 */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowImportDialog(true)}
                  disabled={isFetching}
                  title={
                    isEn
                      ? 'Import links from text (one per line)'
                      : '从文本批量导入链接（每行一个）'
                  }
                >
                  <Upload className="h-4 w-4" />
                  {isEn ? 'Import' : '导入链接'}
                </Button>

                {/* 检测链接有效性 */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleValidateLinks}
                  disabled={
                    isFetching ||
                    isValidatingLinks ||
                    links.filter((l) => l.status === 'success').length === 0
                  }
                  title={
                    isEn ? 'Detect expired links (>15min old)' : '检测过期链接（生成超过 15 分钟）'
                  }
                >
                  {isValidatingLinks ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {isEn ? 'Validate' : '检测有效性'}
                </Button>

                {/* 删除失败/过期 — 始终显示 */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDeleteFailed}
                  disabled={
                    isFetching ||
                    links.filter((l) => l.status === 'error' || l.status === 'expired').length === 0
                  }
                  title={isEn ? 'Remove failed and expired links' : '移除失败和过期的链接'}
                  className={
                    deleteAlsoAccount
                      ? 'text-destructive hover:text-destructive hover:bg-destructive/10'
                      : ''
                  }
                >
                  <Trash2 className="h-4 w-4" />
                  {isEn ? 'Remove Failed' : '清失败'} (
                  {links.filter((l) => l.status === 'error' || l.status === 'expired').length})
                </Button>
                {/* 勾选：清失败时同时删除账号 */}
                <label
                  className="inline-flex items-center gap-2 text-caption text-muted-foreground cursor-pointer select-none"
                  title={
                    isEn
                      ? 'Also permanently delete the accounts (for banned accounts cleanup)'
                      : '同时永久删除这些账号（用于清理封号账号）'
                  }
                >
                  <input
                    type="checkbox"
                    checked={deleteAlsoAccount}
                    onChange={(e) => setDeleteAlsoAccount(e.target.checked)}
                    className="h-4 w-4 shrink-0"
                  />
                  {isEn ? 'Delete accounts' : '连删账号'}
                </label>

                {/* 多选辅助操作（仅有结果时显示） */}
                {links.length > 0 && (
                  <>
                    <div className="w-px h-6 bg-border" />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={invertSelection}
                      disabled={isFetching}
                      title={isEn ? 'Invert selection' : '反选'}
                    >
                      <Minus className="h-4 w-4" />
                      {isEn ? 'Invert' : '反选'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearSelection}
                      disabled={isFetching || selectedLinkIds.size === 0}
                      title={isEn ? 'Clear selection' : '取消多选'}
                    >
                      <Square className="h-4 w-4" />
                      {isEn ? 'Deselect' : '取消多选'}
                    </Button>

                    {/* 快选：从顶部按数量分批选择可用链接 */}
                    <div className="inline-flex flex-wrap items-center gap-2 rounded-control border border-border px-2 py-1">
                      <ListChecks className="h-4 w-4 text-muted-foreground" />
                      <span className="text-caption text-muted-foreground">
                        {isEn ? 'Quick pick' : '快选'}
                      </span>
                      <input
                        type="number"
                        min={1}
                        value={quickPickCount}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10)
                          if (v > 0) setQuickPickCount(v)
                        }}
                        disabled={isFetching}
                        className="h-control w-12 border border-border bg-background text-center rounded-control px-2.5 text-body focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring py-0"
                        title={isEn ? 'Number of links to pick' : '快选数量'}
                      />
                      <button
                        onClick={quickPickTop}
                        disabled={isFetching || successCount === 0}
                        className="text-body font-medium inline-flex h-7 items-center px-3 rounded-control hover:bg-primary/15 text-primary disabled:opacity-40"
                        title={
                          isEn
                            ? `Select top ${quickPickCount} available links`
                            : `从顶部选中前 ${quickPickCount} 个可用链接`
                        }
                      >
                        {isEn ? 'Top' : '前N个'}
                      </button>
                      <button
                        onClick={quickPickNext}
                        disabled={isFetching || successCount === 0}
                        className="text-body font-medium inline-flex h-7 items-center px-3 rounded-control hover:bg-primary/15 text-primary disabled:opacity-40"
                        title={
                          isEn
                            ? 'Select next batch (continue from last pick)'
                            : '选中下一批（从上次位置继续）'
                        }
                      >
                        {isEn ? 'Next' : '下一批'}
                      </button>
                    </div>

                    {/* 按状态快速选择 */}
                    <div className="relative inline-flex flex-wrap items-center gap-2 rounded-control border border-border px-2 py-1">
                      <span className="text-caption text-muted-foreground">
                        {isEn ? 'Pick:' : '选择:'}
                      </span>
                      <button
                        className="text-body font-medium inline-flex h-7 items-center px-3 rounded-control hover:bg-success-soft text-success-text"
                        onClick={() => selectByStatus('success')}
                        disabled={isFetching}
                        title={isEn ? 'Add all "Success" to selection' : '把"成功"项加入选择'}
                      >
                        ✓ {isEn ? 'Success' : '成功'} (
                        {links.filter((l) => l.status === 'success').length})
                      </button>
                      <button
                        className="text-body font-medium inline-flex h-7 items-center px-3 rounded-control hover:bg-warning-soft text-warning-text"
                        onClick={() => selectByStatus('expired')}
                        disabled={isFetching}
                        title={isEn ? 'Add all "Expired" to selection' : '把"过期"项加入选择'}
                      >
                        ⚠ {isEn ? 'Expired' : '过期'} (
                        {links.filter((l) => l.status === 'expired').length})
                      </button>
                      <button
                        className="text-body font-medium inline-flex h-7 items-center px-3 rounded-control hover:bg-danger-soft text-danger-text"
                        onClick={() => selectByStatus('error')}
                        disabled={isFetching}
                        title={isEn ? 'Add all "Error" to selection' : '把"失败"项加入选择'}
                      >
                        ✗ {isEn ? 'Error' : '失败'} (
                        {links.filter((l) => l.status === 'error').length})
                      </button>
                    </div>

                    {/* 批量删除选中 */}
                    {selectedLinkIds.size > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleBatchDelete}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        title={
                          isEn
                            ? `Delete ${selectedLinkIds.size} selected links`
                            : `删除选中的 ${selectedLinkIds.size} 个链接`
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                        {isEn
                          ? `Delete Selected (${selectedLinkIds.size})`
                          : `删除选中 (${selectedLinkIds.size})`}
                      </Button>
                    )}
                  </>
                )}

                {/* 并发数控制 */}
                <div className="flex items-center gap-2 text-caption">
                  <span className="text-muted-foreground">{isEn ? 'Concurrency:' : '并发:'}</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={concurrency}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10)
                      if (val > 0) setConcurrency(val)
                    }}
                    disabled={isFetching}
                    className="h-control w-14 border border-border bg-background text-center rounded-control px-2.5 text-body focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring py-0"
                  />
                </div>

                <div className="w-px h-6 bg-border" />

                {successCount > 0 && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleBatchOpen('selected')}
                      disabled={selectedCount === 0}
                      title={isEn ? 'Open selected in incognito' : '无痕打开选中链接'}
                    >
                      <ExternalLink className="h-4 w-4" />
                      {isEn ? `Open Selected (${selectedCount})` : `打开选中 (${selectedCount})`}
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleBatchOpen('all')}
                      title={isEn ? 'Open all in incognito' : '无痕打开全部链接'}
                    >
                      <ExternalLink className="h-4 w-4" />
                      {isEn ? `Open All (${successCount})` : `全部打开 (${successCount})`}
                    </Button>

                    <div className="w-px h-6 bg-border" />

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleExport('selected')}
                      disabled={selectedCount === 0}
                      title={isEn ? 'Copy selected links' : '复制选中链接'}
                    >
                      <Copy className="h-4 w-4" />
                      {isEn ? `Export Selected (${selectedCount})` : `导出选中 (${selectedCount})`}
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleExport('all')}
                      title={isEn ? 'Copy all links' : '复制全部链接'}
                    >
                      <Download className="h-4 w-4" />
                      {isEn ? `Export All (${successCount})` : `全部导出 (${successCount})`}
                    </Button>
                  </>
                )}

                {/* 统计 */}
                {links.length > 0 && (
                  <div className="ml-auto flex items-center gap-3 text-caption text-muted-foreground">
                    {successCount > 0 && (
                      <span className="flex items-center gap-2 text-success-text">
                        <CheckCircle className="h-3 w-3" /> {successCount}
                      </span>
                    )}
                    {errorCount > 0 && (
                      <span className="flex items-center gap-2 text-danger-text">
                        <XCircle className="h-3 w-3" /> {errorCount}
                      </span>
                    )}
                    {isFetching && (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {
                          links.filter((l) => l.status === 'pending' || l.status === 'loading')
                            .length
                        }
                      </span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 链接列表 */}
            {links.length > 0 && (
              <Card>
                <CardContent className="p-0 overflow-x-auto [&>div]:min-w-[640px]">
                  {/* 表头 */}
                  <div className="flex items-center gap-3 py-2 px-2.5 border-b text-caption font-medium text-muted-foreground">
                    <button
                      onClick={toggleSelectAll}
                      className="flex-shrink-0"
                      disabled={links.length === 0}
                      title={
                        selectedLinkIds.size === links.length && links.length > 0
                          ? isEn
                            ? 'Deselect all'
                            : '取消全选'
                          : isEn
                            ? 'Select all'
                            : '全选'
                      }
                    >
                      {selectedLinkIds.size === links.length && links.length > 0 ? (
                        <CheckSquare className="h-4 w-4 text-primary" />
                      ) : selectedLinkIds.size > 0 ? (
                        <Minus className="h-4 w-4 text-primary" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>
                    <span className="shrink-0 w-8 text-center">#</span>
                    <span className="min-w-0 flex-1">{isEn ? 'Email' : '邮箱'}</span>
                    <span className="shrink-0 w-20 text-center">{isEn ? 'Status' : '状态'}</span>
                    <span className="w-28 shrink-0 text-center">{isEn ? 'Actions' : '操作'}</span>
                  </div>

                  {/* 列表 */}
                  <div className="max-h-[60vh] overflow-y-auto">
                    <SubscriptionRows
                      items={links}
                      renderRow={(link, idx) => (
                        <div
                          key={link.accountId}
                          className={cn(
                            'flex items-center gap-3 py-[9px] px-2.5 border-b last:border-b-0 hover:bg-muted/50 transition-colors',
                            selectedLinkIds.has(link.accountId) && 'bg-accent'
                          )}
                        >
                          {/* 选择框 — 任何状态都可选（便于批量删除/重试失败项） */}
                          <button
                            onClick={() => toggleLinkSelection(link.accountId)}
                            className="flex-shrink-0"
                          >
                            {selectedLinkIds.has(link.accountId) ? (
                              <CheckSquare className="h-4 w-4 text-primary" />
                            ) : (
                              <Square className="h-4 w-4" />
                            )}
                          </button>

                          {/* 序号 */}
                          <span className="shrink-0 w-8 text-center text-caption text-muted-foreground">
                            {idx + 1}
                          </span>

                          {/* 邮箱 */}
                          <span className="min-w-0 flex-1 text-caption truncate" title={link.email}>
                            {link.email}
                          </span>

                          {/* 状态 */}
                          <span className="shrink-0 w-20 flex justify-center">
                            {link.status === 'pending' && (
                              <span className="text-caption text-muted-foreground">
                                {isEn ? 'Pending' : '等待中'}
                              </span>
                            )}
                            {link.status === 'cancelled' && (
                              <span className="text-caption text-muted-foreground">
                                {isEn ? 'Cancelled' : '已取消'}
                              </span>
                            )}
                            {link.status === 'loading' && (
                              <Loader2 className="h-4 w-4 animate-spin text-text-secondary" />
                            )}
                            {link.status === 'success' &&
                              !['unknown', 'stale'].includes(link.validation || '') && (
                                <span className="inline-flex items-center gap-2">
                                  <CheckCircle className="h-4 w-4 text-success-text" />
                                  {link.generatedAt && (
                                    <span
                                      className="text-caption text-muted-foreground tabular-nums"
                                      title={isEn ? 'Minutes since generated' : '生成至今分钟数'}
                                    >
                                      {Math.round((Date.now() - link.generatedAt) / 60000)}m
                                    </span>
                                  )}
                                </span>
                              )}
                            {link.status === 'expired' && (
                              <span
                                className="inline-flex items-center gap-2 text-warning-text"
                                title={isEn ? 'May have expired' : '可能已过期'}
                              >
                                <AlertTriangle className="h-4 w-4" />
                                <span className="text-caption">{isEn ? 'Expired' : '过期'}</span>
                              </span>
                            )}
                            {link.status === 'error' && (
                              <span
                                className="text-caption text-danger-text truncate"
                                title={link.error}
                              >
                                <XCircle className="h-4 w-4 inline" />
                              </span>
                            )}

                            {link.status === 'success' &&
                              ['unknown', 'stale'].includes(link.validation || '') && (
                                <span className="text-warning-text text-caption" title={link.error}>
                                  {isEn ? 'Unconfirmed' : '待确认'}
                                </span>
                              )}
                          </span>

                          {/* 操作 */}
                          <span className="w-28 flex shrink-0 justify-center gap-2">
                            {(link.status === 'success' || link.status === 'expired') &&
                              link.url && (
                                <>
                                  <button
                                    onClick={() => handleOpenLink(link.url!)}
                                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control hover:bg-muted"
                                    title={isEn ? 'Open in incognito' : '无痕打开'}
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => handleCopyLink(link.url!)}
                                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control hover:bg-muted"
                                    title={isEn ? 'Copy link' : '复制链接'}
                                  >
                                    <Copy className="h-4 w-4" />
                                  </button>
                                </>
                              )}
                            {(link.status === 'expired' ||
                              link.status === 'error' ||
                              link.status === 'cancelled' ||
                              link.validation === 'stale' ||
                              link.validation === 'unknown') &&
                              accounts.has(link.accountId) && (
                                <button
                                  onClick={() => void handleRegenerateLink(link.accountId)}
                                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control hover:bg-primary/10 text-primary"
                                  title={isEn ? 'Regenerate' : '重新生成'}
                                >
                                  <RefreshCw className="h-4 w-4" />
                                </button>
                              )}
                            {link.status === 'error' && (
                              <span
                                className="text-caption text-danger-text truncate max-w-[80px]"
                                title={link.error}
                              >
                                {link.error}
                              </span>
                            )}
                          </span>
                        </div>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 空状态 */}
            {links.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-body">
                    {upgradeableCount > 0
                      ? isEn
                        ? `${upgradeableCount} FREE accounts available for upgrade. Click "Fetch Links" to start.`
                        : `有 ${upgradeableCount} 个 FREE 账户可升级。点击"获取链接"开始。`
                      : isEn
                        ? 'No FREE tier accounts found. Select accounts in the Accounts page first.'
                        : '未找到 FREE 账户。请先在账户管理页面选择账户。'}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* 批量导入链接对话框 */}
            <ImportLinksDialog
              open={showImportDialog}
              onClose={() => setShowImportDialog(false)}
              onImport={handleImportLinks}
              isEn={isEn}
            />
          </>
        )}
      </div>
    </div>
  )
}

// ============ 批量导入链接对话框 ============

interface ImportLinksDialogProps {
  open: boolean
  onClose: () => void
  onImport: (text: string) => number
  isEn: boolean
}

function ImportLinksDialog({
  open,
  onClose,
  onImport,
  isEn
}: ImportLinksDialogProps): React.ReactNode {
  const [text, setText] = useState('')
  if (!open) return null

  const detectedCount = parseImportedLinks(text).length
  const handleConfirm = (): void => {
    const n = onImport(text)
    setText('')
    onClose()
    setTimeout(() => alert(isEn ? `Imported ${n} link(s)` : `成功导入 ${n} 个链接`), 0)
  }

  return createPortal(
    <div className="ui-dialog-overlay">
      <div className="absolute inset-0" onClick={onClose} />
      <div
        className="ui-dialog-panel max-w-[min(672px,calc(100vw-32px))]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-links-title"
      >
        {/* 标题栏 */}
        <div className="ui-dialog-header flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-muted-foreground" />
            <h2 id="import-links-title" className="text-title font-semibold">
              {isEn ? 'Import Links' : '批量导入链接'}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            title={isEn ? 'Close' : '关闭'}
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* 内容 */}
        <div className="ui-dialog-body space-y-3">
          <p className="text-caption text-muted-foreground">
            {isEn
              ? 'Paste links, one per line. Supports plain URLs or "email<sep>url" (sep = space / comma / tab / | / ----). URLs are auto-extracted; duplicates are skipped.'
              : '每行一个链接。支持纯 URL，或「邮箱<分隔符>URL」（分隔符可为 空格 / 逗号 / Tab / | / ----）。自动识别 URL，重复链接会跳过。'}
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            autoFocus
            spellCheck={false}
            placeholder={'https://aws.amazon.com/...\nuser@mail.com  https://aws.amazon.com/...'}
            className="w-full border py-2 text-body font-mono resize-y focus-visible:outline-none rounded-control px-2.5 focus-visible:ring-[3px] focus-visible:ring-ring bg-background border-border max-w-full"
          />
          <p className="text-caption text-muted-foreground">
            {isEn
              ? `Detected ${detectedCount} valid link(s)`
              : `已识别 ${detectedCount} 个有效链接`}
          </p>
        </div>

        {/* 底部按钮 */}
        <div className="ui-dialog-footer">
          <Button variant="outline" onClick={onClose}>
            {isEn ? 'Cancel' : '取消'}
          </Button>
          <Button disabled={detectedCount === 0} onClick={handleConfirm}>
            <Upload className="h-4 w-4" />
            {isEn ? `Import (${detectedCount})` : `导入 (${detectedCount})`}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ============ 订阅管理 Tab：批量取消 + 批量关超额 ============

interface ManageSubscriptionsTabProps {
  subscribed: AccountType[]
  concurrency: number
  isEn: boolean
}

function ManageSubscriptionsTab({
  subscribed,
  concurrency,
  isEn
}: ManageSubscriptionsTabProps): React.ReactNode {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const { isBatchOpening, isSettingOverage: isBatchDisablingOverage } = useSubscriptionStore()

  const toggleSelect = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleSelectAll = (): void => {
    if (selectedIds.size === subscribed.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(subscribed.map((a) => a!.id)))
  }

  /** 批量打开订阅门户（用于取消订阅） */
  const handleBatchOpenPortal = async (mode: 'selected' | 'all'): Promise<void> => {
    const targets =
      mode === 'selected' ? subscribed.filter((a) => selectedIds.has(a.id)) : subscribed
    if (
      !targets.length ||
      !confirm(
        isEn
          ? `Open ${targets.length} subscription portal pages? (in browser incognito mode)`
          : `打开 ${targets.length} 个订阅门户页面？（浏览器无痕模式）`
      )
    )
      return
    await openSubscriptionPortals(
      targets,
      concurrency,
      isEn ? 'Open subscription portals' : '批量打开订阅门户'
    )
  }

  /** 批量关闭超额 */
  const handleBatchDisableOverage = async (mode: 'selected' | 'all'): Promise<void> => {
    const targets = (
      mode === 'selected' ? subscribed.filter((a) => selectedIds.has(a.id)) : subscribed
    ).filter((a) => a.usage?.resourceDetail?.overageEnabled === true)
    if (!targets.length) {
      alert(isEn ? 'No accounts with overage enabled' : '没有开启超额的账号')
      return
    }
    if (
      !confirm(
        isEn
          ? `Disable overage on ${targets.length} accounts?`
          : `关闭 ${targets.length} 个账号的超额？`
      )
    )
      return
    await setAccountOverages(targets, false, concurrency, isEn ? 'Disable overage' : '批量关闭超额')
  }

  if (subscribed.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-body">
            {isEn
              ? 'No subscribed accounts found. Run "Check Accounts" first to refresh status.'
              : '未发现已订阅账号。请先在账户页"批量检查"刷新状态。'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const selectedCount = selectedIds.size
  const overageEnabledCount = subscribed.filter(
    (a) => a?.usage?.resourceDetail?.overageEnabled === true
  ).length

  return (
    <>
      {/* 说明 */}
      <Card className="border-border bg-muted">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-text-secondary" />
            <span className="text-body font-medium">
              {isEn ? 'Subscription Lifecycle Management' : '订阅生命周期管理'}
            </span>
          </div>
          <p className="text-caption text-muted-foreground">
            {isEn
              ? 'Bulk open subscription portals in browser (cancel/manage there), or bulk disable overage.'
              : '批量打开订阅门户（在浏览器内取消/管理），或批量关闭超额。'}
          </p>
        </CardContent>
      </Card>

      {/* 批量操作栏 */}
      <Card>
        <CardContent className="p-4 flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            onClick={() => handleBatchOpenPortal('selected')}
            disabled={isBatchOpening || selectedCount === 0}
          >
            {isBatchOpening ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4" />
            )}
            {isEn
              ? `Open Portal (Selected: ${selectedCount})`
              : `打开门户（已选 ${selectedCount}）`}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleBatchOpenPortal('all')}
            disabled={isBatchOpening}
          >
            <ExternalLink className="h-4 w-4" />
            {isEn ? `Open All (${subscribed.length})` : `打开全部 (${subscribed.length})`}
          </Button>

          <div className="w-px h-6 bg-border" />

          <Button
            size="sm"
            variant="outline"
            onClick={() => handleBatchDisableOverage('selected')}
            disabled={isBatchDisablingOverage || selectedCount === 0}
          >
            {isBatchDisablingOverage ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Ban className="h-4 w-4" />
            )}
            {isEn ? `Disable Overage (Selected)` : '关超额（已选）'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleBatchDisableOverage('all')}
            disabled={isBatchDisablingOverage || overageEnabledCount === 0}
          >
            <Ban className="h-4 w-4" />
            {isEn
              ? `Disable All Overage (${overageEnabledCount})`
              : `关全部超额 (${overageEnabledCount})`}
          </Button>

          <span className="ml-auto text-caption text-muted-foreground">
            {selectedCount > 0
              ? isEn
                ? `${selectedCount} of ${subscribed.length} selected`
                : `已选 ${selectedCount} / ${subscribed.length}`
              : isEn
                ? `${subscribed.length} subscribed accounts`
                : `${subscribed.length} 个已订阅账号`}
          </span>
        </CardContent>
      </Card>

      {/* 账号列表（多选） */}
      <Card>
        <CardContent className="p-0 overflow-x-auto [&>div]:min-w-[640px]">
          <div className="flex items-center gap-3 py-2 px-2.5 border-b text-caption font-medium text-muted-foreground bg-muted">
            <button onClick={toggleSelectAll} className="flex-shrink-0">
              {selectedIds.size === subscribed.length && subscribed.length > 0 ? (
                <CheckSquare className="h-4 w-4 text-primary" />
              ) : selectedIds.size > 0 ? (
                <Minus className="h-4 w-4 text-primary" />
              ) : (
                <Square className="h-4 w-4" />
              )}
            </button>
            <span className="shrink-0 w-8 text-center">#</span>
            <span className="min-w-0 flex-1">{isEn ? 'Email' : '邮箱'}</span>
            <span className="shrink-0 w-28 text-center">{isEn ? 'Plan' : '订阅类型'}</span>
            <span className="shrink-0 w-20 text-center">{isEn ? 'Days Left' : '剩余天数'}</span>
            <span className="shrink-0 w-24 text-center">{isEn ? 'Overage' : '超额状态'}</span>
            <span className="shrink-0 w-32 text-center">{isEn ? 'Actions' : '操作'}</span>
          </div>

          <SubscribedAccountsVirtualList
            subscribed={subscribed}
            selectedIds={selectedIds}
            toggleSelect={toggleSelect}
            isEn={isEn}
          />
        </CardContent>
      </Card>
    </>
  )
}

/**
 * 订阅账号虚拟化列表（处理上千个已订阅账号时避免卡顿）
 */
interface SubscribedListProps {
  subscribed: AccountType[]
  selectedIds: Set<string>
  toggleSelect: (id: string) => void
  isEn: boolean
}

function SubscribedAccountsVirtualList({
  subscribed,
  selectedIds,
  toggleSelect,
  isEn
}: SubscribedListProps): React.ReactNode {
  const parentRef = useRef<HTMLDivElement>(null)
  const ROW_HEIGHT = 47
  const validItems = useMemo(() => subscribed.filter((a): a is AccountType => !!a), [subscribed])

  const virtualizer = useVirtualizer({
    count: validItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10
  })

  // 不到 50 行时直接渲染
  if (validItems.length < 50) {
    return (
      <div ref={parentRef} className="max-h-[60vh] overflow-y-auto">
        {validItems.map((acc, idx) => (
          <SubscribedRow
            key={acc.id}
            acc={acc}
            idx={idx}
            selected={selectedIds.has(acc.id)}
            onToggleSelect={() => toggleSelect(acc.id)}
            isEn={isEn}
          />
        ))}
      </div>
    )
  }

  const items = virtualizer.getVirtualItems()
  return (
    <div ref={parentRef} className="h-[60vh] overflow-y-auto" style={{ contain: 'strict' }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {items.map((virtualRow) => {
          const acc = validItems[virtualRow.index]
          if (!acc) return null
          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`
              }}
            >
              <SubscribedRow
                acc={acc}
                idx={virtualRow.index}
                selected={selectedIds.has(acc.id)}
                onToggleSelect={() => toggleSelect(acc.id)}
                isEn={isEn}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SubscribedRow({
  acc,
  idx,
  selected,
  onToggleSelect,
  isEn
}: {
  acc: AccountType
  idx: number
  selected: boolean
  onToggleSelect: () => void
  isEn: boolean
}): React.ReactNode {
  const planName = acc.subscription?.title || acc.subscription?.type || '-'
  const daysLeft = acc.subscription?.daysRemaining
  const overageEnabled = acc.usage?.resourceDetail?.overageEnabled === true
  const overageCapable = acc.subscription?.overageCapability === 'OVERAGE_CAPABLE'

  return (
    <div
      className={cn(
        'flex h-[47px] items-center gap-3 py-[9px] px-2.5 border-b hover:bg-muted/40 text-caption transition-colors',
        selected && 'bg-accent'
      )}
    >
      <button onClick={onToggleSelect} className="flex-shrink-0">
        {selected ? (
          <CheckSquare className="h-4 w-4 text-primary" />
        ) : (
          <Square className="h-4 w-4" />
        )}
      </button>
      <span className="shrink-0 w-8 text-center text-muted-foreground">{idx + 1}</span>
      <span className="min-w-0 flex-1 truncate" title={acc.email}>
        {acc.email}
      </span>
      <span className="shrink-0 w-28 text-center">
        <span
          className={cn(
            'inline-block h-5 max-w-full truncate rounded-full px-[7px] py-0.5 align-middle text-badge font-medium',
            planName.toUpperCase().includes('PRO+') || planName.toUpperCase().includes('PRO_PLUS')
              ? 'bg-muted text-text-secondary'
              : planName.toUpperCase().includes('POWER')
                ? 'bg-warning-soft text-warning-text'
                : planName.toUpperCase().includes('PRO')
                  ? 'bg-muted text-text-secondary'
                  : 'bg-muted text-muted-foreground'
          )}
          title={planName}
        >
          {planName}
        </span>
      </span>
      <span className="shrink-0 w-20 text-center text-muted-foreground">
        {daysLeft != null ? (
          <span
            className={cn(
              daysLeft <= 3 ? 'text-danger-text' : daysLeft <= 7 ? 'text-warning-text' : ''
            )}
          >
            {isEn ? `${daysLeft}d` : `${daysLeft} 天`}
          </span>
        ) : (
          '-'
        )}
      </span>
      <span className="shrink-0 w-24 text-center">
        {overageEnabled ? (
          <span className="text-success-text text-caption">{isEn ? 'ENABLED' : '已开启'}</span>
        ) : overageCapable ? (
          <span className="text-muted-foreground text-caption">{isEn ? 'DISABLED' : '未开启'}</span>
        ) : (
          <span className="text-muted-foreground text-caption">-</span>
        )}
      </span>
      <span className="shrink-0 w-32 flex justify-center gap-2">
        <button
          onClick={async () => {
            const r = await window.api.accountGetSubscriptionUrl(
              acc.credentials.accessToken,
              undefined,
              acc.credentials?.region,
              acc.profileArn,
              acc.machineId,
              acc.credentials?.provider || acc.idp,
              acc.credentials?.authMethod,
              acc.id
            )
            if (r.success && r.url) {
              await window.api.openSubscriptionWindow(r.url)
            } else {
              alert(isEn ? `Failed: ${r.error}` : `失败: ${r.error}`)
            }
          }}
          className="inline-flex h-7 items-center justify-center gap-1.5 px-3 rounded-control text-body font-medium whitespace-nowrap bg-primary/10 text-primary hover:bg-primary/20"
          title={isEn ? 'Open subscription portal' : '打开订阅门户'}
        >
          <ExternalLink className="h-4 w-4" />
          {isEn ? 'Manage' : '管理'}
        </button>
      </span>
    </div>
  )
}

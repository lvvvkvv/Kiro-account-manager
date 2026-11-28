import { useShallow } from 'zustand/react/shallow'
import { useRef, useState, useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useAccountsStore } from '@/store/accounts'
import { useTranslation } from '@/hooks/useTranslation'
import { AccountCard } from './AccountCard'
import { AccountDetailDialog } from './AccountDetailDialog'
import type { Account } from '@/types/account'
import { Loader2, Plus, SearchX, UsersRound } from 'lucide-react'
import { Button } from '../ui'
import './AccountGrid.css'

interface AccountGridProps {
  onAddAccount: () => void
  onEditAccount: (account: Account) => void
}

const MIN_CARD_WIDTH = 304
const GAP = 16

export function AccountGridSkeleton(): React.ReactNode {
  const { t } = useTranslation()
  const label = t('common.unknown') === 'Unknown' ? 'Loading accounts…' : '正在加载账号…'
  return (
    <div
      className="account-grid-shell account-grid-loading"
      role="status"
      aria-label={label}
      aria-busy="true"
    >
      <p>
        <Loader2 className="h-4 w-4 animate-spin" />
        {label}
      </p>
      <div className="account-grid-loading-rows" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="account-card-skeleton motion-safe:animate-pulse">
            <span />
            <span />
            <span />
            <span />
          </div>
        ))}
      </div>
    </div>
  )
}

export function AccountGrid({ onAddAccount, onEditAccount }: AccountGridProps): React.ReactNode {
  const parentRef = useRef<HTMLDivElement>(null)
  const [detailAccount, setDetailAccount] = useState<Account | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [columns, setColumns] = useState(1)

  useEffect(() => {
    const container = parentRef.current
    if (!container) return
    const updateLayout = (): void => {
      const width = container.clientWidth - 4 // 给选中轮廓留出空间
      setColumns(Math.max(1, Math.floor((width + GAP) / (MIN_CARD_WIDTH + GAP))))
    }
    updateLayout()
    const observer = new ResizeObserver(updateLayout)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const {
    accounts: allAccounts,
    getFilteredAccounts,
    tags,
    groups,
    selectedIds,
    checkAccountStatus,
    setFilter,
    setActiveGroupTab
  } = useAccountsStore(
    useShallow((state) => ({
      accounts: state.accounts,
      getFilteredAccounts: state.getFilteredAccounts,
      tags: state.tags,
      groups: state.groups,
      selectedIds: state.selectedIds,
      checkAccountStatus: state.checkAccountStatus,
      setFilter: state.setFilter,
      setActiveGroupTab: state.setActiveGroupTab
    }))
  )
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'
  const accounts = useAccountsStore((state) => state.getFilteredAccounts())
  const toggleSelection = useAccountsStore((state) => state.toggleSelection)
  const rowCount = Math.ceil(accounts.length / columns)

  const handleRefreshDetail = async (): Promise<void> => {
    if (!detailAccount) return
    setIsRefreshing(true)
    try {
      await checkAccountStatus(detailAccount.id)
      const updated = getFilteredAccounts().find((account) => account.id === detailAccount.id)
      if (updated) setDetailAccount(updated)
    } finally {
      setIsRefreshing(false)
    }
  }

  // 以行测量真实高度：长标签、异常提示和展开的额度明细均参与布局。
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 380,
    getItemKey: (index) => `${columns}:${accounts[index * columns].id}`,
    overscan: 2
  })

  useEffect(() => {
    virtualizer.measure()
  }, [columns, virtualizer])

  return (
    <div className="account-grid-shell">
      <div
        ref={parentRef}
        className="account-grid"
        role="list"
        aria-label={isEn ? 'Account cards' : '账号卡片'}
        style={{ contain: 'strict' }}
      >
        {accounts.length > 0 ? (
          <div
            style={{ height: virtualizer.getTotalSize() + 58, width: '100%', position: 'relative' }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => (
              <div
                key={virtualRow.key}
                className="account-grid-row"
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                  transform: `translateY(${virtualRow.start}px)`
                }}
              >
                {accounts
                  .slice(virtualRow.index * columns, (virtualRow.index + 1) * columns)
                  .map((account) => (
                    <AccountCard
                      key={account.id}
                      account={account}
                      tags={tags}
                      groups={groups}
                      isSelected={selectedIds.has(account.id)}
                      onSelect={toggleSelection}
                      onEdit={onEditAccount}
                      onShowDetail={setDetailAccount}
                    />
                  ))}
              </div>
            ))}
            <div style={{ position: 'absolute', top: virtualizer.getTotalSize(), width: '100%' }}>
              <button type="button" onClick={onAddAccount} className="account-grid-add">
                <Plus />
                {isEn ? 'Add account' : '添加账号'}
              </button>
            </div>
          </div>
        ) : (
          <div className="account-grid-empty">
            {allAccounts.size ? <SearchX /> : <UsersRound />}
            <h3>
              {allAccounts.size
                ? isEn
                  ? 'No matching accounts'
                  : '没有匹配的账号'
                : isEn
                  ? 'Your accounts, in one place'
                  : '在这里管理你的账号'}
            </h3>
            <p>
              {allAccounts.size
                ? isEn
                  ? 'Try another search or view all accounts.'
                  : '试试其他搜索条件，或查看全部账号。'
                : isEn
                  ? 'Add an account to track usage, subscription and sign-in status.'
                  : '添加账号后，即可查看用量、订阅和登录状态。'}
            </p>
            <Button
              variant={allAccounts.size ? 'outline' : 'default'}
              onClick={
                allAccounts.size
                  ? () => {
                      setFilter({})
                      setActiveGroupTab('all')
                    }
                  : onAddAccount
              }
            >
              {allAccounts.size ? (
                isEn ? (
                  'View all accounts'
                ) : (
                  '查看全部账号'
                )
              ) : (
                <>
                  <Plus />
                  {isEn ? 'Add first account' : '添加第一个账号'}
                </>
              )}
            </Button>
          </div>
        )}
      </div>
      <AccountDetailDialog
        open={!!detailAccount}
        onOpenChange={(open) => !open && setDetailAccount(null)}
        account={detailAccount}
        onRefresh={handleRefreshDetail}
        isRefreshing={isRefreshing}
      />
    </div>
  )
}

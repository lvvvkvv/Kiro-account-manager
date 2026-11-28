import { useShallow } from 'zustand/react/shallow'
import { useRef, useState, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useAccountsStore } from '@/store/accounts'
import { useTranslation } from '@/hooks/useTranslation'
import { AccountListRow } from './AccountListRow'
import { AccountDetailDialog } from './AccountDetailDialog'
import type { Account } from '@/types/account'
import { Loader2, Plus, SearchX, UsersRound } from 'lucide-react'
import { Button } from '../ui'
import './AccountList.css'

interface AccountListProps {
  onAddAccount: () => void
  onEditAccount: (account: Account) => void
}

// 估算桌面行高；卡片重排、标签和错误提示产生的实际高度由虚拟列表测量。
const ROW_HEIGHT = 104

export function AccountListSkeleton(): React.ReactNode {
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'
  const label = isEn ? 'Loading accounts…' : '正在加载账号…'

  return (
    <div
      className="account-list-shell account-list-loading"
      role="status"
      aria-label={label}
      aria-busy="true"
    >
      <div className="account-list-loading-caption">
        <Loader2 className="h-4 w-4 animate-spin" />
        {label}
      </div>
      <div className="account-list-skeleton-rows" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="account-list-skeleton-row motion-safe:animate-pulse">
            <span className="account-list-skeleton-avatar" />
            <div className="account-list-skeleton-identity">
              <span />
              <span />
              <span />
            </div>
            <div className="account-list-skeleton-metrics">
              <span />
              <span />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function AccountList({ onAddAccount, onEditAccount }: AccountListProps): React.ReactNode {
  const parentRef = useRef<HTMLDivElement>(null)
  const [detailAccount, setDetailAccount] = useState<Account | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const {
    accounts: allAccounts,
    getFilteredAccounts,
    tags,
    groups,
    selectedIds,
    checkAccountStatus,
    selectAll,
    deselectAll,
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
      selectAll: state.selectAll,
      deselectAll: state.deselectAll,
      setFilter: state.setFilter,
      setActiveGroupTab: state.setActiveGroupTab
    }))
  )
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'

  const accounts = useAccountsStore((state) => state.getFilteredAccounts())
  const selectedInView = useMemo(
    () => accounts.reduce((count, account) => count + Number(selectedIds.has(account.id)), 0),
    [accounts, selectedIds]
  )
  const allSelected = accounts.length > 0 && selectedInView === accounts.length

  const handleRefreshDetail = async (): Promise<void> => {
    if (!detailAccount) return
    setIsRefreshing(true)
    try {
      await checkAccountStatus(detailAccount.id)
      const updated = getFilteredAccounts().find((a) => a.id === detailAccount.id)
      if (updated) setDetailAccount(updated)
    } finally {
      setIsRefreshing(false)
    }
  }

  // 按账号缓存实际行高，支持响应式换行与筛选、排序。
  const virtualizer = useVirtualizer({
    count: accounts.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => accounts[index].id,
    overscan: 8
  })

  const items = virtualizer.getVirtualItems()

  return (
    <div className="account-list-shell">
      {accounts.length > 0 && (
        <div className="account-list-header">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(element) => {
              if (element) element.indeterminate = selectedInView > 0 && !allSelected
            }}
            onChange={() => (allSelected ? deselectAll() : selectAll())}
            aria-label={
              allSelected
                ? isEn
                  ? 'Deselect all accounts in this list'
                  : '取消全选列表中的账号'
                : isEn
                  ? 'Select all accounts in this list'
                  : '全选列表中的账号'
            }
          />
          <span className="account-list-heading-account">
            {isEn ? 'ACCOUNT / STATUS' : '账号与状态'}
          </span>
          <span>{isEn ? 'CREDIT USAGE' : '使用额度'}</span>
          <span>{isEn ? 'VALIDITY' : '有效期'}</span>
          <span className="account-list-heading-actions">{isEn ? 'ACTIONS' : '操作'}</span>
        </div>
      )}
      <div
        ref={parentRef}
        className="account-list"
        role="list"
        aria-label={isEn ? 'Accounts' : '账号列表'}
        style={{ contain: 'strict' }}
      >
        {accounts.length > 0 && (
          <div
            style={{
              height: `${virtualizer.getTotalSize() + 80}px`,
              width: '100%',
              position: 'relative'
            }}
          >
            {items.map((virtualRow) => {
              const account = accounts[virtualRow.index]
              if (!account) return null
              return (
                <div
                  key={virtualRow.key}
                  className="account-list-item"
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                >
                  <AccountListRow
                    account={account}
                    tags={tags}
                    groups={groups}
                    isSelected={selectedIds.has(account.id)}
                    position={virtualRow.index + 1}
                    total={accounts.length}
                    onEdit={onEditAccount}
                    onShowDetail={setDetailAccount}
                  />
                </div>
              )
            })}

            {/* 列表底部「添加账号」按钮 */}
            {accounts.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: `${virtualizer.getTotalSize()}px`,
                  left: 0,
                  width: '100%'
                }}
              >
                <button type="button" onClick={onAddAccount} className="account-list-add">
                  <Plus className="h-4 w-4" />
                  <span className="text-body">{isEn ? 'Add Account' : '添加账号'}</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* 空状态 */}
        {accounts.length === 0 && (
          <div className="account-list-empty">
            <div className="account-list-empty-icon">
              {allAccounts.size > 0 ? <SearchX /> : <UsersRound />}
            </div>
            <h3>
              {allAccounts.size > 0
                ? isEn
                  ? 'No matching accounts'
                  : '没有匹配的账号'
                : isEn
                  ? 'Your accounts, in one place'
                  : '在这里管理你的账号'}
            </h3>
            <p>
              {allAccounts.size > 0
                ? isEn
                  ? 'Try another search or view all accounts.'
                  : '试试其他搜索条件，或查看全部账号。'
                : isEn
                  ? 'Add an account to track its usage, subscription and sign-in status.'
                  : '添加账号后，即可查看用量、订阅和登录状态。'}
            </p>
            <Button
              variant={allAccounts.size > 0 ? 'outline' : 'default'}
              onClick={
                allAccounts.size > 0
                  ? () => {
                      setFilter({})
                      setActiveGroupTab('all')
                    }
                  : onAddAccount
              }
            >
              {allAccounts.size > 0 ? (
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

      {/* 账号详情对话框 */}
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

import { useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { useAccountsStore } from '@/store/accounts'
import { useTranslation } from '@/hooks/useTranslation'
import { Button, Badge } from '../ui'
import { VirtualRows } from '../ui/VirtualRows'
import { Users, Search, Edit3, Shuffle, Copy, Trash2, Check, X, History } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMachineIdClipboard } from './useMachineIdClipboard'
export function MachineIdBindingsDialog({ onClose }: { onClose: () => void }): ReactNode {
  const { actualLanguage } = useTranslation()
  const isEn = actualLanguage === 'en'
  const {
    accounts,
    accountMachineIds,
    bindMachineIdToAccount,
    unbindMachineIdFromAccount,
    machineIdError
  } = useAccountsStore(
    useShallow((s) => ({
      accounts: s.accounts,
      accountMachineIds: s.accountMachineIds,
      bindMachineIdToAccount: s.bindMachineIdToAccount,
      unbindMachineIdFromAccount: s.unbindMachineIdFromAccount,
      machineIdError: s.machineIdError
    }))
  )
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null),
    [editingMachineId, setEditingMachineId] = useState(''),
    [accountSearchQuery, setAccountSearchQuery] = useState('')
  const { copyToClipboard } = useMachineIdClipboard()
  const filtered = useMemo(() => {
    const query = accountSearchQuery.trim().toLowerCase()
    return Array.from(accounts.values()).filter(
      (a) =>
        !query ||
        [a.email, a.nickname, accountMachineIds[a.id]].some((v) => v?.toLowerCase().includes(query))
    )
  }, [accounts, accountMachineIds, accountSearchQuery])
  const startEditAccountMachineId = (id: string): void => {
    setEditingAccountId(id)
    setEditingMachineId(accountMachineIds[id] || '')
  }
  const cancelEditAccountMachineId = (): void => {
    setEditingAccountId(null)
    setEditingMachineId('')
  }
  const saveAccountMachineId = (id: string): void => {
    if (bindMachineIdToAccount(id, editingMachineId.trim())) cancelEditAccountMachineId()
  }
  const randomizeAccountMachineId = (id: string): void => {
    const value = crypto.randomUUID()
    if (bindMachineIdToAccount(id, value) && editingAccountId === id) setEditingMachineId(value)
  }
  const removeAccountMachineId = unbindMachineIdFromAccount
  return createPortal(
    <div className="ui-dialog-overlay">
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-transparent" onClick={() => onClose()} />

      {/* 对话框内容 */}
      <div
        className="ui-dialog-panel w-[600px] max-w-[min(600px,calc(100vw-32px))]"
        role="dialog"
        aria-modal="true"
      >
        {/* 标题栏 */}
        <div className="ui-dialog-header flex-row items-center justify-between gap-2 border-b flex-wrap">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            <h2 className="text-title font-semibold min-w-0 break-words">
              {isEn ? 'Account Machine ID' : '账户机器码管理'}
            </h2>
            <Badge variant="secondary">
              {accounts.size} {isEn ? 'accounts' : '个账户'}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="hover:bg-muted hover:text-foreground transition-colors shrink-0 h-control w-control p-0 rounded-control [&_svg]:size-4"
            onClick={() => onClose()}
            title={isEn ? 'Close' : '关闭'}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {machineIdError && (
          <div role="alert" className="px-6 py-2 text-destructive text-body">
            {machineIdError}
          </div>
        )}
        {/* 搜索框 */}
        <div className="shrink-0 px-6 pt-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={accountSearchQuery}
              onChange={(e) => setAccountSearchQuery(e.target.value)}
              placeholder={isEn ? 'Search accounts...' : '搜索账户...'}
              className="w-full pl-9 pr-3 text-body bg-muted border-0 focus:outline-none min-w-0 rounded-control border border-input bg-card px-2.5 focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
            />
            {accountSearchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 shrink-0 h-control w-control p-0 rounded-control [&_svg]:size-4"
                onClick={() => setAccountSearchQuery('')}
                title={isEn ? 'Clear search' : '清除搜索'}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        {/* 账户列表 */}
        <div className="ui-dialog-body flex-auto min-h-0 py-3 space-y-2">
          <VirtualRows
            items={filtered}
            estimateSize={155}
            maxHeight="50vh"
            renderRow={(account) => {
              const boundMachineId = accountMachineIds[account.id]
              const isEditing = editingAccountId === account.id

              return (
                <div key={account.id} className="p-3 bg-muted rounded-panel">
                  {/* 账户信息行 */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-body font-medium">
                        {(account.nickname || account.email || '?')[0].toUpperCase()}
                      </div>
                      <div className="flex flex-col">
                        <span className="font-medium text-body truncate max-w-[200px]">
                          {account.nickname || account.email}
                        </span>
                        {account.nickname && account.email && (
                          <span className="text-caption text-muted-foreground truncate max-w-[200px]">
                            {account.email}
                          </span>
                        )}
                      </div>
                      {boundMachineId && (
                        <Badge
                          variant="secondary"
                          className="text-badge bg-success/10 text-success"
                        >
                          {isEn ? 'Bound' : '已绑定'}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {!isEditing ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0 h-control w-control p-0 rounded-control [&_svg]:size-4"
                            onClick={() => startEditAccountMachineId(account.id)}
                            title={isEn ? 'Edit' : '编辑'}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0 h-control w-control p-0 rounded-control [&_svg]:size-4"
                            onClick={() => randomizeAccountMachineId(account.id)}
                            title={isEn ? 'Random' : '随机'}
                          >
                            <Shuffle className="h-3.5 w-3.5" />
                          </Button>
                          {boundMachineId && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="shrink-0 h-control w-control p-0 rounded-control [&_svg]:size-4"
                                onClick={() => copyToClipboard(boundMachineId)}
                                title={isEn ? 'Copy' : '复制'}
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive shrink-0 h-control w-control p-0 rounded-control [&_svg]:size-4"
                                onClick={() => removeAccountMachineId(account.id)}
                                title={isEn ? 'Delete' : '删除'}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          <Button
                            variant="default"
                            size="sm"
                            className="h-control px-2 text-body"
                            onClick={() => saveAccountMachineId(account.id)}
                          >
                            <Check className="h-3.5 w-3.5 mr-0" />
                            {isEn ? 'Save' : '保存'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-control px-2 text-body"
                            onClick={cancelEditAccountMachineId}
                          >
                            {isEn ? 'Cancel' : '取消'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0 h-control w-control p-0 rounded-control [&_svg]:size-4"
                            onClick={() => randomizeAccountMachineId(account.id)}
                            title={isEn ? 'Random' : '随机'}
                          >
                            <Shuffle className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* 机器码显示/编辑 */}
                  {isEditing ? (
                    <input
                      type="text"
                      value={editingMachineId}
                      onChange={(e) => setEditingMachineId(e.target.value)}
                      placeholder={isEn ? 'Enter UUID format machine ID' : '输入 UUID 格式机器码'}
                      className="w-full font-mono bg-background border focus:outline-none min-w-0 rounded-control border-input bg-card px-2.5 text-body focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                      autoFocus
                    />
                  ) : boundMachineId ? (
                    <div className="flex items-center gap-2 px-2 py-1.5 bg-background rounded-control border">
                      <code className="text-caption font-mono flex-1">{boundMachineId}</code>
                    </div>
                  ) : (
                    <div className="px-2 py-1.5 bg-card rounded-control border border-dashed text-center">
                      <span className="text-caption text-muted-foreground">
                        {isEn ? 'Not bound' : '未绑定'}
                      </span>
                    </div>
                  )}
                </div>
              )
            }}
          />

          {accounts.size === 0 && (
            <div className="text-center py-12">
              <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">{isEn ? 'No accounts' : '暂无账户'}</p>
              <p className="text-caption text-muted-foreground">
                {isEn ? 'Please add accounts first' : '请先添加账户'}
              </p>
            </div>
          )}

          {accounts.size > 0 && accountSearchQuery && filtered.length === 0 && (
            <div className="text-center py-8">
              <Search className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground">
                {isEn ? 'No matches found' : '未找到匹配的账户'}
              </p>
              <p className="text-caption text-muted-foreground">
                {isEn ? 'Try other keywords' : '尝试其他关键词'}
              </p>
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div className="ui-dialog-footer justify-start border-t text-caption text-muted-foreground">
          {isEn
            ? '💡 Tip: After binding, switching to this account will auto-apply the bound machine ID'
            : '💡 提示：绑定机器码后，切换到该账户时会自动应用对应的机器码'}
        </div>
      </div>
    </div>,
    document.body
  )
}
export function MachineIdHistoryDialog({ onClose }: { onClose: () => void }): ReactNode {
  const { actualLanguage } = useTranslation()
  const isEn = actualLanguage === 'en'
  const { machineIdHistory, accounts, clearMachineIdHistory } = useAccountsStore(
    useShallow((s) => ({
      machineIdHistory: s.machineIdHistory,
      accounts: s.accounts,
      clearMachineIdHistory: s.clearMachineIdHistory
    }))
  )
  const reversedHistory = useMemo(() => [...machineIdHistory].reverse(), [machineIdHistory])
  const { copyToClipboard } = useMachineIdClipboard()
  const formatTime = (time: number): string =>
    new Date(time).toLocaleString(isEn ? 'en-US' : 'zh-CN')
  return createPortal(
    <div className="ui-dialog-overlay">
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-transparent" onClick={() => onClose()} />

      {/* 对话框内容 */}
      <div
        className="ui-dialog-panel w-[550px] max-w-[min(550px,calc(100vw-32px))]"
        role="dialog"
        aria-modal="true"
      >
        {/* 标题栏 */}
        <div className="ui-dialog-header flex-row items-center justify-between gap-2 border-b flex-wrap">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5" />
            <h2 className="text-title font-semibold min-w-0 break-words">
              {isEn ? 'Change History' : '变更历史'}
            </h2>
            <Badge variant="secondary">
              {machineIdHistory.length} {isEn ? 'records' : '条'}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {machineIdHistory.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearMachineIdHistory}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-0" />
                {isEn ? 'Clear' : '清空'}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="hover:bg-muted hover:text-foreground transition-colors shrink-0 h-control w-control p-0 rounded-control [&_svg]:size-4"
              onClick={() => onClose()}
              title={isEn ? 'Close' : '关闭'}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* 历史列表 */}
        <div className="ui-dialog-body flex-auto min-h-0 py-3">
          {machineIdHistory.length > 0 ? (
            <div className="space-y-2">
              <VirtualRows
                items={reversedHistory}
                estimateSize={130}
                maxHeight="50vh"
                renderRow={(entry, index) => (
                  <div key={entry.id} className="p-3 bg-muted rounded-panel">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-caption text-muted-foreground">
                          #{machineIdHistory.length - index}
                        </span>
                        <Badge
                          variant="secondary"
                          className={cn(
                            'text-badge whitespace-nowrap',
                            entry.action === 'initial' &&
                              'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
                            entry.action === 'manual' &&
                              'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
                            entry.action === 'auto_switch' &&
                              'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
                            entry.action === 'restore' &&
                              'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
                            entry.action === 'bind' &&
                              'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300'
                          )}
                        >
                          {entry.action === 'initial' && (isEn ? 'Init' : '初始')}
                          {entry.action === 'manual' && (isEn ? 'Manual' : '手动')}
                          {entry.action === 'auto_switch' && (isEn ? 'Auto' : '自动')}
                          {entry.action === 'restore' && (isEn ? 'Restore' : '恢复')}
                          {entry.action === 'bind' && (isEn ? 'Bind' : '绑定')}
                        </Badge>
                      </div>
                      <span className="text-caption text-muted-foreground">
                        {formatTime(entry.timestamp)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 p-2 bg-background rounded-control border">
                      <code className="text-body flex-1 font-mono">{entry.machineId}</code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 h-control w-control p-0 rounded-control [&_svg]:size-4"
                        onClick={() => copyToClipboard(entry.machineId)}
                        title={isEn ? 'Copy' : '复制'}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                    {entry.accountId && (
                      <p className="text-caption text-muted-foreground mt-2">
                        {isEn ? 'Account: ' : '关联账户: '}
                        {accounts.get(entry.accountId)?.nickname ||
                          accounts.get(entry.accountId)?.email ||
                          entry.accountEmail ||
                          entry.accountId}
                      </p>
                    )}
                  </div>
                )}
              />
            </div>
          ) : (
            <div className="text-center py-12">
              <History className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">{isEn ? 'No change records' : '暂无变更记录'}</p>
              <p className="text-caption text-muted-foreground">
                {isEn ? 'Changes will be recorded automatically' : '机器码变更后将自动记录'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

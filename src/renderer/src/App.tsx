import { AccountStorageNotice } from './components/layout/AccountStorageNotice'
import { useBannedAccountNotifications } from './hooks/useBannedAccountNotifications'
import { useRegistrationSchedule } from './hooks/useRegistrationSchedule'
import { useProxyPoolValidation } from './hooks/useProxyPoolValidation'
import { useShallow } from 'zustand/react/shallow'
import { useColorScheme } from './hooks/useColorScheme'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AccountManager } from './components/accounts'
import { Sidebar, TitleBar, type PageType } from './components/layout'
import {
  HomePage,
  AboutPage,
  SettingsPage,
  MachineIdPage,
  KiroSettingsPage,
  ProxyPage,
  KProxyPage,
  ProxyPoolPage,
  WebhooksPage,
  DiagnosePage,
  ConfigSyncPage,
  RegisterPage,
  SubscriptionPage,
  LogsPage
} from './components/pages'
import { useWebhookStore } from './store/webhooks'
import { AutoUpdatePrompt } from './components/updates/AutoUpdatePrompt'
import { CloseConfirmDialog } from './components/CloseConfirmDialog'
import { useAccountsStore } from './store/accounts'

// 托盘信息防抖延迟：后台刷新风暴时合并多次跨进程 IPC 为单次
const TRAY_UPDATE_DEBOUNCE_MS = 400
// 后台刷新结果批量化间隔：N 条结果合并到一次 set，避免 N 次 Map 全量复制 + 渲染抖动
const BACKGROUND_RESULT_FLUSH_MS = 120

function App(): React.JSX.Element {
  useColorScheme()
  const { storageLoaded, storageLoading, storageError } = useAccountsStore(
    useShallow((state) => ({
      storageLoaded: state.storageLoaded,
      storageLoading: state.isLoading,
      storageError: state.storageError
    }))
  )
  const storageReady = storageLoaded && !storageLoading && !storageError
  const [storageAttempt, setStorageAttempt] = useState(0)
  useBannedAccountNotifications(storageReady)
  useProxyPoolValidation(storageReady)
  useRegistrationSchedule(storageReady)
  const [currentPage, setCurrentPage] = useState<PageType>('home')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const toggleSidebar = useCallback(() => setSidebarCollapsed((value) => !value), [])

  const {
    loadFromStorage,
    startAutoTokenRefresh,
    stopAutoTokenRefresh,
    applyBackgroundRefreshResults,
    applyBackgroundCheckResults,
    flushSaveImmediately,
    accounts,
    activeAccountId,
    checkAndRefreshExpiringTokens,
    updateAccountStatus,
    updateAccount
  } = useAccountsStore(
    useShallow((state) => ({
      loadFromStorage: state.loadFromStorage,
      startAutoTokenRefresh: state.startAutoTokenRefresh,
      stopAutoTokenRefresh: state.stopAutoTokenRefresh,
      applyBackgroundRefreshResults: state.applyBackgroundRefreshResults,
      applyBackgroundCheckResults: state.applyBackgroundCheckResults,
      flushSaveImmediately: state.flushSaveImmediately,
      accounts: state.accounts,
      activeAccountId: state.activeAccountId,
      checkAndRefreshExpiringTokens: state.checkAndRefreshExpiringTokens,
      updateAccountStatus: state.updateAccountStatus,
      updateAccount: state.updateAccount
    }))
  )

  // 切换到下一个可用账户
  const switchToNextAccount = useCallback(async () => {
    const state = useAccountsStore.getState()
    const available = Array.from(state.accounts.values()).filter(
      (account) =>
        account.status === 'active' &&
        account.credentials.refreshToken &&
        (account.credentials.authMethod === 'social' ||
          (account.credentials.clientId && account.credentials.clientSecret))
    )
    if (available.length <= 1) return
    const index = available.findIndex((account) => account.id === state.activeAccountId)
    const result = await state.switchAccount(available[(index + 1) % available.length].id)
    if (!result.success || result.warning)
      alert(result.error || result.warning || '切换账号失败 / Account switch failed')
  }, [])

  // 托盘信息防抖：账号 Map 频繁变更（后台刷新风暴）时合并 N 次 IPC 为 1 次
  const trayMaxWaitRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const trayDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const updateTrayInfo = useCallback(() => {
    if (trayDebounceRef.current) clearTimeout(trayDebounceRef.current)
    const publish = (): void => {
      if (trayDebounceRef.current) clearTimeout(trayDebounceRef.current)
      if (trayMaxWaitRef.current) clearTimeout(trayMaxWaitRef.current)
      trayMaxWaitRef.current = null
      trayDebounceRef.current = null
      const currentState = useAccountsStore.getState()
      const currentAccounts = currentState.accounts
      const currentActiveId = currentState.activeAccountId

      const accountList = Array.from(currentAccounts.values()).map((acc) => ({
        id: acc.id,
        email: acc.email || 'Unknown',
        idp: acc.idp || 'Unknown',
        status: acc.status
      }))
      window.api.updateTrayAccountList(accountList)

      if (currentActiveId) {
        const activeAccount = currentAccounts.get(currentActiveId)
        if (activeAccount) {
          window.api.updateTrayAccount({
            id: activeAccount.id,
            email: activeAccount.email || 'Unknown',
            idp: activeAccount.idp || 'Unknown',
            status: activeAccount.status,
            subscription: activeAccount.subscription?.title || undefined,
            usage: activeAccount.usage
              ? {
                  usedCredits: activeAccount.usage.current || 0,
                  totalCredits: activeAccount.usage.limit || 0,
                  totalRequests: 0,
                  successRequests: 0,
                  failedRequests: 0
                }
              : undefined
          })
        } else {
          window.api.updateTrayAccount(null)
        }
      } else {
        window.api.updateTrayAccount(null)
      }
    }
    trayDebounceRef.current = setTimeout(publish, TRAY_UPDATE_DEBOUNCE_MS)
    if (!trayMaxWaitRef.current) trayMaxWaitRef.current = setTimeout(publish, 1000)
  }, [])

  const storageLoadRef = useRef<Promise<void> | null>(null)
  const backgroundFlushes = useRef(new Set<() => void>())
  const flushForQuit = useCallback(async () => {
    try {
      await storageLoadRef.current
    } catch (error) {
      if (useAccountsStore.getState().storageLoaded) throw error
    }
    for (const flush of backgroundFlushes.current) flush()
    if (useAccountsStore.getState().storageLoaded)
      await useAccountsStore.getState().flushSaveImmediately()
  }, [])
  useEffect(
    () =>
      window.api.onAppQuitPrepare(async (token) => {
        try {
          await flushForQuit()
          await window.api.appQuitReady(token)
        } catch (error) {
          await window.api.appQuitReady(token, String(error))
        }
      }),
    [flushForQuit]
  )

  useEffect(
    () =>
      window.api.onUpdatePrepareQuit(async (token) => {
        try {
          await flushForQuit()
          await window.api.updateQuitReady(token)
        } catch (error) {
          await window.api.updateQuitReady(token, String(error))
        }
      }),
    [flushForQuit]
  )

  // 应用启动时加载数据并启动自动刷新
  useEffect(() => {
    storageLoadRef.current = loadFromStorage()
    void storageLoadRef.current.catch((error) =>
      console.error('[App] Account loading failed:', error)
    )
    // 同步主动续期开关（持久化在 main 进程的 electron-store）
    useAccountsStore.getState().loadProactiveRenewalEnabled()
    // 加载 Webhook 配置
    useWebhookStore.getState().loadFromStorage()

    return () => {
      useAccountsStore.getState().stopAutoSave()
    }
  }, [loadFromStorage, storageAttempt])

  useEffect(() => {
    if (!storageReady) return
    startAutoTokenRefresh()
    requestAnimationFrame(() => {
      void window.api.updateRendererReady().catch(console.error)
    })
    return () => stopAutoTokenRefresh()
  }, [storageReady, startAutoTokenRefresh, stopAutoTokenRefresh])
  const retryLoad = useCallback(() => setStorageAttempt((value) => value + 1), [])

  // 订阅 Kiro IDE 自己 refresh token 后反代检测到的事件
  // 触发时间点：Kiro IDE 在后台 refresh loop 把磁盘 token 写新了，反代 watcher 反向同步到 store
  // 按账号合并凭证，保留尚未落盘的编辑；缺少凭证的旧事件仍兼容重新加载。
  useEffect(() => {
    if (typeof window.api.onKiroIdeTokenChanged !== 'function') return
    const unsubscribe = window.api.onKiroIdeTokenChanged((data) => {
      console.log(
        `[App] Kiro IDE refreshed token for account ${data.accountId} (${data.reason}), syncing credentials...`
      )
      if (data.credentials) {
        const state = useAccountsStore.getState()
        const account = state.accounts.get(data.accountId)
        if (
          account &&
          (data.expectedRefreshToken === undefined ||
            account.credentials.refreshToken === data.expectedRefreshToken ||
            account.credentials.refreshToken === data.credentials.refreshToken)
        ) {
          state.updateAccount(data.accountId, {
            credentials: { ...account.credentials, ...data.credentials }
          })
        }
        return
      }
      loadFromStorage().catch((e) => console.warn('[App] reload after IDE token change failed:', e))
    })
    return unsubscribe
  }, [loadFromStorage])

  // 反代关键事件 → 触发 webhook（v1.8 新增）
  // 由 main/proxyServer 内置的 webhookTrigger 通过 IPC 推送过来，统一在 renderer 调 useWebhookStore
  useEffect(() => {
    const unsubscribe = window.api.onProxyWebhookTrigger?.((event, payload) => {
      try {
        const store = useWebhookStore.getState()
        // 映射反代事件名 → Webhook 事件类型
        const webhookEventMap: Record<string, 'risk-warning' | 'account-banned'> = {
          'proxy-account-suspended': 'account-banned',
          'proxy-all-exhausted': 'risk-warning'
        }
        const targetEvent = webhookEventMap[event] || 'risk-warning'
        // 规范化 level（main 用 'error'/'info' 等字符串字面量，需要映射到 store 接受的类型）
        const rawLevel = (payload as { level?: string })?.level
        const level: 'info' | 'warn' | 'error' | 'success' =
          rawLevel === 'error'
            ? 'error'
            : rawLevel === 'info'
              ? 'info'
              : rawLevel === 'success'
                ? 'success'
                : 'warn'
        void store.triggerEvent(targetEvent, {
          title: String((payload as Record<string, unknown>).title ?? '反代告警'),
          message: String((payload as Record<string, unknown>).message ?? ''),
          level,
          fields: (payload as { fields?: Record<string, string | number> })?.fields
        })
      } catch (err) {
        console.error('[App] Proxy webhook trigger failed:', err)
      }
    })
    return () => {
      unsubscribe?.()
    }
  }, [])

  // 应用内页面跳转（轻量 CustomEvent，供深层组件无需 prop 钻取即可切页）
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<PageType>).detail
      if (detail) setCurrentPage(detail)
    }
    window.addEventListener('navigate-page', handler)
    return () => window.removeEventListener('navigate-page', handler)
  }, [])

  // 关闭/刷新前强制 flush 防抖中的待保存数据，防止数据丢失
  useEffect(() => {
    const handleBeforeUnload = (): void => {
      if (useAccountsStore.getState().storageLoaded)
        void flushSaveImmediately().catch(console.error)
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      if (trayDebounceRef.current) clearTimeout(trayDebounceRef.current)
      if (trayMaxWaitRef.current) clearTimeout(trayMaxWaitRef.current)
    }
  }, [flushSaveImmediately])

  // 账户/激活变化时触发托盘更新（内部防抖 + 直接从 store 读取最新数据，避免 stale closure）
  useEffect(() => {
    updateTrayInfo()
  }, [accounts, activeAccountId, updateTrayInfo])

  // 监听托盘刷新账户事件
  useEffect(() => {
    const unsubscribe = window.api.onTrayRefreshAccount(() => {
      checkAndRefreshExpiringTokens()
      updateTrayInfo()
    })
    return () => {
      unsubscribe()
    }
  }, [checkAndRefreshExpiringTokens, updateTrayInfo])

  // 监听托盘切换账户事件
  useEffect(() => {
    const unsubscribe = window.api.onTraySwitchAccount(() => {
      switchToNextAccount()
    })
    return () => {
      unsubscribe()
    }
  }, [switchToNextAccount])

  // 监听后台刷新结果：缓冲 + 批量化 flush，N 条结果合并为一次 set，消除 Map 复制风暴
  useEffect(() => {
    const refreshBuffer: Array<{
      id: string
      success: boolean
      data?: unknown
      error?: string
      expectedRefreshToken?: string
    }> = []
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    const flush = (): void => {
      if (flushTimer) clearTimeout(flushTimer)
      flushTimer = null
      if (refreshBuffer.length === 0) return
      const batch = refreshBuffer.splice(0)
      applyBackgroundRefreshResults(batch)
    }
    const flushes = backgroundFlushes.current
    flushes.add(flush)

    const unsubscribe = window.api.onBackgroundRefreshResult((data) => {
      refreshBuffer.push(data)
      if (!flushTimer) {
        flushTimer = setTimeout(flush, BACKGROUND_RESULT_FLUSH_MS)
      }
    })
    return () => {
      unsubscribe()
      flush()
      flushes.delete(flush)
    }
  }, [applyBackgroundRefreshResults])

  // 监听后台检查结果：同样的批量化策略
  useEffect(() => {
    const checkBuffer: Array<{
      id: string
      success: boolean
      data?: unknown
      error?: string
      expectedRefreshToken?: string
    }> = []
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    const flush = (): void => {
      if (flushTimer) clearTimeout(flushTimer)
      flushTimer = null
      if (checkBuffer.length === 0) return
      const batch = checkBuffer.splice(0)
      applyBackgroundCheckResults(batch)
    }
    const flushes = backgroundFlushes.current
    flushes.add(flush)

    const unsubscribe = window.api.onBackgroundCheckResult((data) => {
      checkBuffer.push(data)
      if (!flushTimer) {
        flushTimer = setTimeout(flush, BACKGROUND_RESULT_FLUSH_MS)
      }
    })
    return () => {
      unsubscribe()
      flush()
      flushes.delete(flush)
    }
  }, [applyBackgroundCheckResults])

  // 监听反代账号被封禁事件（TEMPORARILY_SUSPENDED / AccountSuspendedException）
  // 反代触发后，把封禁状态同步到 store 让 UI 显示
  useEffect(() => {
    const unsubscribe = window.api.onProxyAccountSuspended((info) => {
      console.warn(`[App] Account suspended via proxy: ${info.email || info.id} (${info.reason})`)
      updateAccountStatus(info.id, 'error', `[${info.reason}] ${info.message}`)
    })
    return () => {
      unsubscribe()
    }
  }, [updateAccountStatus])

  // 监听反代账号更新事件（Enterprise profileArn 自愈），持久化到 store + 磁盘
  useEffect(() => {
    const unsubscribe = window.api.onProxyAccountUpdate((info) => {
      const account = useAccountsStore.getState().accounts.get(info.id)
      if (!account) return
      if (
        info.expectedRefreshToken !== undefined &&
        account.credentials.refreshToken !== info.expectedRefreshToken
      )
        return
      const patch = info
      const credentials = { ...account.credentials }
      if (patch.accessToken !== undefined) credentials.accessToken = patch.accessToken
      if (patch.refreshToken !== undefined) credentials.refreshToken = patch.refreshToken
      if (patch.expiresAt !== undefined) credentials.expiresAt = patch.expiresAt
      if (patch.profileArn !== undefined) credentials.profileArn = patch.profileArn
      updateAccount(info.id, {
        credentials,
        ...(patch.profileArn ? { profileArn: patch.profileArn } : {})
      })
    })
    return () => {
      unsubscribe()
    }
  }, [updateAccount])

  const page = useMemo(() => {
    switch (currentPage) {
      case 'home':
        return <HomePage />
      case 'accounts':
        return <AccountManager />
      case 'machineId':
        return <MachineIdPage />
      case 'kiroSettings':
        return <KiroSettingsPage />
      case 'proxy':
        return <ProxyPage />
      case 'kproxy':
        return <KProxyPage />
      case 'proxyPool':
        return <ProxyPoolPage />
      case 'register':
        return <RegisterPage />
      case 'subscription':
        return <SubscriptionPage />
      case 'webhooks':
        return <WebhooksPage />
      case 'diagnose':
        return <DiagnosePage />
      case 'configSync':
        return <ConfigSyncPage />
      case 'logs':
        return <LogsPage />
      case 'settings':
        return <SettingsPage />
      case 'about':
        return <AboutPage />
      default:
        return <HomePage />
    }
  }, [currentPage])

  return (
    <div className="h-screen bg-background overflow-hidden flex flex-col">
      <TitleBar />
      <AccountStorageNotice onRetryLoad={retryLoad} />
      <div className="flex-1 min-h-0 flex">
        <Sidebar
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
        />
        <main
          inert={storageLoaded && !storageReady}
          className="relative flex-1 min-w-0 overflow-hidden bg-background"
        >
          {!storageLoaded ? (
            <div className="p-6 space-y-3" role={storageError ? 'alert' : 'status'}>
              <p>{storageError || '正在加载账号数据 / Loading accounts…'}</p>
              {storageError && (
                <button
                  className="rounded-control border px-3 py-2"
                  onClick={() => setStorageAttempt((value) => value + 1)}
                >
                  重试 / Retry
                </button>
              )}
            </div>
          ) : (
            <>
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentPage}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                  className="h-full flex flex-col"
                >
                  {page}
                </motion.div>
              </AnimatePresence>
              <AutoUpdatePrompt />
            </>
          )}
        </main>
      </div>
      <CloseConfirmDialog />
    </div>
  )
}

export default App

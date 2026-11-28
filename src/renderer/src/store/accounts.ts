import { validateAccountData } from '../../../shared/accountData'
import { normalizeMachineId, type MachineIdConfig, type MachineIdHistoryEntry } from '../../../shared/machineId'
import { isTokenRefreshDue, tokenRefreshConcurrency } from '../../../shared/tokenRefresh'
import { resolveLanguage, type Language } from '../lib/language'
import { resolveThemeMode, type ThemeMode } from '../lib/theme'
import { isBannedAccountError, matchesAccountRisk, normalizeStoredAccount, createAccountIdentityIndex } from '../lib/account'
export { isBannedAccountError } from '../lib/account'
import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type {
  Account,
  AccountGroup,
  AccountTag,
  AccountFilter,
  AccountStatus,
  AccountStats,
  AccountExportData,
  AccountImportItem,
  BatchOperationResult,
  AccountSubscription,
  SubscriptionType,
  IdpType
} from '../types/account'
import type {
  ProxyEntry,
  ProxyPoolConfig,
  ProxyValidationResult,
  ProxyProtocol,
  ProxyImportEntry
} from '../types/proxy'
import { DEFAULT_PROXY_POOL_CONFIG } from '../types/proxy'
import { useWebhookStore, type WebhookEvent, type WebhookMessage } from './webhooks'

// ============================================
// 账号管理 Store
// ============================================

// 生成随机 64 位十六进制设备 ID
function generateRandomMachineId(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// 自动 Token 刷新定时器
let tokenRefreshTimer: ReturnType<typeof setInterval> | null = null
// 持久化防抖：合并连续 mutation 为单次写盘，避免后台刷新风暴时 IPC + IO 风暴
const SAVE_DEBOUNCE_MS = 500
/** 防抖最大延迟：连续 mutation 时也最迟在此时间内落盘一次，防止风暴下数据长时间不入磁盘 */
const SAVE_MAX_WAIT_MS = 5000
let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null
let saveMaxWaitTimer: ReturnType<typeof setTimeout> | null = null
let saveInFlight: Promise<void> | null = null
let savePendingWaiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = []
let storageLoad: Promise<void> | null = null
let localSsoSync: Promise<void> | null = null
let ssoGeneration = 0

// 仅比较持久化字段的引用，避免定时保存为检查变化而序列化全部凭证。
const persistedKeys = [
  'accounts',
  'groups',
  'tags',
  'activeAccountId',
  'autoRefreshEnabled',
  'autoRefreshInterval',
  'autoRefreshConcurrency',
  'autoRefreshSyncInfo',
  'batchImportConcurrency',
  'loginPrivateMode',
  'statusCheckInterval',
  'privacyMode',
  'usagePrecision',
  'proxyEnabled',
  'proxyUrl',
  'autoSwitchEnabled',
  'autoSwitchThreshold',
  'autoSwitchInterval',
  'switchTarget',
  'theme',
  'darkMode',
  'language',
  'machineIdConfig',
  'originalMachineId',
  'originalBackupTime',
  'accountMachineIds',
  'machineIdHistory',
  'proxyPool',
  'proxyPoolConfig',
  'proxyPoolCursor',
  'accountProxyBindings'
] as const satisfies readonly (keyof AccountsState)[]
let lastSavedState: AccountsState | null = null
let needsStorageMigration = false

function hasUnsavedChanges(state: AccountsState): boolean {
  const saved = lastSavedState
  return !saved || needsStorageMigration || persistedKeys.some((key) => state[key] !== saved[key])
}

// ============ getFilteredAccounts / getStats 引用缓存 ============
// 大账号量场景下这两个 selector 每次 re-render 都跑 O(n) 计算（filter + sort）
// 通过引用比较缓存输入快照，命中时直接返回上次结果，将 N×n 计算降至 1×n
let _filterCache: {
  accounts: Map<string, Account>
  filter: AccountFilter
  activeGroupTab: string
  output: Account[]
} | null = null

let _statsCache: {
  accounts: Map<string, Account>
  output: AccountStats
} | null = null

/**
 * 异步同步本地 SSO 缓存中的激活账号到 store。
 * 含潜在的网络请求（verifyAccountCredentials），从 loadFromStorage 中拆出来
 * 异步执行，避免阻塞首屏加载（isLoading）。
 */
type SetFn = (
  partial:
    | Partial<AccountsState>
    | ((state: AccountsState) => Partial<AccountsState>)
) => void

async function syncLocalSsoAccountAsync(
  get: () => AccountsStore,
  set: SetFn
): Promise<void> {
  const generation = ssoGeneration
  const initial = get()
  try {
    const localResult = await window.api.getLocalActiveAccount()
    if (generation !== ssoGeneration) return
    if (!localResult.success || !localResult.data?.refreshToken) return

    const localRefreshToken = localResult.data.refreshToken
    const currentAccounts = get().accounts

    // 查找匹配的账号
    let foundAccountId: string | null = null
    for (const [id, account] of currentAccounts) {
      if (account.credentials.refreshToken === localRefreshToken) {
        foundAccountId = id
        break
      }
    }

    if (foundAccountId) {
      if (get().activeAccountId !== initial.activeAccountId) return
      // 找到匹配的账号，更新 activeAccountId
      set({ activeAccountId: foundAccountId })
      // 同步 isActive 字段
      set((state) => {
        const accounts = new Map(state.accounts)
        for (const [id, account] of accounts) {
          const shouldBeActive = id === foundAccountId
          if (account.isActive !== shouldBeActive) {
            accounts.set(id, { ...account, isActive: shouldBeActive })
          }
        }
        return { accounts }
      })
      console.log('[Store] Synced active account from local SSO cache:', foundAccountId)
      get().saveToStorage()
      return
    }

    // 未找到匹配账号，尝试自动导入（网络请求）
    console.log('[Store] Local account not found in app, importing...')
    const importResult = await window.api.loadKiroCredentials()
    if (!importResult.success || !importResult.data) return

    const verifyResult = await window.api.verifyAccountCredentials({
      refreshToken: importResult.data.refreshToken,
      clientId: importResult.data.clientId || '',
      clientSecret: importResult.data.clientSecret || '',
      region: importResult.data.region,
      authMethod: importResult.data.authMethod,
      provider: importResult.data.provider
    })
    if (!verifyResult.success || !verifyResult.data || generation !== ssoGeneration) return
    if (get().accounts !== currentAccounts || get().activeAccountId !== initial.activeAccountId) return
    const identity = createAccountIdentityIndex(get().accounts.values())
    if (identity.has(verifyResult.data.email, verifyResult.data.userId, importResult.data.provider)) return

    const now = Date.now()
    const newId = `${verifyResult.data.email}-${now}`
    const newAccount: Account = {
      id: newId,
      email: verifyResult.data.email,
      userId: verifyResult.data.userId,
      nickname: verifyResult.data.email ? verifyResult.data.email.split('@')[0] : undefined,
      machineId: generateRandomMachineId(),
      idp: (importResult.data.provider || 'BuilderId') as 'BuilderId' | 'Google' | 'Github',
      credentials: {
        accessToken: verifyResult.data.accessToken,
        csrfToken: '',
        refreshToken: verifyResult.data.refreshToken,
        clientId: importResult.data.clientId || '',
        clientSecret: importResult.data.clientSecret || '',
        region: importResult.data.region || 'us-east-1',
        expiresAt: verifyResult.data.expiresIn ? now + verifyResult.data.expiresIn * 1000 : now + 3600 * 1000,
        authMethod: importResult.data.authMethod as 'IdC' | 'social',
        provider: (importResult.data.provider || 'BuilderId') as 'BuilderId' | 'Github' | 'Google'
      },
      subscription: {
        type: verifyResult.data.subscriptionType as SubscriptionType,
        title: verifyResult.data.subscriptionTitle,
        rawType: verifyResult.data.subscription?.rawType,
        daysRemaining: verifyResult.data.daysRemaining,
        expiresAt: verifyResult.data.expiresAt,
        managementTarget: verifyResult.data.subscription?.managementTarget,
        upgradeCapability: verifyResult.data.subscription?.upgradeCapability,
        overageCapability: verifyResult.data.subscription?.overageCapability
      },
      usage: {
        current: verifyResult.data.usage.current,
        limit: verifyResult.data.usage.limit,
        percentUsed: verifyResult.data.usage.limit > 0
          ? verifyResult.data.usage.current / verifyResult.data.usage.limit
          : 0,
        lastUpdated: now,
        baseLimit: verifyResult.data.usage.baseLimit,
        baseCurrent: verifyResult.data.usage.baseCurrent,
        freeTrialLimit: verifyResult.data.usage.freeTrialLimit,
        freeTrialCurrent: verifyResult.data.usage.freeTrialCurrent,
        freeTrialExpiry: verifyResult.data.usage.freeTrialExpiry,
        bonuses: verifyResult.data.usage.bonuses,
        nextResetDate: verifyResult.data.usage.nextResetDate,
        resourceDetail: verifyResult.data.usage.resourceDetail
      },
      status: 'active',
      createdAt: now,
      lastUsedAt: now,
      tags: [],
      isActive: true
    }

    set((state) => {
      const accounts = new Map(state.accounts)
      // 取消其它账号的激活状态
      for (const [id, account] of accounts) {
        if (account.isActive) {
          accounts.set(id, { ...account, isActive: false })
        }
      }
      accounts.set(newId, newAccount)
      return { accounts, activeAccountId: newId }
    })
    console.log('[Store] Auto-imported account from local SSO cache:', verifyResult.data.email)
    get().saveToStorage()
  } catch (e) {
    console.warn('[Store] Failed to sync local active account:', e)
  }
}

// 自动换号定时器
let autoSwitchInFlight = false
let accountSwitchInFlight = false
let autoSwitchTimer: ReturnType<typeof setInterval> | null = null

// 定时自动保存定时器（防止数据丢失）
let autoSaveTimer: ReturnType<typeof setInterval> | null = null
const AUTO_SAVE_INTERVAL = 30 * 1000 // 每 30 秒自动保存一次

interface AccountsState {
  // 应用版本号
  appVersion: string

  // 数据
  accounts: Map<string, Account>
  groups: Map<string, AccountGroup>
  tags: Map<string, AccountTag>

  // 当前激活账号
  activeAccountId: string | null

  // 筛选和排序
  filter: AccountFilter
  /** 当前激活的分组 Tab：'all' | 'ungrouped' | <groupId>，互斥 */
  activeGroupTab: string

  // 选中的账号（用于批量操作）
  selectedIds: Set<string>

  // 加载状态
  isLoading: boolean
  storageLoaded: boolean
  storageError: string | null
  storageSaveError: string | null
  isSyncing: boolean

  // 自动刷新设置
  autoRefreshEnabled: boolean
  autoRefreshInterval: number // 分钟
  autoRefreshConcurrency: number // 自动刷新并发数
  autoRefreshSyncInfo: boolean // 刷新时是否同步检测账户信息（用量、订阅、封禁状态）
  statusCheckInterval: number // 兼容旧配置；当前信息同步使用 autoRefreshInterval

  // 主动续期开关（持久化在 main 进程的 electron-store；这里只是镜像，不写 saveToStorage）
  proactiveRenewalEnabled: boolean

  // 隐私模式
  privacyMode: boolean

  // 使用量显示精度
  usagePrecision: boolean // true: 显示精确小数, false: 显示整数

  // 代理设置
  proxyEnabled: boolean
  proxyUrl: string // 格式: http://host:port 或 socks5://host:port

  // 自动换号设置
  autoSwitchEnabled: boolean
  autoSwitchThreshold: number // 余额阈值，低于此值时自动切换
  autoSwitchInterval: number // 检查间隔（分钟）

  // 批量导入设置
  batchImportConcurrency: number // 批量导入并发数

  // 登录浏览器隐私模式
  loginPrivateMode: boolean // 登录时使用浏览器隐私/无痕模式

  // 切号目标设置
  switchTarget: 'ide' | 'cli' | 'both' // ide=仅 Kiro IDE, cli=仅 Kiro CLI, both=两者都切

  // 主题设置
  theme: ThemeMode // 与 CC Switch 一致：跟随系统／浅色／深色
  darkMode: boolean // 深色模式

  // 语言设置
  language: Language

  // 机器码管理
  machineIdConfig: MachineIdConfig
  currentMachineId: string
  originalMachineId: string | null
  originalBackupTime: number | null
  accountMachineIds: Record<string, string>
  machineIdHistory: MachineIdHistoryEntry[]
  machineIdBusy: boolean
  machineIdError: string | null
  machineIdWarning: string | null

  // ============ 代理池（用于注册时 IP 轮换）============
  /** 代理条目列表（Map 保证 O(1) 查找） */
  proxyPool: Map<string, ProxyEntry>
  /** 代理池配置（启用状态、调度策略等） */
  proxyPoolConfig: ProxyPoolConfig
  /** 轮询调度光标（仅用于 round_robin 策略） */
  proxyPoolCursor: number
  /** 账号-代理绑定映射（accountId → proxyId）；用于"反代时 N 个账号共用 1 个 IP" */
  accountProxyBindings: Record<string, string>
}

interface AccountsActions {
  // 账号 CRUD
  addAccounts: (accounts: Omit<Account, 'id' | 'createdAt' | 'isActive'>[]) => BatchOperationResult
  addAccount: (account: Omit<Account, 'id' | 'createdAt' | 'isActive'>) => string
  updateAccount: (id: string, updates: Partial<Account>) => void
  removeAccount: (id: string) => void
  removeAccounts: (ids: string[]) => BatchOperationResult

  // 激活账号
  setActiveAccount: (id: string | null) => Promise<void>
  switchAccount: (id: string) => Promise<{ success: boolean; error?: string; warning?: string }>
  getActiveAccount: () => Account | null

  // 分组操作
  addGroup: (group: Omit<AccountGroup, 'id' | 'createdAt' | 'order'>) => string
  updateGroup: (id: string, updates: Partial<AccountGroup>) => void
  removeGroup: (id: string) => void
  moveAccountsToGroup: (accountIds: string[], groupId: string | undefined) => void

  // 标签操作
  addTag: (tag: Omit<AccountTag, 'id'>) => string
  updateTag: (id: string, updates: Partial<AccountTag>) => void
  removeTag: (id: string) => void
  addTagToAccounts: (accountIds: string[], tagId: string) => void
  removeTagFromAccounts: (accountIds: string[], tagId: string) => void

  // 筛选和排序
  setFilter: (filter: AccountFilter) => void
  clearFilter: () => void
  setActiveGroupTab: (tab: string) => void
  getFilteredAccounts: () => Account[]

  // 选择操作
  selectAll: () => void
  deselectAll: () => void
  toggleSelection: (id: string) => void

  // 导入导出
  exportAccounts: (ids?: string[]) => AccountExportData
  importAccounts: (items: AccountImportItem[]) => BatchOperationResult
  importFromExportData: (data: AccountExportData) => BatchOperationResult

  // 状态管理
  updateAccountStatus: (id: string, status: AccountStatus, error?: string) => void
  refreshAccountToken: (id: string) => Promise<boolean>
  batchRefreshTokens: (ids: string[]) => Promise<BatchOperationResult>
  checkAccountStatus: (id: string) => Promise<void>
  batchCheckStatus: (ids: string[]) => Promise<BatchOperationResult>

  // 统计
  getStats: () => AccountStats

  // 持久化
  loadFromStorage: () => Promise<void>
  /** 防抖触发持久化（推荐：高频 mutation 自动合并写盘） */
  saveToStorage: () => Promise<void>
  /** 立即持久化（用于 beforeunload 或关键操作场景） */
  flushSaveImmediately: () => Promise<void>

  // 设置
  setAutoRefresh: (enabled: boolean, interval?: number) => void
  setAutoRefreshConcurrency: (concurrency: number) => void
  setAutoRefreshSyncInfo: (enabled: boolean) => void
  /** 调 main 进程的 IPC，同步开启/关闭主动续期；成功后更新本地镜像 */
  setProactiveRenewalEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>
  /** 从 main 进程读取主动续期开关当前状态 */
  loadProactiveRenewalEnabled: () => Promise<void>
  setStatusCheckInterval: (interval: number) => void

  // 隐私模式
  setPrivacyMode: (enabled: boolean) => void
  maskEmail: (email: string) => string
  maskNickname: (nickname: string | undefined) => string

  // 使用量精度
  setUsagePrecision: (enabled: boolean) => void

  // 代理设置
  setProxy: (enabled: boolean, url?: string) => Promise<void>

  // 主题设置
  setTheme: (theme: string) => void
  setDarkMode: (enabled: boolean) => void
  applyTheme: () => void

  // 语言设置
  setLanguage: (language: Language) => void

  // 自动换号
  setAutoSwitch: (enabled: boolean, threshold?: number, interval?: number) => void

  // 批量导入并发数
  setBatchImportConcurrency: (concurrency: number) => void

  // 登录浏览器隐私模式
  setLoginPrivateMode: (enabled: boolean) => void

  // 切号目标设置
  setSwitchTarget: (target: 'ide' | 'cli' | 'both') => void

  startAutoSwitch: () => void
  stopAutoSwitch: () => void
  checkAndAutoSwitch: () => Promise<void>

  // 自动 Token 刷新
  startAutoTokenRefresh: () => void
  stopAutoTokenRefresh: () => void
  checkAndRefreshExpiringTokens: () => Promise<void>
  triggerBackgroundRefresh: () => Promise<void>
  /** 批量处理后台刷新结果：一次 set 应用 N 条结果，消除 N 次 Map 全量复制 */
  applyBackgroundRefreshResults: (items: Array<{ id: string; success: boolean; data?: unknown; error?: string; expectedRefreshToken?: string }>) => void
  /** 批量处理后台检查结果：一次 set 应用 N 条结果 */
  applyBackgroundCheckResults: (items: Array<{ id: string; success: boolean; data?: unknown; error?: string; expectedRefreshToken?: string }>) => void

  // 定时自动保存（防止数据丢失）
  startAutoSave: () => void
  stopAutoSave: () => void

  // 机器码管理
  setMachineIdConfig: (config: Partial<MachineIdConfig>) => void
  refreshCurrentMachineId: () => Promise<void>
  changeMachineId: (newMachineId?: string, context?: { action: 'manual' | 'auto_switch'; accountId?: string; accountEmail?: string }) => Promise<boolean>
  restoreOriginalMachineId: () => Promise<boolean>
  bindMachineIdToAccount: (accountId: string, machineId?: string) => boolean
  unbindMachineIdFromAccount: (accountId: string) => void
  backupOriginalMachineId: () => void
  clearMachineIdHistory: () => void

  // ============ 代理池操作 ============
  /** 添加单个代理（自动解析协议/主机/端口/认证） */
  addProxy: (url: string, options?: { label?: string; source?: string; tags?: string[] }) => string | null
  addProxies: (entries: ProxyImportEntry[]) => { added: number; skipped: number; failed: number }
  /** 批量导入（文本，每行一个，支持 http://host:port、socks5://user:pass@host:port、host:port 等） */
  importProxies: (text: string) => { added: number; skipped: number; failed: number }
  /** 删除代理 */
  removeProxy: (id: string) => void
  /** 批量删除 */
  removeProxies: (ids: string[]) => void
  /** 切换启用状态 */
  toggleProxyEnabled: (id: string, enabled?: boolean) => void
  /** 更新代理元数据 */
  updateProxy: (id: string, updates: Partial<ProxyEntry>) => void
  /** 测试单个代理（异步，主进程执行） */
  validateProxy: (id: string) => Promise<ProxyValidationResult>
  /** 批量测试（并发） */
  validateProxiesBatch: (ids: string[], concurrency?: number) => Promise<void>
  /** 清空所有代理 */
  replaceProxyPool: (entries: ProxyEntry[]) => void
  clearProxyPool: () => void
  /** 更新代理池配置 */
  setProxyPoolConfig: (config: Partial<ProxyPoolConfig>) => void
  /** 按当前策略挑选下一个可用代理（注册流程内部调用） */
  pickNextProxy: () => ProxyEntry | null
  /** 标记代理使用结果（供注册流程上报，用于失败计数与自动停用） */
  reportProxyResult: (id: string, success: boolean, boundEmail?: string, errorMsg?: string) => void

  // ============ 账号-代理绑定（反代分桶）============
  /** 把账号绑定到指定代理 */
  bindAccountToProxy: (accountId: string, proxyId: string) => void
  /** 批量绑定（用于批量分配） */
  bindAccountsToProxy: (accountIds: string[], proxyId: string) => void
  /** 解除账号绑定 */
  unbindAccountFromProxy: (accountId: string) => void
  /** 批量解除绑定，一次更新 Store。 */
  unbindAccountsFromProxy: (accountIds: string[]) => void
  /** 清空全部账号绑定 */
  clearAccountProxyBindings: () => void
  /**
   * 自动分配：把账号按 N:1 比例平均分配到当前启用的代理上
   * @param accountsPerProxy 每个代理承载的账号数；为 0 表示尽量均分
   * @param onlyUnbound 是否仅分配尚未绑定的账号；false 则重新分配全部
   * @returns 分配统计
   */
  autoDistributeAccountsToProxies: (params: {
    accountsPerProxy?: number
    onlyUnbound?: boolean
    accountIds?: string[]  // 限定分配范围，不填则全部
  }) => { distributed: number; perProxy: Record<string, number>; skipped: number }
  /** 读取账号绑定的代理 URL（供主进程同步用） */
  getAccountProxyUrl: (accountId: string) => string | undefined
}

type AccountsStore = AccountsState & AccountsActions

function collectRefreshAccounts(state: AccountsStore): Parameters<typeof window.api.backgroundBatchRefresh>[0] {
  const now = Date.now()
  return Array.from(state.accounts.values()).filter((account) =>
    !isBannedAccountError(account.lastError) && (state.autoRefreshSyncInfo || state.autoSwitchEnabled ||
      isTokenRefreshDue(account.id, account.credentials.expiresAt, now))
  ).map((account) => ({ id: account.id, email: account.email, idp: account.idp,
    machineId: account.machineId, profileArn: account.profileArn,
    needsTokenRefresh: isTokenRefreshDue(account.id, account.credentials.expiresAt, now),
    credentials: { ...account.credentials, refreshToken: account.credentials.refreshToken || '' }
  }))
}

// 默认筛选
const defaultFilter: AccountFilter = {}

// 从 localStorage 恢复分组 Tab（遵循 Electron renderer 环境总是可用）
const loadActiveGroupTab = (): string => {
  try {
    return localStorage.getItem('accounts_activeGroupTab') || 'all'
  } catch {
    return 'all'
  }
}

export const useAccountsStore = create<AccountsStore>()((set, get) => ({
  // 初始状态
  appVersion: '1.0.0',
  accounts: new Map(),
  groups: new Map(),
  tags: new Map(),
  activeAccountId: null,
  filter: defaultFilter,
  activeGroupTab: loadActiveGroupTab(),
  selectedIds: new Set(),
  isLoading: false,
  storageLoaded: false,
  storageError: null,
  storageSaveError: null,
  isSyncing: false,
  autoRefreshEnabled: true,
  autoRefreshInterval: 5,
  autoRefreshConcurrency: 100,
  autoRefreshSyncInfo: true,
  statusCheckInterval: 60,
  proactiveRenewalEnabled: false,
  privacyMode: false,
  usagePrecision: false,
  proxyEnabled: false,
  proxyUrl: '',
  autoSwitchEnabled: false,
  autoSwitchThreshold: 0,
  autoSwitchInterval: 5,
  batchImportConcurrency: 100,
  loginPrivateMode: false,
  switchTarget: 'ide' as const,
  theme: 'system',
  darkMode: false,
  language: resolveLanguage(undefined),

  machineIdConfig: {
    autoSwitchOnAccountChange: false,
    bindMachineIdToAccount: false,
    useBindedMachineId: true
  },
  currentMachineId: '',
  machineIdBusy: false,
  machineIdError: null,
  machineIdWarning: null,
  originalMachineId: null,
  originalBackupTime: null,
  accountMachineIds: {},
  machineIdHistory: [],

  // 代理池初始状态
  proxyPool: new Map<string, ProxyEntry>(),
  proxyPoolConfig: { ...DEFAULT_PROXY_POOL_CONFIG },
  proxyPoolCursor: 0,
  accountProxyBindings: {},

  // ==================== 账号 CRUD ====================

  addAccount: (accountData) => {
    const id = uuidv4()
    const now = Date.now()

    // 如果没有提供 machineId，自动生成一个随机的 64 位十六进制设备 ID
    const machineId = accountData.machineId || generateRandomMachineId()

    const account: Account = {
      ...accountData,
      id,
      machineId,
      createdAt: now,
      lastUsedAt: now,
      isActive: false,
      tags: accountData.tags || []
    }

    set((state) => {
      const accounts = new Map(state.accounts)
      accounts.set(id, account)
      return { accounts }
    })

    get().saveToStorage()
    return id
  },

  addAccounts: (items) => {
    const result: BatchOperationResult = { success: 0, failed: 0, errors: [] }
    const state = get()
    const identities = createAccountIdentityIndex(state.accounts.values())
    const accounts = new Map(state.accounts)
    for (const item of items) {
      if (identities.has(item.email, item.userId, item.credentials.provider)) continue
      const id = uuidv4()
      accounts.set(id, { ...item, id, createdAt: Date.now(), lastUsedAt: Date.now(),
        isActive: false, machineId: item.machineId || generateRandomMachineId(), tags: item.tags || [] })
      identities.add(item.email, item.userId, item.credentials.provider)
      result.success++
    }
    if (result.success) { set({ accounts }); void get().saveToStorage() }
    return result
  },

  updateAccount: (id, updates) => {
    set((state) => {
      const accounts = new Map(state.accounts)
      const account = accounts.get(id)
      if (account) {
        accounts.set(id, { ...account, ...updates })
      }
      return { accounts }
    })
    get().saveToStorage()
  },

  removeAccount: (id) => {
    ssoGeneration++
    set((state) => {
      const accounts = new Map(state.accounts)
      accounts.delete(id)

      const selectedIds = new Set(state.selectedIds)
      selectedIds.delete(id)

      const activeAccountId = state.activeAccountId === id ? null : state.activeAccountId

      // 同时清理账号-代理绑定
      const bindings = { ...state.accountProxyBindings }
      const machineBindings = { ...state.accountMachineIds }
      delete bindings[id]
      delete machineBindings[id]

      return { accounts, selectedIds, activeAccountId, accountProxyBindings: bindings, accountMachineIds: machineBindings }
    })
    get().saveToStorage()
  },

  removeAccounts: (ids) => {
    ssoGeneration++
    const result: BatchOperationResult = { success: 0, failed: 0, errors: [] }

    set((state) => {
      const accounts = new Map(state.accounts)
      const selectedIds = new Set(state.selectedIds)
      let activeAccountId = state.activeAccountId
      const bindings = { ...state.accountProxyBindings }
      const machineBindings = { ...state.accountMachineIds }

      for (const id of ids) {
        if (accounts.has(id)) {
          accounts.delete(id)
          selectedIds.delete(id)
          delete bindings[id]
          delete machineBindings[id]
          if (activeAccountId === id) activeAccountId = null
          result.success++
        } else {
          result.failed++
          result.errors.push({ id, error: 'Account not found' })
        }
      }

      return { accounts, selectedIds, activeAccountId, accountProxyBindings: bindings, accountMachineIds: machineBindings }
    })

    get().saveToStorage()
    return result
  },

  // ==================== 激活账号 ====================

  setActiveAccount: async (id) => {
    ssoGeneration++
    const state = get()
    
    set((s) => {
      const accounts = new Map(s.accounts)

      // 取消之前的激活状态
      if (s.activeAccountId) {
        const prev = accounts.get(s.activeAccountId)
        if (prev) {
          accounts.set(s.activeAccountId, { ...prev, isActive: false })
        }
      }

      // 设置新的激活状态
      if (id) {
        const account = accounts.get(id)
        if (account) {
          accounts.set(id, { ...account, isActive: true, lastUsedAt: Date.now() })
        }
      }

      return { accounts, activeAccountId: id }
    })
    
    if (id && state.machineIdConfig.autoSwitchOnAccountChange) {
      const account = get().accounts.get(id)
      if (account) {
        let target: string | undefined
        if (state.machineIdConfig.bindMachineIdToAccount) {
          target = normalizeMachineId(get().accountMachineIds[id]) || crypto.randomUUID()
          if (!get().accountMachineIds[id]) get().bindMachineIdToAccount(id, target)
          if (!state.machineIdConfig.useBindedMachineId) target = undefined
        }
        await get().changeMachineId(target, { action: 'auto_switch', accountId: id, accountEmail: account.email })
      }
    }

    get().saveToStorage()
  },

  switchAccount: async (id) => {
    if (accountSwitchInFlight) return { success: false, error: '正在切换账号，请稍候' }
    const account = get().accounts.get(id)
    if (!account) return { success: false, error: '账号不存在' }
    let credentials = account.credentials
    if (!credentials.refreshToken || (credentials.authMethod !== 'social' &&
      (!credentials.clientId || !credentials.clientSecret))) {
      return { success: false, error: '账号凭证不完整，无法切换' }
    }
    accountSwitchInFlight = true
    const target = get().switchTarget
    const applyCredentials = (value: { accessToken: string; refreshToken: string; expiresIn: number }): void => {
      const current = get().accounts.get(id)
      if (!current) return
      const { expiresIn, ...tokens } = value
      credentials = { ...current.credentials, ...tokens, expiresAt: Date.now() + expiresIn * 1000 }
      get().updateAccount(id, { credentials })
    }
    try {
      if (target !== 'cli') {
        const result = await window.api.switchAccount({
          ...credentials, refreshToken: credentials.refreshToken!, clientId: credentials.clientId || '',
          clientSecret: credentials.clientSecret || '', region: credentials.region || 'us-east-1',
          profileArn: account.profileArn, accountId: id })
        if (!result.success) return result
        if (result.refreshedCredentials) applyCredentials(result.refreshedCredentials)
      }
      if (target !== 'ide') {
        const result = await window.api.switchAccountCli({
          ...credentials, refreshToken: credentials.refreshToken!, region: credentials.region || 'us-east-1',
          profileArn: account.profileArn, accountId: id, skipRefresh: target === 'both', expiresAt: credentials.expiresAt })
        if (result.refreshedCredentials) applyCredentials(result.refreshedCredentials)
        if (!result.success) {
          if (target === 'both') await get().setActiveAccount(id)
          return result
        }
      }
      if (!get().accounts.has(id)) return { success: false, error: '账号已删除' }
      await get().setActiveAccount(id)
      return { success: true, warning: get().machineIdConfig.autoSwitchOnAccountChange ? get().machineIdError || get().machineIdWarning || undefined : undefined }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    } finally { accountSwitchInFlight = false }
  },

  getActiveAccount: () => {
    const { accounts, activeAccountId } = get()
    return activeAccountId ? accounts.get(activeAccountId) ?? null : null
  },

  // ==================== 分组操作 ====================

  addGroup: (groupData) => {
    const id = uuidv4()
    const { groups } = get()

    const group: AccountGroup = {
      ...groupData,
      id,
      order: groups.size,
      createdAt: Date.now()
    }

    set((state) => {
      const groups = new Map(state.groups)
      groups.set(id, group)
      return { groups }
    })

    get().saveToStorage()
    return id
  },

  updateGroup: (id, updates) => {
    set((state) => {
      const groups = new Map(state.groups)
      const group = groups.get(id)
      if (group) {
        groups.set(id, { ...group, ...updates })
      }
      return { groups }
    })
    get().saveToStorage()
  },

  removeGroup: (id) => {
    set((state) => {
      const groups = new Map(state.groups)
      groups.delete(id)

      // 移除账号的分组引用
      const accounts = new Map(state.accounts)
      for (const [accountId, account] of accounts) {
        if (account.groupId === id) {
          accounts.set(accountId, { ...account, groupId: undefined })
        }
      }

      return { groups, accounts }
    })
    get().saveToStorage()
  },

  moveAccountsToGroup: (accountIds, groupId) => {
    set((state) => {
      const accounts = new Map(state.accounts)
      for (const id of accountIds) {
        const account = accounts.get(id)
        if (account) {
          accounts.set(id, { ...account, groupId })
        }
      }
      return { accounts }
    })
    get().saveToStorage()
  },

  // ==================== 标签操作 ====================

  addTag: (tagData) => {
    const id = uuidv4()

    const tag: AccountTag = { ...tagData, id }

    set((state) => {
      const tags = new Map(state.tags)
      tags.set(id, tag)
      return { tags }
    })

    get().saveToStorage()
    return id
  },

  updateTag: (id, updates) => {
    set((state) => {
      const tags = new Map(state.tags)
      const tag = tags.get(id)
      if (tag) {
        tags.set(id, { ...tag, ...updates })
      }
      return { tags }
    })
    get().saveToStorage()
  },

  removeTag: (id) => {
    set((state) => {
      const tags = new Map(state.tags)
      tags.delete(id)

      // 移除账号的标签引用
      const accounts = new Map(state.accounts)
      for (const [accountId, account] of accounts) {
        if (account.tags.includes(id)) {
          accounts.set(accountId, {
            ...account,
            tags: account.tags.filter((t) => t !== id)
          })
        }
      }

      return { tags, accounts }
    })
    get().saveToStorage()
  },

  addTagToAccounts: (accountIds, tagId) => {
    set((state) => {
      const accounts = new Map(state.accounts)
      for (const id of accountIds) {
        const account = accounts.get(id)
        if (account && !account.tags.includes(tagId)) {
          accounts.set(id, { ...account, tags: [...account.tags, tagId] })
        }
      }
      return { accounts }
    })
    get().saveToStorage()
  },

  removeTagFromAccounts: (accountIds, tagId) => {
    set((state) => {
      const accounts = new Map(state.accounts)
      for (const id of accountIds) {
        const account = accounts.get(id)
        if (account) {
          accounts.set(id, {
            ...account,
            tags: account.tags.filter((t) => t !== tagId)
          })
        }
      }
      return { accounts }
    })
    get().saveToStorage()
  },

  // ==================== 筛选和排序 ====================

  setFilter: (filter) => {
    set({ filter })
  },

  clearFilter: () => {
    set({ filter: defaultFilter })
  },

  setActiveGroupTab: (tab) => {
    try { localStorage.setItem('accounts_activeGroupTab', tab) } catch { /* no-op */ }
    set({ activeGroupTab: tab })
  },

  getFilteredAccounts: () => {
    const { accounts, filter, activeGroupTab } = get()

    // 引用缓存命中：返回上次结果（数组同引用，便于消费方 useMemo 复用）
    if (
      _filterCache &&
      _filterCache.accounts === accounts &&
      _filterCache.filter === filter &&
      _filterCache.activeGroupTab === activeGroupTab
    ) {
      return _filterCache.output
    }

    let result = Array.from(accounts.values())

    // 按分组 Tab 互斥过滤
    if (activeGroupTab === 'ungrouped') {
      result = result.filter((a) => !a.groupId)
    } else if (activeGroupTab !== 'all') {
      result = result.filter((a) => a.groupId === activeGroupTab)
    }

    // 应用筛选
    if (filter.risk) result = result.filter((a) => matchesAccountRisk(a, filter.risk!))
    if (filter.search) {
      const search = filter.search.toLowerCase()
      result = result.filter(
        (a) =>
          a.email.toLowerCase().includes(search) ||
          a.nickname?.toLowerCase().includes(search)
      )
    }

    if (filter.subscriptionTypes?.length) {
      result = result.filter((a) => filter.subscriptionTypes!.includes(a.subscription.type))
    }

    if (filter.statuses?.length) {
      result = result.filter((a) => filter.statuses!.includes(a.status))
    }

    if (filter.idps?.length) {
      result = result.filter((a) => filter.idps!.includes(a.idp))
    }

    if (filter.tagIds?.length) {
      result = result.filter((a) => filter.tagIds!.some((t) => a.tags.includes(t)))
    }

    if (filter.emailDomains?.length) {
      result = result.filter((a) => {
        const atIndex = a.email.lastIndexOf('@')
        if (atIndex < 0) return false
        const domain = a.email.slice(atIndex + 1).toLowerCase()
        return filter.emailDomains!.includes(domain)
      })
    }

    if (filter.usageMin !== undefined) {
      result = result.filter((a) => a.usage.percentUsed >= filter.usageMin!)
    }

    if (filter.usageMax !== undefined) {
      result = result.filter((a) => a.usage.percentUsed <= filter.usageMax!)
    }

    if (filter.daysRemainingMin !== undefined) {
      result = result.filter(
        (a) => a.subscription.daysRemaining !== undefined &&
               a.subscription.daysRemaining >= filter.daysRemainingMin!
      )
    }

    if (filter.daysRemainingMax !== undefined) {
      result = result.filter(
        (a) => a.subscription.daysRemaining !== undefined &&
               a.subscription.daysRemaining <= filter.daysRemainingMax!
      )
    }

    // 封禁筛选
    if (filter.bannedOnly) {
      result = result.filter((a) => isBannedAccountError(a.lastError))
    }

    result.sort((a, b) => b.lastUsedAt - a.lastUsedAt)

    // 写入缓存：下次相同输入直接命中
    _filterCache = { accounts, filter, activeGroupTab, output: result }
    return result
  },

  // ==================== 选择操作 ====================

  selectAll: () => {
    const filtered = get().getFilteredAccounts()
    set({ selectedIds: new Set(filtered.map((a) => a.id)) })
  },

  deselectAll: () => {
    set({ selectedIds: new Set() })
  },

  toggleSelection: (id) => {
    set((state) => {
      const selectedIds = new Set(state.selectedIds)
      if (selectedIds.has(id)) {
        selectedIds.delete(id)
      } else {
        selectedIds.add(id)
      }
      return { selectedIds }
    })
  },

  // ==================== 导入导出 ====================

  exportAccounts: (ids) => {
    const { accounts, groups, tags } = get()

    let exportAccounts: Account[]
    if (ids?.length) {
      exportAccounts = ids
        .map((id) => accounts.get(id))
        .filter((a): a is Account => a !== undefined)
    } else {
      exportAccounts = Array.from(accounts.values())
    }

    const data: AccountExportData = {
      version: get().appVersion,
      exportedAt: Date.now(),
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      accounts: exportAccounts.map(({ isActive, ...rest }) => rest),
      groups: Array.from(groups.values()),
      tags: Array.from(tags.values())
    }

    return data
  },

  importAccounts: (items) => {
    const result: BatchOperationResult = { success: 0, failed: 0, errors: [] }

    // 验证 idp 是否有效
    const validIdps = ['Google', 'Github', 'BuilderId'] as const
    const normalizeIdp = (idp?: string): IdpType => {
      if (!idp) return 'Google'
      const normalized = validIdps.find(v => v.toLowerCase() === idp.toLowerCase())
      return normalized || 'Google'
    }

    // 批量构造账号对象 + 一次 set，避免 N 次 new Map(O(n²)) 与 N 次 re-render
    const newAccounts: Account[] = []
    for (const item of items) {
      try {
        const now = Date.now()
        const id = uuidv4()
        const machineId = generateRandomMachineId()

        const account: Account = {
          id,
          createdAt: now,
          isActive: false,
          machineId,
          email: item.email,
          password: item.password,
          nickname: item.nickname,
          idp: normalizeIdp(item.idp),
          credentials: {
            accessToken: item.accessToken || '',
            csrfToken: item.csrfToken || '',
            refreshToken: item.refreshToken,
            clientId: item.clientId,
            clientSecret: item.clientSecret,
            region: item.region || 'us-east-1',
            expiresAt: now + 3600 * 1000
          },
          subscription: {
            type: 'Free'
          },
          usage: {
            current: 0,
            limit: 25,
            percentUsed: 0,
            lastUpdated: now
          },
          groupId: item.groupId,
          tags: item.tags ?? [],
          status: 'unknown',
          lastUsedAt: now
        }
        newAccounts.push(account)
        result.success++
      } catch (error) {
        result.failed++
        result.errors.push({
          id: item.email,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    if (newAccounts.length > 0) {
      set((state) => {
        // 仅一次完整 Map 复制
        const accounts = new Map(state.accounts)
        for (const account of newAccounts) {
          accounts.set(account.id, account)
        }
        return { accounts }
      })
      // 防抖触发一次持久化
      get().saveToStorage()
    }

    return result
  },

  importFromExportData: (data) => {
    const result: BatchOperationResult = { success: 0, failed: 0, errors: [] }
    const { accounts: existingAccounts } = get()
    
    // 本地与文件内使用相同规则：同 userId，或同邮箱 + provider 才算重复。
    const userIds = new Set<string>()
    const emailProviders = new Map<string, Set<string | undefined>>()
    const indexAccount = (account: Omit<Account, 'isActive'>): void => {
      if (account.userId) userIds.add(account.userId)
      let providers = emailProviders.get(account.email)
      if (!providers) {
        providers = new Set()
        emailProviders.set(account.email, providers)
      }
      providers.add(account.credentials?.provider)
    }
    for (const account of existingAccounts.values()) indexAccount(account)

    let skipped = 0
    const accountsToAdd: Account[] = []

    for (const accountData of data.accounts) {
      if (
        (accountData.userId && userIds.has(accountData.userId)) ||
        emailProviders.get(accountData.email)?.has(accountData.credentials?.provider)
      ) {
        skipped++
        continue
      }
      try {
        accountsToAdd.push({ ...accountData, isActive: false })
        indexAccount(accountData)
        result.success++
      } catch (error) {
        result.failed++
        result.errors.push({
          id: accountData.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    // 一次 set 应用所有分组、标签、账号 — 单次 re-render
    if (data.groups.length > 0 || data.tags.length > 0 || accountsToAdd.length > 0) {
      set((state) => {
        const groups = data.groups.length > 0 ? new Map(state.groups) : state.groups
        if (data.groups.length > 0) {
          for (const group of data.groups) groups.set(group.id, group)
        }
        const tags = data.tags.length > 0 ? new Map(state.tags) : state.tags
        if (data.tags.length > 0) {
          for (const tag of data.tags) tags.set(tag.id, tag)
        }
        const accounts = accountsToAdd.length > 0 ? new Map(state.accounts) : state.accounts
        if (accountsToAdd.length > 0) {
          for (const acc of accountsToAdd) accounts.set(acc.id, acc)
        }
        return { groups, tags, accounts }
      })
    }

    // 记录跳过数量
    if (skipped > 0) {
      result.errors.push({
        id: 'skipped',
        error: `跳过 ${skipped} 个已存在的账号`
      })
    }

    get().saveToStorage()
    return result
  },

  // ==================== 状态管理 ====================

  updateAccountStatus: (id, status, error) => {
    const wasBanned = isBannedAccountError(get().accounts.get(id)?.lastError)
    const isBanned = isBannedAccountError(error)
    set((state) => {
      const accounts = new Map(state.accounts)
      const account = accounts.get(id)
      if (account) {
        accounts.set(id, {
          ...account,
          status,
          lastError: error,
          lastCheckedAt: Date.now()
        })
      }
      return { accounts }
    })
    get().saveToStorage()
    // 触发 webhook：账号刚被封禁时通知（已封禁的不重复）
    if (isBanned && !wasBanned) {
      const acc = get().accounts.get(id)
      triggerWebhook('account-banned', {
        title: '账号被封禁',
        message: `账号 ${acc?.email || id} 状态变为封禁`,
        level: 'error',
        fields: { 邮箱: acc?.email || '-', 错误: error || '-' }
      })
    }
  },

  refreshAccountToken: async (id) => {
    const { accounts, updateAccountStatus } = get()
    const account = accounts.get(id)

    if (!account) return false

    updateAccountStatus(id, 'refreshing')

    try {
      // 通过主进程调用 Kiro API 刷新 Token（避免 CORS）
      const result = await window.api.refreshAccountToken(account)
      if (get().accounts.get(id)?.credentials.refreshToken !== account.credentials.refreshToken) {
        return get().accounts.get(id)?.status === 'active'
      }

      if (result.success && result.data) {
        // 当 refresh 后 main 进程检测到该账号是 IDE 当前激活账号，会自动同步到磁盘 token 文件；
        // 否则只更新反代 store，IDE 仍用旧 token —— 提醒用户避免误以为"刷新对 IDE 也生效了"
        if (result.data.syncedToIde) {
          console.log(`[refreshAccountToken] Token refreshed AND synced to Kiro IDE (account=${account.email})`)
        } else {
          console.warn(
            `[refreshAccountToken] Token refreshed but NOT synced to Kiro IDE (account=${account.email}). ` +
              `Reason: ${result.data.syncSkipReason || 'unknown'}. ` +
              `Kiro IDE will still use its previously cached token until its own refresh loop kicks in.`
          )
        }

        set((state) => {
          const accounts = new Map(state.accounts)
          const acc = accounts.get(id)
          if (acc) {
            // Enterprise 账号刷新时主进程会返回真实 profileArn，持久化避免后续重复获取
            const resolvedProfileArn = result.data!.profileArn || acc.credentials.profileArn || acc.profileArn
            accounts.set(id, {
              ...acc,
              profileArn: resolvedProfileArn,
              credentials: {
                ...acc.credentials,
                accessToken: result.data!.accessToken,
                // 如果返回了新的 refreshToken，更新它
                refreshToken: result.data!.refreshToken || acc.credentials.refreshToken,
                expiresAt: Date.now() + result.data!.expiresIn * 1000,
                profileArn: resolvedProfileArn
              },
              status: 'active',
              lastError: undefined,
              lastCheckedAt: Date.now()
            })
          }
          return { accounts }
        })
        get().saveToStorage()
        return true
      } else {
        updateAccountStatus(id, 'error', result.error?.message)
        // 触发 webhook：Token 刷新失败
        triggerWebhook('token-expired', {
          title: 'Token 刷新失败',
          message: `账号 ${account.email} Token 刷新失败`,
          level: 'warn',
          fields: { 邮箱: account.email, 错误: result.error?.message || '-' }
        })
        return false
      }
    } catch (error) {
      if (get().accounts.get(id)?.credentials.refreshToken !== account.credentials.refreshToken) return false
      updateAccountStatus(id, 'error', error instanceof Error ? error.message : 'Unknown error')
      return false
    }
  },

  batchRefreshTokens: async (ids) => {
    const { accounts, autoRefreshConcurrency } = get()
    
    // 收集需要刷新的账号
    const accountsToRefresh: Array<{
      id: string
      email: string
      profileArn?: string
      credentials: {
        refreshToken: string
        clientId?: string
        clientSecret?: string
        region?: string
        startUrl?: string
        authMethod?: string
        accessToken?: string
        provider?: string
        profileArn?: string
      }
    }> = []

    for (const id of ids) {
      const account = accounts.get(id)
      if (!account?.credentials.refreshToken) continue
      
      accountsToRefresh.push({
        id,
        email: account.email,
        profileArn: account.profileArn,
        credentials: {
          refreshToken: account.credentials.refreshToken,
          clientId: account.credentials.clientId,
          clientSecret: account.credentials.clientSecret,
          region: account.credentials.region,
          startUrl: account.credentials.startUrl,
          authMethod: account.credentials.authMethod,
          accessToken: account.credentials.accessToken,
          provider: account.credentials.provider || account.idp,
          profileArn: account.credentials.profileArn
        }
      })
    }

    if (accountsToRefresh.length === 0) {
      return { success: 0, failed: 0, errors: [] }
    }

    console.log(`[BatchRefresh] Triggering background refresh for ${accountsToRefresh.length} accounts...`)
    
    // 使用后台刷新 API（不阻塞 UI）
    const result = await window.api.backgroundBatchRefresh(accountsToRefresh, autoRefreshConcurrency)
    
    return { 
      success: result.successCount, 
      failed: result.failedCount, 
      errors: [] 
    }
  },

  checkAccountStatus: async (id) => {
    const { accounts, updateAccountStatus } = get()
    const account = accounts.get(id)

    if (!account) return

    // 设置刷新状态，提供视觉反馈
    updateAccountStatus(id, 'refreshing')

    try {
      // 通过主进程调用 Kiro API 获取状态（避免 CORS）
      const result = await window.api.checkAccountStatus(account)
      if (get().accounts.get(id)?.credentials.refreshToken !== account.credentials.refreshToken) return

      if (result.success && result.data) {
        set((state) => {
          const accounts = new Map(state.accounts)
          const acc = accounts.get(id)
          if (acc) {
            // 如果 token 被刷新，更新凭证
            const updatedCredentials = result.data!.newCredentials 
              ? {
                  ...acc.credentials,
                  accessToken: result.data!.newCredentials.accessToken,
                  refreshToken: result.data!.newCredentials.refreshToken ?? acc.credentials.refreshToken,
                  expiresAt: result.data!.newCredentials.expiresAt ?? acc.credentials.expiresAt
                }
              : acc.credentials

            // 合并 usage 数据，确保包含所有必要字段
            const apiUsage = result.data!.usage
            const mergedUsage = apiUsage ? {
              current: apiUsage.current ?? acc.usage.current,
              limit: apiUsage.limit ?? acc.usage.limit,
              percentUsed: apiUsage.limit > 0 ? apiUsage.current / apiUsage.limit : 0,
              lastUpdated: apiUsage.lastUpdated ?? Date.now(),
              baseLimit: apiUsage.baseLimit,
              baseCurrent: apiUsage.baseCurrent,
              freeTrialLimit: apiUsage.freeTrialLimit,
              freeTrialCurrent: apiUsage.freeTrialCurrent,
              freeTrialExpiry: apiUsage.freeTrialExpiry,
              bonuses: apiUsage.bonuses,
              nextResetDate: apiUsage.nextResetDate,
              resourceDetail: apiUsage.resourceDetail
            } : acc.usage

            // 合并订阅信息
            const apiSub = result.data!.subscription
            const mergedSubscription = apiSub ? {
              ...acc.subscription,
              ...apiSub
            } : acc.subscription

            // 转换 IDP 类型（保持原值优先，只有明确匹配时才更新）
            const apiIdp = result.data!.idp
            let idpType = acc.idp
            if (apiIdp) {
              if (apiIdp === 'BuilderId') idpType = 'BuilderId'
              else if (apiIdp === 'Google') idpType = 'Google'
              else if (apiIdp === 'Github') idpType = 'Github'
              else if (apiIdp === 'AWSIdC') idpType = 'AWSIdC'
              else if (apiIdp === 'Enterprise' || apiIdp === 'Internal') idpType = 'Enterprise'
              // 未知类型保持原值，不强制改为 Internal
            }

            accounts.set(id, {
              ...acc,
              // 更新邮箱（如果 API 返回了）
              email: result.data!.email ?? acc.email,
              userId: result.data!.userId ?? acc.userId,
              idp: idpType,
              status: result.data!.status as AccountStatus,
              usage: mergedUsage,
              subscription: mergedSubscription as AccountSubscription,
              credentials: updatedCredentials,
              lastCheckedAt: Date.now(),
              lastError: undefined
            })
          }
          return { accounts }
        })
        get().saveToStorage()
        
        // 如果刷新了 token，打印日志
        if (result.data.newCredentials) {
          console.log(`[Account] Token refreshed for ${account?.email}`)
        }
      } else {
        // 检查是否是封禁错误
        const isBanned = (result.error as { isBanned?: boolean })?.isBanned
        if (isBanned) {
          // 封禁账户：设置错误状态并标记为封禁
          updateAccountStatus(id, 'error', `账户已封禁: ${result.error?.message}`)
        } else {
          updateAccountStatus(id, 'error', result.error?.message)
        }
      }
    } catch (error) {
      if (get().accounts.get(id)?.credentials.refreshToken !== account.credentials.refreshToken) return
      updateAccountStatus(id, 'error', error instanceof Error ? error.message : 'Unknown error')
    }
  },

  batchCheckStatus: async (ids) => {
    const { accounts, autoRefreshConcurrency } = get()
    
    // 收集需要检查的账号（使用批量检查 API，不刷新 Token）
    const accountsToCheck: Array<{
      id: string
      email: string
      credentials: {
        accessToken: string
        refreshToken?: string
        clientId?: string
        clientSecret?: string
        region?: string
        authMethod?: string
        provider?: string
      }
      idp?: string
    }> = []

    for (const id of ids) {
      const account = accounts.get(id)
      if (!account?.credentials.accessToken) continue
      
      accountsToCheck.push({
        id,
        email: account.email,
        credentials: {
          accessToken: account.credentials.accessToken,
          refreshToken: account.credentials.refreshToken,
          clientId: account.credentials.clientId,
          clientSecret: account.credentials.clientSecret,
          region: account.credentials.region,
          authMethod: account.credentials.authMethod,
          provider: account.credentials.provider
        },
        idp: account.idp
      })
    }

    if (accountsToCheck.length === 0) {
      return { success: 0, failed: 0, errors: [] }
    }

    console.log(`[BatchCheck] Triggering background check for ${accountsToCheck.length} accounts...`)
    
    // 使用后台检查 API（只检查状态，不刷新 Token）
    const result = await window.api.backgroundBatchCheck(accountsToCheck, autoRefreshConcurrency)
    
    return { 
      success: result.successCount, 
      failed: result.failedCount, 
      errors: [] 
    }
  },

  // ==================== 统计 ====================

  getStats: () => {
    const { accounts } = get()

    // 引用缓存命中：避免每次重渲染重新 O(n) 遍历
    if (_statsCache && _statsCache.accounts === accounts) {
      return _statsCache.output
    }

    const accountList = Array.from(accounts.values())

    const stats: AccountStats = {
      total: accountList.length,
      byStatus: {
        active: 0,
        expired: 0,
        error: 0,
        refreshing: 0,
        unknown: 0
      },
      bySubscription: {
        Free: 0,
        Pro: 0,
        Pro_Plus: 0,
        Enterprise: 0,
        Teams: 0
      },
      byIdp: {
        Google: 0,
        Github: 0,
        BuilderId: 0,
        Enterprise: 0,
        AWSIdC: 0,
        Internal: 0,
        IAM_SSO: 0
      },
      activeCount: 0,
      expiringSoonCount: 0,
      bannedCount: 0
    }

    for (const account of accountList) {
      stats.byStatus[account.status]++
      stats.bySubscription[account.subscription.type]++
      stats.byIdp[account.idp]++

      if (account.isActive) stats.activeCount++
      if (account.subscription.daysRemaining !== undefined &&
          account.subscription.daysRemaining <= 7) {
        stats.expiringSoonCount++
      }
      // 统计封禁账号
      if (isBannedAccountError(account.lastError)) {
        stats.bannedCount++
      }
    }

    _statsCache = { accounts, output: stats }
    return stats
  },

  // ==================== 持久化 ====================

  loadFromStorage: () => {
    if (storageLoad) return storageLoad
    const baseline = lastSavedState || get()
    const generation = ++ssoGeneration
    set({ isLoading: true, storageError: null })
    get().stopAutoSave()
    const task = Promise.resolve()
      .then(async () => {
        try {
          // 获取应用版本号
          const [data, appVersion] = await Promise.all([
            window.api.loadAccounts(),
            window.api.getAppVersion().catch(() => get().appVersion)
          ])
          set({ appVersion })
          if (data !== null) validateAccountData(data)

          if (data) {
            const accounts = new Map(Object.entries(data.accounts ?? {}) as [string, Account][])
            const activeAccountId = data.activeAccountId ?? null

            // 为没有 machineId 的现有账户生成一个
            let needsSave = false
            for (const [id, raw] of accounts) {
              const account = normalizeStoredAccount(id, raw)
              if (account !== raw) {
                accounts.set(id, account)
                needsSave = true
              }
              if (!account.machineId) {
                account.machineId = generateRandomMachineId()
                accounts.set(id, account)
                needsSave = true
                console.log(
                  `[Store] Generated machineId for account ${account.email}: ${account.machineId.substring(0, 16)}...`
                )
              }
            }

            const history = Array.isArray(data.machineIdHistory)
              ? data.machineIdHistory.filter(
                  (entry) =>
                    entry &&
                    typeof entry.id === 'string' &&
                    typeof entry.machineId === 'string' &&
                    Number.isFinite(entry.timestamp) &&
                    ['initial', 'manual', 'auto_switch', 'restore', 'bind'].includes(entry.action)
                )
              : []
            const initial = history.find(
              (entry) => entry.action === 'initial' && normalizeMachineId(entry.machineId)
            )
            const original =
              normalizeMachineId(data.originalMachineId) || normalizeMachineId(initial?.machineId)
            const machineBindings = Object.fromEntries(
              Object.entries(data.accountMachineIds || {})
                .filter(([id, value]) => accounts.has(id) && normalizeMachineId(value))
                .map(([id, value]) => [id, normalizeMachineId(value)!])
            )
            if (
              original !== (data.originalMachineId ?? null) ||
              Object.keys(machineBindings).length !==
                Object.keys(data.accountMachineIds || {}).length
            )
              needsSave = true

            // 根据 activeAccountId 重新同步所有账号的 isActive 状态，确保只有一个账号为激活状态
            for (const [id, account] of accounts) {
              const shouldBeActive = id === activeAccountId
              if (account.isActive !== shouldBeActive) {
                accounts.set(id, { ...account, isActive: shouldBeActive })
              }
            }

            const loaded = {
              accounts,
              groups: new Map(Object.entries(data.groups ?? {}) as [string, AccountGroup][]),
              tags: new Map(Object.entries(data.tags ?? {}) as [string, AccountTag][]),
              activeAccountId,
              autoRefreshEnabled: data.autoRefreshEnabled ?? true,
              autoRefreshInterval: data.autoRefreshInterval ?? 5,
              autoRefreshConcurrency: tokenRefreshConcurrency(data.autoRefreshConcurrency),
              autoRefreshSyncInfo: data.autoRefreshSyncInfo ?? true,
              batchImportConcurrency: tokenRefreshConcurrency(data.batchImportConcurrency),
              loginPrivateMode: data.loginPrivateMode ?? false,
              statusCheckInterval: data.statusCheckInterval ?? 60,
              privacyMode: data.privacyMode ?? false,
              usagePrecision: data.usagePrecision ?? false,
              proxyEnabled: data.proxyEnabled ?? false,
              proxyUrl: data.proxyUrl ?? '',
              autoSwitchEnabled: data.autoSwitchEnabled ?? false,
              autoSwitchThreshold: data.autoSwitchThreshold ?? 0,
              autoSwitchInterval: data.autoSwitchInterval ?? 5,
              switchTarget: data.switchTarget ?? 'ide',
              theme: resolveThemeMode(data.theme),
              darkMode: data.darkMode ?? false,
              language: resolveLanguage(data.language),
              machineIdConfig: data.machineIdConfig ?? {
                autoSwitchOnAccountChange: false,
                bindMachineIdToAccount: false,
                useBindedMachineId: true
              },
              originalMachineId: original,
              originalBackupTime: original
                ? Number.isFinite(data.originalBackupTime)
                  ? data.originalBackupTime!
                  : (initial?.timestamp ?? Date.now())
                : null,
              accountMachineIds: machineBindings,
              machineIdHistory: history,
              proxyPool: data.proxyPool
                ? new Map(Object.entries(data.proxyPool as Record<string, ProxyEntry>))
                : new Map<string, ProxyEntry>(),
              proxyPoolConfig: {
                ...DEFAULT_PROXY_POOL_CONFIG,
                ...(data.proxyPoolConfig as Partial<ProxyPoolConfig> | undefined)
              },
              proxyPoolCursor: typeof data.proxyPoolCursor === 'number' ? data.proxyPoolCursor : 0,
              accountProxyBindings:
                (data.accountProxyBindings as Record<string, string> | undefined) || {}
            }
            const current = get()
            const merged = { ...loaded }
            const incoming = { ...current, ...loaded }
            for (const key of persistedKeys) {
              if (!(key in loaded) || current[key] === baseline[key]) continue
              if (key === 'accounts' || key === 'groups' || key === 'tags' || key === 'proxyPool')
                continue
              Object.assign(merged, { [key]: current[key] })
            }
            merged.accounts = mergeLoadedMap(loaded.accounts, baseline.accounts, current.accounts)
            merged.groups = mergeLoadedMap(loaded.groups, baseline.groups, current.groups)
            merged.tags = mergeLoadedMap(loaded.tags, baseline.tags, current.tags)
            merged.proxyPool = mergeLoadedMap(
              loaded.proxyPool,
              baseline.proxyPool,
              current.proxyPool
            )
            // Account activation is owned by activeAccountId, including a switch during a read.
            for (const [id, account] of merged.accounts) {
              const active = id === merged.activeAccountId
              if (account.isActive !== active)
                merged.accounts.set(id, { ...account, isActive: active })
            }
            set({ ...merged, storageLoaded: true })
            lastSavedState = incoming
            needsStorageMigration = needsSave

            // 应用主题
            get().applyTheme()

            // 如果代理已启用，通过 store 的 setProxy（会自动 normalize URL 并回写 UI）
            if (get().proxyEnabled && get().proxyUrl) {
              void get().setProxy(true, get().proxyUrl)
            }

            // 如果自动换号已启用，启动定时器
            if (get().autoSwitchEnabled) {
              get().startAutoSwitch()
            }

            // 如果生成了新的 machineId，保存到存储
            if (needsSave) {
              console.log('[Store] Saving accounts with newly generated machineIds')
              get().saveToStorage()
            }

            // SSO 同步（含潜在网络请求）异步执行，不阻塞首屏加载
            // 完成后通过 set 应用结果，UI 会自然更新
            queueMicrotask(() => {
              if (generation !== ssoGeneration || localSsoSync) return
              localSsoSync = syncLocalSsoAccountAsync(get, set).finally(() => {
                localSsoSync = null
              })
            })
          } else {
            set({ storageLoaded: true })
            lastSavedState = baseline
            needsStorageMigration = false
          }
          get().startAutoSave()
        } catch (error) {
          set({ storageError: error instanceof Error ? error.message : String(error) })
          throw error
        } finally {
          set({ isLoading: false })
        }
      })
      .finally(() => {
        if (storageLoad === task) storageLoad = null
      })
    storageLoad = task
    // Fire-and-forget scheduling runs only after the load promise has been released.
    void task.then(
      () => {
        if (hasUnsavedChanges(get())) get().saveToStorage()
      },
      () => {}
    )
    return task
  },

  /** Schedule one durable save; attach an observer for ordinary fire-and-forget mutations. */
  saveToStorage: () => {
    const promise = new Promise<void>((resolve, reject) => {
      if (!get().storageLoaded || get().isLoading || get().storageError) {
        reject(new Error(get().storageError || '账号数据尚未加载，已暂停保存'))
        return
      }
      savePendingWaiters.push({ resolve, reject })
      const flushNow = (): void => {
        void get()
          .flushSaveImmediately()
          .catch(() => {})
      }
      if (saveDebounceTimer) clearTimeout(saveDebounceTimer)
      saveDebounceTimer = setTimeout(flushNow, SAVE_DEBOUNCE_MS)
      if (!saveMaxWaitTimer) saveMaxWaitTimer = setTimeout(flushNow, SAVE_MAX_WAIT_MS)
    })
    // Callers that await the returned promise still receive the original write failure.
    void promise.catch(() => {})
    return promise
  },

  /**
   * 立即落盘（跳过防抖）。用于 beforeunload、关键操作前后强制持久化场景。
   * 并发调用会自动等待同一次 in-flight 保存，避免重入。
   */
  flushSaveImmediately: async () => {
    if (storageLoad) await storageLoad
    if (!get().storageLoaded || get().storageError)
      throw new Error(get().storageError || '账号数据尚未加载，已暂停保存')
    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer)
      saveDebounceTimer = null
    }
    if (saveMaxWaitTimer) {
      clearTimeout(saveMaxWaitTimer)
      saveMaxWaitTimer = null
    }
    if (saveInFlight) {
      // 等待旧快照后重新检查，不能把旧写入当作本次新变更已保存。
      try {
        await saveInFlight
      } catch {
        // 旧请求失败时，新请求仍尝试保存自己的最新快照。
      }
      return get().flushSaveImmediately()
    }

    const snapshot = get()
    const waiting = savePendingWaiters
    savePendingWaiters = []
    if (!hasUnsavedChanges(snapshot)) {
      for (const waiter of waiting) waiter.resolve()
      return
    }

    // 推迟到微任务，确保同步抛错/同步状态通知时也已设置 saveInFlight。
    saveInFlight = Promise.resolve().then(async () => {
      set({ isSyncing: true })
      try {
        // One persisted field list; only Map values need transport conversion.
        const fields = Object.fromEntries(persistedKeys.map((key) => [key, snapshot[key]])) as Pick<
          AccountsState,
          (typeof persistedKeys)[number]
        >
        await window.api.saveAccounts({
          ...fields,
          accounts: Object.fromEntries(snapshot.accounts),
          groups: Object.fromEntries(snapshot.groups),
          tags: Object.fromEntries(snapshot.tags),
          proxyPool: Object.fromEntries(snapshot.proxyPool)
        })
        lastSavedState = snapshot
        needsStorageMigration = false
        set({ storageSaveError: null })
        for (const waiter of waiting) waiter.resolve()
      } catch (error) {
        set({ storageSaveError: error instanceof Error ? error.message : String(error) })
        for (const waiter of waiting) waiter.reject(error)
        throw error
      } finally {
        saveInFlight = null
        set({ isSyncing: false })
      }
    })

    return saveInFlight
  },

  // ==================== 设置 ====================

  setAutoRefresh: (enabled, interval) => {
    set({
      autoRefreshEnabled: enabled,
      autoRefreshInterval: interval ?? get().autoRefreshInterval
    })
    get().saveToStorage()
    
    // 重新启动定时器
    if (enabled) {
      get().startAutoTokenRefresh()
    } else {
      get().stopAutoTokenRefresh()
    }
  },

  setAutoRefreshConcurrency: (concurrency) => {
    set({ autoRefreshConcurrency: tokenRefreshConcurrency(concurrency) })
    get().saveToStorage()
  },

  setAutoRefreshSyncInfo: (enabled) => {
    set({ autoRefreshSyncInfo: enabled })
    get().saveToStorage()
  },

  setProactiveRenewalEnabled: async (enabled) => {
    if (typeof window.api?.setProactiveRenewalEnabled !== 'function') {
      return { success: false, error: 'API not available' }
    }
    const result = await window.api.setProactiveRenewalEnabled(enabled)
    if (result.success) {
      set({ proactiveRenewalEnabled: !!result.enabled })
    }
    return { success: result.success, error: result.error }
  },

  loadProactiveRenewalEnabled: async () => {
    if (typeof window.api?.getProactiveRenewalEnabled !== 'function') return
    try {
      const result = await window.api.getProactiveRenewalEnabled()
      if (result.success) {
        set({
          proactiveRenewalEnabled: !!result.enabled
        })
      }
    } catch (e) {
      console.warn('[Store] loadProactiveRenewalEnabled failed:', e)
    }
  },

  setStatusCheckInterval: (interval) => {
    set({ statusCheckInterval: interval })
    get().saveToStorage()
  },

  // ==================== 隐私模式 ====================

  setPrivacyMode: (enabled) => {
    set({ privacyMode: enabled })
    get().saveToStorage()
  },

  maskEmail: (email) => {
    if (!get().privacyMode || !email) return email
    // 生成固定长度的随机字符串作为伪装邮箱
    const hash = email.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    const maskedName = `user${(hash % 100000).toString().padStart(5, '0')}`
    return `${maskedName}@***.com`
  },

  maskNickname: (nickname) => {
    if (!get().privacyMode || !nickname) return nickname || ''
    // 基于原始昵称生成固定的伪装昵称
    const hash = nickname.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    return `用户${(hash % 100000).toString().padStart(5, '0')}`
  },

  // ==================== 使用量精度 ====================

  setUsagePrecision: (enabled) => {
    set({ usagePrecision: enabled })
    get().saveToStorage()
  },

  // ==================== 代理设置 ====================

  setProxy: async (enabled, url) => {
    const targetUrl = url ?? get().proxyUrl
    set({ 
      proxyEnabled: enabled,
      proxyUrl: targetUrl
    })
    get().saveToStorage()
    // 通知主进程更新代理设置，并用规范化后的 URL 回写 store
    try {
      const result = await window.api.setProxy?.(enabled, targetUrl)
      if (result?.normalizedUrl && result.normalizedUrl !== targetUrl) {
        set({ proxyUrl: result.normalizedUrl })
        get().saveToStorage()
      }
    } catch (err) {
      console.error('[Store] setProxy IPC failed:', err)
    }
  },

  // ==================== 主题设置 ====================

  setTheme: (theme) => {
    set({ theme: resolveThemeMode(theme) })
    get().saveToStorage()
    get().applyTheme()
  },

  setDarkMode: (enabled) => {
    set({ theme: enabled ? 'dark' : 'light', darkMode: enabled })
    get().saveToStorage()
    get().applyTheme()
  },

  // ==================== 语言设置 ====================

  setLanguage: (language) => {
    set({ language })
    get().saveToStorage()
    window.api.updateTrayLanguage(language)
  },

  applyTheme: () => {
    const { theme } = get()
    const darkMode = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', darkMode)
    if (get().darkMode !== darkMode) set({ darkMode })
  },

  // ==================== 自动换号 ====================

  setAutoSwitch: (enabled, threshold, interval) => {
    set({
      autoSwitchEnabled: enabled,
      autoSwitchThreshold: threshold ?? get().autoSwitchThreshold,
      autoSwitchInterval: interval ?? get().autoSwitchInterval
    })
    get().saveToStorage()
    
    // 重新启动定时器
    if (enabled) {
      get().startAutoSwitch()
    } else {
      get().stopAutoSwitch()
    }
  },

  setBatchImportConcurrency: (concurrency) => {
    set({ batchImportConcurrency: tokenRefreshConcurrency(concurrency) })
    get().saveToStorage()
  },

  setLoginPrivateMode: (enabled) => {
    set({ loginPrivateMode: enabled })
    get().saveToStorage()
  },

  setSwitchTarget: (target) => {
    set({ switchTarget: target })
    get().saveToStorage()
  },

  startAutoSwitch: () => {
    const { autoSwitchEnabled, autoSwitchInterval, checkAndAutoSwitch } = get()
    
    if (!autoSwitchEnabled) return
    
    // 清除现有定时器
    if (autoSwitchTimer) {
      clearInterval(autoSwitchTimer)
    }
    
    // 立即检查一次
    checkAndAutoSwitch()
    
    // 设置定时检查
    autoSwitchTimer = setInterval(() => {
      checkAndAutoSwitch()
    }, autoSwitchInterval * 60 * 1000)
    
    console.log(`[AutoSwitch] Started with interval: ${autoSwitchInterval} minutes`)
  },

  stopAutoSwitch: () => {
    if (autoSwitchTimer) {
      clearInterval(autoSwitchTimer)
      autoSwitchTimer = null
      console.log('[AutoSwitch] Stopped')
    }
  },

  checkAndAutoSwitch: async () => {
    if (autoSwitchInFlight) return
    autoSwitchInFlight = true
    try {
      const active = get().getActiveAccount()
      if (!active) return
      await get().checkAccountStatus(active.id)
      const state = get()
      const updated = state.accounts.get(active.id)
      if (state.activeAccountId !== active.id || !updated || updated.status !== 'active') return
      if (updated.usage.limit - updated.usage.current > state.autoSwitchThreshold) return
      const candidate = Array.from(state.accounts.values()).find((account) =>
        account.id !== active.id && !isBannedAccountError(account.lastError) &&
        account.usage.limit - account.usage.current > state.autoSwitchThreshold &&
        !!account.credentials.refreshToken && (account.credentials.authMethod === 'social' ||
          !!(account.credentials.clientId && account.credentials.clientSecret)))
      if (candidate) {
        const result = await get().switchAccount(candidate.id)
        if (!result.success) console.warn('[AutoSwitch]', result.error)
      }
    } finally { autoSwitchInFlight = false }
  },

  // ==================== 自动 Token 刷新 ====================

  checkAndRefreshExpiringTokens: async () => {
    const state = get()
    const accounts = collectRefreshAccounts(state)
    if (accounts.length) await window.api.backgroundBatchRefresh(accounts, state.autoRefreshConcurrency, true)
  },



  startAutoTokenRefresh: () => {
    const { autoRefreshEnabled, autoRefreshInterval } = get()
    
    // 如果已有定时器，先停止
    if (tokenRefreshTimer) {
      clearInterval(tokenRefreshTimer)
      tokenRefreshTimer = null
    }
    
    // 如果未启用，不启动定时器
    if (!autoRefreshEnabled) {
      console.log('[AutoRefresh] Auto-refresh is disabled')
      return
    }

    // 启动时触发后台刷新（在主进程执行，不阻塞 UI）
    get().triggerBackgroundRefresh()

    // 使用用户设置的间隔（分钟转毫秒）
    const intervalMs = autoRefreshInterval * 60 * 1000
    tokenRefreshTimer = setInterval(() => {
      get().triggerBackgroundRefresh()
    }, intervalMs)

    console.log(`[AutoRefresh] Token auto-refresh started with interval: ${autoRefreshInterval} minutes`)
  },

  stopAutoTokenRefresh: () => {
    if (tokenRefreshTimer) {
      clearInterval(tokenRefreshTimer)
      tokenRefreshTimer = null
      console.log('[AutoRefresh] Token auto-refresh stopped')
    }
  },

  // 触发后台刷新（在主进程执行，不阻塞 UI）
  triggerBackgroundRefresh: async () => {
    const state = get()
    const accounts = collectRefreshAccounts(state)
    if (accounts.length) await window.api.backgroundBatchRefresh(
      accounts, state.autoRefreshConcurrency, state.autoRefreshSyncInfo || state.autoSwitchEnabled)
  },


  // 批量处理后台刷新结果：合并 N 条结果到一次 set，避免 N 次 Map 全量复制
  applyBackgroundRefreshResults: (items) => {
    if (!items || items.length === 0) return

    set((state) => {
      // 仅一次完整 Map 复制
      const accounts = new Map(state.accounts)
      const now = Date.now()

      for (const data of items) {
        const { id, success, data: resultData, error, expectedRefreshToken } = data
        const account = accounts.get(id)
        if (!account) continue
        if (expectedRefreshToken !== undefined && (account.credentials.refreshToken || '') !== expectedRefreshToken) continue

        if (!success) {
          accounts.set(id, {
            ...account,
            status: 'error',
            lastError: error,
            lastCheckedAt: now
          })
          continue
        }

        const refreshData = resultData as {
        accessToken?: string
        refreshToken?: string
        expiresIn?: number
        expiresAt?: number
        profileArn?: string
        usage?: {
          current?: number
          limit?: number
          baseCurrent?: number
          baseLimit?: number
          freeTrialCurrent?: number
          freeTrialLimit?: number
          freeTrialExpiry?: string
          bonuses?: Array<{ code: string; name: string; current: number; limit: number; expiresAt?: string }>
          nextResetDate?: string
          resourceDetail?: {
            displayName?: string
            displayNamePlural?: string
            resourceType?: string
            currency?: string
            unit?: string
            overageRate?: number
            overageCap?: number
            overageEnabled?: boolean
          }
        }
        subscription?: { type?: string; title?: string; daysRemaining?: number; expiresAt?: number; overageCapability?: string; upgradeCapability?: string; subscriptionManagementTarget?: string }
        userInfo?: { email?: string; userId?: string }
        status?: string
        errorMessage?: string
      } | undefined

      // 检测封禁状态
      const newStatus = refreshData?.status === 'error' ? 'error' as AccountStatus : 'active' as AccountStatus
      const newError = refreshData?.errorMessage

      // 后台刷新时主进程可能返回自动获取的 profileArn，持久化到顶层和 credentials
      const bgProfileArn = refreshData?.profileArn || account.credentials.profileArn || account.profileArn
      accounts.set(id, {
        ...account,
        ...(bgProfileArn ? { profileArn: bgProfileArn } : {}),
        credentials: {
          ...account.credentials,
          accessToken: refreshData?.accessToken || account.credentials.accessToken,
          refreshToken: refreshData?.refreshToken || account.credentials.refreshToken,
          expiresAt: refreshData?.expiresAt ?? (refreshData?.expiresIn ? now + refreshData.expiresIn * 1000 : account.credentials.expiresAt),
          ...(bgProfileArn ? { profileArn: bgProfileArn } : {})
        },
        usage: refreshData?.usage ? (() => {
          const newCurrent = refreshData.usage.current ?? account.usage.current
          const newLimit = refreshData.usage.limit ?? account.usage.limit
          return {
            ...account.usage,
            current: newCurrent,
            limit: newLimit,
            percentUsed: newLimit > 0 ? newCurrent / newLimit : 0,
            baseCurrent: refreshData.usage.baseCurrent ?? account.usage.baseCurrent,
            baseLimit: refreshData.usage.baseLimit ?? account.usage.baseLimit,
            freeTrialCurrent: refreshData.usage.freeTrialCurrent ?? account.usage.freeTrialCurrent,
            freeTrialLimit: refreshData.usage.freeTrialLimit ?? account.usage.freeTrialLimit,
            freeTrialExpiry: refreshData.usage.freeTrialExpiry ?? account.usage.freeTrialExpiry,
            bonuses: refreshData.usage.bonuses ?? account.usage.bonuses,
            nextResetDate: refreshData.usage.nextResetDate ?? account.usage.nextResetDate,
            resourceDetail: refreshData.usage.resourceDetail ?? account.usage.resourceDetail,
            lastUpdated: now
          }
        })() : account.usage,
        subscription: refreshData?.subscription ? {
          ...account.subscription,
          type: (refreshData.subscription.type as SubscriptionType) || account.subscription.type,
          title: refreshData.subscription.title || account.subscription.title,
          daysRemaining: refreshData.subscription.daysRemaining ?? account.subscription.daysRemaining,
          expiresAt: refreshData.subscription.expiresAt ?? account.subscription.expiresAt,
          overageCapability: refreshData.subscription.overageCapability ?? account.subscription.overageCapability,
          upgradeCapability: refreshData.subscription.upgradeCapability ?? account.subscription.upgradeCapability,
          managementTarget: refreshData.subscription.subscriptionManagementTarget ?? account.subscription.managementTarget
        } : account.subscription,
        email: refreshData?.userInfo?.email || account.email,
        userId: refreshData?.userInfo?.userId || account.userId,
        status: newStatus,
        lastError: newError,
        lastCheckedAt: now
      })
      } // end for-loop

      return { accounts }
    })
    void get().saveToStorage()
  },


  // 批量处理后台检查结果：合并 N 条结果到一次 set
  applyBackgroundCheckResults: (items) => {
    if (!items || items.length === 0) return

    set((state) => {
      const accounts = new Map(state.accounts)
      const now = Date.now()

      for (const data of items) {
        const { id, success, data: resultData, error, expectedRefreshToken } = data
        const account = accounts.get(id)
        if (!account) continue
        if (expectedRefreshToken !== undefined && (account.credentials.refreshToken || '') !== expectedRefreshToken) continue

        if (!success) {
          accounts.set(id, {
            ...account,
            status: 'error',
            lastError: error,
            lastCheckedAt: now
          })
          continue
        }

        const checkData = resultData as {
        usage?: {
          current?: number
          limit?: number
          baseCurrent?: number
          baseLimit?: number
          freeTrialCurrent?: number
          freeTrialLimit?: number
          freeTrialExpiry?: string
          bonuses?: Array<{ code: string; name: string; current: number; limit: number; expiresAt?: string }>
          nextResetDate?: string
          resourceDetail?: {
            displayName?: string
            displayNamePlural?: string
            resourceType?: string
            currency?: string
            unit?: string
            overageRate?: number
            overageCap?: number
            overageEnabled?: boolean
          }
        }
        subscription?: { type?: string; title?: string; daysRemaining?: number; expiresAt?: number; overageCapability?: string; upgradeCapability?: string; subscriptionManagementTarget?: string }
        userInfo?: { email?: string; userId?: string }
        status?: string
        errorMessage?: string
        needsRefresh?: boolean
      } | undefined

      // 检测状态
      let newStatus: AccountStatus = 'active'
      if (checkData?.status === 'error') {
        newStatus = 'error'
      } else if (checkData?.status === 'expired' || checkData?.needsRefresh) {
        newStatus = 'expired'
      }
      const newError = checkData?.errorMessage

      accounts.set(id, {
        ...account,
        usage: checkData?.usage ? (() => {
          const newCurrent = checkData.usage.current ?? account.usage.current
          const newLimit = checkData.usage.limit ?? account.usage.limit
          return {
            ...account.usage,
            current: newCurrent,
            limit: newLimit,
            percentUsed: newLimit > 0 ? newCurrent / newLimit : 0,
            baseCurrent: checkData.usage.baseCurrent ?? account.usage.baseCurrent,
            baseLimit: checkData.usage.baseLimit ?? account.usage.baseLimit,
            freeTrialCurrent: checkData.usage.freeTrialCurrent ?? account.usage.freeTrialCurrent,
            freeTrialLimit: checkData.usage.freeTrialLimit ?? account.usage.freeTrialLimit,
            freeTrialExpiry: checkData.usage.freeTrialExpiry ?? account.usage.freeTrialExpiry,
            bonuses: checkData.usage.bonuses ?? account.usage.bonuses,
            nextResetDate: checkData.usage.nextResetDate ?? account.usage.nextResetDate,
            resourceDetail: checkData.usage.resourceDetail ?? account.usage.resourceDetail,
            lastUpdated: now
          }
        })() : account.usage,
        subscription: checkData?.subscription ? {
          ...account.subscription,
          type: (checkData.subscription.type as SubscriptionType) ?? account.subscription.type,
          title: checkData.subscription.title ?? account.subscription.title,
          daysRemaining: checkData.subscription.daysRemaining ?? account.subscription.daysRemaining,
          expiresAt: checkData.subscription.expiresAt ?? account.subscription.expiresAt,
          overageCapability: checkData.subscription.overageCapability ?? account.subscription.overageCapability,
          upgradeCapability: checkData.subscription.upgradeCapability ?? account.subscription.upgradeCapability,
          managementTarget: checkData.subscription.subscriptionManagementTarget ?? account.subscription.managementTarget
        } : account.subscription,
        email: checkData?.userInfo?.email || account.email,
        userId: checkData?.userInfo?.userId || account.userId,
        status: newStatus,
        lastError: newError,
        lastCheckedAt: now
      })
      } // end for-loop

      return { accounts }
    })
    void get().saveToStorage()
  },

  // ==================== 定时自动保存 ====================

  startAutoSave: () => {
    // 如果已有定时器，先停止
    if (autoSaveTimer) {
      clearInterval(autoSaveTimer)
    }

    // 设置定时保存
    autoSaveTimer = setInterval(async () => {
      if (hasUnsavedChanges(get())) {
        console.log('[AutoSave] Data changed, saving...')
        try {
          await get().saveToStorage()
          console.log('[AutoSave] Data saved successfully')
        } catch (error) { console.warn('[AutoSave] Save failed:', error) }
      }
    }, AUTO_SAVE_INTERVAL)

    console.log(`[AutoSave] Auto-save started with interval: ${AUTO_SAVE_INTERVAL / 1000}s`)
  },

  stopAutoSave: () => {
    if (autoSaveTimer) {
      clearInterval(autoSaveTimer)
      autoSaveTimer = null
      console.log('[AutoSave] Auto-save stopped')
    }
  },

  // ==================== 机器码管理 ====================

  setMachineIdConfig: (config) => {
    set((state) => ({
      machineIdConfig: { ...state.machineIdConfig, ...config }
    }))
    get().saveToStorage()
  },

  refreshCurrentMachineId: () => readSystemMachineId(),
  changeMachineId: (newMachineId, context) =>
    mutateSystemMachineId(
      () => newMachineId || crypto.randomUUID(),
      context || { action: 'manual' }
    ),
  restoreOriginalMachineId: () =>
    mutateSystemMachineId(() => get().originalMachineId, { action: 'restore' }),

  bindMachineIdToAccount: (accountId, machineId) => {
    const account = get().accounts.get(accountId)
    if (!account) return false
    const boundMachineId = normalizeMachineId(machineId || crypto.randomUUID())
    if (!boundMachineId) {
      set({ machineIdError: '无效的机器码格式' })
      return false
    }

    set((state) => ({
      machineIdError: null,
      accountMachineIds: {
        ...state.accountMachineIds,
        [accountId]: boundMachineId
      },
      machineIdHistory: [
        ...state.machineIdHistory,
        {
          id: crypto.randomUUID(),
          machineId: boundMachineId,
          timestamp: Date.now(),
          action: 'bind',
          accountId,
          accountEmail: account.email
        }
      ]
    }))
    get().saveToStorage()
    return true
  },

  unbindMachineIdFromAccount: (accountId) => {
    const next = { ...get().accountMachineIds }
    delete next[accountId]
    set({ accountMachineIds: next })
    void get().saveToStorage()
  },

  backupOriginalMachineId: () => {
    const { currentMachineId, originalMachineId } = get()

    // 只有在没有备份且有当前机器码时才备份
    if (!originalMachineId && currentMachineId) {
      set((s) => ({
        originalMachineId: currentMachineId,
        originalBackupTime: Date.now(),
        machineIdHistory: [
          ...s.machineIdHistory,
          {
            id: crypto.randomUUID(),
            machineId: currentMachineId,
            timestamp: Date.now(),
            action: 'initial'
          }
        ]
      }))

      get().saveToStorage()
      console.log('[MachineId] Original machine ID backed up:', currentMachineId)
    }
  },

  clearMachineIdHistory: () => {
    set({ machineIdHistory: [] })
    get().saveToStorage()
  },

  // ==================== 代理池 ====================

  addProxy: (url, options) => {
    const parsed = parseProxyUrl(url)
    if (!parsed) return null

    // 去重：同 host:port:protocol:username 视为重复
    // 含 username 以支持 bestproxy 等「单入口、靠用户名区分地区/会话」的轮换代理添加多条
    const existingPool = get().proxyPool
    for (const entry of existingPool.values()) {
      if (
        entry.host === parsed.host &&
        entry.port === parsed.port &&
        entry.protocol === parsed.protocol &&
        (entry.username || '') === (parsed.username || '')
      ) {
        return null
      }
    }

    const id = uuidv4()
    const entry: ProxyEntry = {
      id,
      url: parsed.normalized,
      protocol: parsed.protocol,
      host: parsed.host,
      port: parsed.port,
      username: parsed.username,
      password: parsed.password,
      label: options?.label,
      source: options?.source ?? 'manual',
      tags: options?.tags,
      status: 'untested',
      usedCount: 0,
      failCount: 0,
      enabled: true,
      createdAt: Date.now()
    }

    set((state) => {
      const next = new Map(state.proxyPool)
      next.set(id, entry)
      return { proxyPool: next }
    })
    get().saveToStorage()
    syncProxyAvailabilityChange(existingPool)
    return id
  },

  importProxies: (text) =>
    get().addProxies(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((url) => ({ url }))
    ),

  addProxies: (entries) => {
    const result = { added: 0, skipped: 0, failed: 0 }
    if (entries.length === 0) return result
    // 批量构造新条目，最后只 set 一次，避免 O(n²) re-render
    const existingPool = get().proxyPool
    const existingKeys = new Set<string>()
    for (const entry of existingPool.values()) {
      existingKeys.add(`${entry.protocol}://${entry.username || ''}@${entry.host}:${entry.port}`)
    }
    const newEntries: ProxyEntry[] = []

    for (const input of entries) {
      const parsed = parseProxyUrl(input.url)
      if (!parsed) {
        result.failed++
        continue
      }
      const key = `${parsed.protocol}://${parsed.username || ''}@${parsed.host}:${parsed.port}`
      if (existingKeys.has(key)) {
        result.skipped++
        continue
      }
      existingKeys.add(key)
      newEntries.push({
        id: uuidv4(),
        url: parsed.normalized,
        protocol: parsed.protocol,
        host: parsed.host,
        port: parsed.port,
        username: parsed.username,
        password: parsed.password,
        label: input.label,
        tags: input.tags,
        source: input.source ?? 'import',
        status: 'untested',
        usedCount: 0,
        failCount: 0,
        enabled: true,
        createdAt: Date.now()
      })
      result.added++
    }

    if (newEntries.length > 0) {
      set((state) => {
        const next = new Map(state.proxyPool)
        for (const e of newEntries) next.set(e.id, e)
        return { proxyPool: next }
      })
      get().saveToStorage()
      syncProxyAvailabilityChange(existingPool)
    }
    return result
  },

  removeProxy: (id) => {
    const previousPool = get().proxyPool
    // 收集受影响的账号（绑定到该代理的账号）
    const affectedAccountIds = Object.entries(get().accountProxyBindings)
      .filter(([, pid]) => pid === id)
      .map(([aid]) => aid)
    set((state) => {
      const next = new Map(state.proxyPool)
      next.delete(id)
      // 同步清理绑定
      const bindings = { ...state.accountProxyBindings }
      for (const aid of affectedAccountIds) delete bindings[aid]
      return { proxyPool: next, accountProxyBindings: bindings }
    })
    get().saveToStorage()
    syncProxyAvailabilityChange(previousPool)
    // 通知主进程：这些账号现在无代理绑定，回退全局
    for (const aid of affectedAccountIds) syncAccountProxyToMain(aid)
  },

  removeProxies: (ids) => {
    const previousPool = get().proxyPool
    if (ids.length === 0) return
    const idSet = new Set(ids)
    const affectedAccountIds = Object.entries(get().accountProxyBindings)
      .filter(([, pid]) => idSet.has(pid))
      .map(([aid]) => aid)
    set((state) => {
      const next = new Map(state.proxyPool)
      for (const id of ids) next.delete(id)
      const bindings = { ...state.accountProxyBindings }
      for (const aid of affectedAccountIds) delete bindings[aid]
      return { proxyPool: next, accountProxyBindings: bindings }
    })
    get().saveToStorage()
    syncProxyAvailabilityChange(previousPool)
    for (const aid of affectedAccountIds) syncAccountProxyToMain(aid)
  },

  toggleProxyEnabled: (id, enabled) => {
    const previousPool = get().proxyPool
    set((state) => {
      const next = new Map(state.proxyPool)
      const entry = next.get(id)
      if (entry) {
        next.set(id, { ...entry, enabled: enabled ?? !entry.enabled })
      }
      return { proxyPool: next }
    })
    get().saveToStorage()
    // 通知所有绑定该代理的账号更新主进程内存（启用变化会影响是否可用）
    if (!syncProxyAvailabilityChange(previousPool)) syncAllAccountsBoundToProxy(id)
  },

  updateProxy: (id, updates) => {
    const previousPool = get().proxyPool
    set((state) => {
      const next = new Map(state.proxyPool)
      const entry = next.get(id)
      if (entry) {
        next.set(id, {
          ...entry,
          ...updates,
          ...(updates.url && updates.url !== entry.url && entry.status === 'testing'
            ? {
                status: 'untested',
                lastError: undefined,
                latencyMs: undefined,
                lastTestedAt: undefined
              }
            : {})
        })
      }
      return { proxyPool: next }
    })
    get().saveToStorage()
    // url / 启用状态 / 状态变化都需要同步绑定账号
    if ('url' in updates || 'enabled' in updates || 'status' in updates) {
      if (!syncProxyAvailabilityChange(previousPool)) syncAllAccountsBoundToProxy(id)
    }
  },

  validateProxy: async (id) => {
    const entry = get().proxyPool.get(id)
    if (!entry) return { success: false, error: 'Proxy not found' }
    markProxiesTesting([entry])
    const result = await enqueueProxyValidation(entry)
    flushProxyValidationResults()
    return result
  },

  validateProxiesBatch: async (ids, concurrency = 5) => {
    const entries = [...new Set(ids)]
      .map((id) => get().proxyPool.get(id))
      .filter((entry): entry is ProxyEntry => !!entry)
    if (!entries.length) return
    proxyValidationLimit = Math.max(1, Math.min(500, Math.floor(concurrency) || 5))
    markProxiesTesting(entries)
    await Promise.all(entries.map(enqueueProxyValidation))
    flushProxyValidationResults()
  },

  replaceProxyPool: (entries) => {
    const previousBindings = get().accountProxyBindings
    const pool = new Map(entries.map((entry) => [entry.id, entry]))
    const bindings = Object.fromEntries(
      Object.entries(previousBindings).filter(([, id]) => pool.has(id))
    )
    set({ proxyPool: pool, proxyPoolCursor: 0, accountProxyBindings: bindings })
    void get().saveToStorage()
    for (const id of Object.keys(previousBindings)) syncAccountProxyToMain(id)
  },

  clearProxyPool: () => {
    const affectedAccountIds = Object.keys(get().accountProxyBindings)
    set({ proxyPool: new Map(), proxyPoolCursor: 0, accountProxyBindings: {} })
    get().saveToStorage()
    // 通知所有曾被绑定的账号回退全局
    for (const aid of affectedAccountIds) syncAccountProxyToMain(aid)
  },

  setProxyPoolConfig: (config) => {
    set((state) => ({
      proxyPoolConfig: { ...state.proxyPoolConfig, ...config }
    }))
    get().saveToStorage()
  },

  pickNextProxy: () => {
    const { proxyPool, proxyPoolConfig, proxyPoolCursor } = get()
    if (!proxyPoolConfig.enabled) return null

    // 仅在启用且非 dead 的代理中挑选
    const enabled = Array.from(proxyPool.values()).filter((proxy) => proxy.enabled)
    const healthy = enabled.filter((proxy) => !isDeadProxy(proxy))
    const candidates = healthy.length ? healthy : enabled
    if (candidates.length === 0) return null

    let picked: ProxyEntry
    switch (proxyPoolConfig.strategy) {
      case 'random':
        picked = candidates[Math.floor(Math.random() * candidates.length)]
        break
      case 'least_used':
        picked = candidates.reduce((min, cur) => (cur.usedCount < min.usedCount ? cur : min))
        break
      case 'fastest':
        // 已测过的优先按延迟升序；未测过的排最后
        picked = candidates.reduce((best, current) => (current.latencyMs ?? Infinity) < (best.latencyMs ?? Infinity) ? current : best)
        break
      case 'round_robin':
      default: {
        const idx = proxyPoolCursor % candidates.length
        picked = candidates[idx]
        set({ proxyPoolCursor: proxyPoolCursor + 1 })
        break
      }
    }

    // 更新使用计数（即时反映到 UI，使用 saveToStorage 防抖）
    set((state) => {
      const next = new Map(state.proxyPool)
      const existing = next.get(picked.id)
      if (existing) {
        next.set(picked.id, { ...existing, usedCount: existing.usedCount + 1, lastUsedAt: Date.now() })
      }
      return { proxyPool: next }
    })
    get().saveToStorage()
    return picked
  },

  reportProxyResult: (id, success, boundEmail, errorMsg) => {
    let autoDisabled = false
    set((state) => {
      const next = new Map(state.proxyPool)
      const existing = next.get(id)
      if (!existing) return state
      // 仅「代理连接层错误」才累加 failCount；AWS 业务/风控失败（如 Portal/EOF/邮箱已注册）不计，
      // 避免把好代理（尤其只配了一条的轮换代理）误判停用导致变直连暴露真实 IP。
      const isProxyFail = !success && isProxyConnectionError(errorMsg)
      const failCount = isProxyFail ? existing.failCount + 1 : existing.failCount
      // 轮换代理保护：池中可用代理 <= 1 时不自动停用
      const enabledCount = Array.from(state.proxyPool.values()).filter((p) => p.enabled && p.status !== 'dead').length
      const autoDisable = isProxyFail
        && state.proxyPoolConfig.autoDisableDead
        && failCount >= state.proxyPoolConfig.failureThreshold
        && enabledCount > 1
      autoDisabled = autoDisable
      next.set(id, {
        ...existing,
        failCount,
        lastBoundEmail: boundEmail || existing.lastBoundEmail,
        lastError: success ? existing.lastError : (errorMsg || existing.lastError),
        enabled: autoDisable ? false : existing.enabled,
        status: autoDisable ? 'dead' : existing.status
      })
      return { proxyPool: next }
    })
    get().saveToStorage()
    // 仅在代理被自动停用时通知主进程（普通 used/failCount 计数变化无需同步）
    if (autoDisabled) {
      syncAllAccountsBoundToProxy(id)
    }
  },

  // ==================== 账号-代理绑定 ====================

  bindAccountToProxy: (accountId, proxyId) => {
    set((state) => ({
      accountProxyBindings: { ...state.accountProxyBindings, [accountId]: proxyId }
    }))
    get().saveToStorage()
    // 同步到主进程的账号池
    syncAccountProxyToMain(accountId)
  },

  bindAccountsToProxy: (accountIds, proxyId) => {
    if (accountIds.length === 0) return
    set((state) => {
      const next = { ...state.accountProxyBindings }
      for (const id of accountIds) next[id] = proxyId
      return { accountProxyBindings: next }
    })
    get().saveToStorage()
    for (const id of accountIds) syncAccountProxyToMain(id)
  },

  unbindAccountFromProxy: (accountId) => {
    get().unbindAccountsFromProxy([accountId])
  },

  unbindAccountsFromProxy: (accountIds) => {
    const bindings = get().accountProxyBindings
    const boundIds = [...new Set(accountIds)].filter((id) => Object.hasOwn(bindings, id))
    if (boundIds.length === 0) return
    set((state) => {
      const next = { ...state.accountProxyBindings }
      for (const id of boundIds) delete next[id]
      return { accountProxyBindings: next }
    })
    get().saveToStorage()
    for (const id of boundIds) syncAccountProxyToMain(id)
  },

  clearAccountProxyBindings: () => {
    const old = Object.keys(get().accountProxyBindings)
    set({ accountProxyBindings: {} })
    get().saveToStorage()
    for (const id of old) syncAccountProxyToMain(id)
  },

  autoDistributeAccountsToProxies: ({ accountsPerProxy = 0, onlyUnbound = false, accountIds }) => {
    const state = get()
    const aliveProxies = Array.from(state.proxyPool.values()).filter(
      (p) => p.enabled && p.status !== 'dead'
    )
    if (aliveProxies.length === 0) {
      return { distributed: 0, perProxy: {}, skipped: 0 }
    }

    // 候选账号
    const candidates = accountIds
      ? accountIds.map((id) => state.accounts.get(id)).filter((a): a is Account => !!a)
      : Array.from(state.accounts.values())
    const targets = onlyUnbound
      ? candidates.filter((a) => !state.accountProxyBindings[a.id])
      : candidates

    if (targets.length === 0) {
      return { distributed: 0, perProxy: {}, skipped: candidates.length }
    }

    const aliveIds = new Set(aliveProxies.map((proxy) => proxy.id))
    const targetIds = new Set(targets.map((account) => account.id))
    const perProxy: Record<string, number> = Object.fromEntries(
      aliveProxies.map((proxy) => [proxy.id, 0])
    )
    const newBindings = { ...state.accountProxyBindings }
    for (const [accountId, proxyId] of Object.entries(newBindings)) {
      if (targetIds.has(accountId) && !onlyUnbound) delete newBindings[accountId]
      else if (aliveIds.has(proxyId) && state.accounts.has(accountId)) perProxy[proxyId]++
    }
    let distributed = 0
    let cursor = 0
    for (const account of targets) {
      if (accountsPerProxy > 0) {
        while (
          cursor < aliveProxies.length &&
          perProxy[aliveProxies[cursor].id] >= accountsPerProxy
        )
          cursor++
        if (cursor === aliveProxies.length) break
      }
      const proxyId = aliveProxies[cursor % aliveProxies.length].id
      newBindings[account.id] = proxyId
      perProxy[proxyId]++
      if (accountsPerProxy === 0) cursor++
      distributed++
    }
    set({ accountProxyBindings: newBindings })
    get().saveToStorage()
    for (const id of targetIds) {
      if (state.accountProxyBindings[id] !== newBindings[id]) syncAccountProxyToMain(id)
    }
    return { distributed, perProxy, skipped: targets.length - distributed }
  },

  getAccountProxyUrl: (accountId) => {
    const state = get()
    const proxyId = state.accountProxyBindings[accountId]
    if (!proxyId) return undefined
    const proxy = state.proxyPool.get(proxyId)
    if (!proxy || !proxy.enabled) return undefined
    if (isDeadProxy(proxy) && hasHealthyProxy(state.proxyPool)) return undefined
    return proxy.url
  }
}))

/**
 * 把单个账号的代理绑定信息同步到主进程账号池
 * （主进程账号池里的 ProxyAccount.proxyUrl 由此 IPC 设置）
 */
let indexedBindings: Record<string, string> | null = null
let accountsByProxy = new Map<string, string[]>()
function boundAccounts(proxyId: string): string[] {
  const bindings = useAccountsStore.getState().accountProxyBindings
  if (bindings !== indexedBindings) {
    indexedBindings = bindings
    accountsByProxy = new Map()
    for (const [accountId, id] of Object.entries(bindings)) {
      const list = accountsByProxy.get(id) || []
      list.push(accountId)
      accountsByProxy.set(id, list)
    }
  }
  return accountsByProxy.get(proxyId) || []
}
const pendingProxyBindings = new Map<string, string | undefined>()
let bindingSyncQueued = false
function syncAccountProxyToMain(accountId: string): void {
  const url = useAccountsStore.getState().getAccountProxyUrl(accountId)
  pendingProxyBindings.set(accountId, url)
  if (bindingSyncQueued) return
  bindingSyncQueued = true
  queueMicrotask(() => {
    bindingSyncQueued = false
    const updates = Array.from(pendingProxyBindings, ([id, proxyUrl]) => ({ id, proxyUrl }))
    pendingProxyBindings.clear()
    void window.api.accountSetProxyBindings(updates).catch((error) => console.warn('[Store] Proxy binding sync failed:', error))
  })
}
function syncAllAccountsBoundToProxy(proxyId: string): void {
  for (const accountId of boundAccounts(proxyId)) syncAccountProxyToMain(accountId)
}

function isDeadProxy(proxy: ProxyEntry): boolean {
  const source = validationSources.get(proxy.id)
  return (
    (proxy.status === 'testing' && source?.url === proxy.url ? source.status : proxy.status) ===
    'dead'
  )
}

const healthyProxyCache = new WeakMap<Map<string, ProxyEntry>, boolean>()
function syncProxyAvailabilityChange(previous: Map<string, ProxyEntry>): boolean {
  const state = useAccountsStore.getState()
  if (hasHealthyProxy(previous) === hasHealthyProxy(state.proxyPool)) return false
  for (const id of Object.keys(state.accountProxyBindings)) syncAccountProxyToMain(id)
  return true
}

function hasHealthyProxy(pool: Map<string, ProxyEntry>): boolean {
  const cached = healthyProxyCache.get(pool)
  if (cached !== undefined) return cached
  for (const proxy of pool.values()) {
    if (proxy.enabled && !isDeadProxy(proxy)) {
      healthyProxyCache.set(pool, true)
      return true
    }
  }
  healthyProxyCache.set(pool, false)
  return false
}

// One pool shared by manual and periodic validation; UI updates are committed in batches.
let proxyValidationLimit = 5
let proxyValidationActive = 0
const validationQueue: Array<() => void> = []
const proxyValidations = new Map<string, Promise<ProxyValidationResult>>()
const latestValidationKeys = new Map<string, string>()
const validationSources = new Map<string, ProxyEntry>()
const pendingValidationResults = new Map<string, { source: ProxyEntry; key: string; result: ProxyValidationResult }>()
let validationFlushTimer: ReturnType<typeof setTimeout> | undefined
function validationKey(url: string): string {
  const config = useAccountsStore.getState().proxyPoolConfig
  return JSON.stringify([url, config.testUrl, config.testTimeoutMs, config.upstreamProxy || ''])
}
function markProxiesTesting(entries: ProxyEntry[]): void {
  const state = useAccountsStore.getState()
  const next = new Map(state.proxyPool)
  for (const entry of entries) {
    const previous = validationSources.get(entry.id)
    if (!previous || previous.url !== entry.url) validationSources.set(entry.id, entry)
    next.set(entry.id, { ...entry, status: 'testing' })
  }
  useAccountsStore.setState({ proxyPool: next })
}
function drainProxyValidations(): void {
  while (proxyValidationActive < proxyValidationLimit && validationQueue.length)
    validationQueue.shift()!()
}
async function enqueueProxyValidation(entry: ProxyEntry): Promise<ProxyValidationResult> {
  const key = validationKey(entry.url)
  const source = validationSources.get(entry.id) || entry
  latestValidationKeys.set(entry.id, key)
  let task = proxyValidations.get(key)
  if (!task) {
    const config = useAccountsStore.getState().proxyPoolConfig
    task = new Promise<ProxyValidationResult>((resolve) => {
      validationQueue.push(() => {
        proxyValidationActive++
        void Promise.resolve()
          .then(() =>
            window.api.proxyPoolValidate({
              url: entry.url,
              testUrl: config.testUrl,
              timeoutMs: config.testTimeoutMs,
              upstreamProxy: config.upstreamProxy
            })
          )
          .catch((error) => ({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }))
          .then((result) => {
            proxyValidationActive--
            proxyValidations.delete(key)
            resolve(result)
            drainProxyValidations()
          })
      })
    })
    proxyValidations.set(key, task)
    drainProxyValidations()
  }
  const result = await task
  if (latestValidationKeys.get(entry.id) === key) {
    pendingValidationResults.set(entry.id, { source, key, result })
    if (!validationFlushTimer) validationFlushTimer = setTimeout(flushProxyValidationResults, 120)
  }
  return result
}
function flushProxyValidationResults(): void {
  clearTimeout(validationFlushTimer)
  validationFlushTimer = undefined
  if (!pendingValidationResults.size) return
  const state = useAccountsStore.getState()
  const next = new Map(state.proxyPool)
  const previouslyHealthy = hasHealthyProxy(state.proxyPool)
  let healthyCount = Array.from(next.values()).filter(
    (proxy) => proxy.enabled && !isDeadProxy(proxy)
  ).length
  let enabledCount = Array.from(next.values()).filter((proxy) => proxy.enabled).length
  const changedProxies: string[] = []
  let changed = false
  for (const [id, { source, key, result }] of pendingValidationResults) {
    const current = next.get(id)
    if (latestValidationKeys.get(id) !== key) continue
    if (!current || current.url !== source.url) {
      latestValidationKeys.delete(id)
      validationSources.delete(id)
      continue
    }
    latestValidationKeys.delete(id)
    validationSources.delete(id)
    if (validationKey(current.url) !== key) {
      if (current.status === 'testing') {
        next.set(id, { ...current, status: source.status })
        changed = true
      }
      continue
    }
    const failCount = current.failCount + (result.success ? 0 : 1)
    const enabled =
      !result.success &&
      state.proxyPoolConfig.autoDisableDead &&
      failCount >= state.proxyPoolConfig.failureThreshold &&
      enabledCount > 1
        ? false
        : current.enabled
    const updated: ProxyEntry = {
      ...current,
      status: result.success
        ? result.latencyMs !== undefined && result.latencyMs > 3000
          ? 'slow'
          : 'alive'
        : 'dead',
      enabled,
      failCount,
      latencyMs: result.latencyMs,
      lastTestedAt: Date.now(),
      lastError: result.success ? undefined : result.error
    }
    const wasHealthy =
      current.enabled &&
      (current.status === 'testing' ? source.status !== 'dead' : current.status !== 'dead')
    const nowHealthy = updated.enabled && updated.status !== 'dead'
    healthyCount += Number(nowHealthy) - Number(wasHealthy)
    if (current.enabled && !updated.enabled) enabledCount--
    next.set(id, updated)
    changed = true
    if (source.enabled !== enabled || (source.status === 'dead') !== (updated.status === 'dead'))
      changedProxies.push(id)
  }
  pendingValidationResults.clear()
  if (!changed) return
  useAccountsStore.setState({ proxyPool: next })
  void useAccountsStore.getState().saveToStorage()
  // If availability crosses zero, all dead bindings may change their fallback policy.
  const currentlyHealthy = healthyCount > 0
  if (previouslyHealthy !== currentlyHealthy) {
    for (const id of Object.keys(state.accountProxyBindings)) syncAccountProxyToMain(id)
  } else for (const id of changedProxies) syncAllAccountsBoundToProxy(id)
}

/** 触发 Webhook 事件（封装错误处理，不阻塞主业务流程） */
function triggerWebhook(event: WebhookEvent, payload: WebhookMessage): void {
  try {
    void useWebhookStore.getState().triggerEvent(event, payload)
  } catch (err) {
    console.warn(`[Webhook] trigger ${event} failed:`, err)
  }
}

// ==================== 代理 URL 解析辅助 ====================

interface ParsedProxy {
  protocol: ProxyProtocol
  host: string
  port: number
  username?: string
  password?: string
  normalized: string
}

/**
 * 解析多种代理 URL 格式：
 *   - http://host:port
 *   - http://user:pass@host:port
 *   - socks5://host:port
 *   - host:port              （默认 http）
 *   - host:port:user:pass    （Stormproxies 等代理商常用格式）
 *   - user:pass@host:port    （省略 scheme）
 */
// 判断错误是否为「代理连接层」问题（而非 AWS 业务/风控失败）。
// 仅这类错误才累加代理 failCount / 触发自动停用，避免风控失败把好代理（尤其单条轮换代理）误杀成直连。
function isProxyConnectionError(msg: string | undefined): boolean {
  const m = (msg || '').toLowerCase()
  if (!m) return false
  return (
    m.includes('proxy') ||
    m.includes('econnrefused') ||
    m.includes('econnreset') ||
    m.includes('etimedout') ||
    m.includes('ehostunreach') ||
    m.includes('enetunreach') ||
    m.includes('tunnel') ||
    m.includes('dial tcp') ||
    m.includes('connection refused') ||
    m.includes('connection reset') ||
    m.includes('407') ||
    m.includes('socks')
  )
}

export function parseProxyUrl(raw: string): ParsedProxy | null {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null

  // 形式 1: scheme://...
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed)
      const protocol = normalizeProtocol(u.protocol.replace(':', ''))
      if (!protocol) return null
      const port = Number(u.port) || defaultPort(protocol)
      if (!u.hostname || !Number.isFinite(port)) return null
      return {
        protocol,
        host: u.hostname,
        port,
        username: u.username ? decodeURIComponent(u.username) : undefined,
        password: u.password ? decodeURIComponent(u.password) : undefined,
        normalized: buildProxyUrl(
          protocol,
          u.hostname,
          port,
          u.username ? decodeURIComponent(u.username) : undefined,
          u.password ? decodeURIComponent(u.password) : undefined
        )
      }
    } catch {
      return null
    }
  }

  // 形式 2: host:port:user:pass（4 段冒号分隔）
  const segs = trimmed.split(':')
  if (segs.length === 4 && /^\d+$/.test(segs[1])) {
    const [host, portStr, user, pass] = segs
    const port = Number(portStr)
    if (!host || !Number.isFinite(port)) return null
    return {
      protocol: 'http',
      host,
      port,
      username: user || undefined,
      password: pass || undefined,
      normalized: buildProxyUrl('http', host, port, user, pass)
    }
  }

  // 形式 3: user:pass@host:port（缺 scheme）
  if (trimmed.includes('@')) {
    const [authPart, hostPart] = trimmed.split('@')
    const [user, pass] = authPart.split(':')
    const [host, portStr] = (hostPart || '').split(':')
    const port = Number(portStr)
    if (!host || !Number.isFinite(port)) return null
    return {
      protocol: 'http',
      host,
      port,
      username: user || undefined,
      password: pass || undefined,
      normalized: buildProxyUrl('http', host, port, user, pass)
    }
  }

  // 形式 4: host:port（裸格式，默认 http）
  if (segs.length === 2 && /^\d+$/.test(segs[1])) {
    const port = Number(segs[1])
    if (!segs[0] || !Number.isFinite(port)) return null
    return {
      protocol: 'http',
      host: segs[0],
      port,
      normalized: buildProxyUrl('http', segs[0], port)
    }
  }

  return null
}

function normalizeProtocol(raw: string): ProxyProtocol | null {
  const p = raw.toLowerCase()
  if (p === 'http' || p === 'https' || p === 'socks5' || p === 'socks4') return p
  if (p === 'socks') return 'socks5'
  return null
}

function defaultPort(protocol: ProxyProtocol): number {
  switch (protocol) {
    case 'http':
      return 8080
    case 'https':
      return 443
    case 'socks5':
    case 'socks4':
      return 1080
  }
}

function buildProxyUrl(
  protocol: ProxyProtocol,
  host: string,
  port: number,
  username?: string,
  password?: string
): string {
  const auth = username
    ? `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ''}@`
    : ''
  return `${protocol}://${auth}${host}:${port}`
}

let machineVersion = 0
let machineRead: Promise<void> | undefined
let machineTail: Promise<unknown> = Promise.resolve()
let machinePending = 0
function readSystemMachineId(): Promise<void> {
  if (machineRead) return machineRead
  const version = machineVersion
  const task = machineTail
    .catch(() => {})
    .then(async () => {
      const result = await window.api.machineIdGetCurrent()
      if (version !== machineVersion) return
      const id = normalizeMachineId(result.machineId)
      if (!result.success || !id) throw new Error(result.error || '无法获取有效的机器码')
      useAccountsStore.setState({ currentMachineId: id, machineIdError: null })
      useAccountsStore.getState().backupOriginalMachineId()
    })
    .catch((error) => {
      if (version === machineVersion)
        useAccountsStore.setState({
          machineIdError: String(error instanceof Error ? error.message : error)
        })
    })
    .finally(() => {
      if (machineRead === task) machineRead = undefined
    })
  machineRead = task
  return task
}
function mutateSystemMachineId(
  getId: () => string | null | undefined,
  context: {
    action: 'manual' | 'auto_switch' | 'restore'
    accountId?: string
    accountEmail?: string
  }
): Promise<boolean> {
  machineVersion++
  machineRead = undefined
  machinePending++
  useAccountsStore.setState({ machineIdBusy: true })
  const task = machineTail
    .catch(() => {})
    .then(async () => {
      const store = useAccountsStore
      store.setState({ machineIdError: null, machineIdWarning: null })
      try {
        if (context.action === 'restore' && !store.getState().originalMachineId)
          throw new Error('没有可恢复的原始备份')
        if (context.accountId && !store.getState().accounts.has(context.accountId))
          throw new Error('账号已删除')
        if (!store.getState().originalMachineId) {
          const current = await window.api.machineIdGetCurrent()
          const original = normalizeMachineId(current.machineId)
          if (!current.success || !original)
            throw new Error(current.error || '无法备份原始机器码，已取消修改')
          store.setState({ currentMachineId: original })
          store.getState().backupOriginalMachineId()
        }
        // A restorable original must be durable before the first OS write is attempted.
        await store.getState().flushSaveImmediately()
        const id = normalizeMachineId(getId())
        if (!id) throw new Error('无效的机器码格式或没有可恢复的原始备份')
        const result = await window.api.machineIdSet(id)
        if (!result.success) {
          if (!result.cancelled)
            store.setState({ machineIdError: result.error || '机器码修改失败' })
          return false
        }
        const actual = normalizeMachineId(result.machineId) || id
        machineVersion++
        store.setState((state) => ({
          currentMachineId: actual,
          machineIdWarning: result.warning || null,
          machineIdHistory: [
            ...state.machineIdHistory,
            { id: crypto.randomUUID(), machineId: actual, timestamp: Date.now(), ...context }
          ]
        }))
        await store.getState().flushSaveImmediately()
        return true
      } catch (error) {
        store.setState({ machineIdError: error instanceof Error ? error.message : String(error) })
        return false
      } finally {
        machinePending--
        store.setState({ machineIdBusy: machinePending > 0 })
      }
    })
  machineTail = task
  return task
}

/** Apply local additions/edits/deletions over a loaded snapshot without losing unrelated disk accounts. */
function mergeLoadedMap<T>(
  loaded: Map<string, T>,
  baseline: Map<string, T>,
  current: Map<string, T>
): Map<string, T> {
  if (baseline === current) return loaded
  const merged = new Map(loaded)
  for (const [id, value] of current)
    if (!baseline.has(id) || baseline.get(id) !== value) merged.set(id, value)
  for (const id of baseline.keys()) if (!current.has(id)) merged.delete(id)
  return merged
}

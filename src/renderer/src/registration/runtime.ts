import { create } from 'zustand'
import { useAccountsStore } from '@/store/accounts'
import { useTaskStore } from '@/store/tasks'
import { useWebhookStore } from '@/store/webhooks'
import { createRateLimiter, type RateLimiter, type RateLimiterSnapshot } from '@/store/rateLimiter'
import type { Account, SubscriptionType } from '@/types/account'
import type { RegistrationStartConfig, RegStepEvent } from '../../../shared/registration'
import { appendSubscriptionLink, updateSubscriptionLink } from '@/components/pages/SubscriptionPage'
import { generateNextDotVariant } from '@/lib/dotVariants'
import {
  boundedInteger,
  classifyError,
  injectProxySession,
  loadHistory,
  saveHistory,
  loadEmailBlacklist,
  saveEmailBlacklist,
  type AutoEmailSource,
  type BatchItem,
  type HistoryItem,
  type Phase,
  type RegResult,
  type RegisterConfig
} from '@/lib/registration'

export interface RegistrationOptions extends RegisterConfig {
  dailyQuotaLimit: number
  rateLimitEnabled: boolean
  maxPerMinute: number
  burstSize: number
  backoffBaseSec: number
  backoffMaxSec: number
  autoBackoff: boolean
  autoPauseOnRisk: boolean
  mixedWeights: Record<AutoEmailSource, number>
}
type Translate = (key: string) => string
interface RegistrationState {
  phase: Phase
  logs: string[]
  result: RegResult | null
  imported: boolean
  batchRunning: boolean
  batchItems: BatchItem[]
  batchDone: number
  batchSuccess: number
  batchFail: number
  isPaused: boolean
  history: HistoryItem[]
  rateSnapshot: RateLimiterSnapshot | null
  dailyQuotaDate: string
  dailyQuotaUsed: number
  protonLoggedIn: boolean
}
export function quotaDate(): string {
  const date = new Date()
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}
function readQuota(date: string): number {
  try {
    return Math.max(0, Number(localStorage.getItem(`kiro-register-quota-${date}`)) || 0)
  } catch {
    return 0
  }
}
export const useRegistrationStore = create<RegistrationState>(() => ({
  phase: 'idle',
  logs: [],
  result: null,
  imported: false,
  batchRunning: false,
  batchItems: [],
  batchDone: 0,
  batchSuccess: 0,
  batchFail: 0,
  isPaused: false,
  history: loadHistory(),
  rateSnapshot: null,
  dailyQuotaDate: quotaDate(),
  dailyQuotaUsed: readQuota(quotaDate()),
  protonLoggedIn: false
}))
const state = useRegistrationStore.getState
const patch = useRegistrationStore.setState
let initialized = false
const taskItems = new Map<string, string>()
const pendingSteps = new Map<string, RegStepEvent>()
let stepTimer: ReturnType<typeof setTimeout> | undefined
let logTimer: ReturnType<typeof setTimeout> | undefined
let pendingLogs: string[] = []

export function addRegistrationLog(message: string): void {
  pendingLogs.push(`[${new Date().toLocaleTimeString()}] ${message}`)
  if (pendingLogs.length > 500) pendingLogs = pendingLogs.slice(-500)
  if (!logTimer) logTimer = setTimeout(flushLogs, 80)
}
function flushLogs(): void {
  clearTimeout(logTimer)
  logTimer = undefined
  if (!pendingLogs.length) return
  patch({ logs: [...state().logs, ...pendingLogs].slice(-500) })
  pendingLogs = []
}
export function clearRegistrationLogs(): void {
  clearTimeout(logTimer)
  logTimer = undefined
  pendingLogs = []
  patch({ logs: [] })
}
function flushSteps(): void {
  clearTimeout(stepTimer)
  stepTimer = undefined
  if (!pendingSteps.size) return
  patch({
    batchItems: state().batchItems.map((item) => {
      const event = pendingSteps.get(item.id)
      if (!event || !['running', 'retrying'].includes(item.status)) return item
      return {
        ...item,
        currentStep: event.name,
        startedAt: item.startedAt ?? event.ts,
        stepStartedAt: event.ts,
        email: event.email || item.email,
        exitIp: event.exitIp || item.exitIp
      }
    })
  })
  pendingSteps.clear()
}
export function initializeRegistration(): void {
  if (initialized) return
  initialized = true
  void window.api
    .registrationStatus()
    .then((status) => {
      if (status.inProgress && !activeBatch && !activeSingle) return window.api.registrationCancel()
      return undefined
    })
    .catch((error) => addRegistrationLog(String(error)))
  window.api.onRegistrationLog(addRegistrationLog)
  window.api.onRegistrationStep(({ taskId, event }) => {
    const id = taskId && taskItems.get(taskId)
    if (!id) return
    pendingSteps.set(id, event)
    if (!stepTimer) stepTimer = setTimeout(flushSteps, 120)
  })
}
export function refreshRegistrationQuota(): void {
  const date = quotaDate()
  if (state().dailyQuotaDate !== date)
    patch({ dailyQuotaDate: date, dailyQuotaUsed: readQuota(date) })
}
export function resetRegistrationQuota(): void {
  refreshRegistrationQuota()
  try {
    localStorage.setItem(`kiro-register-quota-${state().dailyQuotaDate}`, '0')
  } catch {
    /* Keep the in-memory count available. */
  }
  patch({ dailyQuotaUsed: 0 })
}
function incrementQuota(): void {
  refreshRegistrationQuota()
  const used = state().dailyQuotaUsed + 1
  try {
    localStorage.setItem(`kiro-register-quota-${state().dailyQuotaDate}`, String(used))
  } catch {
    /* Keep registration results even when storage is full. */
  }
  patch({ dailyQuotaUsed: used })
}
export function setRegistrationHistory(
  update: HistoryItem[] | ((previous: HistoryItem[]) => HistoryItem[])
): void {
  const history = typeof update === 'function' ? update(state().history) : update
  patch({ history })
  saveHistory(history)
}
function addHistory(result: RegResult): string {
  const id = crypto.randomUUID()
  setRegistrationHistory((previous) => [
    {
      id,
      time: Date.now(),
      email: result.email,
      status: result.status,
      error: result.error,
      password: result.password,
      result,
      imported: false
    },
    ...previous
  ])
  return id
}
export function collectRegistrationEmails(
  accounts: Iterable<{ email?: string }> = useAccountsStore.getState().accounts.values(),
  history: HistoryItem[] = state().history
): Set<string> {
  const emails = loadEmailBlacklist()
  for (const account of accounts) if (account.email) emails.add(account.email.toLowerCase())
  for (const item of history) if (item.email) emails.add(item.email.toLowerCase())
  for (const email of allocatedEmails) emails.add(email)
  return emails
}
const allocatedEmails = new Set<string>()
export function allocateProtonEmail(base: string): string | null {
  const email = generateNextDotVariant(base.trim(), collectRegistrationEmails()).variant
  if (email) allocatedEmails.add(email.toLowerCase())
  return email
}

const imports = new Map<string, Promise<boolean>>()
/** Import is idempotent by email/provider and owns credential rotation through verification. */
export function importRegistrationResult(result: RegResult): Promise<boolean> {
  const key = result.email.trim().toLowerCase()
  const existing = imports.get(key)
  if (existing) return existing
  const promise = performImport(result).finally(() => imports.delete(key))
  imports.set(key, promise)
  return promise
}
async function performImport(result: RegResult): Promise<boolean> {
  if (!result.refreshToken || !result.clientId || !result.clientSecret) return false
  try {
    const now = Date.now()
    const verify = result.verify
    const current = Array.from(useAccountsStore.getState().accounts.values()).find(
      (account) =>
        account.email.toLowerCase() === result.email.toLowerCase() &&
        account.credentials.provider === 'BuilderId'
    )
    const credentials = current?.credentials || result
    const response = verify?.alive
      ? undefined
      : await window.api.verifyAccountCredentials({
          accountId: current?.id,
          refreshToken: credentials.refreshToken || result.refreshToken,
          clientId: credentials.clientId || result.clientId,
          clientSecret: credentials.clientSecret || result.clientSecret,
          region: result.region || 'us-east-1',
          authMethod: 'IdC',
          provider: 'BuilderId'
        })
    const data = response?.data
    result.clientId = credentials.clientId || result.clientId
    result.clientSecret = credentials.clientSecret || result.clientSecret
    // Keep the refreshed credentials for link generation and subsequent import retries as well.
    const latest = current && useAccountsStore.getState().accounts.get(current.id)
    const rotation = data?.refreshToken || response?.refreshedCredentials?.refreshToken
    const newerCredentials =
      latest &&
      latest.credentials.refreshToken !== credentials.refreshToken &&
      latest.credentials.refreshToken !== rotation
        ? latest.credentials
        : undefined
    result.refreshToken =
      newerCredentials?.refreshToken ||
      data?.refreshToken ||
      response?.refreshedCredentials?.refreshToken ||
      latest?.credentials.refreshToken ||
      result.refreshToken
    result.accessToken =
      newerCredentials?.accessToken ||
      data?.accessToken ||
      response?.refreshedCredentials?.accessToken ||
      latest?.credentials.accessToken ||
      result.accessToken
    const title = data?.subscriptionTitle || String(verify?.subscription || 'Free Tier')
    const rawType = data?.subscriptionType || title
    const allowed: SubscriptionType[] = ['Free', 'Pro', 'Pro_Plus', 'Enterprise', 'Teams']
    const type: SubscriptionType = allowed.includes(rawType as SubscriptionType)
      ? (rawType as SubscriptionType)
      : rawType.includes('PRO_PLUS') || rawType.includes('POWER')
        ? 'Pro_Plus'
        : rawType.includes('PRO')
          ? 'Pro'
          : 'Free'
    const used = data?.usage?.current ?? (Number(verify?.credit_used) || 0)
    const limit = data?.usage?.limit ?? (Number(verify?.credit_limit) || 0)
    const input: Omit<Account, 'id' | 'createdAt' | 'isActive'> = {
      email: data?.email || String(verify?.email || result.email),
      password: result.password,
      idp: 'BuilderId',
      status: 'active',
      credentials: {
        refreshToken: result.refreshToken,
        accessToken: result.accessToken || '',
        clientId: result.clientId,
        clientSecret: result.clientSecret,
        csrfToken: '',
        region: result.region || 'us-east-1',
        authMethod: 'IdC',
        provider: 'BuilderId',
        expiresAt:
          newerCredentials?.expiresAt ??
          response?.refreshedCredentials?.expiresAt ??
          (!data && latest ? latest.credentials.expiresAt : undefined) ??
          result.expiresAt ??
          now + (data?.expiresIn ?? 3600) * 1000
      },
      subscription: { type, title },
      usage: {
        ...data?.usage,
        current: used,
        limit,
        percentUsed: limit > 0 ? Math.round((used / limit) * 100) : 0,
        lastUpdated: now
      },
      tags: [],
      lastUsedAt: now,
      ...(data?.userId ? { userId: data.userId } : {}),
      ...(data?.profileArn ? { profileArn: data.profileArn } : {})
    }
    const store = useAccountsStore.getState()
    const account = Array.from(store.accounts.values()).find(
      (entry) =>
        entry.email.toLowerCase() === input.email.toLowerCase() &&
        entry.credentials.provider === 'BuilderId'
    )
    if (account)
      store.updateAccount(account.id, {
        ...input,
        password: account.password ?? result.password,
        subscription: { ...account.subscription, ...input.subscription },
        credentials: { ...account.credentials, ...input.credentials },
        tags: account.tags,
        machineId: account.machineId,
        ...(account.groupId ? { groupId: account.groupId } : {})
      })
    else store.addAccount(input)
    setRegistrationHistory((previous) =>
      previous.map((history) =>
        history.result === result ? { ...history, imported: true, result: { ...result } } : history
      )
    )
    return true
  } catch (error) {
    addRegistrationLog(
      `[Import] ${result.email}: ${error instanceof Error ? error.message : String(error)}`
    )
    return false
  }
}
export async function importRegistrationHistory(item: HistoryItem): Promise<void> {
  if (item.result?.status === 'success') await importRegistrationResult(item.result)
}
export async function fetchRegistrationLink(
  result: RegResult,
  plan: RegisterConfig['proPlanType'],
  t: Translate
): Promise<string | undefined> {
  if (!result.accessToken) return undefined
  const id = crypto.randomUUID()
  appendSubscriptionLink({ accountId: id, email: result.email, status: 'loading' })
  try {
    addRegistrationLog(
      `[Pro Link] ${result.email}: ${t('register.fetchingProLink')} (${plan.replace('Q_DEVELOPER_STANDALONE_', '')})...`
    )
    const response = await window.api.accountGetSubscriptionUrl(
      result.accessToken,
      plan,
      result.region || 'us-east-1',
      undefined,
      undefined,
      'BuilderId',
      'IdC',
      undefined
    )
    if (!response.success || !response.url) throw new Error(response.error || 'Failed to get link')
    updateSubscriptionLink(id, { status: 'success', url: response.url })
    addRegistrationLog(`[Pro Link] ${result.email}: ${response.url}`)
    return response.url
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateSubscriptionLink(id, { status: 'error', error: message })
    addRegistrationLog(`[Pro Link] ${result.email}: ${message}`)
    return undefined
  }
}

interface Run {
  id: string
  abort: AbortController
  paused: boolean
  resume: Set<() => void>
  taskIds: Set<string>
  options: RegistrationOptions
  t: Translate
  limiter?: RateLimiter
  centerId?: string
  outlook: string[]
  credits: Record<AutoEmailSource, number>
  nextStart: number
  startGate: Promise<void>
  riskWarning: boolean
}
let activeBatch: Run | undefined
let activeSingle: Run | undefined
function createRun(options: RegistrationOptions, t: Translate): Run {
  return {
    id: crypto.randomUUID(),
    abort: new AbortController(),
    paused: false,
    resume: new Set(),
    taskIds: new Set(),
    options,
    t,
    outlook: [],
    credits: { outlook: 0, tempmail: 0, proton: 0, gptmail: 0 },
    nextStart: 0,
    startGate: Promise.resolve(),
    riskWarning: false
  }
}
export function eligibleRegistrationSources(config: RegisterConfig): AutoEmailSource[] {
  return (
    config.mode === 'mixed'
      ? config.mixedEnabledSources || ['outlook', 'tempmail']
      : config.mode === 'manual'
        ? []
        : [config.mode]
  ).filter((source) => {
    if (source === 'outlook') return !!config.outlookData.trim()
    if (source === 'tempmail')
      return !!(
        config.tempMailEmail.trim() &&
        config.tempMailEpin.trim() &&
        config.tempMailDomain.trim()
      )
    if (source === 'proton') return !!config.protonBaseEmail.trim()
    return !!config.gptMailDomain.trim()
  })
}
export function chooseRegistrationSource(
  run: Pick<Run, 'options' | 'credits'>
): AutoEmailSource | undefined {
  const candidates = eligibleRegistrationSources(run.options)
  const weights = candidates.map((source) =>
    boundedInteger(run.options.mixedWeights[source], 1, 0, 100)
  )
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let best: AutoEmailSource | undefined
  let credit = -Infinity
  for (let index = 0; index < candidates.length; index++) {
    const source = candidates[index]
    const weight = total ? weights[index] : 1
    if (!weight) continue
    run.credits[source] += weight
    if (run.credits[source] > credit) {
      best = source
      credit = run.credits[source]
    }
  }
  if (best) run.credits[best] -= total || candidates.length
  return best
}
function configureAuto(run: Run): RegistrationStartConfig {
  const config = run.options
  const source = chooseRegistrationSource(run)
  if (!source) throw new Error('没有已配置的邮箱源')
  if (source === 'outlook')
    return { useOutlook: true, outlookData: run.outlook.shift() || config.outlookData }
  if (source === 'tempmail')
    return {
      useTempMailPlus: true,
      tempMailPlusEmail: config.tempMailEmail,
      tempMailPlusEpin: config.tempMailEpin,
      tempMailPlusDomain: config.tempMailDomain
    }
  if (source === 'proton') {
    const email = allocateProtonEmail(config.protonBaseEmail)
    if (!email) throw new Error('Proton 邮箱未配置或点号变体已用尽')
    return { useProton: true, protonEmail: email }
  }
  return {
    useGptMail: true,
    gptMailBaseURL: config.gptMailBaseURL.trim(),
    gptMailInboxEmail: config.gptMailInboxEmail.trim(),
    gptMailDomain: config.gptMailDomain,
    gptMailPrefix: config.gptMailPrefix.trim(),
    gptMailPrivatePassword: config.gptMailPrivatePassword
  }
}
function configureProxy(config: RegistrationStartConfig, strict = false): string | undefined {
  const store = useAccountsStore.getState()
  if (!store.proxyPoolConfig.enabled) return undefined
  const proxy = store.pickNextProxy()
  if (!proxy) {
    if (strict) throw new Error('代理池已启用但当前无可用代理')
    return undefined
  }
  config.proxy = injectProxySession(proxy.url)
  if (strict) config.strictProxy = true
  config.upstreamProxy = store.proxyPoolConfig.upstreamProxy?.trim() || ''
  addRegistrationLog(`[Proxy] Using ${proxy.protocol}://${proxy.host}:${proxy.port}`)
  return proxy.id
}
export function registrationSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = (): void => {
      clearTimeout(timer)
      reject(signal.reason || new Error('注册已取消'))
    }
    const timer = setTimeout(
      () => {
        signal.removeEventListener('abort', aborted)
        resolve()
      },
      Math.max(0, ms)
    )
    signal.addEventListener('abort', aborted, { once: true })
    if (signal.aborted) {
      signal.removeEventListener('abort', aborted)
      aborted()
    }
  })
}
async function waitReady(run: Run): Promise<void> {
  run.abort.signal.throwIfAborted()
  if (!run.paused) return
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      run.resume.delete(resume)
      run.abort.signal.removeEventListener('abort', abort)
    }
    const resume = (): void => {
      cleanup()
      resolve()
    }
    const abort = (): void => {
      cleanup()
      reject(run.abort.signal.reason)
    }
    run.resume.add(resume)
    run.abort.signal.addEventListener('abort', abort, { once: true })
    if (run.abort.signal.aborted) abort()
  })
  run.abort.signal.throwIfAborted()
}
async function acquireStart(run: Run): Promise<void> {
  const previous = run.startGate
  let release: () => void = () => {}
  run.startGate = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    await waitReady(run)
    if (run.nextStart > Date.now())
      await registrationSleep(run.nextStart - Date.now(), run.abort.signal)
    do {
      await waitReady(run)
      if (run.limiter) await run.limiter.waitForSlot(run.abort.signal)
    } while (run.paused)
    run.abort.signal.throwIfAborted()
    run.nextStart = Date.now() + boundedInteger(run.options.batchInterval, 5, 0, 300) * 1000
  } finally {
    release()
  }
}

function pauseBatch(paused: boolean): void {
  const run = activeBatch
  if (!run || run.abort.signal.aborted) return
  run.paused = paused
  patch({ isPaused: paused })
  if (run.centerId)
    useTaskStore.getState().updateTask(run.centerId, { status: paused ? 'paused' : 'running' })
  if (!paused) for (const resume of [...run.resume]) resume()
}
export function toggleRegistrationPause(): void {
  pauseBatch(!activeBatch?.paused)
}
export function stopRegistrationBatch(): void {
  const run = activeBatch
  if (!run || run.abort.signal.aborted) return
  run.abort.abort(new Error('注册已取消'))
  patch({ isPaused: false })
  addRegistrationLog('[Batch] 正在停止，已中止在途请求...')
  void Promise.allSettled(
    Array.from(run.taskIds, (taskId) => window.api.registrationCancel(taskId))
  )
  if (run.centerId) useTaskStore.getState().cancelTask(run.centerId)
}
function updateItem(id: string, updates: Partial<BatchItem>): void {
  flushSteps()
  patch({
    batchItems: state().batchItems.map((item) => (item.id === id ? { ...item, ...updates } : item))
  })
}
function updateBatchCounters(): void {
  const items = state().batchItems
  patch({
    batchDone: items.filter((item) =>
      ['success', 'imported', 'import_failed', 'failed'].includes(item.status)
    ).length,
    batchSuccess: items.filter((item) =>
      ['success', 'imported', 'import_failed'].includes(item.status)
    ).length,
    batchFail: items.filter((item) => item.status === 'failed').length
  })
}
function recordFailure(result: RegResult, run: Run): void {
  const category = classifyError(result.error)
  if (category === 'email_used' && result.email) {
    const emails = loadEmailBlacklist()
    emails.add(result.email.toLowerCase())
    saveEmailBlacklist(emails)
  }
  const risk = category === 'risk_control' || !!run.limiter?.snapshot().riskWarning
  if (risk && !run.riskWarning && run === activeBatch) {
    if (run.options.autoPauseOnRisk) pauseBatch(true)
    addRegistrationLog(
      `[RiskControl] 检测到风控信号${run.options.autoPauseOnRisk ? '，已暂停' : ''}：${result.error || ''}`
    )
    void useWebhookStore.getState().triggerEvent('risk-warning', {
      title: '风控信号触发',
      message: result.error || '批量注册成功率下降',
      level: 'warn',
      fields: { 动作: run.options.autoPauseOnRisk ? '已自动暂停' : '请手动检查' }
    })
  }
  run.riskWarning = risk
}
async function attemptRegistration(run: Run, item?: BatchItem): Promise<RegResult> {
  const retries = boundedInteger(run.options.batchRetries, 1, 0, 10)
  let result: RegResult = { status: 'failed', email: '', error: '注册失败' }
  for (let attempt = 0; attempt <= retries; attempt++) {
    await waitReady(run)
    if (attempt) {
      addRegistrationLog(
        run
          .t('register.batchRetrying')
          .replace('{current}', String(attempt))
          .replace('{max}', String(retries))
      )
      await registrationSleep(3000, run.abort.signal)
    }
    if (attempt === 0) await acquireStart(run)
    else {
      do {
        await waitReady(run)
        if (run.limiter) await run.limiter.waitForSlot(run.abort.signal)
      } while (run.paused)
      run.abort.signal.throwIfAborted()
    }
    if (item)
      updateItem(item.id, {
        status: attempt ? 'retrying' : 'running',
        retryCount: attempt,
        startedAt: item.startedAt || Date.now()
      })
    const taskId = `${item ? 'batch' : 'single'}-${crypto.randomUUID()}`
    let proxyId: string | undefined
    try {
      const config = configureAuto(run)
      config.taskId = taskId
      proxyId = configureProxy(config, run === activeBatch)
      run.taskIds.add(taskId)
      if (item) taskItems.set(taskId, item.id)
      const response = await window.api.registrationStartAuto(config)
      result =
        response.success && response.result
          ? response.result
          : { status: 'failed', email: '', error: response.error || '注册失败' }
    } catch (error) {
      result = {
        status: 'failed',
        email: '',
        error: error instanceof Error ? error.message : String(error)
      }
    } finally {
      run.taskIds.delete(taskId)
      flushSteps()
      taskItems.delete(taskId)
    }
    const success = result.status === 'success'
    if (proxyId)
      useAccountsStore.getState().reportProxyResult(proxyId, success, result.email, result.error)
    run.limiter?.reportResult(success)
    recordFailure(result, run)
    if (success || run.abort.signal.aborted) return result
  }
  return result
}
async function afterRegistration(result: RegResult, run: Run, item?: BatchItem): Promise<void> {
  const historyId =
    item?.status === 'import_failed' && item.result === result && item.historyId
      ? item.historyId
      : addHistory(result)
  if (item)
    updateItem(item.id, {
      result,
      historyId,
      email: result.email,
      error: result.error,
      status: result.status
    })
  if (result.status !== 'success') return
  if (run.abort.signal.aborted) return
  if (run.options.batchAutoImport || item?.status === 'import_failed') {
    if (!item) patch({ phase: 'importing' })
    const imported = await importRegistrationResult(result)
    if (item)
      updateItem(item.id, {
        status: imported ? 'imported' : 'import_failed',
        error: imported ? undefined : '账号导入失败'
      })
    else if (run === activeSingle) patch({ imported })
    if (imported) addRegistrationLog(run.t('register.logImported'))
  }
  if (run.options.autoFetchProLink && !run.abort.signal.aborted) {
    if (!item) patch({ phase: 'fetching-link' })
    await fetchRegistrationLink(result, run.options.proPlanType, run.t)
  }
}

export async function startRegistrationBatch(
  options: RegistrationOptions,
  t: Translate,
  retryItems?: BatchItem[]
): Promise<boolean> {
  if (activeBatch || activeSingle || options.mode === 'manual') return false
  if (
    !eligibleRegistrationSources(options).length &&
    !retryItems?.every(
      (item) => item.status === 'import_failed' && item.result?.status === 'success'
    )
  ) {
    addRegistrationLog('没有已配置的邮箱源')
    return false
  }
  initializeRegistration()
  refreshRegistrationQuota()
  const normalized = {
    ...options,
    batchCount: boundedInteger(options.batchCount, 1, 1, 100),
    batchRetries: boundedInteger(options.batchRetries, 1, 0, 10),
    batchInterval: boundedInteger(options.batchInterval, 5, 0, 300)
  }
  let items = retryItems
    ? retryItems.slice(0, 100).map((item) => ({ ...item, retryCount: 0, error: undefined }))
    : Array.from(
        { length: normalized.batchCount },
        (_, index): BatchItem => ({
          id: crypto.randomUUID(),
          index: index + 1,
          status: 'pending',
          email: '',
          retryCount: 0
        })
      )
  const remaining =
    options.dailyQuotaLimit > 0
      ? Math.max(0, options.dailyQuotaLimit - state().dailyQuotaUsed)
      : Infinity
  let reservations = 0
  items = items.filter(
    (item) =>
      (item.status === 'import_failed' && item.result?.status === 'success') ||
      reservations++ < remaining
  )
  if (!items.length) {
    addRegistrationLog('[Quota] 今日注册配额已用完，跳过启动')
    return false
  }
  if (items.length < (retryItems?.length || normalized.batchCount))
    addRegistrationLog(`[Quota] 本次申请数量超过剩余配额，实际执行 ${items.length} 项`)
  const run = createRun(normalized, t)
  activeBatch = run
  const ids = new Set(items.map((item) => item.id))
  patch({
    batchRunning: true,
    isPaused: false,
    phase: 'running',
    batchItems: retryItems
      ? [
          ...state().batchItems.filter((item) => !ids.has(item.id)),
          ...items.map((item) => ({ ...item, status: 'pending' as const }))
        ]
      : items
  })
  updateBatchCounters()
  run.outlook = (
    eligibleRegistrationSources(options).includes('outlook') ? options.outlookData : ''
  )
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('----'))
  for (let index = run.outlook.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[run.outlook[index], run.outlook[other]] = [run.outlook[other], run.outlook[index]]
  }
  if (options.rateLimitEnabled)
    run.limiter = createRateLimiter({
      maxPerMinute: boundedInteger(options.maxPerMinute, 10, 1, 300),
      burst: boundedInteger(options.burstSize, 3, 1, 100),
      backoffBaseMs: boundedInteger(options.backoffBaseSec, 8, 1, 300) * 1000,
      backoffMaxMs: boundedInteger(options.backoffMaxSec, 120, 1, 3600) * 1000,
      consecutiveFailureThreshold: options.autoBackoff ? 5 : Number.MAX_SAFE_INTEGER
    })
  run.centerId = useTaskStore.getState().createTask({
    kind: 'register-batch',
    title: retryItems ? `重试 ${items.length} 个失败任务` : `批量注册 ${items.length} 个账号`,
    subtitle: `${options.mode}，并发 ${boundedInteger(options.batchConcurrency, 1, 1, 100)}`,
    total: items.length,
    onPause: () => pauseBatch(true),
    onResume: () => pauseBatch(false),
    onCancel: stopRegistrationBatch
  })
  let done = 0,
    successes = 0,
    failures = 0
  const timer = setInterval(() => patch({ rateSnapshot: run.limiter?.snapshot() || null }), 1000)
  let cursor = 0
  try {
    await Promise.all(
      Array.from(
        { length: Math.min(items.length, boundedInteger(options.batchConcurrency, 1, 1, 100)) },
        async () => {
          while (!run.abort.signal.aborted && cursor < items.length) {
            const item = items[cursor++]
            try {
              await waitReady(run)
              const importOnly =
                item.status === 'import_failed' && item.result?.status === 'success'
              const result = importOnly ? item.result! : await attemptRegistration(run, item)
              if (run.abort.signal.aborted && result.status !== 'success')
                run.abort.signal.throwIfAborted()
              if (!importOnly && result.status === 'success') incrementQuota()
              await afterRegistration(result, run, item)
              if (result.status === 'success') successes++
              else failures++
            } catch (error) {
              updateItem(item.id, {
                status: run.abort.signal.aborted ? 'cancelled' : 'failed',
                error: error instanceof Error ? error.message : String(error)
              })
              if (!run.abort.signal.aborted) failures++
            } finally {
              done++
              updateBatchCounters()
              if (run.centerId)
                useTaskStore.getState().updateTask(run.centerId, {
                  done,
                  successCount: successes,
                  failedCount: failures,
                  progress: Math.round((done / items.length) * 100)
                })
            }
          }
        }
      )
    )
    if (!run.abort.signal.aborted)
      useTaskStore
        .getState()
        .completeTask(run.centerId, { successCount: successes, failedCount: failures })
  } catch (error) {
    useTaskStore
      .getState()
      .failTask(run.centerId, error instanceof Error ? error.message : String(error))
  } finally {
    clearInterval(timer)
    if (run.abort.signal.aborted)
      for (const item of items)
        if (
          ['pending', 'running', 'retrying'].includes(
            state().batchItems.find((entry) => entry.id === item.id)?.status || ''
          )
        )
          updateItem(item.id, { status: 'cancelled' })
    updateBatchCounters()
    activeBatch = undefined
    patch({ batchRunning: false, isPaused: false, phase: 'idle', rateSnapshot: null })
    addRegistrationLog(
      run.abort.signal.aborted
        ? t('register.batchStopped')
            .replace('{done}', String(done))
            .replace('{total}', String(items.length))
        : t('register.batchCompleted')
    )
    if (!run.abort.signal.aborted)
      void useWebhookStore.getState().triggerEvent('batch-completed', {
        title: '批量注册完成',
        message: `共 ${items.length} 个任务，成功 ${successes}，失败 ${failures}`,
        level: failures ? (successes ? 'warn' : 'error') : 'success',
        fields: { 模式: options.mode, 成功: successes, 失败: failures, 总数: items.length }
      })
    flushLogs()
  }
  return true
}

export function resetRegistration(): void {
  if (activeSingle || activeBatch) return
  clearRegistrationLogs()
  patch({ phase: 'idle', result: null, imported: false })
}
export async function cancelSingleRegistration(): Promise<void> {
  const run = activeSingle
  if (!run) return
  run.abort.abort(new Error('注册已取消'))
  activeSingle = undefined
  await Promise.allSettled(
    run.options.mode === 'manual'
      ? [window.api.registrationCancel(run.id)]
      : Array.from(run.taskIds, (id) => window.api.registrationCancel(id))
  )
  if (activeSingle || activeBatch) return
  patch({ phase: 'idle' })
  addRegistrationLog(run.t('register.logCancelled'))
}
export async function startSingleRegistration(
  options: RegistrationOptions,
  t: Translate,
  manualEmail = ''
): Promise<void> {
  if (activeSingle || activeBatch) return
  initializeRegistration()
  const run = createRun({ ...options, batchRetries: 0, batchInterval: 0 }, t)
  activeSingle = run
  clearRegistrationLogs()
  patch({
    phase: options.mode === 'manual' ? 'initializing' : 'running',
    imported: false,
    result: null
  })
  try {
    if (options.mode !== 'manual') {
      const result = await attemptRegistration(run)
      if (activeSingle !== run) {
        if (result.status === 'success') addHistory(result)
        return
      }
      patch({ result, phase: 'done' })
      await afterRegistration(result, run)
      if (activeSingle === run)
        patch({
          phase:
            (options.batchAutoImport && result.status === 'success') ||
            (options.autoFetchProLink && result.status === 'success')
              ? 'finalized'
              : 'done'
        })
      void useWebhookStore
        .getState()
        .triggerEvent(result.status === 'success' ? 'register-success' : 'register-failed', {
          title: result.status === 'success' ? '账号注册成功' : '账号注册失败',
          message: result.email || result.error || '',
          level: result.status === 'success' ? 'success' : 'error'
        })
      if (activeSingle === run) activeSingle = undefined
    } else {
      const config: RegistrationStartConfig & { requestId?: string } = {
        fullName: options.fullName.trim() || undefined,
        requestId: run.id
      }
      configureProxy(config)
      const response = await window.api.registrationManualPhase1(config)
      if (activeSingle !== run) return
      if (!response.success) throw new Error(response.error || '初始化失败')
      patch({ phase: 'email' })
      if (manualEmail) await submitRegistrationEmail(manualEmail, options.fullName)
    }
  } catch (error) {
    if (activeSingle === run) {
      addRegistrationLog(error instanceof Error ? error.message : String(error))
      patch({ phase: 'idle' })
      activeSingle = undefined
    }
  }
}
export async function submitRegistrationEmail(email: string, fullName?: string): Promise<void> {
  const run = activeSingle
  if (!run || !email.trim() || state().phase !== 'email') return
  patch({ phase: 'running' })
  try {
    const response = await window.api.registrationManualPhase2(
      email.trim(),
      fullName?.trim() || undefined,
      run.id
    )
    if (activeSingle !== run) return
    if (!response.success) throw new Error(response.error || '发送验证码失败')
    patch({ phase: 'otp' })
  } catch (error) {
    if (activeSingle === run) {
      addRegistrationLog(String(error))
      patch({ phase: 'idle' })
      activeSingle = undefined
    }
  }
}
export async function submitRegistrationOTP(otp: string): Promise<void> {
  const run = activeSingle
  if (!run || !otp.trim() || state().phase !== 'otp') return
  patch({ phase: 'running' })
  try {
    const response = await window.api.registrationManualPhase3(otp.trim(), run.id)
    if (activeSingle !== run) {
      if (response.result?.status === 'success') addHistory(response.result)
      return
    }
    if (!response.success || !response.result) throw new Error(response.error || '注册失败')
    patch({ result: response.result, phase: 'done' })
    await afterRegistration(response.result, run)
    if (activeSingle === run) {
      patch({
        phase: run.options.batchAutoImport || run.options.autoFetchProLink ? 'finalized' : 'done'
      })
      activeSingle = undefined
    }
  } catch (error) {
    if (activeSingle === run) {
      addRegistrationLog(String(error))
      patch({ phase: 'idle' })
      activeSingle = undefined
    }
  }
}

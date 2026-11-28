import { create } from 'zustand'
import { useAccountsStore } from '@/store/accounts'
import { useTaskStore } from '@/store/tasks'
import type { Account } from '@/types/account'
import { checkAborted, waitFor } from '../../../shared/async'
import { mapConcurrent } from '../../../shared/asyncPool'
import {
  subscriptionConcurrency,
  type SubscriptionLink,
  type OverageItem,
  type SubscriptionPlan
} from '../../../shared/subscription'
import { checkUpgradeEligibility, parseImportedLinks } from './helpers'

interface SubscriptionState {
  links: SubscriptionLink[]
  overageItems: OverageItem[]
  activeTab: 'overage' | 'links' | 'manage'
  availablePlans: SubscriptionPlan[]
  selectedPlanType: string
  selectedLinkIds: Set<string>
  quickPickCount: number
  quickPickCursor: number
  concurrency: number
  isFetching: boolean
  isValidatingLinks: boolean
  isSettingOverage: boolean
  isBatchOpening: boolean
  isLoadingPlans: boolean
}
export const useSubscriptionStore = create<SubscriptionState>(() => ({
  links: [],
  overageItems: [],
  activeTab: 'overage',
  availablePlans: [],
  selectedPlanType: '',
  selectedLinkIds: new Set(),
  quickPickCount: 10,
  quickPickCursor: 0,
  concurrency: 5,
  isFetching: false,
  isValidatingLinks: false,
  isSettingOverage: false,
  isBatchOpening: false,
  isLoadingPlans: false
}))
const links = new Map<string, SubscriptionLink>()
const overage = new Map<string, OverageItem>()
const versions = new Map<string, symbol>()
const accountOverages = new Map<string, boolean>()
const operations = new Map<
  string,
  {
    controller: AbortController
    requestId: string
    taskId: string
    done: number
    success: number
    failed: number
  }
>()
const busyFields = {
  links: 'isFetching',
  validation: 'isValidatingLinks',
  overage: 'isSettingOverage',
  opening: 'isBatchOpening',
  plans: 'isLoadingPlans'
} as const
let dirtyLinks = false,
  dirtyOverage = false
let flushTimer: ReturnType<typeof setTimeout> | undefined

/** Mutate working indexes per result; publish at most one list snapshot per UI interval. */
export function flushSubscriptionProgress(): void {
  clearTimeout(flushTimer)
  flushTimer = undefined
  const patch: Partial<SubscriptionState> = {}
  if (dirtyLinks) patch.links = Array.from(links.values())
  if (dirtyOverage) patch.overageItems = Array.from(overage.values())
  dirtyLinks = dirtyOverage = false
  if (Object.keys(patch).length) useSubscriptionStore.setState(patch)
  if (accountOverages.size) {
    const changes = new Map(accountOverages)
    accountOverages.clear()
    useAccountsStore.setState((state) => {
      const accounts = new Map(state.accounts)
      for (const [id, enabled] of changes) {
        const latest = accounts.get(id)
        if (latest)
          accounts.set(id, {
            ...latest,
            usage: {
              ...latest.usage,
              resourceDetail: { ...latest.usage?.resourceDetail, overageEnabled: enabled }
            }
          })
      }
      return { accounts }
    })
    void useAccountsStore.getState().saveToStorage()
  }
  for (const operation of operations.values()) {
    useTaskStore.getState().updateTask(operation.taskId, {
      done: operation.done,
      successCount: operation.success,
      failedCount: operation.failed,
      progress:
        (operation.done * 100) / (useTaskStore.getState().tasks.get(operation.taskId)?.total || 1)
    })
  }
}
function schedule(): void {
  if (!flushTimer) flushTimer = setTimeout(flushSubscriptionProgress, 50)
}

export function setSubscriptionLinks(
  value: SubscriptionLink[] | ((current: SubscriptionLink[]) => SubscriptionLink[])
): void {
  const previous = new Map(links)
  const next = typeof value === 'function' ? value(Array.from(links.values())) : value
  const keep = new Set(next.map((link) => link.accountId))
  for (const id of versions.keys()) if (!keep.has(id)) versions.delete(id)
  links.clear()
  for (const link of next) {
    links.set(link.accountId, link)
    if (previous.get(link.accountId) !== link) versions.set(link.accountId, Symbol())
  }
  dirtyLinks = true
  flushSubscriptionProgress()
}
export function setSubscriptionOverage(
  value: OverageItem[] | ((current: OverageItem[]) => OverageItem[])
): void {
  const next = typeof value === 'function' ? value(Array.from(overage.values())) : value
  overage.clear()
  for (const item of next) overage.set(item.accountId, item)
  dirtyOverage = true
  flushSubscriptionProgress()
}
function patchLink(id: string, patch: Partial<SubscriptionLink>, version?: symbol): void {
  const current = links.get(id)
  if (!current || (version && versions.get(id) !== version)) return
  links.set(id, { ...current, ...patch })
  dirtyLinks = true
  schedule()
}
export function appendSubscriptionLink(link: SubscriptionLink): void {
  versions.set(link.accountId, Symbol())
  links.set(link.accountId, link)
  dirtyLinks = true
  schedule()
}
export function updateSubscriptionLink(id: string, patch: Partial<SubscriptionLink>): void {
  if (!links.has(id)) return
  versions.set(id, Symbol())
  patchLink(id, patch)
}
export function importSubscriptionLinks(text: string, isEn: boolean): number {
  const known = new Set(Array.from(links.values(), (link) => link.url))
  let count = 0
  for (const item of parseImportedLinks(text)) {
    if (known.has(item.url)) continue
    known.add(item.url)
    const id = `import-${crypto.randomUUID()}`
    appendSubscriptionLink({
      accountId: id,
      email: item.email || (isEn ? `(Imported #${links.size + 1})` : `(导入 #${links.size + 1})`),
      status: 'success',
      url: item.url,
      generatedAt: Date.now(),
      validated: false
    })
    count++
  }
  if (count) flushSubscriptionProgress()
  return count
}
export function cancelSubscriptionOperation(key: string): void {
  const job = operations.get(key)
  if (!job) return
  job.controller.abort(new Error('任务已取消'))
  void window.api.subscriptionCancel(job.requestId).catch(() => {})
}

async function run<T>(
  key: string,
  items: readonly T[],
  concurrency: number,
  title: string,
  work: (item: T, signal: AbortSignal, requestId: string) => Promise<boolean>
): Promise<boolean> {
  if (operations.has(key) || items.length === 0) return false
  const controller = new AbortController(),
    requestId = crypto.randomUUID()
  const taskId = useTaskStore.getState().createTask({
    kind: 'subscription-batch',
    title,
    total: items.length,
    onCancel: () => cancelSubscriptionOperation(key)
  })
  const job = { controller, requestId, taskId, done: 0, success: 0, failed: 0 }
  operations.set(key, job)
  const field = busyFields[key as keyof typeof busyFields]
  if (field) useSubscriptionStore.setState({ [field]: true })
  try {
    await mapConcurrent(items, subscriptionConcurrency(concurrency), async (item) => {
      checkAborted(controller.signal)
      try {
        const ok = await work(item, controller.signal, requestId)
        checkAborted(controller.signal)
        if (ok) job.success++
        else job.failed++
      } catch (error) {
        if (!controller.signal.aborted) {
          job.failed++
          useTaskStore.getState().updateTask(taskId, {
            lastMessage: error instanceof Error ? error.message : String(error)
          })
        }
      } finally {
        job.done++
        schedule()
      }
    })
  } finally {
    flushSubscriptionProgress()
    if (controller.signal.aborted) useTaskStore.getState().cancelTask(taskId)
    else
      useTaskStore
        .getState()
        .completeTask(taskId, { successCount: job.success, failedCount: job.failed })
    operations.delete(key)
    if (field) useSubscriptionStore.setState({ [field]: false })
  }
  return true
}

function latestAccount(id: string): Account {
  const account = useAccountsStore.getState().accounts.get(id)
  if (!account?.credentials.accessToken) throw new Error('账号不存在或缺少 accessToken')
  return account
}
async function subscriptionUrl(
  account: Account,
  plan: string | undefined,
  signal: AbortSignal,
  requestId: string
): Promise<string> {
  checkAborted(signal)
  const c = account.credentials
  const result = await waitFor(
    window.api.accountGetSubscriptionUrl(
      c.accessToken,
      plan,
      c.region,
      account.profileArn,
      account.machineId,
      c.provider || account.idp,
      c.authMethod,
      account.id,
      requestId
    ),
    signal
  )
  checkAborted(signal)
  if (!result.success || !result.url) throw new Error(result.error || 'Failed to get URL')
  return result.url
}
function beginLink(id: string): symbol {
  const token = Symbol()
  versions.set(id, token)
  return token
}
async function fetchLink(
  id: string,
  plan: string,
  signal: AbortSignal,
  requestId: string,
  owned?: Map<string, symbol>,
  enforceEligibility = true
): Promise<boolean> {
  if (!links.has(id)) return false
  const token = beginLink(id)
  owned?.set(id, token)
  patchLink(id, { status: 'loading', error: undefined }, token)
  try {
    const account = latestAccount(id)
    const eligible = checkUpgradeEligibility(account)
    if (enforceEligibility && !eligible.eligible)
      throw new Error(eligible.detail || eligible.reason)
    const url = await subscriptionUrl(account, plan, signal, requestId)
    patchLink(
      id,
      {
        status: 'success',
        url,
        generatedAt: Date.now(),
        validated: false,
        validation: undefined,
        error: undefined
      },
      token
    )
    return true
  } catch (error) {
    patchLink(
      id,
      {
        status: signal.aborted ? 'cancelled' : 'error',
        error: error instanceof Error ? error.message : String(error)
      },
      token
    )
    return false
  }
}
export function fetchSubscriptionLinks(
  accounts: Account[],
  plan: string,
  concurrency: number,
  title: string
): Promise<boolean> {
  if (!plan || operations.has('links')) return Promise.resolve(false)
  const eligible = accounts.filter((account) => checkUpgradeEligibility(account).eligible)
  if (!eligible.length) return Promise.resolve(false)
  setSubscriptionLinks(
    eligible.map((account) => ({
      accountId: account.id,
      email: account.email || 'Unknown',
      status: 'pending'
    }))
  )
  useSubscriptionStore.setState({ selectedLinkIds: new Set() })
  const owned = new Map(eligible.map((account) => [account.id, versions.get(account.id)!]))
  return run('links', eligible, concurrency, title, (account, signal, id) =>
    fetchLink(account.id, plan, signal, id, owned)
  ).finally(() => {
    for (const [id, version] of owned) {
      const link = links.get(id)
      if (
        link &&
        versions.get(id) === version &&
        (link.status === 'pending' || link.status === 'loading')
      )
        patchLink(id, { status: 'cancelled', error: '任务已取消' }, version)
    }
    flushSubscriptionProgress()
  })
}
export function regenerateSubscriptionLink(
  id: string,
  plan: string,
  title: string
): Promise<boolean> {
  if (!plan || !links.has(id)) return Promise.resolve(false)
  return run(`link:${id}`, [id], 1, title, (id, signal, requestId) =>
    fetchLink(id, plan, signal, requestId, undefined, false)
  )
}
export function loadSubscriptionPlans(accounts: Account[], title: string): Promise<boolean> {
  const account = accounts.find((a) => checkUpgradeEligibility(a).eligible)
  if (!account) return Promise.resolve(false)
  return run('plans', [account.id], 1, title, async (id, signal, requestId) => {
    const account = latestAccount(id),
      c = account.credentials
    const result = await waitFor(
      window.api.accountGetSubscriptions(
        c.accessToken,
        c.region,
        account.profileArn,
        account.machineId,
        c.provider || account.idp,
        c.authMethod,
        account.id,
        requestId
      ),
      signal
    )
    checkAborted(signal)
    if (!result.success || !result.plans.length)
      throw new Error(result.error || 'No subscription plans returned')
    const plan =
      result.plans.find(
        (p) =>
          p.qSubscriptionType?.toUpperCase().includes('PRO') &&
          !p.qSubscriptionType.toUpperCase().includes('PLUS')
      ) || result.plans[0]
    useSubscriptionStore.setState({
      availablePlans: result.plans,
      selectedPlanType: plan.qSubscriptionType
    })
    return true
  })
}
export function validateSubscriptionLinks(concurrency: number, title: string): Promise<boolean> {
  const targets = Array.from(links.values()).filter((link) => link.status === 'success' && link.url)
  return run('validation', targets, concurrency, title, async (link, signal, requestId) => {
    const existing = links.get(link.accountId)
    if (
      !existing ||
      existing.status !== 'success' ||
      existing.url !== link.url ||
      existing.generatedAt !== link.generatedAt
    )
      return false
    const token = versions.get(link.accountId)
    let patch: Partial<SubscriptionLink>
    if (!link.generatedAt || Date.now() - link.generatedAt > 15 * 60000) {
      patch = {
        validation: 'stale',
        validated: false,
        error: '链接生成已超过 15 分钟，有效性待确认'
      }
    } else {
      try {
        const result = await waitFor(
          window.api.diagnoseHttpProbe({
            url: link.url!,
            method: 'HEAD',
            timeoutMs: 6000,
            requestId
          }),
          signal
        )
        checkAborted(signal)
        patch =
          result.success ||
          (result.status !== undefined && result.status >= 200 && result.status < 400)
            ? { validation: 'valid', validated: true, error: undefined }
            : result.status === 410 || result.status === 404
              ? { status: 'expired', validation: 'expired', validated: false, error: '链接不可用' }
              : {
                  validation: 'unknown',
                  validated: false,
                  error: '暂时无法确认链接有效性，可手动打开确认'
                }
      } catch (error) {
        checkAborted(signal)
        patch = {
          validation: 'unknown',
          validated: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
    checkAborted(signal)
    const current = links.get(link.accountId)
    if (
      current &&
      current.url === link.url &&
      current.generatedAt === link.generatedAt &&
      current.status === 'success'
    )
      patchLink(link.accountId, patch, token)
    return patch.validated === true
  })
}
export function setAccountOverages(
  accounts: Account[],
  enabled: boolean,
  concurrency: number,
  title: string
): Promise<boolean> {
  if (operations.has('overage') || !accounts.length) return Promise.resolve(false)
  setSubscriptionOverage(
    accounts.map((a) => ({ accountId: a.id, email: a.email || 'Unknown', status: 'pending' }))
  )
  return run('overage', accounts, concurrency, title, async (input, signal, requestId) => {
    const patch = (changes: Partial<OverageItem>): void => {
      const item = overage.get(input.id)
      if (item) {
        overage.set(input.id, { ...item, ...changes })
        dirtyOverage = true
        schedule()
      }
    }
    patch({ status: 'loading' })
    try {
      const account = latestAccount(input.id),
        c = account.credentials
      const result = await waitFor(
        window.api.accountSetOverage(
          c.accessToken,
          enabled ? 'ENABLED' : 'DISABLED',
          c.region,
          account.profileArn,
          account.machineId,
          c.provider || account.idp,
          c.authMethod,
          account.id,
          requestId
        ),
        signal
      )
      checkAborted(signal)
      if (!result.success) throw new Error(result.error || 'Unknown error')
      accountOverages.set(account.id, enabled)
      patch({ status: 'success' })
      return true
    } catch (error) {
      patch({
        status: signal.aborted ? 'cancelled' : 'error',
        error: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }).finally(() => {
    for (const item of overage.values())
      if (item.status === 'pending' || item.status === 'loading')
        overage.set(item.accountId, { ...item, status: 'cancelled', error: '任务已取消' })
    dirtyOverage = true
    flushSubscriptionProgress()
  })
}
export function openSubscriptionPortals(
  accounts: Account[],
  concurrency: number,
  title: string
): Promise<boolean> {
  return run('opening', accounts, concurrency, title, async (input, signal, requestId) => {
    const url = await subscriptionUrl(latestAccount(input.id), undefined, signal, requestId)
    const result = await waitFor(window.api.openSubscriptionWindow(url, requestId), signal)
    checkAborted(signal)
    if (!result.success) throw new Error(result.error || 'Failed to open URL')
    return true
  })
}
export function openSubscriptionLinks(
  targets: SubscriptionLink[],
  concurrency: number,
  title: string
): Promise<boolean> {
  return run('opening', targets, concurrency, title, async (link, signal, requestId) => {
    if (!link.url || links.get(link.accountId)?.url !== link.url) return false
    const result = await waitFor(window.api.openSubscriptionWindow(link.url, requestId), signal)
    checkAborted(signal)
    if (!result.success) throw new Error(result.error || 'Failed to open URL')
    return true
  })
}

/* eslint @typescript-eslint/explicit-function-return-type: "off" -- JavaScript regression fixtures. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { build } from 'esbuild'
const require = createRequire(import.meta.url)
const noop = () => undefined
const tick = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function load(file, dependencies = {}, globals = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }).outputText
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(
    (name) => (name in dependencies ? dependencies[name] : require(name)),
    module,
    module.exports,
    ...Object.values(globals)
  )
  return module.exports
}
const bundled = (
  await build({
    entryPoints: ['src/renderer/src/registration/runtime.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    external: ['zustand'],
    alias: { '@': process.cwd() + '/src/renderer/src' },
    plugins: [
      {
        name: 'fixtures',
        setup(builder) {
          builder.onResolve(
            {
              filter:
                /^@\/(store\/accounts|store\/tasks|store\/webhooks|components\/pages\/SubscriptionPage)$/
            },
            ({ path }) => ({ path, namespace: 'fixtures' })
          )
          builder.onLoad({ filter: /.*/, namespace: 'fixtures' }, ({ path }) => ({
            contents: path.includes('SubscriptionPage')
              ? 'export const appendSubscriptionLink = value => window.links.push(value); export const updateSubscriptionLink = (id, patch) => Object.assign(window.links.find(link => link.accountId === id), patch)'
              : `export const ${path.endsWith('accounts') ? 'useAccountsStore = window.accounts' : path.endsWith('tasks') ? 'useTaskStore = window.tasks' : 'useWebhookStore = window.webhooks'};`,
            loader: 'js'
          }))
        }
      }
    ]
  })
).outputFiles[0].text
function options(patch = {}) {
  return {
    mode: 'gptmail',
    fullName: '',
    outlookData: '',
    batchCount: 1,
    batchInterval: 0,
    batchRetries: 0,
    batchConcurrency: 1,
    batchAutoImport: false,
    autoFetchProLink: false,
    proPlanType: 'Q_DEVELOPER_STANDALONE_PRO',
    tempMailEmail: '',
    tempMailEpin: '',
    tempMailDomain: '',
    protonBaseEmail: '',
    gptMailBaseURL: '',
    gptMailInboxEmail: '',
    gptMailDomain: 'example.test',
    gptMailPrefix: '',
    gptMailPrivatePassword: '',
    manualParentEmail: '',
    manualAnonymousEmail: false,
    mixedEnabledSources: ['gptmail'],
    mixedWeights: { outlook: 1, tempmail: 1, proton: 1, gptmail: 1 },
    dailyQuotaLimit: 0,
    rateLimitEnabled: false,
    maxPerMinute: 10,
    burstSize: 3,
    backoffBaseSec: 8,
    backoffMaxSec: 120,
    autoBackoff: true,
    autoPauseOnRisk: false,
    ...patch
  }
}
function success(email = 'fixture@example.test', patch = {}) {
  return {
    status: 'success',
    email,
    password: 'fixture-password',
    refreshToken: 'old-refresh',
    accessToken: 'old-access',
    clientId: 'client',
    clientSecret: 'secret',
    region: 'us-east-1',
    verify: { alive: true, email, credit_limit: 25 },
    ...patch
  }
}
function harness(api = {}, globals = {}) {
  const storage = new Map()
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  }
  const tasks = load('src/renderer/src/store/tasks.ts', {}, { localStorage }).useTaskStore
  const accountMap = new Map(),
    events = [],
    requests = [],
    links = [],
    listeners = {}
  const state = {
    accounts: accountMap,
    proxyPoolConfig: { enabled: false },
    pickNextProxy: () => null,
    reportProxyResult: noop,
    addAccount: (value) => {
      const id = 'account-' + accountMap.size
      accountMap.set(id, { ...value, id })
      return id
    },
    updateAccount: (id, patch) => accountMap.set(id, { ...accountMap.get(id), ...patch })
  }
  const window = {
    accounts: { getState: () => state },
    tasks,
    links,
    webhooks: { getState: () => ({ triggerEvent: async (...args) => events.push(args) }) },
    api: {
      registrationStatus: async () => ({ inProgress: false }),
      onRegistrationLog: (callback) => {
        listeners.log = callback
        return noop
      },
      onRegistrationStep: (callback) => {
        listeners.step = callback
        return noop
      },
      registrationStartAuto: async (config) => {
        requests.push(config)
        return { success: true, result: success('fixture-' + requests.length + '@example.test') }
      },
      registrationCancel: async () => ({ success: true }),
      accountGetSubscriptionUrl: async () => ({
        success: true,
        url: 'https://example.test/subscribe'
      }),
      verifyAccountCredentials: async () => ({
        success: true,
        data: {
          email: 'fixture@example.test',
          refreshToken: 'rotated',
          accessToken: 'new-access',
          expiresIn: 600,
          subscriptionType: 'Free',
          subscriptionTitle: 'Free Tier',
          usage: { current: 1, limit: 25 }
        }
      }),
      ...api
    }
  }
  const module = { exports: {} }
  new Function(
    'require',
    'module',
    'exports',
    'window',
    'localStorage',
    ...Object.keys(globals),
    bundled
  )(require, module, module.exports, window, localStorage, ...Object.values(globals))
  return {
    ...module.exports,
    storage,
    tasks,
    accounts: state,
    requests,
    links,
    events,
    listeners,
    window
  }
}
const t = (key) => key

test('quota truncates the actual batch and dispatch clamps count/concurrency to the existing UI limits', async () => {
  const h = harness()
  h.useRegistrationStore.setState({ dailyQuotaUsed: 8 })
  await h.startRegistrationBatch(options({ batchCount: 5, dailyQuotaLimit: 10 }), t)
  assert.equal(h.requests.length, 2)
  assert.equal(h.useRegistrationStore.getState().batchItems.length, 2)
  assert.equal(h.useRegistrationStore.getState().dailyQuotaUsed, 10)
  const other = harness()
  await other.startRegistrationBatch(options({ batchCount: 1000, batchConcurrency: 1000 }), t)
  assert.equal(other.requests.length, 100)
})

test('every retry acquires a fresh token and reports its failure before the next attempt', async () => {
  let now = 0,
    calls = 0
  class Clock extends Date {
    static now() {
      return now
    }
  }
  const times = []
  const h = harness(
    {
      registrationStartAuto: async () => {
        times.push(now)
        calls++
        return { success: true, result: { status: 'failed', email: '', error: 'HTTP 503' } }
      }
    },
    {
      Date: Clock,
      setTimeout: (callback, delay) => {
        now += delay
        queueMicrotask(callback)
        return 1
      },
      clearTimeout: noop
    }
  )
  await h.startRegistrationBatch(
    options({ batchRetries: 2, rateLimitEnabled: true, maxPerMinute: 1, burstSize: 1 }),
    t
  )
  assert.equal(calls, 3)
  assert.ok(times[1] - times[0] >= 60000)
  assert.ok(times[2] - times[1] >= 60000)
})

test('cancel interrupts a five-minute start interval and keeps the task terminal', async () => {
  const h = harness()
  const running = h.startRegistrationBatch(options({ batchCount: 3, batchInterval: 300 }), t)
  for (let index = 0; index < 10 && !h.requests.length; index++) await tick()
  h.stopRegistrationBatch()
  await running
  assert.equal(h.requests.length, 1)
  assert.equal(h.useRegistrationStore.getState().batchRunning, false)
  const task = [...h.tasks.getState().tasks.values()][0]
  assert.equal(task.status, 'cancelled')
  assert.equal(task.onCancel, undefined)
  h.tasks.getState().completeTask(task.id, { successCount: 99 })
  assert.equal(h.tasks.getState().tasks.get(task.id).status, 'cancelled')
})

test('pause/resume and cancel work without a mounted page; completed results persist', async () => {
  const first = deferred(),
    reached = deferred()
  let calls = 0
  const h = harness({
    registrationStartAuto: async () => {
      calls++
      if (calls === 1) {
        reached.resolve()
        return first.promise
      }
      return { success: true, result: success('second@example.test') }
    }
  })
  const running = h.startRegistrationBatch(options({ batchCount: 2 }), t)
  await reached.promise
  h.toggleRegistrationPause()
  first.resolve({ success: true, result: success() })
  await tick()
  assert.equal(calls, 1)
  assert.equal(h.useRegistrationStore.getState().history.length, 1)
  h.toggleRegistrationPause()
  await running
  assert.equal(calls, 2)
  assert.equal(JSON.parse(h.storage.get('kiro-register-history')).length, 2)
})

test('IPC rejection becomes a failed item and releases the batch for a later run', async () => {
  const h = harness({
    registrationStartAuto: async () => {
      throw new Error('fixture rejection')
    }
  })
  await h.startRegistrationBatch(options(), t)
  assert.equal(h.useRegistrationStore.getState().batchRunning, false)
  assert.equal(h.useRegistrationStore.getState().phase, 'idle')
  assert.match(h.useRegistrationStore.getState().batchItems[0].error, /fixture rejection/)
  assert.equal([...h.tasks.getState().tasks.values()][0].status, 'failed')
})

test('filtered retry statistics are scoped to that run and preserve other failed items', async () => {
  const h = harness()
  const retry = { id: 'a', index: 9, email: '', status: 'failed', retryCount: 0 }
  h.useRegistrationStore.setState({
    batchItems: [retry, { id: 'b', index: 10, email: '', status: 'failed', retryCount: 0 }]
  })
  const progress = []
  h.tasks.subscribe((state) => {
    for (const task of state.tasks.values()) progress.push(task.progress)
  })
  await h.startRegistrationBatch(options(), t, [retry])
  const task = [...h.tasks.getState().tasks.values()][0]
  assert.equal(task.total, 1)
  assert.equal(task.done, 1)
  assert.equal(task.successCount, 1)
  assert.ok(progress.every((value) => value <= 100))
  assert.equal(h.useRegistrationStore.getState().batchFail, 1)
})

test('import-only retries reuse the successful result even when daily registration quota is exhausted', async () => {
  const h = harness()
  h.useRegistrationStore.setState({ dailyQuotaUsed: 10 })
  const item = {
    id: 'a',
    index: 1,
    email: 'fixture@example.test',
    status: 'import_failed',
    retryCount: 0,
    result: success()
  }
  h.useRegistrationStore.setState({ batchItems: [item] })
  await h.startRegistrationBatch(options({ dailyQuotaLimit: 10 }), t, [item])
  assert.equal(h.requests.length, 0)
  assert.equal(h.accounts.accounts.size, 1)
  assert.equal(h.useRegistrationStore.getState().batchItems[0].status, 'imported')
  assert.equal(h.useRegistrationStore.getState().dailyQuotaUsed, 10)
})

test('concurrent imports coalesce, preserve rotated credentials/password, and update the existing account', async () => {
  let verifications = 0
  const hold = deferred()
  const h = harness({
    verifyAccountCredentials: async () => {
      verifications++
      return hold.promise
    }
  })
  const result = success('fixture@example.test', { verify: undefined })
  const one = h.importRegistrationResult(result),
    two = h.importRegistrationResult(result)
  assert.equal(one, two)
  hold.resolve({
    success: true,
    data: {
      email: result.email,
      refreshToken: 'rotated-refresh',
      accessToken: 'rotated-access',
      expiresIn: 600,
      subscriptionType: 'Free'
    }
  })
  await Promise.all([one, two])
  assert.equal(verifications, 1)
  const account = [...h.accounts.accounts.values()][0]
  assert.equal(account.credentials.refreshToken, 'rotated-refresh')
  assert.equal(account.password, 'fixture-password')
  account.tags = ['keep']
  account.groupId = 'keep-group'
  account.machineId = 'keep-machine'
  await h.importRegistrationResult(success())
  assert.equal(h.accounts.accounts.size, 1)
  const updated = [...h.accounts.accounts.values()][0]
  assert.equal(updated.credentials.refreshToken, 'rotated-refresh')
  assert.deepEqual(updated.tags, ['keep'])
  assert.equal(updated.groupId, 'keep-group')
  assert.equal(updated.machineId, 'keep-machine')
})

test('credential rotation remains available when the following account information query fails', async () => {
  const h = harness({
    verifyAccountCredentials: async () => ({
      success: false,
      error: 'usage unavailable',
      refreshedCredentials: {
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresAt: 123456
      }
    })
  })
  await h.importRegistrationResult(success('fixture@example.test', { verify: undefined }))
  const account = [...h.accounts.accounts.values()][0]
  assert.equal(account.credentials.refreshToken, 'new-refresh')
  assert.equal(account.credentials.expiresAt, 123456)
})

test('Mixed routing consumes credits only when dispatched and respects zero/all-zero weights', async () => {
  const h = harness()
  const config = options({
    mode: 'mixed',
    outlookData: 'outlook@example.test----pw----client----refresh',
    mixedEnabledSources: ['outlook', 'gptmail']
  })
  for (let index = 0; index < 20; index++) h.eligibleRegistrationSources(config)
  await h.startRegistrationBatch({ ...config, batchCount: 2 }, t)
  assert.equal(h.requests[0].useOutlook, true)
  assert.equal(h.requests[1].useGptMail, true)
  for (const weight of [0, 1]) {
    const run = {
      options: { ...config, mixedWeights: { outlook: weight, gptmail: 0, tempmail: 0, proton: 0 } },
      credits: { outlook: 0, gptmail: 0, tempmail: 0, proton: 0 }
    }
    const sources = Array.from({ length: 20 }, () => h.chooseRegistrationSource(run))
    assert.equal(sources.filter((source) => source === 'outlook').length, weight ? 20 : 10)
  }
  await h.startSingleRegistration(config, t)
  assert.ok(h.requests.at(-1).useOutlook || h.requests.at(-1).useGptMail)
})

test('single completion, postprocessing and selected plan work without page event listeners', async () => {
  const hold = deferred(),
    reached = deferred(),
    plans = []
  const h = harness({
    registrationStartAuto: async () => {
      reached.resolve()
      return hold.promise
    },
    accountGetSubscriptionUrl: async (_token, plan) => {
      plans.push(plan)
      return { success: true, url: 'https://example.test' }
    }
  })
  const running = h.startSingleRegistration(
    options({
      batchAutoImport: true,
      autoFetchProLink: true,
      proPlanType: 'Q_DEVELOPER_STANDALONE_POWER'
    }),
    t
  )
  await reached.promise
  hold.resolve({ success: true, result: success() })
  await running
  assert.equal(h.useRegistrationStore.getState().phase, 'finalized')
  assert.equal(h.useRegistrationStore.getState().history.length, 1)
  assert.equal(h.accounts.accounts.size, 1)
  assert.deepEqual(plans, ['Q_DEVELOPER_STANDALONE_POWER'])
})

test('stopping a single operation targets its request and ignores late state changes', async () => {
  const hold = deferred(),
    reached = deferred(),
    cancelled = []
  let config
  const h = harness({
    registrationStartAuto: async (value) => {
      config = value
      reached.resolve()
      return hold.promise
    },
    registrationCancel: async (id) => {
      cancelled.push(id)
      return { success: true }
    }
  })
  const running = h.startSingleRegistration(options(), t)
  await reached.promise
  await h.cancelSingleRegistration()
  hold.resolve({ success: true, result: success() })
  await running
  assert.deepEqual(cancelled, [config.taskId])
  assert.equal(h.useRegistrationStore.getState().phase, 'idle')
  assert.equal(h.useRegistrationStore.getState().history.length, 1)
})

test('date rollover resets the displayed count and stores the next success under the new day', async () => {
  let date = new Date(2026, 10, 27, 23, 59).getTime()
  class Clock extends Date {
    constructor(...args) {
      super(...(args.length ? args : [date]))
    }
    static now() {
      return date
    }
  }
  const h = harness({}, { Date: Clock })
  h.storage.set('kiro-register-quota-2026-11-27', '8')
  h.useRegistrationStore.setState({ dailyQuotaUsed: 8 })
  date += 120000
  h.refreshRegistrationQuota()
  assert.equal(h.useRegistrationStore.getState().dailyQuotaUsed, 0)
  await h.startRegistrationBatch(options({ dailyQuotaLimit: 10 }), t)
  assert.equal(h.storage.get('kiro-register-quota-2026-11-28'), '1')
  assert.equal(h.storage.get('kiro-register-quota-2026-11-27'), '8')
})

test('template parsing rejects invalid elements and normalizes legacy modes and numeric limits', () => {
  const helper = load('src/renderer/src/lib/registration.ts')
  assert.throws(() => helper.parseTemplates([{ id: 'broken', name: 'broken' }]))
  assert.throws(() =>
    helper.parseTemplates([{ id: 'broken', name: 'broken', config: { mode: 'invalid' } }])
  )
  const templates = helper.parseTemplates([
    { id: 'old', name: 'old', config: { mode: 'moemail', batchCount: 500, batchConcurrency: 0 } }
  ])
  assert.equal(templates[0].config.mode, 'outlook')
  assert.equal(templates[0].config.batchCount, 100)
  assert.equal(templates[0].config.batchConcurrency, 1)
})

function ipcHarness() {
  const handlers = {},
    registrars = []
  class Registrar {
    constructor() {
      this.wait = deferred()
      this.disposal = deferred()
      this.aborted = false
      registrars.push(this)
    }
    run() {
      return this.wait.promise
    }
    abort() {
      this.aborted = true
    }
    destroy() {
      return this.disposal.promise
    }
    runManualPhase1() {
      return this.wait.promise
    }
    runManualPhase2() {
      return this.wait.promise
    }
  }
  load('src/main/registration/ipc-handlers.ts', {
    electron: {
      ipcMain: {
        handle: (name, callback) => {
          handlers[name] = callback
        }
      }
    },
    './index': { Registrar, newConfig: (config) => config },
    './proton-mail-window': {}
  }).registerIPCHandlers(() => null)
  return { handlers, registrars }
}
test('cancel-all aborts every registrar before awaiting the first disposal', async () => {
  const { handlers, registrars } = ipcHarness()
  const runs = Array.from({ length: 3 }, (_, index) =>
    handlers['registration-start-auto'](null, { taskId: String(index) })
  )
  const cancelling = handlers['registration-cancel'](null)
  assert.ok(registrars.every((registrar) => registrar.aborted))
  for (const registrar of registrars) {
    registrar.disposal.resolve()
    registrar.wait.resolve(success())
  }
  await Promise.all([...runs, cancelling])
  assert.equal((await handlers['registration-status']()).count, 0)
})
test('late manual completion cannot delete a new registrar and stale phase calls are rejected', async () => {
  const { handlers, registrars } = ipcHarness()
  const old = handlers['registration-manual-phase1'](null, { requestId: 'old' })
  const cancellation = handlers['registration-cancel'](null, 'old')
  registrars[0].disposal.resolve()
  await cancellation
  const next = handlers['registration-manual-phase1'](null, { requestId: 'next' })
  registrars[0].wait.resolve({ success: false })
  await old
  assert.equal((await handlers['registration-status']()).count, 1)
  assert.equal(
    (await handlers['registration-manual-phase2'](null, 'old@example.test', undefined, 'old'))
      .success,
    false
  )
  registrars[1].wait.resolve({ success: false })
  registrars[1].disposal.resolve()
  await next
})

test('manual phases preserve their session through email/OTP waits and coalesce duplicate submissions', async () => {
  const email = deferred(),
    otp = deferred(),
    phaseCalls = []
  let requestId
  const h = harness({
    registrationManualPhase1: async (config) => {
      requestId = config.requestId
      return { success: true }
    },
    registrationManualPhase2: async (...args) => {
      phaseCalls.push(['email', ...args])
      return email.promise
    },
    registrationManualPhase3: async (...args) => {
      phaseCalls.push(['otp', ...args])
      return otp.promise
    }
  })
  await h.startSingleRegistration(options({ mode: 'manual', batchAutoImport: true }), t)
  assert.equal(h.useRegistrationStore.getState().phase, 'email')
  const pending = h.submitRegistrationEmail('fixture@example.test', 'Fixture')
  await h.submitRegistrationEmail('duplicate@example.test')
  email.resolve({ success: true })
  await pending
  assert.equal(h.useRegistrationStore.getState().phase, 'otp')
  const completing = h.submitRegistrationOTP('123456')
  await h.submitRegistrationOTP('654321')
  otp.resolve({ success: true, result: success() })
  await completing
  assert.deepEqual(phaseCalls, [
    ['email', 'fixture@example.test', 'Fixture', requestId],
    ['otp', '123456', requestId]
  ])
  assert.equal(h.useRegistrationStore.getState().phase, 'finalized')
  assert.equal(h.accounts.accounts.size, 1)
})

test('single-mode proxy fallback is retained while a batch with an empty enabled pool sends no registration request', async () => {
  const h = harness()
  h.accounts.proxyPoolConfig.enabled = true
  await h.startSingleRegistration(options(), t)
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].proxy, undefined)
  await h.startRegistrationBatch(options(), t)
  assert.equal(h.requests.length, 1)
  assert.equal(h.useRegistrationStore.getState().batchItems[0].status, 'failed')
})

test('logs share a bounded writer while session history and export data remain complete', async () => {
  const h = harness()
  for (let index = 0; index < 1000; index++) h.addRegistrationLog(String(index))
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(h.useRegistrationStore.getState().logs.length, 500)
  assert.match(h.useRegistrationStore.getState().logs.at(-1), /999/)
  const history = Array.from({ length: 150 }, (_, index) => ({
    id: String(index),
    time: index,
    email: `fixture-${index}@example.test`,
    status: 'success',
    imported: false
  }))
  h.setRegistrationHistory(history)
  assert.equal(h.useRegistrationStore.getState().history.length, 150)
  assert.equal(JSON.parse(h.storage.get('kiro-register-history')).length, 100)
})

test('a newer account rotation during verification is not overwritten by an older verification response', async () => {
  const hold = deferred()
  const h = harness({ verifyAccountCredentials: () => hold.promise })
  const original = {
    id: 'existing',
    email: 'fixture@example.test',
    tags: [],
    credentials: {
      refreshToken: 'original',
      accessToken: 'original',
      clientId: 'client',
      clientSecret: 'secret',
      provider: 'BuilderId',
      expiresAt: 100
    }
  }
  h.accounts.accounts.set(original.id, original)
  const importing = h.importRegistrationResult(
    success('fixture@example.test', { verify: undefined })
  )
  h.accounts.updateAccount(original.id, {
    credentials: {
      ...original.credentials,
      refreshToken: 'newest',
      accessToken: 'newest-access',
      expiresAt: 9000
    }
  })
  hold.resolve({
    success: true,
    data: {
      email: original.email,
      refreshToken: 'older-rotation',
      accessToken: 'older-access',
      expiresIn: 3600
    }
  })
  await importing
  assert.equal(h.accounts.accounts.get(original.id).credentials.refreshToken, 'newest')
  assert.equal(h.accounts.accounts.get(original.id).credentials.accessToken, 'newest-access')
  assert.equal(h.accounts.accounts.get(original.id).credentials.expiresAt, 9000)
})

test('automatic risk pause applies before a failed attempt can retry and can be cancelled without resuming', async () => {
  let calls = 0
  const h = harness({
    registrationStartAuto: async () => {
      calls++
      return {
        success: true,
        result: { status: 'failed', email: 'fixture@example.test', error: 'AWS-RISK-CONTROL' }
      }
    }
  })
  const running = h.startRegistrationBatch(options({ batchRetries: 2, autoPauseOnRisk: true }), t)
  for (let index = 0; index < 20 && !h.useRegistrationStore.getState().isPaused; index++)
    await tick()
  assert.equal(h.useRegistrationStore.getState().isPaused, true)
  assert.equal(calls, 1)
  assert.equal(h.events.filter(([name]) => name === 'risk-warning').length, 1)
  h.stopRegistrationBatch()
  await running
  assert.equal(calls, 1)
})

test('scheduler reads imported registration settings instead of holding a stale page snapshot', () => {
  const h = harness()
  const helper = load(
    'src/renderer/src/lib/registration.ts',
    {},
    { localStorage: { getItem: (key) => h.storage.get(key) ?? null } }
  )
  const scheduler = load(
    'src/renderer/src/hooks/useRegistrationSchedule.ts',
    {
      react: { useEffect: noop },
      './useTranslation': { useTranslation: () => ({ t }) },
      '@/lib/registration': helper,
      '@/registration/runtime': h
    },
    { localStorage: { getItem: (key) => h.storage.get(key) ?? null } }
  )
  scheduler.setRegistrationOptions(options({ batchCount: 1 }))
  assert.equal(scheduler.readRegistrationOptions().batchCount, 1)
  h.storage.set(
    'kiro-register-config',
    JSON.stringify(options({ batchCount: 3, mode: 'mixed', mixedEnabledSources: ['gptmail'] }))
  )
  h.storage.set('kiro-register-ratelimit-max', '25')
  assert.equal(scheduler.readRegistrationOptions().batchCount, 3)
  assert.equal(scheduler.readRegistrationOptions().maxPerMinute, 25)
  assert.deepEqual(scheduler.readRegistrationOptions().mixedEnabledSources, ['gptmail'])
})

test('an actual failed import retries postprocessing without another registration or duplicate history', async () => {
  let verifies = 0
  const h = harness({
    registrationStartAuto: async () => ({
      success: true,
      result: success('fixture@example.test', { verify: undefined })
    }),
    verifyAccountCredentials: async () => {
      verifies++
      if (verifies === 1) throw new Error('fixture import interruption')
      return {
        success: true,
        data: {
          email: 'fixture@example.test',
          refreshToken: 'rotated',
          accessToken: 'new',
          subscriptionType: 'Free'
        }
      }
    }
  })
  const calls = []
  const start = h.window.api.registrationStartAuto
  h.window.api.registrationStartAuto = (...args) => {
    calls.push(args)
    return start(...args)
  }
  await h.startRegistrationBatch(options({ batchAutoImport: true }), t)
  const item = h.useRegistrationStore.getState().batchItems[0]
  assert.equal(item.status, 'import_failed')
  await h.startRegistrationBatch(options(), t, [item])
  assert.equal(calls.length, 1)
  assert.equal(verifies, 2)
  assert.equal(h.useRegistrationStore.getState().history.length, 1)
  assert.equal(h.useRegistrationStore.getState().history[0].imported, true)
  assert.equal(h.useRegistrationStore.getState().dailyQuotaUsed, 1)
})

test('the existing fixed retry delay is retained when the interval between new jobs is five minutes', async () => {
  let now = 0
  const times = []
  class Clock extends Date {
    static now() {
      return now
    }
  }
  const h = harness(
    {
      registrationStartAuto: async () => {
        times.push(now)
        return { success: true, result: { status: 'failed', email: '', error: 'fixture' } }
      }
    },
    {
      Date: Clock,
      setTimeout: (callback, delay) => {
        now += delay
        queueMicrotask(callback)
        return 1
      },
      clearTimeout: noop
    }
  )
  await h.startRegistrationBatch(options({ batchRetries: 1, batchInterval: 300 }), t)
  assert.equal(times.length, 2)
  assert.ok(times[1] - times[0] >= 3000)
  assert.ok(times[1] - times[0] < 300000)
})

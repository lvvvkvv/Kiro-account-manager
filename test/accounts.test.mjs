/* eslint @typescript-eslint/explicit-function-return-type: "off" -- JavaScript test helpers. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
async function compile(entry) {
  const { outputFiles } = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['zustand'],
    write: false
  })
  return outputFiles[0].text
}
const storeCode = await compile('src/renderer/src/store/accounts.ts')
const accountCode = await compile('src/renderer/src/lib/account.ts')

function account(id, overrides = {}) {
  return {
    id,
    email: `${id}@example.test`,
    idp: 'Google',
    userId: `user-${id}`,
    password: 'fixture-password',
    machineId: 'a'.repeat(64),
    credentials: {
      accessToken: 'fixture-access',
      refreshToken: 'fixture-refresh',
      csrfToken: 'fixture-csrf',
      clientId: 'fixture-client',
      clientSecret: 'fixture-secret',
      provider: 'Google',
      expiresAt: 1_900_000_000_000
    },
    subscription: { type: 'Free' },
    usage: { current: 0, limit: 25, percentUsed: 0, lastUpdated: 0 },
    tags: [],
    status: 'active',
    createdAt: 0,
    lastUsedAt: 0,
    isActive: false,
    ...overrides
  }
}

function harness(apiOverrides = {}) {
  const saves = []
  const bindings = []
  const timeouts = new Map()
  const intervals = new Map()
  let timerId = 0
  const api = {
    saveAccounts: async (data) => {
      saves.push(JSON.parse(JSON.stringify(data)))
    },
    accountSetProxyBindings: async (updates) => {
      for (const { id, proxyUrl } of updates) bindings.push([id, proxyUrl])
      return { success: true }
    },
    getAppVersion: async () => 'test',
    getLocalActiveAccount: async () => ({ success: false }),
    ...apiOverrides
  }
  const module = { exports: {} }
  new Function(
    'require',
    'module',
    'exports',
    'window',
    'localStorage',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    storeCode
  )(
    require,
    module,
    module.exports,
    { api },
    {
      getItem: () => null,
      setItem() {
        return undefined
      }
    },
    (fn, delay) => {
      const id = ++timerId
      timeouts.set(id, { fn, delay })
      return id
    },
    (id) => timeouts.delete(id),
    (fn, delay) => {
      const id = ++timerId
      intervals.set(id, { fn, delay })
      return id
    },
    (id) => intervals.delete(id)
  )
  module.exports.useAccountsStore.setState({ storageLoaded: true })
  return { store: module.exports.useAccountsStore, saves, bindings, timeouts, intervals }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('bulk unbind submits once, preserves other bindings and synchronizes changed accounts only', async () => {
  const { store, bindings } = harness()
  store.setState({ accountProxyBindings: { a: 'p', b: 'p', c: 'other' } })
  let changes = 0
  store.subscribe(() => {
    changes++
  })
  store.getState().unbindAccountsFromProxy(['a', 'b', 'a', 'missing'])
  assert.deepEqual(store.getState().accountProxyBindings, { c: 'other' })
  assert.equal(changes, 1)
  await tick()
  assert.deepEqual(bindings, [
    ['a', undefined],
    ['b', undefined]
  ])
  store.getState().unbindAccountFromProxy('missing')
  assert.equal(changes, 1)
  store.getState().unbindAccountFromProxy('c')
  assert.deepEqual(store.getState().accountProxyBindings, {})
  assert.equal(changes, 2)
})

test('JSON import deduplicates by userId or email/provider, including duplicates within the file', () => {
  const { store } = harness()
  const existing = account('existing')
  store.setState({ accounts: new Map([[existing.id, existing]]), activeAccountId: existing.id })
  const github = account('github', {
    email: existing.email,
    credentials: { ...existing.credentials, provider: 'Github' }
  })
  let changes = 0
  store.subscribe(() => {
    changes++
  })
  const result = store.getState().importFromExportData({
    version: 'test',
    exportedAt: 0,
    accounts: [
      account('same-user', { userId: existing.userId }),
      account('same-identity', { email: existing.email }),
      github,
      { ...github, id: 'duplicate-github', userId: 'different-user' },
      account('duplicate-new-user', { userId: github.userId }),
      account('new', { isActive: true })
    ],
    groups: [{ id: 'group', name: 'Group', order: 0, createdAt: 0 }],
    tags: [{ id: 'tag', name: 'Tag', color: '#fff' }]
  })
  assert.equal(result.success, 2)
  assert.equal(result.failed, 0)
  assert.match(result.errors[0].error, /4/)
  assert.deepEqual([...store.getState().accounts.keys()], ['existing', 'github', 'new'])
  assert.equal(store.getState().accounts.get('new').isActive, false)
  assert.equal(store.getState().activeAccountId, existing.id)
  assert.equal(store.getState().groups.get('group').name, 'Group')
  assert.equal(store.getState().tags.get('tag').name, 'Tag')
  assert.equal(changes, 1)
})

test('legacy accounts without a provider retain their existing identity semantics', () => {
  const { store } = harness()
  const legacy = account('legacy')
  delete legacy.credentials.provider
  store.setState({ accounts: new Map([[legacy.id, legacy]]) })
  const result = store.getState().importFromExportData({
    accounts: [
      { ...legacy, id: 'duplicate', userId: undefined },
      account('google', { email: legacy.email })
    ],
    groups: [],
    tags: []
  })
  assert.equal(result.success, 1)
  assert.equal(store.getState().accounts.size, 2)
})

test('bulk JSON import scans existing accounts a bounded number of times', () => {
  const { store } = harness()
  let visits = 0
  class CountedAccounts extends Map {
    *values() {
      for (const value of super.values()) {
        visits++
        yield value
      }
    }
  }
  const existing = new CountedAccounts(
    Array.from({ length: 500 }, (_, i) => {
      const value = account(`existing-${i}`)
      return [value.id, value]
    })
  )
  store.setState({ accounts: existing })
  const result = store.getState().importFromExportData({
    accounts: Array.from({ length: 500 }, (_, i) => account(`imported-${i}`)),
    groups: [],
    tags: []
  })
  assert.equal(result.success, 500)
  assert.ok(visits <= existing.size * 2, `Repeated full scans: ${visits} account visits`)
})

test('filtering, latest-used sorting, selection and statistics remain consistent', () => {
  const { store } = harness()
  const first = account('a', { groupId: 'g', tags: ['tag'], lastUsedAt: 10 })
  const second = account('b', { groupId: 'g', lastUsedAt: 20, lastError: 'TEMPORARILY_SUSPENDED' })
  const third = account('c', { lastUsedAt: 30 })
  store.setState({ accounts: new Map([first, second, third].map((a) => [a.id, a])) })
  assert.deepEqual(
    store
      .getState()
      .getFilteredAccounts()
      .map((a) => a.id),
    ['c', 'b', 'a']
  )
  const cached = store.getState().getFilteredAccounts()
  store.getState().toggleSelection('a')
  assert.equal(store.getState().getFilteredAccounts(), cached)
  store.getState().setActiveGroupTab('g')
  assert.deepEqual(
    store
      .getState()
      .getFilteredAccounts()
      .map((a) => a.id),
    ['b', 'a']
  )
  store.getState().setFilter({ tagIds: ['tag'], emailDomains: ['example.test'], usageMax: 0.5 })
  store.getState().selectAll()
  assert.deepEqual([...store.getState().selectedIds], ['a'])
  store.getState().clearFilter()
  store.getState().setFilter({ bannedOnly: true })
  assert.deepEqual(
    store
      .getState()
      .getFilteredAccounts()
      .map((a) => a.id),
    ['b']
  )
  assert.equal(store.getState().getStats().bannedCount, 1)
  store.getState().deselectAll()
  assert.equal(store.getState().selectedIds.size, 0)
})

test('overlapping saves wait for the newest snapshot and never write concurrently', async () => {
  const gates = [deferred(), deferred()]
  const saves = []
  const { store, timeouts } = harness({
    saveAccounts: (data) => {
      saves.push(JSON.parse(JSON.stringify(data)))
      return gates[saves.length - 1].promise
    }
  })
  const original = account('a')
  store.setState({ accounts: new Map([['a', original]]) })
  const first = store.getState().flushSaveImmediately()
  await tick()
  store.getState().updateAccount('a', { nickname: 'latest' })
  let finished = false
  const second = store
    .getState()
    .saveToStorage()
    .then(() => {
      finished = true
    })
  const concurrentFlush = store.getState().flushSaveImmediately()
  assert.equal(saves.length, 1)
  assert.equal(timeouts.size, 0)
  gates[0].resolve()
  await tick()
  assert.equal(saves.length, 2)
  assert.equal(finished, false)
  assert.equal(saves[1].accounts.a.nickname, 'latest')
  gates[1].resolve()
  await Promise.all([first, second, concurrentFlush])
  assert.equal(finished, true)
  assert.equal(store.getState().isSyncing, false)
  await store.getState().flushSaveImmediately()
  assert.equal(saves.length, 2)
})

test('failed writes stay dirty and an explicit flush can retry', async () => {
  let attempts = 0
  const { store } = harness({
    saveAccounts: async () => {
      if (++attempts === 1) throw Error('fixture disk error')
    }
  })
  await assert.rejects(store.getState().flushSaveImmediately(), /fixture disk error/)
  assert.equal(store.getState().isSyncing, false)
  await store.getState().flushSaveImmediately()
  assert.equal(attempts, 2)
})

test('mutations during a write keep their debounce window instead of causing continuous writes', async () => {
  const gate = deferred()
  let writes = 0
  const { store, timeouts } = harness({
    saveAccounts: async () => {
      if (++writes === 1) await gate.promise
    }
  })
  const first = store.getState().flushSaveImmediately()
  await tick()
  store.setState({ language: 'en' })
  let finished = false
  const second = store
    .getState()
    .saveToStorage()
    .then(() => {
      finished = true
    })
  gate.resolve()
  await first
  await tick()
  assert.equal(writes, 1)
  assert.equal(finished, false)
  const debounce = [...timeouts.values()].find((timer) => timer.delay === 500)
  debounce.fn()
  await second
  assert.equal(writes, 2)
})

test('a debounce flush that fires during an older write still persists its own newer snapshot', async () => {
  const gate = deferred()
  const snapshots = []
  const { store, timeouts } = harness({
    saveAccounts: async (data) => {
      snapshots.push(data.language)
      if (snapshots.length === 1) await gate.promise
    }
  })
  const first = store.getState().flushSaveImmediately()
  await tick()
  store.setState({ language: 'en' })
  const second = store.getState().saveToStorage()
  const debounce = [...timeouts.values()].find((timer) => timer.delay === 500)
  debounce.fn()
  await tick()
  assert.deepEqual(snapshots, ['zh'])
  gate.resolve()
  await Promise.all([first, second])
  assert.deepEqual(snapshots, ['zh', 'en'])
  assert.equal(timeouts.size, 0)
})

test('debounce coalesces requests and immediate flush clears both timers', async () => {
  const { store, saves, timeouts } = harness()
  const first = store.getState().saveToStorage()
  store.setState({ language: 'en' })
  const second = store.getState().saveToStorage()
  assert.deepEqual(
    [...timeouts.values()].map((t) => t.delay).sort((a, b) => a - b),
    [500, 5000]
  )
  await store.getState().flushSaveImmediately()
  await Promise.all([first, second])
  assert.equal(timeouts.size, 0)
  assert.equal(saves.length, 1)
  assert.equal(saves[0].language, 'en')
})

test('maximum wait persists the latest state during a continuous debounce window', async () => {
  const { store, saves, timeouts } = harness()
  const first = store.getState().saveToStorage()
  const maximum = [...timeouts.values()].find((timer) => timer.delay === 5000)
  store.setState({ privacyMode: true })
  const second = store.getState().saveToStorage()
  assert.equal(
    [...timeouts.values()].find((timer) => timer.delay === 5000),
    maximum
  )
  maximum.fn()
  await Promise.all([first, second])
  assert.equal(saves.length, 1)
  assert.equal(saves[0].privacyMode, true)
  assert.equal(timeouts.size, 0)
})

test('auto save avoids unchanged serialization and still saves background-only mutations', async () => {
  const { store, saves, timeouts, intervals } = harness()
  let serializations = 0
  const original = account('a')
  original.toJSON = function () {
    serializations++
    return { ...this, toJSON: undefined }
  }
  store.setState({ accounts: new Map([['a', original]]) })
  await store.getState().flushSaveImmediately()
  serializations = 0
  store.getState().startAutoSave()
  const timer = [...intervals.values()][0]
  await timer.fn()
  assert.equal(serializations, 0)
  assert.equal(saves.length, 1)
  store.setState({ accounts: new Map([['a', { ...original, nickname: 'background' }]]) })
  const saving = timer.fn()
  const debounce = [...timeouts.values()].find((t) => t.delay === 500)
  debounce.fn()
  await saving
  assert.equal(saves.length, 2)
  assert.equal(saves[1].accounts.a.nickname, 'background')
  await timer.fn()
  assert.equal(saves.length, 2)
  store.getState().stopAutoSave()
  assert.equal(intervals.size, 0)
})

test('loading existing data establishes a baseline while missing machine IDs are persisted', async () => {
  for (const missingMachineId of [false, true]) {
    const original = account('a', { machineId: missingMachineId ? undefined : 'a'.repeat(64) })
    const { store, saves, intervals } = harness({
      loadAccounts: async () => ({
        accounts: { a: original },
        groups: {},
        tags: {},
        activeAccountId: null
      })
    })
    store.setState({
      applyTheme() {
        return undefined
      }
    })
    await store.getState().loadFromStorage()
    if (missingMachineId) {
      await store.getState().flushSaveImmediately()
      assert.equal(saves[0].accounts.a.machineId.length, 64)
    } else {
      await [...intervals.values()][0].fn()
      assert.equal(saves.length, 0)
    }
  }
})

test('credential-free export strips secrets without mutating a full export', () => {
  const module = { exports: {} }
  new Function('require', 'module', 'exports', accountCode)(require, module, module.exports)
  const { withoutAccountCredentials, isBannedAccountError } = module.exports
  const { store } = harness()
  const original = account('a')
  store.setState({ accounts: new Map([['a', original]]) })
  const full = store.getState().exportAccounts(['a'])
  const sanitized = full.accounts.map(withoutAccountCredentials)
  const json = JSON.stringify(sanitized)
  for (const secret of [
    'fixture-password',
    'fixture-access',
    'fixture-refresh',
    'fixture-csrf',
    'fixture-secret'
  ]) {
    assert.equal(json.includes(secret), false)
  }
  assert.equal(sanitized[0].email, original.email)
  assert.equal(sanitized[0].credentials.provider, original.credentials.provider)
  assert.equal(full.accounts[0].credentials.clientSecret, original.credentials.clientSecret)
  assert.equal(full.accounts[0].password, original.password)
  assert.equal('isActive' in full.accounts[0], false)
  for (const message of [
    'AccountSuspendedException',
    'User ID is temporarily suspended',
    'HTTP 423',
    '账户已封禁'
  ]) {
    assert.equal(isBannedAccountError(message), true)
  }
  for (const message of [undefined, 'fetch failed', 'UnauthorizedException', 'HTTP 1423']) {
    assert.equal(isBannedAccountError(message), false)
  }
})

test('validated additions deduplicate a batch and commit one account Map', () => {
  const { store } = harness()
  const original = account('old')
  store.setState({ accounts: new Map([[original.id, original]]) })
  let updates = 0
  store.subscribe(() => {
    updates++
  })
  const input = account('new')
  const otherProvider = {
    ...input,
    userId: 'different-user',
    credentials: { ...input.credentials, provider: 'Github' }
  }
  const result = store.getState().addAccounts([original, input, input, otherProvider])
  assert.equal(result.success, 2)
  assert.equal(store.getState().accounts.size, 3)
  assert.equal(updates, 1)
})

test('manual refresh uses the background batch API without per-account Store updates', async () => {
  let payload, syncInfo
  const { store } = harness({
    backgroundBatchRefresh: async (items, _limit, sync) => {
      payload = items
      syncInfo = sync
      return { success: true, completed: items.length, successCount: items.length, failedCount: 0 }
    }
  })
  store.setState({
    accounts: new Map(
      Array.from({ length: 1000 }, (_, i) => {
        const value = account(String(i))
        return [value.id, value]
      })
    )
  })
  let updates = 0
  store.subscribe(() => {
    updates++
  })
  await store.getState().checkAndRefreshExpiringTokens()
  assert.equal(payload.length, 1000)
  assert.equal(syncInfo, true)
  assert.equal(updates, 0)
})

test('late background events cannot replace newer credentials or mark them failed', () => {
  const { store } = harness()
  const current = account('a')
  store.setState({ accounts: new Map([['a', current]]) })
  store.getState().applyBackgroundRefreshResults([
    {
      id: 'a',
      success: true,
      expectedRefreshToken: 'obsolete-token',
      data: { accessToken: 'obsolete-access', refreshToken: 'obsolete-token' }
    }
  ])
  store
    .getState()
    .applyBackgroundCheckResults([
      { id: 'a', success: false, expectedRefreshToken: 'obsolete-token', error: 'obsolete failure' }
    ])
  assert.equal(store.getState().accounts.get('a').credentials, current.credentials)
  assert.equal(store.getState().accounts.get('a').status, 'active')
})

test('failed automatic switching retains the actual active account', async () => {
  const { store } = harness({
    switchAccount: async () => ({ success: false, error: 'fixture failure' })
  })
  const first = account('a', { isActive: true, usage: { current: 25, limit: 25 } })
  const second = account('b')
  store.setState({
    accounts: new Map([
      ['a', first],
      ['b', second]
    ]),
    activeAccountId: 'a',
    checkAccountStatus: async () => undefined
  })
  await store.getState().checkAndAutoSwitch()
  assert.equal(store.getState().activeAccountId, 'a')
  assert.equal(store.getState().accounts.get('b').isActive, false)
})

test('automatic switching rechecks candidates after the current status check', async () => {
  let switches = 0
  const { store } = harness({
    switchAccount: async () => {
      switches++
      return { success: true }
    }
  })
  store.setState({
    accounts: new Map([
      ['a', account('a', { usage: { current: 25, limit: 25 } })],
      ['b', account('b')]
    ]),
    activeAccountId: 'a',
    checkAccountStatus: async () => {
      store.setState({
        accounts: new Map([
          ['a', account('a', { usage: { current: 25, limit: 25 } })],
          ['b', account('b', { lastError: 'AccountSuspendedException' })]
        ])
      })
    }
  })
  await store.getState().checkAndAutoSwitch()
  assert.equal(switches, 0)
  assert.equal(store.getState().activeAccountId, 'a')
})

test('IDE and CLI share the rotated credentials and update the store before activation', async () => {
  let cli
  const refreshed = { accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 1800 }
  const { store } = harness({
    switchAccount: async () => ({ success: true, refreshedCredentials: refreshed }),
    switchAccountCli: async (input) => {
      cli = input
      return { success: true }
    }
  })
  store.setState({ accounts: new Map([['a', account('a')]]), switchTarget: 'both' })
  const result = await store.getState().switchAccount('a')
  assert.equal(result.success, true)
  assert.equal(cli.refreshToken, refreshed.refreshToken)
  assert.equal(cli.skipRefresh, true)
  assert.equal(store.getState().accounts.get('a').credentials.refreshToken, refreshed.refreshToken)
  assert.equal(store.getState().activeAccountId, 'a')
})

test('a failed CLI destination retains refreshed credentials while leaving the active account unchanged', async () => {
  const refreshed = { accessToken: 'new-cli-access', refreshToken: 'new-cli-refresh', expiresIn: 1800 }
  const { store } = harness({
    switchAccountCli: async () => ({ success: false, error: 'fixture database error', refreshedCredentials: refreshed })
  })
  store.setState({ accounts: new Map([['a', account('a')]]), switchTarget: 'cli', activeAccountId: null })
  const result = await store.getState().switchAccount('a')
  assert.equal(result.success, false)
  assert.equal(store.getState().accounts.get('a').credentials.refreshToken, refreshed.refreshToken)
  assert.equal(store.getState().activeAccountId, null)
})

test('refresh preferences survive save and restore', async () => {
  const { store, saves } = harness()
  store.getState().setAutoRefreshSyncInfo(false)
  store.getState().setBatchImportConcurrency(7)
  store.getState().setLoginPrivateMode(true)
  await store.getState().flushSaveImmediately()
  const saved = saves.at(-1)
  const restored = harness({ loadAccounts: async () => saved }).store
  restored.setState({ applyTheme: () => undefined })
  await restored.getState().loadFromStorage()
  assert.equal(restored.getState().autoRefreshSyncInfo, false)
  assert.equal(restored.getState().batchImportConcurrency, 7)
  assert.equal(restored.getState().loginPrivateMode, true)
})

test('fresh-install sessions start auto save and persist background results', async () => {
  const { store, intervals, saves } = harness({ loadAccounts: async () => null })
  await store.getState().loadFromStorage()
  assert.equal(intervals.size, 1)
  store.setState({ accounts: new Map([['a', account('a')]]) })
  store.getState().applyBackgroundRefreshResults([
    {
      id: 'a',
      success: true,
      data: {
        accessToken: 'background-access',
        refreshToken: 'background-refresh',
        expiresIn: 1800
      }
    }
  ])
  await store.getState().flushSaveImmediately()
  assert.equal(saves.at(-1).accounts.a.credentials.refreshToken, 'background-refresh')
})

test('missing-refresh-token errors are applied to legacy accounts without a token field', () => {
  const { store } = harness()
  const value = account('a')
  delete value.credentials.refreshToken
  store.setState({ accounts: new Map([['a', value]]) })
  store
    .getState()
    .applyBackgroundRefreshResults([
      { id: 'a', success: false, expectedRefreshToken: '', error: '缺少 Refresh Token' }
    ])
  assert.equal(store.getState().accounts.get('a').status, 'error')
  assert.equal(store.getState().accounts.get('a').lastError, '缺少 Refresh Token')
})

function proxy(id, patch = {}) {
  return { id, url: `http://${id}.example.test:8080`, protocol: 'http', host: `${id}.example.test`, port: 8080, status: 'alive', enabled: true, usedCount: 0, failCount: 0, createdAt: 0, ...patch }
}

test('proxy validation batches 5000 results into two store commits without unchanged binding IPC', async () => {
  const batches = []
  const { store } = harness({ proxyPoolValidate: async () => ({ success: true, latencyMs: 10 }), accountSetProxyBindings: async (updates) => batches.push(updates) })
  const entries = Array.from({ length: 5000 }, (_, i) => proxy(`p${i}`))
  store.setState({ proxyPool: new Map(entries.map((p) => [p.id, p])), accountProxyBindings: Object.fromEntries(entries.map((p) => [`a${p.id}`, p.id])), saveToStorage: async () => {} })
  let updates = 0
  store.subscribe(() => updates++)
  await store.getState().validateProxiesBatch(entries.map((p) => p.id), 10)
  await tick()
  assert.equal(updates, 2)
  assert.equal(batches.length, 0)
  assert.equal(store.getState().proxyPool.get('p4999').latencyMs, 10)
})

test('manual and periodic proxy validations share concurrency, deduplicate requests and count failures once', async () => {
  const hold = deferred()
  let active = 0, peak = 0, calls = 0
  const { store } = harness({ proxyPoolValidate: async () => { calls++; active++; peak = Math.max(peak, active); await hold.promise; active--; return { success: false, error: 'offline' } } })
  const entries = ['p1', 'p2', 'p3'].map((id) => proxy(id))
  store.setState({ proxyPool: new Map(entries.map((p) => [p.id, p])), saveToStorage: async () => {} })
  const batch = store.getState().validateProxiesBatch(entries.map((p) => p.id), 2)
  const duplicate = store.getState().validateProxy('p1')
  const second = store.getState().validateProxiesBatch(['p1', 'p2'], 2)
  await tick()
  assert.equal(peak, 2)
  hold.resolve()
  await Promise.all([batch, duplicate, second])
  assert.equal(calls, 3)
  assert.equal(store.getState().proxyPool.get('p1').failCount, 1)
})

test('validation of an old URL or configuration cannot overwrite the edited proxy', async () => {
  for (const editUrl of [true, false]) {
    const hold = deferred()
    const { store } = harness({ proxyPoolValidate: () => hold.promise })
    store.setState({ proxyPool: new Map([['p', proxy('p')]]), saveToStorage: async () => {} })
    const running = store.getState().validateProxy('p')
    if (editUrl) store.getState().updateProxy('p', { url: 'http://new.example.test:8080' })
    else store.getState().setProxyPoolConfig({ upstreamProxy: 'http://new-upstream:8080' })
    hold.resolve({ success: false, error: 'old result' })
    await running
    const current = store.getState().proxyPool.get('p')
    assert.equal(current.status, editUrl ? 'untested' : 'alive')
    assert.equal(current.failCount, 0)
    assert.equal(current.lastError, undefined)
  }
})

test('the last enabled proxy remains selected and bound after validation failures', async () => {
  const batches = []
  const { store } = harness({ proxyPoolValidate: async () => ({ success: false, error: 'refused' }), accountSetProxyBindings: async (updates) => batches.push(updates) })
  store.setState({ proxyPool: new Map([['p', proxy('p')]]), accountProxyBindings: { a: 'p' }, proxyPoolConfig: { ...store.getState().proxyPoolConfig, enabled: true, failureThreshold: 1 }, saveToStorage: async () => {} })
  await store.getState().validateProxy('p')
  assert.equal(store.getState().proxyPool.get('p').enabled, true)
  assert.equal(store.getState().pickNextProxy().id, 'p')
  assert.equal(store.getState().getAccountProxyUrl('a'), proxy('p').url)
  // A failed enabled proxy stays the fallback until another healthy route exists.
  store.getState().addProxy('http://healthy.example.test:8080')
  assert.equal(store.getState().getAccountProxyUrl('a'), undefined)
  await tick()
  assert.equal(batches.at(-1)[0].proxyUrl, undefined)
})

test('bulk binding IPC merges updates, distribution respects existing capacity and subset bindings', async () => {
  const batches = []
  const { store } = harness({ accountSetProxyBindings: async (updates) => batches.push(updates) })
  const entries = ['p', 'q'].map((id) => proxy(id))
  store.setState({ accounts: new Map(['a', 'b', 'c', 'd', 'other'].map((id) => [id, account(id)])), proxyPool: new Map(entries.map((p) => [p.id, p])), accountProxyBindings: { a: 'p', b: 'p', other: 'unavailable' }, saveToStorage: async () => {} })
  const result = store.getState().autoDistributeAccountsToProxies({ accountsPerProxy: 2, onlyUnbound: true, accountIds: ['c', 'd'] })
  assert.equal(result.distributed, 2)
  assert.deepEqual(store.getState().accountProxyBindings, { a: 'p', b: 'p', other: 'unavailable', c: 'q', d: 'q' })
  await tick()
  assert.equal(batches.length, 1)
  assert.equal(batches[0].length, 2)
})

test('proxy URL normalization encodes credentials exactly once', () => {
  const { store } = harness()
  const id = store.getState().addProxy('http://user%40name:p%40ss@localhost:8080')
  assert.equal(store.getState().proxyPool.get(id).url, 'http://user%40name:p%40ss@localhost:8080')
  assert.equal(store.getState().proxyPool.get(id).username, 'user@name')
})

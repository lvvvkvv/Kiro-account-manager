/* eslint @typescript-eslint/explicit-function-return-type: "off" -- Isolated application and browser lifecycle fixtures. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { build } from 'esbuild'
const require = createRequire(import.meta.url)
const noop = () => undefined
const quiet = { log: noop, warn: noop, error: noop }
const bundle = (
  await build({
    stdin: {
      contents: `export {useAccountsStore} from './src/renderer/src/store/accounts';export {parsePortableConfig,importPortableConfig,buildPortableConfig,containsConfigSecrets} from './src/renderer/src/lib/configSync';export {useWebhookStore} from './src/renderer/src/store/webhooks';export {matchesAccountRisk,formatAccountDate} from './src/renderer/src/lib/account';export {BannedAccountNotifications} from './src/renderer/src/lib/bannedNotifications';`,
      resolveDir: process.cwd()
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    write: false
  })
).outputFiles[0].text
function account(id, patch = {}) {
  return {
    id,
    email: `${id}@example.test`,
    machineId: 'a'.repeat(64),
    idp: 'Google',
    tags: [],
    credentials: { accessToken: 'fixture', csrfToken: '', refreshToken: 'fixture', expiresAt: 0 },
    subscription: { type: 'Free' },
    usage: { current: 23, limit: 25, percentUsed: 0.92, lastUpdated: 0 },
    status: 'active',
    createdAt: 0,
    lastUsedAt: 0,
    isActive: false,
    ...patch
  }
}
function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const tick = () => new Promise((done) => setImmediate(done))
function fixture(options = {}) {
  const data = new Map(Object.entries(options.storage || {})),
    writes = [],
    notices = [],
    saves = [],
    bindings = [],
    cancelled = []
  let now = 0,
    copied = 0
  class Clock extends Date {
    static now() {
      return now
    }
  }
  class CountedMap extends Map {
    constructor(entries) {
      super(entries)
      if (entries instanceof Map) copied += entries.size
    }
  }
  class Notice {
    static permission = 'granted'
    static requestPermission = async () => 'granted'
    constructor(title, body) {
      notices.push({ title, ...body })
    }
  }
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      if (options.failStorage?.(key)) throw Error('fixture quota exceeded')
      data.set(key, value)
      writes.push([key, value])
    },
    removeItem: (key) => data.delete(key)
  }
  const api = {
    saveAccounts: async (value) => {
      if (options.failSave) throw Error('fixture disk full')
      saves.push(value)
    },
    accountSetProxyBindings: async (updates) => {
      bindings.push(...updates)
      return { success: true }
    },
    webhookCancel: async (id) => {
      cancelled.push(id)
    },
    ...options.api
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
    'console',
    'Notification',
    'Date',
    'Map',
    bundle
  )(
    require,
    module,
    module.exports,
    { api },
    storage,
    () => 1,
    noop,
    () => 1,
    noop,
    quiet,
    Notice,
    Clock,
    CountedMap
  )
  const store = module.exports.useAccountsStore
  store.setState({ storageLoaded: true })
  return {
    ...module.exports,
    store,
    data,
    writes,
    notices,
    saves,
    bindings,
    cancelled,
    Notice,
    now: (value) => {
      now = value
    },
    resetCopies: () => {
      copied = 0
    },
    copies: () => copied
  }
}
function source(file) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
}
const main = source('src/main/index.ts'),
  settings = source('src/renderer/src/components/pages/SettingsPage.tsx')
function find(tree, predicate) {
  let result
  function visit(n) {
    if (predicate(n)) result = n
    n.forEachChild(visit)
  }
  visit(tree)
  assert.ok(result)
  return result
}
function entry(tree, name, bindings) {
  const node = find(
    tree,
    (n) =>
      (ts.isFunctionDeclaration(n) && n.name?.text === name) ||
      (ts.isVariableDeclaration(n) && n.name.getText(tree) === name) ||
      (ts.isCallExpression(n) &&
        n.expression.getText(tree) === 'ipcMain.handle' &&
        n.arguments[0]?.text === name)
  )
  const expression = ts.isVariableDeclaration(node)
    ? node.initializer.getText(tree)
    : ts.isCallExpression(node)
      ? node.arguments[1].getText(tree)
      : node.getText(tree)
  const code = ts
    .transpileModule('const run=(' + expression + ');', {
      compilerOptions: { target: ts.ScriptTarget.ES2022 }
    })
    .outputText.replaceAll('import(', '__import(')
  return new Function('bindings', 'with(bindings){' + code + ';return run}')(bindings)
}

test('clearing 5000 accounts publishes one account snapshot and saves once while preserving groups and tags', async () => {
  const f = fixture(),
    n = 5000
  f.store.setState({
    accounts: new Map(Array.from({ length: n }, (_, i) => ['a' + i, account('a' + i)])),
    groups: new Map([['g', { id: 'g' }]]),
    tags: new Map([['t', { id: 't' }]]),
    activeAccountId: 'a0',
    selectedIds: new Set(['a0']),
    accountMachineIds: { a0: '11111111-1111-4111-8111-111111111111' },
    accountProxyBindings: { a0: 'p' }
  })
  let changes = 0
  f.store.subscribe((s, p) => {
    if (s.accounts !== p.accounts) changes++
  })
  f.resetCopies()
  const messages = []
  await entry(settings, 'handleClearData', {
    clearing: { current: false },
    setIsClearing: noop,
    isEn: true,
    confirm: () => true,
    useAccountsStore: f.store,
    alert: (value) => messages.push(value)
  })()
  assert.equal(changes, 1)
  assert.equal(f.copies(), n)
  assert.equal(f.saves.length, 1)
  assert.equal(f.saves[0].groups.g.id, 'g')
  assert.equal(f.store.getState().tags.size, 1)
  assert.equal(f.store.getState().activeAccountId, null)
  assert.equal(f.store.getState().selectedIds.size, 0)
  assert.deepEqual(f.store.getState().accountMachineIds, {})
  assert.deepEqual(f.store.getState().accountProxyBindings, {})
  assert.deepEqual(messages, ['All accounts cleared'])
})
test('clearing does not report success before durable save or after a failed save', async () => {
  const wait = deferred(),
    f = fixture({ api: { saveAccounts: () => wait.promise } })
  f.store.setState({ accounts: new Map([['a', account('a')]]) })
  const messages = [],
    guard = { current: false }
  const clear = entry(settings, 'handleClearData', {
    clearing: guard,
    setIsClearing: noop,
    isEn: true,
    confirm: () => true,
    useAccountsStore: f.store,
    alert: (v) => messages.push(v)
  })
  const running = clear()
  await tick()
  assert.deepEqual(messages, [])
  assert.equal(guard.current, true)
  await clear()
  wait.resolve()
  await running
  assert.deepEqual(messages, ['All accounts cleared'])
  const bad = fixture({ failSave: true })
  bad.store.setState({ accounts: new Map([['a', account('a')]]) })
  const errors = []
  await entry(settings, 'handleClearData', {
    clearing: { current: false },
    setIsClearing: noop,
    isEn: true,
    confirm: () => true,
    useAccountsStore: bad.store,
    alert: (v) => errors.push(v)
  })()
  assert.match(errors[0], /disk full/)
  assert.equal(errors.length, 1)
})
test('risk filters exactly match homepage business predicates and preserve generic filters', () => {
  const f = fixture(),
    rows = [
      account('ban', {
        status: 'error',
        lastError: 'AccountSuspendedException',
        subscription: { type: 'Free', daysRemaining: 3 }
      }),
      account('network', { status: 'error', lastError: 'network timeout' }),
      account('good', { subscription: { type: 'Free', daysRemaining: 3 } }),
      account('expired', { status: 'expired', subscription: { type: 'Free', daysRemaining: 3 } }),
      account('zero', { usage: { current: 0, limit: 0, percentUsed: 1 } })
    ]
  f.store.setState({ accounts: new Map(rows.map((a) => [a.id, a])), activeGroupTab: 'all' })
  for (const risk of ['banned', 'expiring', 'quota']) {
    f.store.getState().setFilter({ risk })
    assert.deepEqual(
      f.store
        .getState()
        .getFilteredAccounts()
        .map((a) => a.id),
      rows.filter((a) => f.matchesAccountRisk(a, risk)).map((a) => a.id)
    )
  }
  f.store.getState().setFilter({ usageMin: 0.9 })
  assert.equal(f.store.getState().getFilteredAccounts().length, 5)
  assert.equal(f.store.getState().getStats().bannedCount, 1)
})
test('date formatting retains ISO string and legacy timestamp fallbacks', () => {
  const f = fixture()
  assert.equal(f.formatAccountDate('2026-11-28T12:00:00Z'), '2026-11-28')
  assert.equal(f.formatAccountDate(Date.UTC(2026, 10, 28)), '2026-11-28')
  assert.equal(f.formatAccountDate(NaN, 'Unknown'), 'Unknown')
  assert.equal(f.formatAccountDate({}, ''), '')
})
function notifications(f) {
  return new f.BannedAccountNotifications(f.store.getState, 8000)
}
function banned(f, id, patch = {}) {
  const accounts = new Map(f.store.getState().accounts)
  accounts.set(id, account(id, { lastError: 'AccountSuspendedException', ...patch }))
  f.store.setState({ accounts })
  return accounts
}
test('slow loaded baseline never re-notifies old bans and unchanged sets never rewrite storage', () => {
  const f = fixture({ storage: { 'kiro-notified-banned-ids': '["a"]' } })
  f.now(12000)
  const n = notifications(f)
  n.update(banned(f, 'a'))
  assert.equal(f.notices.length, 0)
  assert.equal(f.writes.length, 0)
  for (let i = 0; i < 20; i++) n.update(new Map(f.store.getState().accounts))
  assert.equal(f.writes.length, 0)
  n.update(banned(f, 'b'))
  assert.equal(f.notices.length, 1)
})
test('startup grace is retained and unban/reban can notify again', () => {
  const f = fixture(),
    n = notifications(f)
  n.update(new Map())
  n.update(banned(f, 'a'))
  assert.equal(f.notices.length, 0)
  f.now(10000)
  f.store.setState({ accounts: new Map() })
  n.update(f.store.getState().accounts)
  n.update(banned(f, 'a'))
  assert.equal(f.notices.length, 1)
})
test('pending permission coalesces new bans, drops deleted accounts and applies current privacy', async () => {
  const f = fixture(),
    n = notifications(f),
    permission = deferred()
  let requests = 0
  f.Notice.permission = 'default'
  f.Notice.requestPermission = () => {
    requests++
    return permission.promise
  }
  n.update(new Map())
  f.now(10000)
  n.update(banned(f, 'a'))
  n.update(banned(f, 'b'))
  assert.equal(requests, 1)
  f.store.setState({
    accounts: new Map([['b', f.store.getState().accounts.get('b')]]),
    privacyMode: true,
    language: 'en'
  })
  n.update(f.store.getState().accounts)
  permission.resolve('granted')
  await tick()
  assert.equal(f.notices.length, 1)
  assert.doesNotMatch(f.notices[0].body, /@example.test/)
  assert.equal(f.notices[0].title, 'Account banned')
})
test('permission rejection, disposal and malformed cached notification IDs are harmless', async () => {
  const f = fixture({ storage: { 'kiro-notified-banned-ids': '{}' } }),
    n = notifications(f),
    permission = deferred()
  n.update(new Map())
  f.now(10000)
  f.Notice.permission = 'default'
  f.Notice.requestPermission = () => permission.promise
  n.update(banned(f, 'a'))
  n.dispose()
  permission.resolve('granted')
  await tick()
  assert.equal(f.notices.length, 0)
  const another = notifications(f)
  another.update(new Map())
  f.Notice.requestPermission = async () => {
    throw Error('unavailable')
  }
  another.update(banned(f, 'b'))
  await tick()
  assert.equal(f.notices.length, 0)
})
const legacy = (patch = {}) => ({ version: 1, type: 'kiro-account-manager-config', ...patch })
const proxy = (id = 'p', patch = {}) => ({
  id,
  url: 'http://user:fixture-pass@127.0.0.1:8080',
  protocol: 'http',
  host: '127.0.0.1',
  port: 8080,
  status: 'alive',
  enabled: true,
  usedCount: 3,
  failCount: 1,
  createdAt: 1,
  ...patch
})
test('legacy pool import retains IDs/metadata, replaces pool once and keeps surviving bindings', async () => {
  const f = fixture()
  f.store.setState({
    accounts: new Map([
      ['a', account('a')],
      ['b', account('b')]
    ]),
    proxyPool: new Map([
      ['p', proxy()],
      ['gone', proxy('gone', { url: 'http://127.0.0.1:8090', port: 8090 })]
    ]),
    accountProxyBindings: { a: 'p', b: 'gone' }
  })
  let updates = 0
  f.store.subscribe((s, p) => {
    if (s.proxyPool !== p.proxyPool) updates++
  })
  const result = await f.importPortableConfig(
    legacy({ proxyPool: { p: proxy('p', { label: 'kept', enabled: false, tags: ['fixture'] }) } })
  )
  assert.equal(result.success, true)
  assert.equal(updates, 1)
  assert.equal(f.saves.length, 1)
  assert.equal(f.store.getState().proxyPool.size, 1)
  assert.equal(f.store.getState().proxyPool.get('p').password, 'fixture-pass')
  assert.equal(f.store.getState().proxyPool.get('p').usedCount, 3)
  assert.deepEqual(f.store.getState().accountProxyBindings, { a: 'p' })
  assert.deepEqual(f.bindings.map((x) => x.id).sort(), ['a', 'b'])
})
test('legacy registration/templates/history and live webhook settings remain importable', async () => {
  const f = fixture()
  const hook = {
    id: 'hook',
    createdAt: 1,
    kind: 'custom',
    url: 'https://fixture.test/hook',
    enabled: false,
    events: ['account-banned']
  }
  const result = await f.importPortableConfig(
    legacy({
      localStorage: {
        'kiro-register-config': JSON.stringify({ gptMailPrivatePassword: 'fixture-secret' }),
        'kiro-register-templates': '[]',
        'kiro-register-history': '[{"id":"h","email":"fixture@test"}]',
        'kiro-webhooks': JSON.stringify([hook]),
        accounts_viewMode: 'list',
        accounts_activeGroupTab: 'all',
        'kiro-register-schedule-time': '12:30'
      }
    })
  )
  assert.equal(result.success, true)
  assert.equal(
    JSON.parse(f.data.get('kiro-register-config')).gptMailPrivatePassword,
    'fixture-secret'
  )
  assert.equal(f.useWebhookStore.getState().webhooks.get('hook').enabled, false)
  assert.equal(f.data.get('accounts_viewMode'), 'list')
  assert.equal(f.store.getState().activeGroupTab, 'all')
})
for (const payload of [
  legacy({ version: 999 }),
  legacy({ proxyPool: { p: 'not-a-proxy' } }),
  legacy({ proxyPool: { p: proxy('wrong') } }),
  legacy({ localStorage: { 'kiro-webhooks': 'not json' } }),
  legacy({ localStorage: { 'kiro-register-schedule-time': '99:00' } })
]) {
  test(
    'invalid legacy input leaves existing data and bindings untouched: ' + JSON.stringify(payload),
    async () => {
      const f = fixture()
      f.store.setState({ proxyPool: new Map([['p', proxy()]]), accountProxyBindings: { a: 'p' } })
      const before = f.store.getState()
      const result = await f.importPortableConfig(payload)
      assert.equal(result.success, false)
      assert.equal(f.store.getState().proxyPool, before.proxyPool)
      assert.equal(f.store.getState().accountProxyBindings, before.accountProxyBindings)
      assert.equal(f.writes.length, 0)
    }
  )
}
test('legacy quota failure rolls back preferences before replacing a pool', async () => {
  const f = fixture({
    storage: { accounts_viewMode: 'grid' },
    failStorage: (key) => key === 'accounts_activeGroupTab'
  })
  const old = new Map([['old', proxy('old')]])
  f.store.setState({ proxyPool: old })
  const result = await f.importPortableConfig(
    legacy({
      proxyPool: { p: proxy() },
      localStorage: { accounts_viewMode: 'list', accounts_activeGroupTab: 'all' }
    })
  )
  assert.equal(result.success, false)
  assert.equal(f.data.get('accounts_viewMode'), 'grid')
  assert.equal(f.store.getState().proxyPool, old)
})
test('validated legacy secrets still require encryption through the shared export flow', async () => {
  const f = fixture()
  await f.importPortableConfig(
    legacy({
      proxyPool: { p: proxy() },
      localStorage: { 'kiro-register-config': '{"gptMailPrivatePassword":"fixture-secret"}' }
    })
  )
  const opts = {
    proxyPool: true,
    webhooks: true,
    registerConfig: true,
    registerTemplates: true,
    registerSettings: true,
    appSettings: true,
    includeProxyCredentials: false
  }
  const config = f.buildPortableConfig(opts)
  assert.equal(f.containsConfigSecrets(config), true)
  assert.doesNotMatch(JSON.stringify(config.proxyPool), /fixture-pass/)
})
function apiFixture(fail = false) {
  const env = {
    store: {
      set: (key, value) => {
        if (fail) throw Error('fixture disk full')
        env.disk[key] = value
      }
    },
    disk: {},
    initStore: async () => undefined,
    currentUsageApiType: 'rest',
    routing: false,
    setUsageApiType: (v) => {
      env.currentUsageApiType = v
    },
    setUseKProxyForApi: (v) => {
      env.routing = v
    },
    getUseKProxyForApi: () => env.routing
  }
  return env
}
test('API preferences persist before runtime publication and leave old values on disk failure', async () => {
  const f = apiFixture(true)
  assert.equal((await entry(main, 'set-usage-api-type', f)({}, 'cbor')).success, false)
  assert.equal(f.currentUsageApiType, 'rest')
  assert.equal((await entry(main, 'set-use-kproxy-for-api', f)({}, true)).success, false)
  assert.equal(f.routing, false)
  const good = apiFixture()
  assert.equal((await entry(main, 'set-usage-api-type', good)({}, 'cbor')).success, true)
  assert.equal(good.disk.usageApiType, 'cbor')
  assert.equal(good.currentUsageApiType, 'cbor')
  assert.equal((await entry(main, 'set-use-kproxy-for-api', good)({}, true)).success, true)
  assert.equal(good.disk.useKProxyForApi, true)
})
test('invalid API settings never reach storage or alter runtime', async () => {
  const env = apiFixture()
  assert.equal((await entry(main, 'set-usage-api-type', env)({}, 'unknown')).success, false)
  assert.equal((await entry(main, 'set-use-kproxy-for-api', env)({}, 'false')).success, false)
  assert.deepEqual(env.disk, {})
})
test('initial store loading restores API preferences independently of tray/proxy initialization', async () => {
  class Store {
    path = '/fixture/accounts'
    store = { usageApiType: 'cbor', useKProxyForApi: true }
    get(key) {
      return { usageApiType: 'cbor', useKProxyForApi: true }[key]
    }
    set() {
      return undefined
    }
  }
  const env = apiFixture()
  Object.assign(env, {
    store: null,
    lastSavedData: null,
    accountDataDirty: false,
    accountBackup: undefined,
    AccountBackupScheduler: class {
      constructor() {
        return undefined
      }
    },
    updateAccountStorageStatus: noop,
    refreshConcurrency: 1,
    proactiveRenewalEnabled: false,
    tokenRefreshConcurrency: (x) => x ?? 1,
    migrateAccountDataIfNeeded: noop,
    console: quiet,
    __import: async (name) =>
      name === 'electron-store'
        ? { default: Store }
        : name === 'path'
          ? { dirname: () => '/fixture' }
          : { initializeAccountBackup: async () => null }
  })
  await entry(main, 'initializeStore', env)()
  assert.equal(env.currentUsageApiType, 'cbor')
  assert.equal(env.routing, true)
  assert.ok(env.store)
})

/* eslint @typescript-eslint/explicit-function-return-type: "off" -- Isolated persistence and lifecycle fixtures. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import Conf from 'conf'
import ts from 'typescript'
import { build } from 'esbuild'
const require = createRequire(import.meta.url),
  noop = () => undefined
const quiet = { log: noop, warn: noop, error: noop }
const tick = () => new Promise((done) => setImmediate(done))
function gate() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
async function compile(contents) {
  return (
    await build({
      stdin: { contents, resolveDir: process.cwd() },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      write: false
    })
  ).outputFiles[0].text
}
const rendererCode = await compile(
  `export {useAccountsStore} from './src/renderer/src/store/accounts';`
)
const backendCode = await compile(
  `export {PendingAccountCredentials} from './src/main/accountCredentials';export {AccountBackupScheduler} from './src/main/accountBackup';export {validateAccountData} from './src/shared/accountData';export * from './src/main/secureBackup';`
)
function load(code, bindings = {}) {
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'console', ...Object.keys(bindings), code)(
    require,
    module,
    module.exports,
    quiet,
    ...Object.values(bindings)
  )
  return module.exports
}
const backend = load(backendCode)
function timers() {
  const jobs = new Map()
  let id = 0
  return {
    jobs,
    setTimeout: (fn, delay) => {
      jobs.set(++id, { fn, delay })
      return id
    },
    clearTimeout: (key) => jobs.delete(key),
    fire: () => {
      const [id, job] = jobs.entries().next().value
      jobs.delete(id)
      return job.fn()
    }
  }
}
function account(id, patch = {}) {
  return {
    id,
    email: `${id}@fixture.test`,
    idp: 'Google',
    machineId: 'a'.repeat(64),
    credentials: {
      accessToken: 'fixture-access',
      csrfToken: '',
      refreshToken: `fixture-refresh-${id}`,
      authMethod: 'social',
      provider: 'Google',
      expiresAt: 1900000000000
    },
    subscription: { type: 'Free' },
    usage: { current: 1, limit: 25, percentUsed: 0.04, lastUpdated: 0 },
    tags: [],
    isActive: false,
    createdAt: 0,
    lastUsedAt: 0,
    ...patch
  }
}
function renderer(options = {}) {
  const saves = [],
    clock = timers(),
    intervals = new Map()
  let n = 0
  const api = {
    loadAccounts: async () => null,
    getAppVersion: async () => 'fixture',
    getLocalActiveAccount: async () => ({ success: false }),
    saveAccounts: async (data) => {
      saves.push(structuredClone(data))
    },
    ...options
  }
  const { useAccountsStore: store } = load(rendererCode, {
    window: { api, matchMedia: () => ({ matches: false }) },
    document: { documentElement: { classList: { toggle: noop } } },
    localStorage: { getItem: () => null, setItem: noop },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: (fn, delay) => {
      intervals.set(++n, { fn, delay })
      return n
    },
    clearInterval: (id) => intervals.delete(id)
  })
  return { store, api, saves, clock, intervals }
}
const source = fs.readFileSync('src/main/index.ts', 'utf8'),
  ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true)
function entry(name, env) {
  if (!('lastSavedData' in env)) env.lastSavedData = null

  let expression
  function visit(n) {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) expression = n.getText(ast)
    if (
      ts.isCallExpression(n) &&
      n.expression.getText(ast) === 'ipcMain.handle' &&
      n.arguments[0]?.text === name
    )
      expression = n.arguments[1].getText(ast)
    n.forEachChild(visit)
  }
  visit(ast)
  assert.ok(expression, name)
  const code = ts
    .transpileModule('const run=(' + expression + ');', {
      compilerOptions: { target: ts.ScriptTarget.ES2022 }
    })
    .outputText.replaceAll('import(', '__import(')
  return new Function('bindings', 'with(bindings){' + code + ';return run}')(env)
}
function mainFixture() {
  const clock = timers(),
    writes = [],
    backups = [],
    status = []
  let data = { accountData: { accounts: { a: account('a') } } }
  const env = {
    store: {
      path: '/fixture/accounts',
      get: (key, fallback) => structuredClone(data[key] ?? fallback),
      set: (key, value) => {
        if (env.fail) throw Error('fixture locked file')
        const patch = typeof key === 'object' ? key : { [key]: value }
        writes.push(structuredClone(patch))
        data = { ...data, ...structuredClone(patch) }
      }
    },
    lastSavedData: structuredClone(data.accountData),
    pendingAccountCredentials: new backend.PendingAccountCredentials(),
    accountDataDirty: false,
    storeFlushTimer: null,
    storeFlushRetries: 0,
    STORE_FLUSH_INTERVAL: 5000,
    pendingStoreWrites: new Map(),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    validateAccountData: backend.validateAccountData,
    updateAccountStorageStatus: (patch) => status.push(patch),
    createBackup: (value) => {
      backups.push(structuredClone(value))
    },
    mainWindow: null,
    initStore: async () => {},
    tokenRefreshConcurrency: (value) => value ?? 1,
    refreshConcurrency: 1,
    console: quiet
  }
  for (const name of [
    'scheduleStoreFlush',
    'flushStoreWrites',
    'debouncedStoreSet',
    'stageAccountData',
    'persistAccountData',
    'flushAccountData',
    'commitAccountCredentials'
  ])
    env[name] = entry(name, env)
  return { env, clock, writes, backups, status, read: () => data }
}

test('six counters use one encrypted store write and preserve the account payload', async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kiro-store-batch-'))
  t.after(() => fsp.rm(dir, { recursive: true, force: true }))
  const store = new Conf({
    cwd: dir,
    configName: 'fixture',
    encryptionKey: 'kiro-account-manager-secret-key'
  })
  store.set('accountData', { accounts: { a: account('a') } })
  let writes = 0,
    reads = 0
  const write = store._write,
    deserialize = store._deserialize
  store._write = function (value) {
    writes++
    return write.call(this, value)
  }
  store._deserialize = (value) => {
    reads++
    return deserialize(value)
  }
  const f = mainFixture()
  f.env.store = store
  for (const key of ['credits', 'input', 'output', 'requests', 'success', 'failed'])
    f.env.debouncedStoreSet(key, 3)
  f.env.flushStoreWrites()
  assert.equal(writes, 1)
  assert.equal(reads, 2)
  assert.equal(store.get('accountData').accounts.a.credentials.refreshToken, 'fixture-refresh-a')
  assert.equal(f.env.pendingStoreWrites.size, 0)
})
test('timer write failure is caught, retains the latest values and retries a bounded number of times', () => {
  const f = mainFixture()
  f.env.fail = true
  f.env.debouncedStoreSet('counter', 1)
  for (let i = 0; i < 4; i++) assert.doesNotThrow(() => f.clock.fire())
  assert.equal(f.clock.jobs.size, 0)
  assert.equal(f.env.pendingStoreWrites.get('counter'), 1)
  assert.match(f.status.at(-1).writeError, /locked/)
  f.env.fail = false
  f.env.debouncedStoreSet('counter', 2)
  f.clock.fire()
  assert.equal(f.read().counter, 2)
  assert.equal(f.env.pendingStoreWrites.size, 0)
  assert.equal(f.status.at(-1).writeError, null)
})
test('pending main account edits and counters share one batch commit', () => {
  const f = mainFixture(),
    updated = structuredClone(f.env.lastSavedData)
  updated.accounts.a.nickname = 'staged'
  f.env.stageAccountData(updated)
  f.env.debouncedStoreSet('counter', 4)
  f.env.flushStoreWrites()
  assert.equal(f.writes.length, 1)
  assert.equal(f.writes[0].accountData.accounts.a.nickname, 'staged')
  assert.equal(f.writes[0].counter, 4)
  assert.equal(f.env.accountDataDirty, false)
  assert.equal(f.backups.length, 1)
})
test('main account writes validate before persistence and keep failed valid writes for retry', () => {
  const f = mainFixture()
  assert.throws(() => f.env.persistAccountData({ accounts: { a: null } }))
  assert.equal(f.writes.length, 0)
  f.env.fail = true
  const latest = { accounts: { a: account('a', { nickname: 'new' }) } }
  assert.throws(() => f.env.persistAccountData(latest))
  assert.equal(f.env.lastSavedData, latest)
  assert.equal(f.env.accountDataDirty, true)
  f.env.fail = false
  f.env.flushStoreWrites()
  assert.equal(f.read().accountData.accounts.a.nickname, 'new')
  assert.equal(f.env.accountDataDirty, false)
})
test('IDE refresh with no renderer updates the canonical snapshot and survives quit preparation', async () => {
  const f = mainFixture()
  Object.assign(f.env, {
    parseAccessTokenClaims: () => ({ sub: 'fixture-sub' }),
    lastSwitchedAccountId: 'a'
  })
  await entry(
    'syncIdeTokenChangeToStore',
    f.env
  )({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: '2030-01-01T00:00:00Z' })
  assert.equal(f.env.lastSavedData.accounts.a.credentials.refreshToken, 'new-refresh')
  const count = f.writes.length
  Object.assign(f.env, {
    shutdownPreparation: undefined,
    stopMainPoolTokenRefresh: noop,
    stopKiroAuthTokenWatcher: null,
    proxyServer: null,
    getKProxyService: () => null,
    closeCachedProxyAgents: async () => {},
    flushBackupNow: async () => {},
    proxyLogStore: { flushSaveNow: async () => {} },
    __import: async () => ({ shutdownTlsClientPool: async () => {} })
  })
  await entry('prepareUpdateQuit', f.env)()
  assert.equal(f.read().accountData.accounts.a.credentials.refreshToken, 'new-refresh')
  assert.equal(f.writes.length, count)
})
test('main load errors reject instead of returning an empty installation', async () => {
  await assert.rejects(
    entry('load-accounts', {
      initStore: async () => {},
      store: {
        get() {
          throw Error('fixture read failure')
        }
      },
      validateAccountData: backend.validateAccountData
    })(),
    /read failure/
  )
  const load = entry('load-accounts', {
    initStore: async () => {},
    store: { get: () => ({ accounts: { a: null } }) },
    validateAccountData: backend.validateAccountData
  })
  await assert.rejects(load(), /账号记录/)
})
test('a fresh installation becomes ready while a failed read never starts auto-save or submits empty data', async () => {
  const fresh = renderer()
  await fresh.store.getState().loadFromStorage()
  assert.equal(fresh.store.getState().storageLoaded, true)
  assert.equal(fresh.intervals.size, 1)
  await fresh.store.getState().flushSaveImmediately()
  assert.equal(fresh.saves.length, 0)
  const failed = renderer({
    loadAccounts: async () => {
      throw Error('fixture read failure')
    }
  })
  await assert.rejects(failed.store.getState().loadFromStorage())
  assert.equal(failed.store.getState().storageLoaded, false)
  assert.equal(failed.intervals.size, 0)
  await assert.rejects(failed.store.getState().flushSaveImmediately())
  assert.equal(failed.saves.length, 0)
  assert.match(failed.store.getState().storageError, /read failure/)
})
test('retry after a load failure clears the error without losing user data', async () => {
  const f = renderer({
    loadAccounts: async () => {
      throw Error('fixture unavailable')
    }
  })
  await assert.rejects(f.store.getState().loadFromStorage())
  f.api.loadAccounts = async () => ({ accounts: { a: account('a') }, groups: {}, tags: {} })
  await f.store.getState().loadFromStorage()
  assert.equal(f.store.getState().storageError, null)
  assert.equal(f.store.getState().accounts.size, 1)
  assert.equal(f.intervals.size, 1)
})
test('concurrent startup loads share the same request and optional version metadata cannot block recovery', async () => {
  const hold = gate()
  let reads = 0
  const f = renderer({
    loadAccounts: () => {
      reads++
      return hold.promise
    },
    getAppVersion: async () => {
      throw Error('fixture metadata failure')
    }
  })
  const one = f.store.getState().loadFromStorage(),
    two = f.store.getState().loadFromStorage()
  assert.equal(one, two)
  await tick()
  assert.equal(reads, 1)
  hold.resolve({ accounts: { a: account('a') }, groups: {}, tags: {} })
  await Promise.all([one, two])
  assert.equal(f.store.getState().accounts.size, 1)
})
test('a flush during initial loading waits and preserves local additions alongside existing disk accounts', async () => {
  const hold = gate(),
    f = renderer({ loadAccounts: () => hold.promise })
  const loading = f.store.getState().loadFromStorage()
  await tick()
  const id = f.store.getState().addAccount(account('new'))
  let finished = false
  const flush = f.store
    .getState()
    .flushSaveImmediately()
    .then(() => {
      finished = true
    })
  await tick()
  assert.equal(finished, false)
  assert.equal(f.saves.length, 0)
  hold.resolve({ accounts: { old: account('old') }, groups: {}, tags: {} })
  await loading
  await flush
  assert.ok(f.store.getState().accounts.has(id))
  assert.ok(f.store.getState().accounts.has('old'))
  assert.ok(f.saves.at(-1).accounts[id])
  assert.ok(f.saves.at(-1).accounts.old)
})
test('reload merges unsaved edits, additions and deletions while retaining unrelated disk updates', async () => {
  const initial = {
    accounts: { a: account('a'), b: account('b'), c: account('c') },
    groups: {},
    tags: {}
  }
  const f = renderer({ loadAccounts: async () => structuredClone(initial) })
  await f.store.getState().loadFromStorage()
  f.store.getState().updateAccount('a', { nickname: 'local-edit' })
  const hold = gate()
  f.api.loadAccounts = () => hold.promise
  const reload = f.store.getState().loadFromStorage()
  await tick()
  f.store.getState().removeAccount('b')
  const id = f.store.getState().addAccount(account('new'))
  hold.resolve({
    accounts: { ...initial.accounts, c: account('c', { nickname: 'disk-edit' }) },
    groups: {},
    tags: {}
  })
  await reload
  assert.equal(f.store.getState().accounts.get('a').nickname, 'local-edit')
  assert.equal(f.store.getState().accounts.get('c').nickname, 'disk-edit')
  assert.equal(f.store.getState().accounts.has('b'), false)
  assert.equal(f.store.getState().accounts.has(id), true)
  await f.store.getState().flushSaveImmediately()
  assert.equal(f.saves.at(-1).accounts.a.nickname, 'local-edit')
})
test('sparse legacy records receive compatible defaults without changing their credentials', async () => {
  const f = renderer({
    loadAccounts: async () => ({
      accounts: { a: { credentials: { refreshToken: 'legacy-refresh' } } }
    })
  })
  await f.store.getState().loadFromStorage()
  const a = f.store.getState().accounts.get('a')
  assert.equal(a.credentials.refreshToken, 'legacy-refresh')
  assert.equal(a.usage.limit, 0)
  assert.equal(a.subscription.type, 'Free')
  assert.equal(a.machineId.length, 64)
  await f.store.getState().flushSaveImmediately()
  assert.equal(f.saves.length, 1)
})
test('scheduled saves reject on write failure, remain dirty, and clear the visible error after retry', async () => {
  const f = renderer()
  await f.store.getState().loadFromStorage()
  f.store.getState().addAccount(account('a'))
  f.api.saveAccounts = async () => {
    throw Error('fixture disk full')
  }
  const scheduled = f.store.getState().saveToStorage()
  await assert.rejects(f.store.getState().flushSaveImmediately(), /disk full/)
  await assert.rejects(scheduled, /disk full/)
  assert.match(f.store.getState().storageSaveError, /disk full/)
  f.api.saveAccounts = async (data) => f.saves.push(data)
  await f.store.getState().flushSaveImmediately()
  assert.equal(f.saves.length, 1)
  assert.equal(f.store.getState().storageSaveError, null)
})
test('concurrent startup SSO verification runs once and imports one identity', async () => {
  const hold = gate()
  let verifies = 0
  const f = renderer({
    loadAccounts: async () => ({ accounts: {} }),
    getLocalActiveAccount: async () => ({ success: true, data: { refreshToken: 'local' } }),
    loadKiroCredentials: async () => ({
      success: true,
      data: { refreshToken: 'local', authMethod: 'social', provider: 'Google' }
    }),
    verifyAccountCredentials: () => {
      verifies++
      return hold.promise
    }
  })
  await Promise.all([f.store.getState().loadFromStorage(), f.store.getState().loadFromStorage()])
  await tick()
  assert.equal(verifies, 1)
  hold.resolve({
    success: true,
    data: {
      email: 'local@fixture.test',
      userId: 'local-user',
      accessToken: 'a',
      refreshToken: 'local',
      usage: { current: 0, limit: 25 },
      subscriptionType: 'Free'
    }
  })
  await tick()
  assert.equal(f.store.getState().accounts.size, 1)
})
test('a late SSO import cannot override a user selection or resurrect a deleted account', async () => {
  const hold = gate()
  const f = renderer({
    loadAccounts: async () => ({ accounts: { b: account('b') } }),
    getLocalActiveAccount: async () => ({ success: true, data: { refreshToken: 'local' } }),
    loadKiroCredentials: async () => ({
      success: true,
      data: { refreshToken: 'local', provider: 'Google' }
    }),
    verifyAccountCredentials: () => hold.promise
  })
  await f.store.getState().loadFromStorage()
  await tick()
  await f.store.getState().setActiveAccount('b')
  hold.resolve({
    success: true,
    data: {
      email: 'local@fixture.test',
      accessToken: 'a',
      refreshToken: 'local',
      usage: { current: 0, limit: 25 },
      subscriptionType: 'Free'
    }
  })
  await tick()
  assert.equal(f.store.getState().accounts.size, 1)
  assert.equal(f.store.getState().activeAccountId, 'b')
})
function backupFixture(write) {
  const clock = timers(),
    states = []
  const { AccountBackupScheduler } = load(backendCode, {
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  })
  return { clock, states, backup: new AccountBackupScheduler(write, (error) => states.push(error)) }
}
test('backup requests coalesce the latest snapshot within the five-minute window', async () => {
  const writes = [],
    f = backupFixture(async (data) => writes.push(data))
  f.backup.request({ revision: 1 })
  f.clock.fire()
  await tick()
  f.backup.request({ revision: 2 })
  f.backup.request({ revision: 3 })
  assert.equal(f.clock.jobs.size, 1)
  assert.ok([...f.clock.jobs.values()][0].delay > 290000)
  await f.backup.flush()
  assert.deepEqual(writes, [{ revision: 1 }, { revision: 3 }])
  assert.equal(f.clock.jobs.size, 0)
})
test('failed backups retry without a new edit, stop after three failures, and remain manually retryable', async () => {
  let failed = true,
    attempts = 0
  const f = backupFixture(async () => {
    attempts++
    if (failed) throw Error('fixture backup full')
  })
  f.backup.request({ accounts: {} })
  for (let i = 0; i < 3; i++) {
    f.clock.fire()
    await tick()
  }
  assert.equal(attempts, 3)
  assert.equal(f.clock.jobs.size, 0)
  assert.match(f.states.at(-1), /backup full/)
  failed = false
  await f.backup.flush()
  assert.equal(attempts, 4)
  assert.equal(f.states.at(-1), null)
})
test('forced backup flush joins the active write and drains a newer snapshot without concurrent writers', async () => {
  const hold = gate(),
    writes = []
  let active = 0,
    peak = 0
  const f = backupFixture(async (data) => {
    active++
    peak = Math.max(peak, active)
    writes.push(data)
    if (writes.length === 1) await hold.promise
    active--
  })
  f.backup.request(1)
  f.clock.fire()
  await tick()
  let finished = false
  const flushing = f.backup.flush().then(() => {
    finished = true
  })
  f.backup.request(2)
  await tick()
  assert.equal(finished, false)
  hold.resolve()
  await flushing
  assert.deepEqual(writes, [1, 2])
  assert.equal(peak, 1)
  assert.equal(f.clock.jobs.size, 0)
})
for (const invalid of [
  { accounts: { a: null } },
  { accounts: { a: [] } },
  { accounts: { a: { credentials: [] } } },
  { accounts: { a: { usage: { current: 'bad' } } } },
  { accounts: { a: { subscription: null } } },
  { accounts: [] },
  { accounts: {}, groups: { g: null } }
]) {
  test(
    'invalid account data preserves the existing backup and key: ' + JSON.stringify(invalid),
    async (t) => {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kiro-valid-backup-'))
      t.after(() => fsp.rm(dir, { recursive: true, force: true }))
      const valid = { accounts: { a: account('a') } }
      await backend.writeSecureBackup(dir, valid)
      const file = path.join(dir, 'kiro-accounts.backup.local.enc'),
        key = path.join(dir, 'kiro-accounts.backup.key'),
        before = await fsp.readFile(file),
        keyBefore = await fsp.readFile(key)
      await assert.rejects(backend.initializeAccountBackup(dir, invalid))
      assert.deepEqual(await fsp.readFile(file), before)
      assert.deepEqual(await fsp.readFile(key), keyBefore)
      assert.deepEqual(await backend.readSecureBackup(dir), valid)
    }
  )
}
test('disabled account migration keeps the rollback flag without reading the account payload', () => {
  const calls = []
  entry('migrateAccountDataIfNeeded', {
    store: {
      get: (key) => {
        calls.push(key)
        return { builderIdArn: 1 }
      },
      set: () => {
        throw Error('already migrated')
      }
    }
  })()
  assert.deepEqual(calls, ['accountDataMigration'])
})

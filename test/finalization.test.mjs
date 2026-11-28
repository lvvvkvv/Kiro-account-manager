/* eslint @typescript-eslint/explicit-function-return-type: "off" -- Isolated cross-module lifecycle and credential fixtures. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { build } from 'esbuild'
const require = createRequire(import.meta.url)
const quiet = {
  log() {
    return undefined
  },
  warn() {
    return undefined
  },
  error() {
    return undefined
  }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))
function gate() {
  let resolve
  const promise = new Promise((done) => (resolve = done))
  return { promise, resolve }
}
async function load(file, dependencies = {}) {
  const code = (
    await build({
      entryPoints: [file],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      write: false
    })
  ).outputFiles[0].text
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'console', code)(
    (name) => (name in dependencies ? dependencies[name] : require(name)),
    module,
    module.exports,
    quiet
  )
  return module.exports
}
const { PendingAccountCredentials } = await load('src/main/accountCredentials.ts')
const { AccountWork } = await load('src/main/accountWork.ts')
const helpers = {
  ...(await load('src/shared/asyncPool.ts')),
  ...(await load('src/shared/tokenRefresh.ts'))
}
const ast = ts.createSourceFile(
  'index.ts',
  fs.readFileSync('src/main/index.ts', 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
function entry(name, env) {
  let node
  function visit(n) {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) node = n
    if (ts.isVariableDeclaration(n) && n.name.getText(ast) === name) node = n.initializer
    if (
      ts.isCallExpression(n) &&
      n.expression.getText(ast) === 'ipcMain.handle' &&
      n.arguments[0]?.text === name
    )
      node = n.arguments[1]
    ts.forEachChild(n, visit)
  }
  visit(ast)
  assert.ok(node, name)
  const code = ts
    .transpileModule(`const run=(${node.getText(ast)});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 }
    })
    .outputText.replaceAll('import(', '__import(')
  return new Function('env', `with(env){${code};return run}`)(env)
}
const before = {
  accessToken: 'old-access',
  refreshToken: 'old-refresh',
  expiresAt: 1,
  region: 'us-east-1'
}
const after = {
  ...before,
  accessToken: 'new-access',
  refreshToken: 'new-refresh',
  expiresAt: 1900000000000
}
const data = () => ({ accounts: { a: { nickname: 'keep', credentials: { ...before } } } })
test('a stale auto-save keeps edits but cannot undo a main-process credential rotation', () => {
  const updates = new PendingAccountCredentials()
  updates.record('a', before, after)
  const input = data()
  input.accounts.a.nickname = 'edited'
  input.accounts.a.credentials.region = 'eu-central-1'
  updates.merge(input)
  assert.equal(input.accounts.a.credentials.refreshToken, 'new-refresh')
  assert.equal(input.accounts.a.credentials.region, 'eu-central-1')
  assert.equal(input.accounts.a.nickname, 'edited')
  const accepted = structuredClone(input)
  updates.merge(accepted)
  const explicit = data()
  updates.merge(explicit)
  assert.equal(explicit.accounts.a.credentials.refreshToken, 'old-refresh') // acknowledged update no longer overrides edits
})
test('consecutive rotations protect intermediate snapshots while deletion and explicit credentials remain valid', () => {
  const updates = new PendingAccountCredentials(),
    newest = { ...after, accessToken: 'newest', refreshToken: 'newest', expiresAt: 1900003600000 }
  updates.record('a', before, after)
  updates.record('a', after, newest)
  const middle = { accounts: { a: { credentials: { ...after } } } }
  updates.merge(middle)
  assert.equal(middle.accounts.a.credentials.refreshToken, 'newest')
  const original = data()
  updates.merge(original)
  assert.equal(original.accounts.a.credentials.refreshToken, 'newest')
  const edited = data()
  edited.accounts.a.credentials.refreshToken = 'explicit-user-token'
  updates.merge(edited)
  assert.equal(edited.accounts.a.credentials.refreshToken, 'explicit-user-token')
  updates.record('a', before, after)
  const deleted = { accounts: {} }
  updates.merge(deleted)
  assert.deepEqual(deleted.accounts, {})
})
function mainFixture() {
  let disk = data(),
    requests = 0,
    writes = 0
  const env = {
    ...helpers,
    console: quiet,
    mainWindow: null,
    proxyServer: null,
    lastSwitchedAccountId: 'other',
    accountWork: new AccountWork(),
    pendingAccountCredentials: new PendingAccountCredentials(),
    lastSavedData: structuredClone(disk),
    accountDataDirty: false,
    storeFlushRetries: 0,
    store: {
      get: () => structuredClone(disk),
      set: (_key, value) => {
        disk = structuredClone(value)
        writes++
      }
    },
    scheduleStoreFlush() {
      return undefined
    },
    updateAccountStorageStatus() {
      return undefined
    },
    createBackup: async () => {},
    initStore: async () => {},
    validateAccountData() {
      return undefined
    },
    poolRefreshInFlightIds: new Set(),
    readKiroAuthTokenFile: async () => null,
    refreshTokenByMethod: async (token) => {
      requests++
      assert.equal(token, 'old-refresh')
      return {
        success: true,
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresIn: 3600
      }
    }
  }
  env.lastSavedData.accounts.a.id = 'a'
  env.lastSavedData.accounts.a.idp = 'Google'
  env.lastSavedData.accounts.a.credentials.authMethod = 'social'
  env.lastSavedData.accounts.a.credentials.provider = 'Google'
  for (const name of [
    'stageAccountData',
    'persistAccountData',
    'flushAccountData',
    'commitAccountCredentials',
    'isBannedAccountErrorMain'
  ])
    env[name] = entry(name, env)
  env.backgroundBatchRefreshImpl = entry('backgroundBatchRefresh', env)
  return { env, disk: () => disk, stats: () => ({ requests, writes }) }
}
test('a window-less background refresh commits once and the next scheduler tick uses its new expiry', async () => {
  const h = mainFixture(),
    run = entry('runMainPoolTokenRefreshTick', h.env)
  await run()
  await run()
  assert.deepEqual(h.stats(), { requests: 1, writes: 1 })
  assert.equal(h.disk().accounts.a.credentials.refreshToken, 'new-refresh')
  assert.ok(h.disk().accounts.a.credentials.expiresAt > Date.now())
})
test('main commits preserve current settings and reject deleted or stale credential targets', () => {
  const h = mainFixture()
  h.env.lastSavedData.accounts.a.nickname = 'edited while network pending'
  assert.equal(h.env.commitAccountCredentials('a', after, 'old-refresh'), true)
  assert.equal(h.env.lastSavedData.accounts.a.nickname, 'edited while network pending')
  assert.equal(h.env.commitAccountCredentials('a', { refreshToken: 'stale' }, 'old-refresh'), false)
  delete h.env.lastSavedData.accounts.a
  assert.equal(h.env.commitAccountCredentials('a', after, 'old-refresh'), false)
  assert.deepEqual(h.env.lastSavedData.accounts, {})
})
test('exit pauses new jobs and joins the accepted credential commit before it can finish', async () => {
  const work = new AccountWork(),
    held = gate(),
    events = []
  const active = work.run(async () => {
    await held.promise
    events.push('committed')
  })
  await tick()
  let paused = false
  const pause = work.pause().then(() => {
    paused = true
    events.push('drained')
  })
  await assert.rejects(
    work.run(async () => events.push('unexpected')),
    /Preparing to quit/
  )
  assert.equal(paused, false)
  held.resolve()
  await Promise.all([active, pause])
  assert.deepEqual(events, ['committed', 'drained'])
  work.paused = false
  await work.run(async () => events.push('resumed'))
  assert.equal(events.at(-1), 'resumed')
})
test('quiescing and failed-quit recovery restore only the services that were running', async () => {
  const held = gate(),
    events = [],
    work = new AccountWork()
  const active = work.run(() => held.promise)
  const server = {
    isRunning: () => true,
    isStarting: () => false,
    stop: async () => events.push('proxy-stop'),
    start: async () => events.push('proxy-start')
  }
  let running = true
  server.isRunning = () => running
  server.stop = async () => {
    events.push('proxy-stop')
    running = false
  }
  server.start = async () => {
    events.push('proxy-start')
    running = true
  }
  const env = {
    accountWork: work,
    quitWorkGeneration: 0,
    quiescingAccounts: undefined,
    resumeAccountServices: undefined,
    shutdownPreparation: undefined,
    mainPoolRefreshTimer: 1,
    stopKiroAuthTokenWatcher: () => events.push('watch-stop'),
    proxyServer: server,
    getKProxyService: () => null,
    stopMainPoolTokenRefresh: () => events.push('timer-stop'),
    clearProactiveRenewal() {
      return undefined
    },
    startMainPoolTokenRefresh: () => events.push('timer-start'),
    startKiroAuthTokenWatcher: () => events.push('watch-start'),
    lastSwitchedAccountId: null,
    console: quiet
  }
  const paused = entry('quiesceAccountWork', env)()
  assert.equal(work.paused, true)
  assert.equal(running, false)
  held.resolve()
  await Promise.all([active, paused])
  entry('resumeAfterFailedQuit', env)()
  await tick()
  await tick()
  assert.equal(work.paused, false)
  assert.equal(running, true)
  assert.ok(events.includes('timer-start') && events.includes('watch-start'))
})
test('self-signed certificates are asynchronous, reusable, scoped by directory and refreshable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-final-cert-'))
  try {
    const { ensureProxySelfSignedCert } = await load('src/main/proxy/selfSignedCert.ts')
    let heartbeat = false
    setImmediate(() => (heartbeat = true))
    const [a, b] = await Promise.all([
      ensureProxySelfSignedCert(root, ['fixture.test']),
      ensureProxySelfSignedCert(root, ['fixture.test'])
    ])
    assert.equal(heartbeat, true)
    assert.equal(a.fingerprint, b.fingerprint)
    assert.ok(a.altNames.includes('fixture.test') && a.altNames.includes('::1'))
    const crypto = await import('node:crypto'),
      cert = new crypto.X509Certificate(a.cert)
    assert.equal(cert.checkPrivateKey(crypto.createPrivateKey(a.key)), true)
    const fresh = await ensureProxySelfSignedCert(root, ['fixture.test'], true)
    assert.notEqual(fresh.fingerprint, a.fingerprint)
    const other = await ensureProxySelfSignedCert(path.join(root, 'other'), ['fixture.test'])
    assert.notEqual(other.fingerprint, fresh.fingerprint)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
test('CLI fallback runs one transaction and rolls back SQL errors without misreporting a missing driver', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-final-cli-'))
  try {
    const { DatabaseSync } = await import('node:sqlite'),
      dbPath = path.join(root, 'fixture.sqlite3')
    let db = new DatabaseSync(dbPath)
    db.exec(
      "CREATE TABLE auth_kv(key TEXT PRIMARY KEY,value TEXT);INSERT INTO auth_kv VALUES('old','keep');CREATE TRIGGER reject_delete BEFORE DELETE ON auth_kv BEGIN SELECT RAISE(ABORT,'fixture delete failure'); END;"
    )
    db.close()
    let attempts = 0,
      sqlInput
    const { writeCliCredentials } = await load('src/main/cliCredentials.ts', {
      'node:child_process': {
        execFile(_file, args, _opts, callback) {
          attempts++
          assert.equal(args[0], '-bail')
          queueMicrotask(() => callback(Object.assign(Error('no binary'), { code: 'ENOENT' })))
          return {
            stdin: {
              on() {
                return undefined
              },
              end(input) {
                sqlInput = input
              }
            }
          }
        }
      }
    })
    await assert.rejects(
      writeCliCredentials(dbPath, [
        "INSERT INTO auth_kv VALUES('new','fixture');",
        "DELETE FROM auth_kv WHERE key='old';"
      ]),
      /fixture delete failure/
    )
    assert.equal(attempts, 1)
    assert.ok(sqlInput.startsWith('BEGIN IMMEDIATE;') && sqlInput.endsWith('COMMIT;'))
    db = new DatabaseSync(dbPath)
    assert.deepEqual(
      db
        .prepare('SELECT key FROM auth_kv')
        .all()
        .map((row) => row.key),
      ['old']
    )
    db.exec('DROP TRIGGER reject_delete;')
    db.close()
    await writeCliCredentials(dbPath, [
      "INSERT INTO auth_kv VALUES('new','fixture');",
      "DELETE FROM auth_kv WHERE key='old';"
    ])
    db = new DatabaseSync(dbPath)
    assert.deepEqual(
      db
        .prepare('SELECT key FROM auth_kv')
        .all()
        .map((row) => row.key),
      ['new']
    )
    db.close()
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
test('an existing SQLite command failure does not execute the native fallback a second time', async () => {
  const failure = Object.assign(Error('database locked'), { code: 5 })
  const { writeCliCredentials } = await load('src/main/cliCredentials.ts', {
    'node:child_process': {
      execFile(_file, _args, _options, callback) {
        queueMicrotask(() => callback(failure))
        return {
          stdin: {
            on() {
              return undefined
            },
            end() {
              return undefined
            }
          }
        }
      }
    }
  })
  await assert.rejects(
    writeCliCredentials('/unused-fixture-path', []),
    (error) => error === failure
  )
})

test('a CLI database failure keeps a successful token rotation without reporting a successful switch', async () => {
  const h = mainFixture()
  Object.assign(h.env, {
    resolveProfileArnForWrite: () => undefined,
    writeCliCredentials: async () => {
      throw Error('fixture SQL failure')
    },
    __import: async (name) => {
      if (name === 'os') return { homedir: () => '/fixture-home' }
      if (name === 'path') return path
      if (name === 'fs/promises') return { mkdir: async () => {} }
      throw Error('Unexpected external operation: ' + name)
    }
  })
  const result = await entry('switch-account-cli', h.env)(null, {
    accountId: 'a',
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    provider: 'Google'
  })
  assert.equal(result.success, false)
  assert.match(result.error, /fixture SQL failure/)
  assert.equal(result.refreshedCredentials.refreshToken, 'new-refresh')
  assert.equal(h.env.lastSavedData.accounts.a.credentials.refreshToken, 'new-refresh')
})

test('a destroyed renderer cannot submit a late stale save after the final flush', async () => {
  const h = mainFixture(),
    held = gate()
  let destroyed = false
  h.env.initStore = () => held.promise
  h.env.tokenRefreshConcurrency = () => 1
  h.env.refreshConcurrency = 1
  const save = entry('save-accounts', h.env)({ sender: { isDestroyed: () => destroyed } }, data())
  destroyed = true
  held.resolve()
  await save
  assert.equal(h.stats().writes, 0)
})
test('ordinary quit waits for producers before requesting the renderer snapshot and resumes after failure', async () => {
  const handlers = new Map(),
    events = [],
    held = gate()
  const { AppQuitCoordinator } = await load('src/main/quit.ts', {
    electron: { ipcMain: { handle: (name, fn) => handlers.set(name, fn) } }
  })
  const sender = {
    mainFrame: {},
    isDestroyed: () => false,
    getURL: () => 'file://fixture',
    send: (_channel, token) => events.push({ token })
  }
  let fail = true
  const q = new AppQuitCoordinator(
    () => ({ isDestroyed: () => false, webContents: sender }),
    async () => {
      events.push('cleanup')
      if (fail) throw Error('fixture cleanup failure')
    },
    () => events.push('exit'),
    () => events.push('reported'),
    () => held.promise,
    () => events.push('resumed')
  )
  const pending = q.request()
  await tick()
  assert.equal(q.isPreparing, true)
  assert.deepEqual(events, [])
  held.resolve()
  await tick()
  await tick()
  handlers.get('app-quit:ready')({ sender, senderFrame: sender.mainFrame }, events[0].token)
  await pending
  assert.deepEqual(events.slice(1), ['cleanup', 'resumed', 'reported'])
  fail = false
  const again = q.request()
  await tick()
  await tick()
  handlers.get('app-quit:ready')(
    { sender, senderFrame: sender.mainFrame },
    events.findLast((value) => value.token).token
  )
  await again
  assert.equal(events.at(-1), 'exit')
})

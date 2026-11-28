/* eslint @typescript-eslint/explicit-function-return-type: "off" -- JavaScript test helpers. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { build } from 'esbuild'
const require = createRequire(import.meta.url)
const mainSource = await fs.readFile('src/main/index.ts', 'utf8')
const ast = ts.createSourceFile('index.ts', mainSource, ts.ScriptTarget.Latest, true)
const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined }
const tick = () => new Promise((resolve) => setImmediate(resolve))
function gate() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function load(entry) {
  const { outputFiles } = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    write: false
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputFiles[0].text)(require, module, module.exports)
  return module.exports
}
const { mapConcurrent } = await load('src/shared/asyncPool.ts')
const { TokenRefreshCoordinator } = await load('src/main/tokenRefreshCoordinator.ts')
const { tokenRefreshConcurrency } = await load('src/shared/tokenRefresh.ts')
const { AccountWork } = await load('src/main/accountWork.ts')
const { PendingAccountCredentials } = await load('src/main/accountCredentials.ts')
function entry(name, bindings) {
  bindings.accountWork ??= new AccountWork()
  bindings.pendingAccountCredentials ??= new PendingAccountCredentials()
  if (bindings.mainWindow && !bindings.mainWindow.isDestroyed) bindings.mainWindow.isDestroyed = () => false

  let expression
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) expression = node.getText(ast)
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name)
      expression = node.initializer.getText(ast)
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === 'ipcMain.handle' &&
      node.arguments[0]?.text === name
    )
      expression = node.arguments[1].getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(expression, `Missing entry ${name}`)
  const code = ts
    .transpileModule(`const run = (${expression});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 }
    })
    .outputText.replaceAll('import(', '__import(')
  // Load real entry-point code without booting Electron. Only external I/O is supplied by the fixture.
  return new Function('bindings', `with (bindings) { ${code}; return run }`)(bindings)
}

test('workers immediately reuse a free slot even when another task is slow', async () => {
  const slow = gate(),
    started = []
  const running = mapConcurrent([0, 1, 2, 3], 2, async (value) => {
    started.push(value)
    if (value === 0) await slow.promise
    if (value === 2) throw Error('fixture error')
    return value
  })
  await tick()
  assert.deepEqual(started, [0, 1, 2, 3])
  slow.resolve()
  const results = await running
  assert.equal(results[2].status, 'rejected')
  assert.equal(results[3].value, 3)
})

test('information queries share same-account work and the global concurrency limit', async () => {
  const ready = gate()
  let active = 0,
    peak = 0,
    calls = 0
  const request = async () => {
    calls++
    active++
    peak = Math.max(peak, active)
    await ready.promise
    active--
    return {}
  }
  const run = entry('fetchAccountInfo', {
    accountInfoCoordinator: new TokenRefreshCoordinator(() => 1),
    getUsageAndLimits: request,
    getUserInfo: request
  })
  const first = run('token-a', 'Google'),
    duplicate = run('token-a', 'Google'),
    other = run('token-b', 'Google')
  assert.equal(first, duplicate)
  await tick()
  assert.equal(calls, 2)
  ready.resolve()
  await Promise.all([first, duplicate, other])
  assert.equal(calls, 4)
  assert.equal(peak, 2)
})

test('information-only background results omit credentials and preserve request identity', async () => {
  const events = []
  const run = entry('backgroundBatchRefresh', {
    tokenRefreshConcurrency,
    mapConcurrent,
    console: quiet,
    poolRefreshInFlightIds: new Set(),
    proxyServer: null,
    mainWindow: { webContents: { send: (name, data) => events.push({ name, data }) } },
    fetchAccountInfo: async () => ({
      usage: { status: 'fulfilled', value: { usageBreakdownList: [] } },
      userInfo: { status: 'fulfilled', value: { email: 'fixture@example.test' } }
    })
  })
  const result = await run(
    [
      {
        id: 'a',
        profileArn: 'existing',
        needsTokenRefresh: false,
        credentials: { accessToken: 'old-access', refreshToken: 'old-refresh' }
      }
    ],
    1,
    true
  )
  assert.equal(result.successCount, 1)
  const payload = events.find((e) => e.name === 'background-refresh-result').data
  assert.equal(payload.expectedRefreshToken, 'old-refresh')
  assert.equal('accessToken' in payload.data, false)
  assert.equal('refreshToken' in payload.data, false)
})

function renewalFixture(refresh, write = async () => undefined) {
  const events = []
  const env = {
    console: quiet,
    proactiveRenewalEnabled: true,
    ideSwitchGeneration: 0,
    lastSwitchedAccountId: 'a',
    lastWrittenTokenSignature: '',
    lastSavedData: null,
    resolveProfileArnForWrite: () => undefined,
    refreshTokenByMethod: refresh,
    writeKiroAuthTokenFile: write,
    mainWindow: { webContents: { send: (_name, data) => events.push(data) } },
    tokenRefreshAt: (_id, expiry) => expiry - 600000,
    scheduleProactiveRenewal: () => undefined
  }
  let data = {
    accounts: {
      a: {
        id: 'a',
        email: 'a@example.test',
        credentials: { refreshToken: 'old', authMethod: 'social', provider: 'Google' }
      }
    },
    language: 'zh'
  }
  env.store = {
    get: () => structuredClone(data),
    set: (_key, value) => {
      data = structuredClone(value)
    }
  }
  env.persistAccountData = (value) => { env.store.set('accountData', value); env.lastSavedData = value }
  env.stageAccountData = env.persistAccountData
  env.commitAccountCredentials = entry('commitAccountCredentials', env)
  return {
    env,
    events,
    run: entry('runProactiveRenewal', env),
    read: () => data,
    update: (mutate) => mutate(data)
  }
}
const rotated = {
  success: true,
  accessToken: 'new-access',
  refreshToken: 'new-refresh',
  expiresIn: 1800
}

test('proactive renewal preserves edits made during both network and file writes', async () => {
  const network = gate(),
    disk = gate()
  const fixture = renewalFixture(
    async () => {
      await network.promise
      return rotated
    },
    async () => {
      await disk.promise
    }
  )
  const running = fixture.run('a')
  await tick()
  fixture.update((data) => {
    data.accounts.b = { id: 'b' }
  })
  network.resolve()
  await tick()
  fixture.update((data) => {
    data.language = 'en'
    data.accounts.c = { id: 'c' }
  })
  disk.resolve()
  await running
  assert.deepEqual(Object.keys(fixture.read().accounts), ['a', 'b', 'c'])
  assert.equal(fixture.read().language, 'en')
  assert.equal(fixture.read().accounts.a.credentials.refreshToken, 'new-refresh')
  assert.equal(fixture.events[0].expectedRefreshToken, 'old')
  assert.equal(fixture.events[0].credentials.refreshToken, 'new-refresh')
})

test('switching away during renewal keeps rotated credentials but does not rewrite the IDE account', async () => {
  const network = gate()
  let writes = 0
  const fixture = renewalFixture(
    async () => {
      await network.promise
      return rotated
    },
    async () => {
      writes++
    }
  )
  const running = fixture.run('a')
  await tick()
  fixture.env.ideSwitchGeneration++
  fixture.env.lastSwitchedAccountId = 'b'
  network.resolve()
  await running
  assert.equal(writes, 0)
  assert.equal(fixture.env.lastSwitchedAccountId, 'b')
  assert.equal(fixture.read().accounts.a.credentials.refreshToken, 'new-refresh')
})

test('fresh online-login credentials skip redundant token rotation', async () => {
  let refreshes = 0
  const verify = entry('verify-account-credentials', {
    console: quiet,
    refreshTokenByMethod: async () => {
      refreshes++
      return rotated
    },
    getUsageAndLimits: async () => ({
      userInfo: { email: 'fixture@example.test', userId: 'u' },
      usageBreakdownList: []
    })
  })
  const result = await verify(null, {
    accessToken: 'fresh-access',
    refreshToken: 'fresh-refresh',
    expiresIn: 900,
    clientId: '',
    clientSecret: '',
    authMethod: 'social',
    provider: 'Google'
  })
  assert.equal(result.success, true)
  assert.equal(result.data.accessToken, 'fresh-access')
  assert.equal(result.data.refreshToken, 'fresh-refresh')
  assert.equal(result.data.expiresIn, 900)
  assert.equal(refreshes, 0)
  await verify(null, {
    refreshToken: 'old',
    clientId: '',
    clientSecret: '',
    authMethod: 'social',
    provider: 'Google'
  })
  assert.equal(refreshes, 1)
})

test('CLI writes the rotated refresh token and actual expiry, and can reuse IDE credentials', async () => {
  const statements = []
  let refreshes = 0
  const run = entry('switch-account-cli', {
    console: quiet,
    writeCliCredentials: async (_dbPath, sql) => { statements.push(sql.join('\n')) },
    resolveProfileArnForWrite: () => undefined,
    refreshTokenByMethod: async () => {
      refreshes++
      return rotated
    },
    __import: async (name) => {
      if (name === 'os') return { homedir: () => '/fixture-home' }
      if (name === 'path') return path
      if (name === 'fs/promises') return { mkdir: async () => undefined }
      if (name === 'child_process')
        return {
          execFileSync: (_binary, _args, options) => {
            statements.push(options.input)
          }
        }
      throw Error(`Unexpected external import: ${name}`)
    }
  })
  const result = await run(null, {
    accessToken: 'old-access',
    refreshToken: 'old',
    provider: 'Google'
  })
  assert.equal(result.success, true)
  const value = JSON.parse(statements[0].match(/VALUES \('[^']+', '(.*?)'\);/)[1])
  assert.equal(value.refresh_token, 'new-refresh')
  assert.ok(Math.abs(Date.parse(value.expires_at) - Date.now() - 1800000) < 2000)
  assert.equal(result.refreshedCredentials.refreshToken, 'new-refresh')
  await run(null, {
    accessToken: 'ide-access',
    refreshToken: 'ide-refresh',
    provider: 'Google',
    skipRefresh: true,
    expiresAt: Date.now() + 900000
  })
  assert.equal(refreshes, 1)
  assert.ok(statements[1].includes('ide-refresh'))
})

test('cached proxy agents reuse a dispatcher while isolated validation agents retain ownership', async () => {
  const proxy = await load('src/main/proxy/systemProxy.ts')
  const first = proxy.getCachedProxyAgent('http://127.0.0.1:23456')
  assert.equal(proxy.getCachedProxyAgent('http://127.0.0.1:23456'), first)
  const isolated = proxy.safeCreateProxyAgent('http://127.0.0.1:23456')
  assert.notEqual(isolated, first)
  await isolated.close()
  assert.equal(proxy.getCachedProxyAgent('http://127.0.0.1:23456'), first)
  await proxy.closeCachedProxyAgents()
  assert.notEqual(proxy.getCachedProxyAgent('http://127.0.0.1:23456'), first)
  await proxy.closeCachedProxyAgents()
})

test('verification publishes rotated credentials even if the following information query fails', async () => {
  const events = []
  const verify = entry('verify-account-credentials', {
    console: quiet,
    refreshTokenByMethod: async () => rotated,
    mainWindow: { webContents: { send: (_name, value) => events.push(value) } },
    getUsageAndLimits: async () => {
      throw Error('fixture information failure')
    }
  })
  const result = await verify(null, {
    accountId: 'a',
    refreshToken: 'old',
    clientId: '',
    clientSecret: '',
    authMethod: 'social',
    provider: 'Google'
  })
  assert.equal(result.success, false)
  assert.equal(events[0].expectedRefreshToken, 'old')
  assert.equal(events[0].credentials.refreshToken, 'new-refresh')
  assert.equal(result.refreshedCredentials.refreshToken, 'new-refresh')
  const newAccount = await verify(null, { refreshToken: 'old', clientId: 'client', clientSecret: 'secret', authMethod: 'IdC', provider: 'BuilderId' })
  assert.equal(newAccount.refreshedCredentials.refreshToken, 'new-refresh')
  assert.equal(events.length, 1)
})

const addSource = await fs.readFile(
  'src/renderer/src/components/accounts/AddAccountDialog.tsx',
  'utf8'
)
function loginEntry(name, bindings) {
  const tree = ts.createSourceFile(
    'dialog.tsx',
    addSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  let expression
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name)
      expression = node.initializer.getText(tree)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  const code = ts.transpileModule(`const run = (${expression});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText
  return new Function('bindings', `with(bindings) { ${code}; return run }`)(bindings)
}
function pollingFixture(poll) {
  const timers = new Map(),
    callbacks = []
  let next = 0,
    cancellations = 0
  const env = {
    console: quiet,
    region: 'us-east-1',
    isEn: false,
    loginGeneration: { current: 1 },
    loginSession: { current: 'builderid' },
    pollIntervalRef: { current: null },
    useCallback: (callback) => callback,
    setTimeout: (fn, delay) => {
      const id = ++next
      timers.set(id, { fn, delay })
      return id
    },
    clearTimeout: (id) => timers.delete(id),
    window: {
      api: {
        pollBuilderIdAuth: poll,
        cancelBuilderIdLogin: async () => {
          cancellations++
        }
      }
    },
    setError: () => undefined,
    setIsLoggingIn: () => undefined,
    setBuilderIdLoginData: () => undefined,
    setIamSsoLoginData: () => undefined,
    handleLoginSuccess: async (value) => {
      callbacks.push(value)
    }
  }
  env.cancelPendingLogin = loginEntry('cancelPendingLogin', env)
  return {
    env,
    timers,
    callbacks,
    cancelled: () => cancellations,
    start: loginEntry('startAuthorizationPolling', env),
    fire: () => {
      const [id, timer] = timers.entries().next().value
      timers.delete(id)
      timer.fn()
    }
  }
}

test('login polling waits for completion and applies slow_down before scheduling the next request', async () => {
  const response = gate()
  let calls = 0
  const fixture = pollingFixture(async () => {
    calls++
    return response.promise
  })
  fixture.start('builderid', 5)
  assert.equal([...fixture.timers.values()][0].delay, 5000)
  fixture.fire()
  await tick()
  assert.equal(calls, 1)
  assert.equal(fixture.timers.size, 0)
  response.resolve({ success: true, completed: false, status: 'slow_down' })
  await tick()
  assert.equal([...fixture.timers.values()][0].delay, 10000)
  fixture.env.cancelPendingLogin()
  assert.equal(fixture.timers.size, 0)
})

test('cancelled login ignores a completed response that arrives later', async () => {
  const response = gate()
  const fixture = pollingFixture(async () => response.promise)
  fixture.start('builderid', 5)
  fixture.fire()
  fixture.env.cancelPendingLogin()
  response.resolve({ success: true, completed: true, accessToken: 'late', refreshToken: 'late' })
  await tick()
  assert.equal(fixture.cancelled(), 1)
  assert.equal(fixture.callbacks.length, 0)
  assert.equal(fixture.timers.size, 0)
})

test('IDE credential-file writes serialize concurrent updates', async () => {
  const pending = gate(),
    writes = []
  let active = 0,
    peak = 0
  globalThis.__kiroAuthWriteFixture = async (_file, content) => {
    active++
    peak = Math.max(peak, active)
    writes.push(JSON.parse(content))
    if (writes.length === 1) await pending.promise
    active--
  }
  try {
    const { outputFiles } = await build({
      entryPoints: ['src/main/kiroAuthSync.ts'],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      write: false,
      plugins: [
        {
          name: 'isolated-auth-file-writes',
          setup(builder) {
            builder.onResolve({ filter: /^fs\/promises$/ }, () => ({
              path: 'fixture-fs',
              namespace: 'fixture'
            }))
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
              loader: 'js',
              contents: `
          export * from 'node:fs/promises';
          export const mkdir = async () => undefined;
          export const chmod = async () => undefined;
          export const writeFile = (...args) => globalThis.__kiroAuthWriteFixture(...args);
        `
            }))
          }
        }
      ]
    })
    const module = { exports: {} }
    new Function('require', 'module', 'exports', outputFiles[0].text)(
      require,
      module,
      module.exports
    )
    const write = module.exports.writeKiroAuthTokenFile
    const input = {
      authMethod: 'social',
      provider: 'Google',
      accessToken: 'a',
      refreshToken: 'first',
      expiresAtIso: new Date().toISOString()
    }
    const first = write(input),
      second = write({ ...input, refreshToken: 'second' })
    await tick()
    assert.equal(writes.length, 1)
    pending.resolve()
    await Promise.all([first, second])
    assert.equal(peak, 1)
    assert.deepEqual(
      writes.map((value) => value.refreshToken),
      ['first', 'second']
    )
  } finally {
    delete globalThis.__kiroAuthWriteFixture
  }
})

test('a failed response from a cancelled social login does not clear a newer login session', async () => {
  let reject
  const pending = new Promise((_resolve, fail) => {
    reject = fail
  })
  const env = {
    console: quiet,
    loginGeneration: 1,
    currentLoginState: { type: 'social', oauthState: 'first', codeVerifier: 'fixture' },
    KIRO_AUTH_ENDPOINT: 'http://fixture.invalid',
    fetchWithAppProxy: async () => pending
  }
  const exchange = entry('exchange-social-token', env)
  const result = exchange(null, 'fixture-code', 'first')
  env.loginGeneration++
  env.currentLoginState = { type: 'social', oauthState: 'second' }
  reject(Error('old request failed'))
  assert.equal((await result).success, false)
  assert.equal(env.currentLoginState.oauthState, 'second')
})

test('background refresh emits a failure result when required credentials are missing', async () => {
  const events = []
  const run = entry('backgroundBatchRefresh', {
    tokenRefreshConcurrency,
    mapConcurrent,
    console: quiet,
    poolRefreshInFlightIds: new Set(),
    proxyServer: null,
    mainWindow: { webContents: { send: (name, data) => events.push({ name, data }) } }
  })
  const result = await run(
    [{ id: 'a', credentials: { refreshToken: '', accessToken: '' } }],
    1,
    false
  )
  assert.equal(result.failedCount, 1)
  const failure = events.find((value) => value.name === 'background-refresh-result').data
  assert.equal(failure.success, false)
  assert.match(failure.error, /Refresh Token/)
})

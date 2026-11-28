/* eslint @typescript-eslint/explicit-function-return-type: "off" -- Isolated file and store regression fixtures. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { build } from 'esbuild'
const require = createRequire(import.meta.url)
const noop = () => undefined
const quiet = { log: noop, warn: noop, error: noop }
function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const tick = () => new Promise((done) => setImmediate(done))
function loader(deps = {}) {
  const cache = new Map()
  function load(file) {
    file = path.resolve(file)
    if (cache.has(file)) return cache.get(file)
    const module = { exports: {} }
    cache.set(file, module.exports)
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true
      }
    }).outputText
    new Function('require', 'module', 'exports', code)(
      (name) =>
        name in deps
          ? deps[name]
          : name.startsWith('.')
            ? load(path.resolve(path.dirname(file), name) + '.ts')
            : require(name),
      module,
      module.exports
    )
    cache.set(file, module.exports)
    return module.exports
  }
  return load
}
const { KiroConfigFiles, kiroSettingsPath } = loader()('src/main/kiroSettings.ts')
const { DEFAULT_KIRO_SETTINGS } = loader()('src/shared/kiroSettings.ts')
async function files(t) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'kiro-config-test-'))
  t.after(() => fsp.rm(home, { recursive: true, force: true }))
  return new KiroConfigFiles(home, path.join(home, 'app', 'User', 'settings.json'))
}
async function seed(file, text) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, text)
}

test('platform settings locations respect redirected APPDATA and XDG', () => {
  assert.equal(
    kiroSettingsPath('win32', '/home', { APPDATA: '/roaming' }),
    path.join('/roaming', 'Kiro/User/settings.json')
  )
  assert.equal(
    kiroSettingsPath('win32', '/home', {}),
    path.join('/home', 'AppData/Roaming/Kiro/User/settings.json')
  )
  assert.equal(
    kiroSettingsPath('darwin', '/home', {}),
    path.join('/home', 'Library/Application Support/Kiro/User/settings.json')
  )
  assert.equal(
    kiroSettingsPath('linux', '/home', { XDG_CONFIG_HOME: '/xdg' }),
    path.join('/xdg', 'Kiro/User/settings.json')
  )
  assert.equal(
    kiroSettingsPath('linux', '/home', {}),
    path.join('/home', '.config/Kiro/User/settings.json')
  )
})
test('JSONC settings preserve URL strings, comments, unrelated values and trailing commas', async (t) => {
  const f = await files(t)
  await seed(
    f.settingsPath,
    '{\n // keep-comment\n "http.proxy":"https://proxy.example.test/a//b",\n "other":{"text":"/*literal*/",},\n "kiroAgent.agentAutonomy":"Supervised",\n}'
  )
  assert.equal((await f.load()).settings.agentAutonomy, 'Supervised')
  await f.saveSettings({
    agentAutonomy: 'Autopilot',
    trustedCommands: ['echo https://fixture.test']
  })
  const text = await fsp.readFile(f.settingsPath, 'utf8')
  assert.match(text, /keep-comment/)
  assert.match(text, /https:\/\/proxy.example.test\/a\/\/b/)
  assert.match(text, /\/\*literal\*\//)
  const result = await f.load()
  assert.equal(result.settings.agentAutonomy, 'Autopilot')
  assert.deepEqual(result.settings.trustedCommands, ['echo https://fixture.test'])
})
test('all setting fields roundtrip while invalid fields leave the file unchanged', async (t) => {
  const f = await files(t)
  await f.saveSettings(DEFAULT_KIRO_SETTINGS)
  assert.deepEqual(
    JSON.parse(JSON.stringify((await f.load('settings')).settings)),
    DEFAULT_KIRO_SETTINGS
  )
  const before = await fsp.readFile(f.settingsPath, 'utf8')
  await assert.rejects(f.saveSettings({ trustedTools: { tool: 'yes' } }), /字段无效/)
  assert.equal(await fsp.readFile(f.settingsPath, 'utf8'), before)
})
test('invalid settings do not hide valid MCP and rules or get overwritten', async (t) => {
  const f = await files(t)
  await seed(f.settingsPath, '{invalid')
  await f.saveMcp('fixture', { command: 'node' })
  await f.saveRule('fixture.md', 'fixture')
  const loaded = await f.load()
  assert.ok(loaded.errors.settings)
  assert.equal(loaded.mcpConfig.mcpServers.fixture.command, 'node')
  assert.deepEqual(loaded.steeringFiles, ['fixture.md'])
  await assert.rejects(f.saveSettings({ modelSelection: 'auto' }))
  assert.equal(await fsp.readFile(f.settingsPath, 'utf8'), '{invalid')
})
test('BOM JSONC and prototype-named data remain data and survive edits', async (t) => {
  const f = await files(t)
  await seed(
    f.settingsPath,
    '\uFEFF{ "__proto__":{"fixture":true}, "kiroAgent.agentAutonomy":"Supervised", }'
  )
  await f.saveSettings({ modelSelection: 'auto' })
  assert.equal((await f.load('settings')).settings.agentAutonomy, 'Supervised')
  assert.match(await fsp.readFile(f.settingsPath, 'utf8'), /"__proto__"/)
  assert.equal({}.fixture, undefined)
})
test('MCP editing keeps hidden fields and remote entries, clears owned args and env', async (t) => {
  const f = await files(t)
  await seed(
    f.mcpPath,
    '{\n//keep\n"identityProvider":{"issuer":"https://idp.test"},"mcpServers":{"local":{"command":"node","args":["old"],"env":{"OLD":"x"},"disabled":true,"autoApprove":["read"],"extra":5},"remote":{"url":"https://mcp.test","headers":{"token":"fixture"}}}}'
  )
  await f.saveMcp('local', { command: 'new-command' }, 'local')
  const mcp = (await f.load('mcp')).mcpConfig.mcpServers
  assert.deepEqual(JSON.parse(JSON.stringify(mcp.local)), {
    command: 'new-command',
    disabled: true,
    autoApprove: ['read'],
    extra: 5
  })
  assert.equal(mcp.remote.url, 'https://mcp.test')
  assert.match(await fsp.readFile(f.mcpPath, 'utf8'), /keep/)
  assert.match(await fsp.readFile(f.mcpPath, 'utf8'), /identityProvider/)
  await assert.rejects(f.saveMcp('remote', { command: 'node' }, 'remote'), /远程/)
})
test('parallel MCP mutations retain every server and reads await in-flight writes', async (t) => {
  const f = await files(t)
  await Promise.all(Array.from({ length: 30 }, (_, i) => f.saveMcp('s' + i, { command: 'node' })))
  assert.equal(Object.keys((await f.load('mcp')).mcpConfig.mcpServers).length, 30)
  const save = f.saveMcp('last', { command: 'node' })
  const loaded = f.load('mcp')
  await save
  assert.equal((await loaded).mcpConfig.mcpServers.last.command, 'node')
  await f.deleteMcp('s1')
  assert.equal((await f.load('mcp')).mcpConfig.mcpServers.s1, undefined)
})
test('MCP rename compatibility keeps fields and rejects collisions', async (t) => {
  const f = await files(t)
  await seed(
    f.mcpPath,
    JSON.stringify({
      mcpServers: { a: { command: 'node', disabled: true }, b: { command: 'other' } }
    })
  )
  await assert.rejects(f.saveMcp('b', { command: 'new' }, 'a'), /已存在/)
  await f.saveMcp('c', { command: 'new' }, 'a')
  const result = (await f.load('mcp')).mcpConfig.mcpServers
  assert.equal(result.a, undefined)
  assert.equal(result.c.disabled, true)
  assert.equal(result.b.command, 'other')
})
test('creating defaults never overwrites existing settings, MCP or rules', async (t) => {
  const f = await files(t)
  await f.saveSettings({ modelSelection: 'custom-model' })
  await f.saveMcp('fixture', { command: 'custom' })
  await f.saveRule('rules.md', 'custom-rules')
  await Promise.all([f.ensureSettings(), f.ensureMcp(), f.createRules(), f.createRules()])
  assert.equal((await f.load()).settings.modelSelection, 'custom-model')
  assert.equal((await f.load()).mcpConfig.mcpServers.fixture.command, 'custom')
  assert.equal(await f.readRule('rules.md'), 'custom-rules')
})
test('rule operations reject traversal, non-files and symlinks outside the directory', async (t) => {
  const f = await files(t)
  await f.ensureSteeringFolder()
  const outside = path.join(path.dirname(f.steeringPath), 'outside.md')
  await seed(outside, 'outside-untouched')
  await fsp.symlink(outside, path.join(f.steeringPath, 'linked.md'))
  for (const name of [
    '../../outside.md',
    '..\\outside.md',
    'C:outside.md',
    '/outside.md',
    'other.txt',
    'linked.md'
  ]) {
    await assert.rejects(f.readRule(name))
    await assert.rejects(f.saveRule(name, 'bad'))
    await assert.rejects(f.deleteRule(name))
    await assert.rejects(f.openRule(name))
  }
  assert.equal(await fsp.readFile(outside, 'utf8'), 'outside-untouched')
  await f.saveRule('valid.md', 'valid-content')
  assert.equal(await f.readRule('valid.md'), 'valid-content')
  await f.deleteRule('valid.md')
})
test('file failures leave original contents and release mutation queues', async (t) => {
  const f = await files(t)
  await seed(f.mcpPath, 'null')
  await assert.rejects(f.saveMcp('bad', { command: 'node' }))
  assert.equal(await fsp.readFile(f.mcpPath, 'utf8'), 'null')
  await seed(f.mcpPath, '{}')
  await f.saveMcp('ok', { command: 'node' })
  assert.equal((await f.load('mcp')).mcpConfig.mcpServers.ok.command, 'node')
  assert.equal(
    (await fsp.readdir(path.dirname(f.mcpPath))).some((file) => file.endsWith('.tmp')),
    false
  )
})
function modelLoader(getAccount, fetch, timeout = 1000) {
  return loader({ electron: {}, '../proxy/kiroApi': { fetchKiroModels: fetch } })(
    'src/main/ipc/kiroSettings.ts'
  ).createSettingsModelLoader(getAccount, fetch, timeout)
}
const model = { modelId: 'fixture', modelName: 'Fixture', description: 'Fixture model' }
test('model requests dedupe across remounts, cache results and retain explicit refresh', async () => {
  const pending = deferred()
  let calls = 0
  const load = modelLoader(
    () => ({ id: 'a', accessToken: 'fixture' }),
    async () => {
      calls++
      return pending.promise
    }
  )
  const jobs = Array.from({ length: 5 }, () => load())
  await tick()
  assert.equal(calls, 1)
  pending.resolve([model])
  await Promise.all(jobs)
  await load()
  assert.equal(calls, 1)
  await load(true)
  assert.equal(calls, 2)
})
test('model cache follows credential, proxy and account changes', async () => {
  let account = {
    id: 'a',
    accessToken: 'one',
    proxyUrl: 'http://proxy-one',
    machineId: 'device-one',
    provider: 'Google'
  }
  const received = []
  const load = modelLoader(
    () => account,
    async (input) => {
      received.push({ ...input })
      return [model]
    }
  )
  await load()
  account = { ...account, proxyUrl: 'http://proxy-two' }
  await load()
  account = { ...account, accessToken: 'two' }
  await load()
  assert.equal(received.length, 3)
  assert.equal(received[1].machineId, 'device-one')
  assert.equal(received[2].accessToken, 'two')
})
test('model timeout aborts shared work, releases the slot and ignores late results', async () => {
  const old = deferred()
  let calls = 0,
    signal
  const load = modelLoader(
    () => ({ id: 'a', accessToken: 'fixture' }),
    async (_input, s) => {
      calls++
      signal = s
      return calls === 1 ? old.promise : [model]
    },
    15
  )
  assert.match((await load()).error, /超时/)
  assert.equal(signal.aborted, true)
  assert.equal((await load()).models.length, 1)
  old.resolve([{ ...model, modelId: 'late' }])
  await tick()
  assert.equal((await load()).models[0].id, 'fixture')
})
test('file IPC surfaces shell failures and workspace selection cancellation', async () => {
  const handlers = new Map()
  let opened
  const electron = {
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    shell: {
      openPath: async (file) => {
        opened = file
        return 'fixture-shell-failed'
      }
    },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
  }
  class Files {
    async ensureSettings() {
      return '/fixture/settings.json'
    }
    async ensureMcp() {
      throw Error('cancelled dialog must not create files')
    }
  }
  loader({ electron, '../kiroSettings': { KiroConfigFiles: Files }, '../proxy/kiroApi': {} })(
    'src/main/ipc/kiroSettings.ts'
  ).registerKiroSettingsIPC(
    () => undefined,
    () => '/fixture/workspace'
  )
  const result = await handlers.get('open-kiro-settings-file')()
  assert.equal(opened, '/fixture/settings.json')
  assert.equal(result.success, false)
  assert.match(result.error, /shell/)
  assert.deepEqual(await handlers.get('open-kiro-mcp-config')(null, 'workspace'), {
    success: false,
    cancelled: true
  })
})
test('workspace MCP IPC uses the explicitly selected project directory', async () => {
  const handlers = new Map()
  let created
  class Files {
    async ensureMcp(file) {
      created = file
      return file
    }
  }
  loader({
    electron: {
      ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      shell: { openPath: async () => '' },
      dialog: {
        showOpenDialog: async () => ({ canceled: false, filePaths: ['/selected-project'] })
      }
    },
    '../kiroSettings': { KiroConfigFiles: Files },
    '../proxy/kiroApi': {}
  })('src/main/ipc/kiroSettings.ts').registerKiroSettingsIPC(
    () => undefined,
    () => '/different-project'
  )
  assert.equal((await handlers.get('open-kiro-mcp-config')(null, 'workspace')).success, true)
  assert.equal(created, path.join('/selected-project', '.kiro/settings/mcp.json'))
})
const bundle = (
  await build({
    stdin: {
      contents: `export * from './src/renderer/src/lib/configSync'; export { useAccountsStore } from './src/renderer/src/store/accounts'; export { useWebhookStore } from './src/renderer/src/store/webhooks'; export { REGISTRATION_PREFERENCE_KEYS } from './src/renderer/src/lib/registration';`,
      resolveDir: process.cwd()
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['zustand'],
    write: false
  })
).outputFiles[0].text
function storeHarness(seed = {}, failKey) {
  const data = new Map(Object.entries(seed)),
    writes = [],
    timers = new Map(),
    saves = []
  let timerId = 0
  const localStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem(key, value) {
      if (key === failKey) throw Error('fixture-QuotaExceeded')
      writes.push([key, value])
      data.set(key, value)
    },
    removeItem: (key) => data.delete(key)
  }
  const module = { exports: {} }
  new Function(
    'require',
    'module',
    'exports',
    'window',
    'document',
    'localStorage',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'console',
    bundle
  )(
    require,
    module,
    module.exports,
    {
      api: {
        accountSetProxyBindings: async () => ({}),
        saveAccounts: async (value) => {
          saves.push(value)
        },
        updateTrayLanguage: noop
      },
      addEventListener: noop,
      matchMedia: () => ({ matches: false })
    },
    { documentElement: { classList: { toggle: noop } } },
    localStorage,
    (fn) => {
      const id = ++timerId
      timers.set(id, fn)
      return id
    },
    (id) => timers.delete(id),
    () => 1,
    noop,
    quiet
  )
  module.exports.useAccountsStore.setState({ storageLoaded: true })
  return { ...module.exports, data, writes, saves, timers }
}
const config = (extra) => ({ app: 'kiro-account-manager', version: 1, ...extra })
const proxy = (i) => ({
  url: `http://192.0.2.1:${10000 + i}`,
  label: `proxy-${i}`,
  tags: ['fixture']
})
const hook = (i) => ({
  kind: 'custom',
  url: `https://fixture.test/${i}`,
  enabled: true,
  events: ['batch-completed'],
  label: 'fixture'
})
const allOptions = {
  proxyPool: true,
  webhooks: true,
  registerConfig: true,
  registerTemplates: true,
  registerSettings: true,
  appSettings: true,
  includeProxyCredentials: true
}
test('5000 proxy imports make one pool update and preserve labels, tags and dedupe behavior', async () => {
  const h = storeHarness()
  let changes = 0
  h.useAccountsStore.subscribe((s, prev) => {
    if (s.proxyPool !== prev.proxyPool) changes++
  })
  const result = await h.importPortableConfig(
    config({ proxyPool: Array.from({ length: 5000 }, (_, i) => proxy(i)) })
  )
  assert.equal(result.success, true)
  assert.equal(result.counts['代理池'], 5000)
  assert.equal(changes, 1)
  assert.equal(h.saves.length, 1)
  const entry = h.useAccountsStore.getState().proxyPool.values().next().value
  assert.equal(entry.label, 'proxy-0')
  assert.deepEqual(entry.tags, ['fixture'])
  const second = await h.importPortableConfig(config({ proxyPool: [proxy(0)] }))
  assert.equal(second.skipped['代理池'], 1)
  assert.equal(changes, 1)
})
test('1000 Webhook imports persist once and a second identical import produces no duplicates', async () => {
  const h = storeHarness()
  let changes = 0
  h.useWebhookStore.subscribe(() => changes++)
  const input = config({ webhooks: Array.from({ length: 1000 }, (_, i) => hook(i)) })
  assert.equal((await h.importPortableConfig(input)).counts.Webhook, 1000)
  assert.equal(changes, 1)
  assert.equal(h.writes.length, 1)
  assert.equal((await h.importPortableConfig(input)).skipped.Webhook, 1000)
  assert.equal(h.useWebhookStore.getState().webhooks.size, 1000)
  assert.equal(h.writes.length, 1)
  h.useWebhookStore.getState().addWebhook(hook(0))
  assert.equal(
    h.useWebhookStore.getState().webhooks.size,
    1001,
    'manual additions remain independent'
  )
})
test('dedupe ignores event order and retains intentionally different destination configurations', async () => {
  const h = storeHarness()
  const a = { ...hook(0), events: ['batch-completed', 'risk-warning'] }
  const b = { ...a, events: [...a.events].reverse() }
  const c = { ...a, label: 'intentional second configuration' }
  const result = await h.importPortableConfig(config({ webhooks: [a, b, c] }))
  assert.equal(result.counts.Webhook, 2)
  assert.equal(result.skipped.Webhook, 1)
})
test('invalid or unsupported input never partially imports earlier valid sections', async () => {
  for (const extra of [
    { webhooks: [null] },
    { version: 999 },
    { webhooks: [{ ...hook(0), events: undefined }] },
    { registerTemplates: [{ id: 'bad' }] },
    { registerLocalStorage: { 'kiro-register-schedule-time': '99:99' } }
  ]) {
    const h = storeHarness()
    const result = await h.importPortableConfig(config({ proxyPool: [proxy(0)], ...extra }))
    assert.equal(result.success, false)
    assert.equal(h.useAccountsStore.getState().proxyPool.size, 0)
    assert.equal(h.writes.length, 0)
  }
})
test('quota errors are reported and do not publish Webhooks or account changes', async () => {
  const h = storeHarness({ 'kiro-register-config': 'previous' }, 'kiro-webhooks')
  const result = await h.importPortableConfig(
    config({ proxyPool: [proxy(0)], registerConfig: { mode: 'manual' }, webhooks: [hook(0)] })
  )
  assert.equal(result.success, false)
  assert.match(result.error, /Quota/)
  assert.equal(h.data.get('kiro-register-config'), 'previous')
  assert.equal(h.useWebhookStore.getState().webhooks.size, 0)
  assert.equal(h.useAccountsStore.getState().proxyPool.size, 0)
})
test('registration preference export and import cover all live keys without runtime counters', async () => {
  const seed = {
    'kiro-register-schedule-week-mask': '2',
    'kiro-register-ratelimit-burst': '9',
    'kiro-register-backoff-base-sec': '7',
    'kiro-register-backoff-max-sec': '100',
    'kiro-register-autopause-risk': '1',
    'kiro-register-mixed-weights': '{"outlook":9}',
    'kiro-register-quota-2026-11-27': '99',
    'kiro-register-last-schedule': '2026-11-27'
  }
  const h = storeHarness(seed),
    exported = h.buildPortableConfig(allOptions)
  for (const key of h.REGISTRATION_PREFERENCE_KEYS)
    if (key in seed) assert.equal(exported.registerLocalStorage[key], seed[key])
  assert.equal(exported.registerLocalStorage['kiro-register-last-schedule'], undefined)
  const target = storeHarness()
  assert.equal((await target.importPortableConfig(exported)).success, true)
  assert.equal(target.data.get('kiro-register-schedule-week-mask'), '2')
  assert.equal(target.data.get('kiro-register-quota-2026-11-27'), undefined)
})
test('old masked proxies and plaintext v1 exports stay importable', async () => {
  const h = storeHarness()
  const result = await h.importPortableConfig(
    config({
      proxyPool: [
        {
          url: 'socks5://user:***@fixture.test:1080',
          host: 'fixture.test',
          port: 1080,
          protocol: 'socks5',
          label: 'old'
        }
      ]
    })
  )
  assert.equal(result.success, true)
  assert.equal(
    h.useAccountsStore.getState().proxyPool.values().next().value.url,
    'socks5://fixture.test:1080'
  )
})
test('full export retains registration and Webhook secrets and detects required encryption', async () => {
  const h = storeHarness({
    'kiro-register-config': JSON.stringify({
      mode: 'gptmail',
      gptMailPrivatePassword: 'fixture-password'
    }),
    'kiro-register-templates': JSON.stringify([
      { id: 't', name: 'Fixture', config: { mode: 'outlook', outlookData: 'fixture-refresh' } }
    ])
  })
  h.useWebhookStore.getState().addWebhook(hook(0))
  const exported = h.buildPortableConfig(allOptions)
  assert.equal(exported.registerConfig.gptMailPrivatePassword, 'fixture-password')
  assert.equal(exported.registerTemplates[0].config.outlookData, 'fixture-refresh')
  assert.equal(exported.webhooks[0].url, hook(0).url)
  assert.equal(h.containsConfigSecrets(exported), true)
})
test('public proxy export removes credentials and upstream authentication without mutating originals', () => {
  const h = storeHarness(),
    state = h.useAccountsStore.getState()
  const id = state.addProxy('http://fixture-user:fixture-secret@proxy.test:8080')
  state.setProxyPoolConfig({ upstreamProxy: 'socks5://u:p@upstream.test:1080' })
  const exported = h.buildPortableConfig({ ...allOptions, includeProxyCredentials: false })
  assert.equal(exported.proxyPool[0].url, 'http://proxy.test:8080')
  assert.equal(exported.proxyPoolConfig.upstreamProxy, 'socks5://upstream.test:1080')
  assert.equal(JSON.stringify(exported).includes('fixture-secret'), false)
  assert.equal(h.useAccountsStore.getState().proxyPool.get(id).password, 'fixture-secret')
  assert.equal(h.containsConfigSecrets(exported), false)
})
test('app scheduling values apply even without an enabled flag, and proxy config survives an empty pool', async () => {
  const h = storeHarness()
  const result = await h.importPortableConfig(
    config({
      proxyPoolConfig: { strategy: 'random' },
      appSettings: { autoRefreshInterval: 17, autoSwitchThreshold: 11 }
    })
  )
  assert.equal(result.success, true)
  assert.equal(h.useAccountsStore.getState().autoRefreshInterval, 17)
  assert.equal(h.useAccountsStore.getState().autoSwitchThreshold, 11)
  assert.equal(h.buildPortableConfig(allOptions).proxyPoolConfig.strategy, 'random')
})
test('KCFG1 Unicode roundtrip, wrong-password rejection and old ciphertext compatibility', async () => {
  const file = 'src/renderer/src/components/pages/ConfigSyncPage.tsx',
    text = fs.readFileSync(file, 'utf8')
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names = new Set(['deriveKey', 'b64encode', 'b64decode', 'encryptText', 'decryptText'])
  const code = ts.transpileModule(
    "const ENC_PREFIX='KCFG1:',PBKDF2_ITER=100_000;\n" +
      ast.statements
        .filter((n) => ts.isFunctionDeclaration(n) && names.has(n.name?.text))
        .map((n) => n.getText(ast))
        .join('\n') +
      '\nexports.encryptText=encryptText;exports.decryptText=decryptText;',
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }
  ).outputText
  const module = { exports: {} }
  new Function('exports', code)(module.exports)
  const { encryptText, decryptText } = module.exports
  const raw = '中文 fixture content\n'.repeat(5000),
    encrypted = await encryptText(raw, 'fixture')
  assert.match(encrypted, /^KCFG1:/)
  assert.equal(await decryptText(encrypted, 'fixture'), raw)
  await assert.rejects(decryptText(encrypted, 'wrong-password'))
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12))
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('fixture'),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  )
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode('old-format-fixture')
  )
  const old = `KCFG1:${Buffer.from(salt).toString('base64')}.${Buffer.from(iv).toString('base64')}.${Buffer.from(ciphertext).toString('base64')}`
  assert.equal(await decryptText(old, 'fixture'), 'old-format-fixture')
})

/* eslint @typescript-eslint/explicit-function-return-type: "off" -- Isolated OS and application lifecycle fixtures. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import ts from 'typescript'
import { build } from 'esbuild'
const require = createRequire(import.meta.url),
  noop = () => undefined
const quiet = { log: noop, warn: noop, error: noop }
const old = '11111111-1111-4111-8111-111111111111',
  fresh = '22222222-2222-4222-8222-222222222222'
const tick = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function loader(deps = {}, globals = {}) {
  const cache = new Map()
  function load(file) {
    file = path.resolve(file)
    if (cache.has(file)) return cache.get(file)
    const module = { exports: {} }
    cache.set(file, module.exports)
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true
      }
    }).outputText
    new Function('require', 'module', 'exports', 'console', ...Object.keys(globals), code)(
      (name) =>
        name in deps
          ? deps[name]
          : name.startsWith('.')
            ? load(path.resolve(path.dirname(file), name) + '.ts')
            : require(name),
      module,
      module.exports,
      quiet,
      ...Object.values(globals)
    )
    cache.set(file, module.exports)
    return module.exports
  }
  return load
}
function memoryFiles(initial = {}, denied = () => false) {
  const values = new Map(Object.entries(initial)),
    writes = []
  const error = (code) => Object.assign(new Error(code), { code })
  return {
    values,
    writes,
    api: {
      access: async (p) => {
        if (!values.has(p)) throw error('ENOENT')
      },
      readFile: async (p, encoding) => {
        if (!values.has(p)) throw error('ENOENT')
        const v = values.get(p)
        return encoding ? String(v) : Buffer.from(v)
      },
      writeFile: async (p, v) => {
        if (denied(p)) throw error('EACCES')
        values.set(p, String(v))
        writes.push(p)
      },
      mkdir: async () => {},
      stat: async () => ({ mode: 0o600 }),
      realpath: async (p) => p,
      rename: async (a, b) => {
        if (denied(b)) throw error('EACCES')
        values.set(b, values.get(a))
        values.delete(a)
      },
      unlink: async (p) => {
        if (!values.delete(p)) throw error('ENOENT')
      }
    }
  }
}
function osHarness(platform, options = {}) {
  const files = memoryFiles(options.files, options.denied),
    calls = [],
    children = []
  const execFile = () => {}
  execFile[util.promisify.custom] = async (file, args, opts) => {
    calls.push({ file, args, opts })
    if (options.run) return options.run(file, args, opts, files)
    throw Error('fixture-command-unavailable')
  }
  const p = {
    platform,
    env: { ProgramFiles: 'C:\\Programs', SystemRoot: 'C:\\Windows' },
    getuid: () => 1000,
    argv: [],
    pid: 123
  }
  const app = {
    getPath: (key) => (key === 'exe' ? '/fixture/app' : '/fixture/profile'),
    getVersion: () => 'fixture',
    getAppPath: () => '/fixture/project',
    exit: noop,
    setPath: noop
  }
  const load = loader(
    {
      'fs/promises': files.api,
      os: { homedir: () => '/fixture/home' },
      path: platform === 'win32' ? path.win32 : path,
      child_process: {
        execFile,
        execSync: () => {
          throw Error('sync command forbidden')
        },
        spawn: () => {
          const c = new EventEmitter()
          c.unref = noop
          children.push(c)
          return c
        }
      },
      electron: { app, dialog: { showMessageBox: async () => ({ response: 0 }) } }
    },
    { process: p }
  )
  return { api: load('src/main/machineId.ts'), load, calls, files, app, process: p, children }
}
const { normalizeMachineId } = loader()('src/shared/machineId.ts')
test('system IDs normalize UUID and 32hex only, rejecting arrays, zeros and API device IDs', () => {
  assert.equal(normalizeMachineId(fresh.toUpperCase()), fresh)
  assert.equal(normalizeMachineId(fresh.replaceAll('-', '')), fresh)
  for (const value of [[fresh], {}, null, '0'.repeat(32), 'a'.repeat(64), 'uninitialized'])
    assert.equal(normalizeMachineId(value), null)
})
test('Windows admin and tool discovery are async and shared across concurrent calls', async () => {
  const h = osHarness('win32', {
    files: { 'C:\\Programs\\PowerShell\\7\\pwsh.exe': '' },
    run: async () => ({ stdout: 'True\r\n' })
  })
  assert.deepEqual(
    await Promise.all(Array.from({ length: 10 }, () => h.api.checkAdminPrivilege())),
    Array(10).fill(true)
  )
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].opts.timeout, 5000)
})
test('Windows reads share in-flight work and never cache a stale system value permanently', async () => {
  let id = old
  const h = osHarness('win32', { run: async () => ({ stdout: `MachineGuid REG_SZ ${id}` }) })
  await Promise.all(Array.from({ length: 10 }, () => h.api.getCurrentMachineId()))
  assert.equal(h.calls.length, 1)
  id = fresh
  assert.equal((await h.api.getCurrentMachineId()).machineId, fresh)
  assert.equal(h.calls.length, 2)
})
test('Windows writes serialize and verify their actual registry target', async () => {
  const pending = deferred()
  let current = old,
    active = 0,
    peak = 0,
    adds = 0
  const h = osHarness('win32', {
    run: async (_file, args) => {
      if (args[0] === 'add') {
        adds++
        active++
        peak = Math.max(peak, active)
        if (adds === 1) await pending.promise
        current = args[args.indexOf('/d') + 1]
        active--
        return { stdout: '' }
      }
      return { stdout: `MachineGuid REG_SZ ${current}` }
    }
  })
  const a = h.api.setMachineId(fresh),
    b = h.api.setMachineId(old)
  await tick()
  assert.equal(adds, 1)
  pending.resolve()
  assert.equal((await a).success, true)
  assert.equal((await b).success, true)
  assert.equal(peak, 1)
  assert.equal(current, old)
})
test('a failed registry readback cannot be rescued by an unrelated hardware UUID', async () => {
  const h = osHarness('win32', {
    run: async (_file, args) => ({ stdout: args[0] === 'query' ? `MachineGuid REG_SZ ${old}` : '' })
  })
  assert.equal((await h.api.setMachineId(fresh)).success, false)
})
test('macOS Kiro write failure never publishes an app-only success', async () => {
  const target = '/fixture/home/Library/Application Support/Kiro/machineid'
  const h = osHarness('darwin', { files: { [target]: old }, denied: (p) => p.startsWith(target) })
  assert.equal((await h.api.setMachineId(fresh)).success, false)
  assert.equal(h.files.values.get(target), old)
  assert.equal(h.files.values.has('/fixture/profile/machine-id-override'), false)
})
test('macOS restores the Kiro destination if publishing the app override fails', async () => {
  const target = '/fixture/home/Library/Application Support/Kiro/machineid'
  const h = osHarness('darwin', {
    files: { [target]: old },
    denied: (p) => p.startsWith('/fixture/profile/machine-id-override')
  })
  assert.equal((await h.api.setMachineId(fresh)).success, false)
  assert.equal(h.files.values.get(target), old)
})
test('macOS writes and reads the same effective identity', async () => {
  const h = osHarness('darwin')
  assert.equal((await h.api.setMachineId(fresh)).success, true)
  assert.equal((await h.api.getCurrentMachineId()).machineId, fresh)
  assert.equal(
    [...h.files.values.keys()].some((p) => p.endsWith('.tmp')),
    false
  )
})
test('Linux denied primary cannot fall through to a false secondary success', async () => {
  const h = osHarness('linux', {
    files: {
      '/etc/machine-id': old.replaceAll('-', ''),
      '/var/lib/dbus/machine-id': old.replaceAll('-', '')
    },
    denied: (p) => p === '/etc/machine-id'
  })
  assert.equal((await h.api.setMachineId(fresh)).success, false)
  assert.equal(h.files.values.get('/var/lib/dbus/machine-id'), old.replaceAll('-', ''))
})
test('Linux secondary sync failure is a warning after a verified primary write', async () => {
  const h = osHarness('linux', {
    files: { '/etc/machine-id': old, '/var/lib/dbus/machine-id': old },
    denied: (p) => p === '/var/lib/dbus/machine-id'
  })
  const result = await h.api.setMachineId(fresh)
  assert.equal(result.success, true)
  assert.match(result.warning, /同步失败/)
  assert.equal((await h.api.getCurrentMachineId()).machineId, fresh)
})
test('Linux can use a genuine secondary-only source and skips invalid primary contents', async () => {
  const h = osHarness('linux', { files: { '/var/lib/dbus/machine-id': old.replaceAll('-', '') } })
  assert.equal((await h.api.setMachineId(fresh)).success, true)
  const corrupt = osHarness('linux', {
    files: { '/etc/machine-id': 'uninitialized', '/var/lib/dbus/machine-id': old }
  })
  assert.equal((await corrupt.api.getCurrentMachineId()).machineId, old)
})
test('cancelled Linux authorization stops without writing another file', async () => {
  const h = osHarness('linux', {
    files: { '/etc/machine-id': old, '/var/lib/dbus/machine-id': old },
    denied: (p) => p === '/etc/machine-id',
    run: async (file) => {
      if (file === 'which') return { stdout: '/bin/pkexec' }
      throw Error('Not authorized: dismissed')
    }
  })
  const result = await h.api.setMachineId(fresh)
  assert.equal(result.cancelled, true)
  assert.equal(h.files.writes.length, 0)
})
test('machine backup keeps the existing JSON format and validates imported value types', async () => {
  const h = osHarness('darwin')
  assert.equal(await h.api.backupMachineIdToFile(fresh, '/fixture/backup.json'), true)
  const data = JSON.parse(h.files.values.get('/fixture/backup.json'))
  assert.equal(data.machineId, fresh)
  assert.equal(data.osType, 'macos')
  assert.equal(data.appVersion, 'fixture')
  assert.equal((await h.api.restoreMachineIdFromFile('/fixture/backup.json')).machineId, fresh)
  h.files.values.set('/fixture/backup.json', JSON.stringify({ machineId: [fresh] }))
  assert.equal((await h.api.restoreMachineIdFromFile('/fixture/backup.json')).success, false)
})
test('authorized restart waits for helper acknowledgement before cleanup and exit', async () => {
  const h = osHarness('win32', {
    run: async (_file, args, _opts, files) => {
      const command = args.at(-1),
        encoded = command.match(/EncodedCommand ([A-Za-z0-9+/=]+)/)[1]
      const helper = Buffer.from(encoded, 'base64').toString('utf16le')
      assert.match(helper, /Get-Process -Id 123/)
      assert.match(helper, /:exit/)
      const [marker, value] = [...files.values].find(([key]) => key.includes('machine-id-restart-'))
      files.values.set(marker, value.replace(':pending', ':ready'))
      return { stdout: '' }
    }
  })
  h.files.values.set('/fixture/app', 'fixture')
  const events = []
  h.app.exit = () => events.push('exit')
  const restart = h.load('src/main/machineIdRestart.ts')
  restart.configureAdminRestart(
    async () => events.push('save'),
    () => events.push('finish')
  )
  assert.equal(await restart.requestAdminRestart('powershell.exe'), true)
  assert.deepEqual(events, ['save', 'finish', 'exit'])
})
test('denied elevation and failed cleanup never quit the running app', async () => {
  for (const denied of [true, false]) {
    const h = osHarness('win32', {
      run: async (_file, _args, _opts, files) => {
        if (denied) throw Error('fixture-UAC-denied')
        const [marker, value] = [...files.values].find(([key]) =>
          key.includes('machine-id-restart-')
        )
        files.values.set(marker, value.replace(':pending', ':ready'))
        return { stdout: '' }
      }
    })
    h.files.values.set('/fixture/app', 'fixture')
    let exits = 0
    h.app.exit = () => exits++
    const restart = h.load('src/main/machineIdRestart.ts')
    restart.configureAdminRestart(async () => {
      throw Error('fixture-save-failed')
    })
    assert.equal(await restart.requestAdminRestart('powershell.exe'), false)
    assert.equal(exits, 0)
  }
})
function shortcutHarness(fail = '', persistFails = false) {
  const registered = new Set(),
    saved = []
  const { WindowShortcut } = loader({
    electron: {
      globalShortcut: {
        register: (value) => value !== fail && (registered.add(value), true),
        unregister: (value) => registered.delete(value)
      }
    }
  })('src/main/windowShortcut.ts')
  const controller = new WindowShortcut(noop, async (value) => {
    if (persistFails) throw Error('fixture disk failure')
    saved.push(value)
  })
  controller.start('Ctrl+K')
  return { controller, registered, saved }
}
test('shortcut collision preserves the working old binding and reports failure', async () => {
  const h = shortcutHarness('Ctrl+X')
  assert.equal((await h.controller.set('Ctrl+X')).success, false)
  assert.equal(h.controller.value, 'Ctrl+K')
  assert.equal(h.registered.has('Ctrl+K'), true)
})
test('shortcut persistence failure rolls back the new registration', async () => {
  const h = shortcutHarness('', true)
  assert.equal((await h.controller.set('Ctrl+X')).success, false)
  assert.deepEqual([...h.registered], ['Ctrl+K'])
})
test('cleared and rapidly changed shortcuts persist their confirmed state in order', async () => {
  const h = shortcutHarness()
  await Promise.all([h.controller.set('Ctrl+X'), h.controller.set('Ctrl+Y')])
  assert.deepEqual([...h.registered], ['Ctrl+Y'])
  await h.controller.set('')
  assert.equal(h.controller.value, '')
  h.controller.start('')
  assert.equal(h.registered.size, 0)
  assert.deepEqual(h.saved, ['Ctrl+X', 'Ctrl+Y', ''])
})
function quitHarness(options = {}) {
  const handlers = new Map(),
    events = [],
    sender = {
      mainFrame: {},
      getURL: () => 'file://fixture',
      isDestroyed: () => false,
      send: (channel, token) => events.push({ channel, token })
    }
  const { AppQuitCoordinator } = loader({
    electron: { ipcMain: { handle: (name, fn) => handlers.set(name, fn) } }
  })('src/main/quit.ts')
  const q = new AppQuitCoordinator(
    () => (options.noWindow ? null : { isDestroyed: () => false, webContents: sender }),
    options.cleanup || (async () => events.push('cleanup')),
    () => events.push('exit'),
    (error) => events.push(String(error))
  )
  const ack = (token, error, source = sender) =>
    handlers.get('app-quit:ready')({ sender: source, senderFrame: source.mainFrame }, token, error)
  return { q, events, sender, ack }
}
test('concurrent quit requests wait for the renderer, clean once, and exit once', async () => {
  const h = quitHarness()
  const jobs = [h.q.request(), h.q.request(), h.q.request()]
  await tick()
  assert.equal(h.events.length, 1)
  const { token } = h.events[0]
  h.ack(token, undefined, { mainFrame: {} })
  await tick()
  assert.equal(h.events.length, 1)
  h.ack(token)
  await Promise.all(jobs)
  assert.deepEqual(h.events.slice(1), ['cleanup', 'exit'])
})
test('failed renderer save retains the running app and a later retry can quit', async () => {
  const h = quitHarness()
  const first = h.q.request()
  await tick()
  h.ack(h.events[0].token, 'fixture-save-failed')
  await first
  assert.equal(h.events.includes('exit'), false)
  const again = h.q.request()
  await tick()
  h.ack(h.events.findLast((v) => v?.token).token)
  await again
  assert.equal(h.events.includes('exit'), true)
})
test('quitting without an existing renderer still flushes main-process resources', async () => {
  const h = quitHarness({ noWindow: true })
  await h.q.request()
  assert.deepEqual(h.events, ['cleanup', 'exit'])
})
const code = (
  await build({
    entryPoints: ['src/renderer/src/store/accounts.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['zustand'],
    write: false
  })
).outputFiles[0].text
const account = (id) => ({
  id,
  email: `${id}@fixture.test`,
  status: 'active',
  machineId: 'a'.repeat(64),
  credentials: {
    authMethod: 'social',
    provider: 'Google',
    accessToken: 'fixture',
    refreshToken: 'fixture'
  },
  usage: { current: 0, limit: 100 },
  subscription: { type: 'Free' },
  tags: []
})
function storeHarness(overrides = {}) {
  const snapshots = [],
    writes = [],
    module = { exports: {} }
  let timer = 0
  const api = {
    getAppVersion: async () => 'fixture',
    getLocalActiveAccount: async () => ({ success: false }),
    machineIdGetCurrent: async () => ({ success: true, machineId: old }),
    machineIdSet: async (id) => {
      writes.push(id)
      return { success: true, machineId: id }
    },
    saveAccounts: async (value) => snapshots.push(structuredClone(value)),
    ...overrides
  }
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
    code
  )(
    require,
    module,
    module.exports,
    { api, addEventListener: noop, matchMedia: () => ({ matches: false }) },
    { documentElement: { classList: { toggle: noop } } },
    { getItem: () => null, setItem: noop },
    () => ++timer,
    noop,
    () => ++timer,
    noop,
    quiet
  )
  module.exports.useAccountsStore.setState({ storageLoaded: true })
  return { store: module.exports.useAccountsStore, snapshots, writes, api }
}
test('the first change durably backs up the real old ID before any OS write', async () => {
  const h = storeHarness()
  h.api.machineIdSet = async (id) => {
    assert.equal(h.snapshots.at(-1).originalMachineId, old)
    return { success: true, machineId: id }
  }
  assert.equal(await h.store.getState().changeMachineId(fresh), true)
  assert.equal(h.store.getState().originalMachineId, old)
  assert.deepEqual(
    h.store.getState().machineIdHistory.map((x) => x.action),
    ['initial', 'manual']
  )
})
test('an original-read or backup-save failure prevents a destructive OS write', async () => {
  for (const overrides of [
    { machineIdGetCurrent: async () => ({ success: false, error: 'fixture-read-failed' }) },
    {
      saveAccounts: async () => {
        throw Error('fixture-save-failed')
      }
    }
  ]) {
    const h = storeHarness(overrides)
    assert.equal(await h.store.getState().changeMachineId(fresh), false)
    assert.equal(h.writes.length, 0)
  }
})
test('original ID and timestamp survive restart and remain distinct from the new current value', async () => {
  const h = storeHarness()
  await h.store.getState().changeMachineId(fresh)
  const saved = h.snapshots.at(-1)
  const next = storeHarness({
    loadAccounts: async () => saved,
    machineIdGetCurrent: async () => ({ success: true, machineId: fresh })
  })
  await next.store.getState().loadFromStorage()
  await next.store.getState().refreshCurrentMachineId()
  assert.equal(next.store.getState().originalMachineId, old)
  assert.equal(next.store.getState().originalBackupTime, saved.originalBackupTime)
})
test('legacy initial history can restore the missing original without deleting records', async () => {
  const history = [
    { id: 'initial', action: 'initial', machineId: old, timestamp: 100 },
    { id: 'manual', action: 'manual', machineId: fresh, timestamp: 200 }
  ]
  const h = storeHarness({
    loadAccounts: async () => ({ accounts: {}, machineIdHistory: history })
  })
  await h.store.getState().loadFromStorage()
  assert.equal(h.store.getState().originalMachineId, old)
  assert.equal(h.store.getState().machineIdHistory.length, 2)
})
test('failed automatic changes create no success record; successful ones create exactly one', async () => {
  for (const success of [false, true]) {
    const h = storeHarness({
      machineIdSet: async (id) => ({ success, machineId: id, error: 'fixture-write-failed' })
    })
    h.store.setState({
      accounts: new Map([['a', account('a')]]),
      originalMachineId: old,
      machineIdConfig: {
        autoSwitchOnAccountChange: true,
        bindMachineIdToAccount: false,
        useBindedMachineId: true
      }
    })
    await h.store.getState().setActiveAccount('a')
    assert.deepEqual(
      h.store.getState().machineIdHistory.map((x) => x.action),
      success ? ['auto_switch'] : []
    )
  }
})
test('late reads cannot replace a completed newer change', async () => {
  const pending = deferred()
  const h = storeHarness({ machineIdGetCurrent: () => pending.promise })
  h.store.setState({ originalMachineId: old, currentMachineId: old })
  const read = h.store.getState().refreshCurrentMachineId()
  await tick()
  assert.equal(await h.store.getState().changeMachineId(fresh), true)
  pending.resolve({ success: true, machineId: old })
  await read
  assert.equal(h.store.getState().currentMachineId, fresh)
})
test('manual change and restore share one renderer mutation queue', async () => {
  const pending = deferred()
  const h = storeHarness()
  h.store.setState({ originalMachineId: old })
  h.api.machineIdSet = async (id) => {
    h.writes.push(id)
    if (h.writes.length === 1) await pending.promise
    return { success: true, machineId: id }
  }
  const a = h.store.getState().changeMachineId(fresh),
    b = h.store.getState().restoreOriginalMachineId()
  await tick()
  assert.deepEqual(h.writes, [fresh])
  pending.resolve()
  await Promise.all([a, b])
  assert.deepEqual(h.writes, [fresh, old])
})
test('binding validation and account removal preserve API IDs and historical snapshots', () => {
  const h = storeHarness()
  h.store.setState({
    accounts: new Map([
      ['a', account('a')],
      ['b', account('b')]
    ])
  })
  assert.equal(h.store.getState().bindMachineIdToAccount('a', 'invalid'), false)
  h.store.getState().bindMachineIdToAccount('a', fresh)
  h.store.getState().bindMachineIdToAccount('b', old)
  assert.equal(h.store.getState().accounts.get('a').machineId, 'a'.repeat(64))
  h.store.getState().removeAccount('a')
  h.store.getState().removeAccounts(['b'])
  assert.deepEqual(h.store.getState().accountMachineIds, {})
  assert.equal(h.store.getState().machineIdHistory.length, 2)
})
test('primary-write warnings are preserved separately from success or failure', async () => {
  const h = storeHarness({
    machineIdSet: async (id) => ({
      success: true,
      machineId: id,
      warning: 'fixture-secondary-failed'
    })
  })
  h.store.setState({ originalMachineId: old })
  assert.equal(await h.store.getState().changeMachineId(fresh), true)
  assert.equal(h.store.getState().machineIdWarning, 'fixture-secondary-failed')
  assert.equal(h.store.getState().machineIdError, null)
})
function extractVariable(file, name) {
  const source = fs.readFileSync(file, 'utf8'),
    ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let initializer
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name)
      initializer = node.initializer
    node.forEachChild(visit)
  }
  visit(ast)
  return { initializer, ast }
}
function callback(file, name, globals) {
  const { initializer, ast } = extractVariable(file, name)
  const code = ts.transpileModule(`exports.callback=${initializer.arguments[0].getText(ast)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const module = { exports: {} }
  new Function('exports', ...Object.keys(globals), code)(module.exports, ...Object.values(globals))
  return module.exports.callback
}
test('tray account switching uses the full credential switch with the latest eligible account', async () => {
  let selected
  const state = {
    accounts: new Map([
      ['a', account('a')],
      ['missing', { ...account('missing'), credentials: {} }],
      ['b', account('b')]
    ]),
    activeAccountId: 'a',
    switchAccount: async (id) => {
      selected = id
      return { success: true }
    }
  }
  await callback('src/renderer/src/App.tsx', 'switchToNextAccount', {
    useAccountsStore: { getState: () => state },
    alert: noop
  })()
  assert.equal(selected, 'b')
})
test('continuous account updates publish tray snapshots within the maximum wait', () => {
  const timers = new Map()
  let now = 0,
    id = 0,
    snapshots = 0
  const clearTimeout = (key) => timers.delete(key),
    advance = (time) => {
      now = time
      for (const [key, value] of [...timers])
        if (value.at <= now) {
          timers.delete(key)
          value.fn()
        }
    }
  const publish = callback('src/renderer/src/App.tsx', 'updateTrayInfo', {
    trayDebounceRef: { current: null },
    trayMaxWaitRef: { current: null },
    TRAY_UPDATE_DEBOUNCE_MS: 400,
    setTimeout: (fn, ms) => {
      timers.set(++id, { fn, at: now + ms })
      return id
    },
    clearTimeout,
    useAccountsStore: { getState: () => ({ accounts: new Map(), activeAccountId: null }) },
    window: { api: { updateTrayAccountList: () => snapshots++, updateTrayAccount: noop } }
  })
  for (let n = 0; n < 20; n++) {
    advance(n * 100)
    publish()
  }
  assert.ok(snapshots >= 1)
  advance(2500)
  assert.ok(snapshots >= 2)
})
test('paired tray updates rebuild once and pending work is cancelled when destroyed', () => {
  const timers = new Map()
  let id = 0,
    builds = 0,
    menus = 0
  const icon = {
      resize() {
        return this
      },
      setTemplateImage: noop
    },
    tray = { setContextMenu: () => menus++, setToolTip: noop, on: noop, destroy: noop }
  const api = loader(
    {
      electron: {
        Tray: function () {
          return tray
        },
        Menu: {
          buildFromTemplate: (x) => {
            builds++
            return x
          }
        },
        nativeImage: { createFromPath: () => icon, createEmpty: () => icon },
        app: { getVersion: () => 'fixture', isPackaged: false }
      }
    },
    {
      process: { platform: 'darwin' },
      __dirname: '/fixture/main',
      setTimeout: (fn) => {
        timers.set(++id, fn)
        return id
      },
      clearTimeout: (key) => timers.delete(key)
    }
  )('src/main/tray.ts')
  api.createTray({
    getProxyStatus: () => ({ running: false, port: 1 }),
    getProxyStats: () => ({}),
    getSessionStats: () => ({}),
    getUpdateState: () => null
  })
  const initial = builds
  api.updateAccountList([])
  api.updateCurrentAccount(null)
  assert.equal(timers.size, 1)
  for (const fn of timers.values()) fn()
  timers.clear()
  assert.equal(builds - initial, 1)
  api.updateTrayMenu()
  api.destroyTray()
  assert.equal(timers.size, 0)
  assert.equal(menus, 2)
})
test('file backup IPC distinguishes dialog cancellation from a failed export', async () => {
  const handlers = new Map()
  const machine = {
    getOSType: () => 'macos',
    getCurrentMachineId: async () => ({}),
    setMachineId: async () => ({}),
    generateRandomMachineId: () => fresh,
    checkAdminPrivilege: async () => true,
    backupMachineIdToFile: async () => false
  }
  const dialog = { showSaveDialog: async () => ({ canceled: true }) }
  loader({
    electron: { ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, dialog },
    '../machineId': machine
  })('src/main/ipc/machineId.ts').registerMachineIdIPC(() => null)
  assert.equal((await handlers.get('machine-id:backup-to-file')(null, fresh)).cancelled, true)
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: '/fixture/export.json' })
  const result = await handlers.get('machine-id:backup-to-file')(null, fresh)
  assert.equal(result.success, false)
  assert.match(result.error, /失败/)
})

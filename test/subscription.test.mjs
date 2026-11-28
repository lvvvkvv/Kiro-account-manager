/* eslint @typescript-eslint/explicit-function-return-type: "off" -- Isolated subscription and delivery regression fixtures. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import ts from 'typescript'
import { build } from 'esbuild'
const require = createRequire(import.meta.url)
const { create } = require('zustand')
const noop = () => undefined
const quiet = { log: noop, warn: noop, error: noop, info: noop }
const tick = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function loader(dependencies = {}, globals = {}) {
  const cache = new Map()
  globals = {
    console: quiet,
    fetch: async () => {
      throw new Error('Unexpected external fetch')
    },
    ...globals
  }
  function load(file, extra = '') {
    file = path.resolve(file)
    if (cache.has(file)) return cache.get(file)
    const module = { exports: {} }
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8') + '\n' + extra, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true
      }
    }).outputText
    new Function('require', 'module', 'exports', ...Object.keys(globals), code)(
      (name) =>
        name in dependencies
          ? dependencies[name]
          : name.startsWith('.')
            ? load(path.resolve(path.dirname(file), name) + '.ts')
            : require(name),
      module,
      module.exports,
      ...Object.values(globals)
    )
    cache.set(file, module.exports)
    return module.exports
  }
  return load
}
const bundle = (
  await build({
    entryPoints: ['src/renderer/src/subscription/runtime.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    external: ['zustand'],
    alias: { '@': process.cwd() + '/src/renderer/src' },
    plugins: [
      {
        name: 'stores',
        setup(b) {
          b.onResolve({ filter: /^@\/store\/(accounts|tasks)$/ }, ({ path }) => ({
            path,
            namespace: 'stores'
          }))
          b.onLoad({ filter: /.*/, namespace: 'stores' }, ({ path }) => ({
            contents: path.endsWith('accounts')
              ? 'export const useAccountsStore=window.accounts;'
              : 'export const useTaskStore=window.tasks;',
            loader: 'js'
          }))
        }
      }
    ]
  })
).outputFiles[0].text
function account(id, extra = {}) {
  return {
    id,
    email: id + '@example.test',
    status: 'active',
    credentials: { accessToken: 'fixture', provider: 'BuilderId' },
    subscription: { type: 'Free', title: 'Free' },
    usage: { current: 10, limit: 100, resourceDetail: { overageEnabled: false } },
    ...extra
  }
}
function harness(list = [account('A'), account('B')], api = {}) {
  const stats = { saves: 0, cancels: [] }
  const accounts = create(() => ({
    accounts: new Map(list.map((a) => [a.id, a])),
    saveToStorage: async () => {
      stats.saves++
    }
  }))
  const tasks = loader()('src/renderer/src/store/tasks.ts').useTaskStore
  const window = {
    accounts,
    tasks,
    api: {
      subscriptionCancel: async (id) => {
        stats.cancels.push(id)
      },
      accountGetSubscriptionUrl: async (...args) => ({
        success: true,
        url: 'https://fixture.test/' + args[7]
      }),
      accountSetOverage: async () => ({ success: true }),
      diagnoseHttpProbe: async () => ({ success: true, status: 200 }),
      openSubscriptionWindow: async () => ({ success: true }),
      ...api
    }
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'window', bundle)(
    require,
    module,
    module.exports,
    window
  )
  return {
    runtime: module.exports,
    state: () => module.exports.useSubscriptionStore.getState(),
    accounts,
    tasks,
    stats,
    window
  }
}

test('1000 link results publish bounded snapshots and execute at most 100 workers', async () => {
  let active = 0,
    peak = 0,
    calls = 0
  const h = harness(
    Array.from({ length: 1000 }, (_, i) => account('a' + i)),
    {
      accountGetSubscriptionUrl: async (...args) => {
        calls++
        active++
        peak = Math.max(peak, active)
        await tick()
        active--
        return { success: true, url: 'https://fixture.test/' + args[7] }
      }
    }
  )
  let snapshots = 0,
    last
  h.runtime.useSubscriptionStore.subscribe((state) => {
    if (state.links !== last) {
      snapshots++
      last = state.links
    }
  })
  await h.runtime.fetchSubscriptionLinks(
    [...h.accounts.getState().accounts.values()],
    'PRO',
    1000,
    'fixture'
  )
  assert.equal(calls, 1000)
  assert.equal(peak, 100)
  assert.equal(h.state().links.filter((l) => l.status === 'success').length, 1000)
  assert.ok(snapshots < 30, `Unexpected list publication count: ${snapshots}`)
})

test('deleting A during a batch never attaches its URL to B', async () => {
  const gate = deferred()
  let calls = 0
  const h = harness(undefined, {
    accountGetSubscriptionUrl: async (...args) =>
      ++calls === 1 ? gate.promise : { success: true, url: 'https://fixture.test/' + args[7] }
  })
  const work = h.runtime.fetchSubscriptionLinks(
    [...h.accounts.getState().accounts.values()],
    'PRO',
    1,
    'fixture'
  )
  await tick()
  h.runtime.setSubscriptionLinks((current) => current.filter((l) => l.accountId !== 'A'))
  gate.resolve({ success: true, url: 'https://fixture.test/A' })
  await work
  assert.deepEqual(
    h.state().links.map((l) => [l.accountId, l.url]),
    [['B', 'https://fixture.test/B']]
  )
})

test('running jobs remain locked across subscribers and task cancellation stops queued requests', async () => {
  let calls = 0
  const h = harness(
    Array.from({ length: 20 }, (_, i) => account('a' + i)),
    {
      accountGetSubscriptionUrl: () => {
        calls++
        return new Promise(() => {})
      }
    }
  )
  const input = [...h.accounts.getState().accounts.values()]
  const work = h.runtime.fetchSubscriptionLinks(input, 'PRO', 2, 'fixture')
  await tick()
  assert.equal(h.state().isFetching, true)
  assert.equal(await h.runtime.fetchSubscriptionLinks(input, 'PRO', 2, 'duplicate'), false)
  h.tasks.getState().cancelTask([...h.tasks.getState().tasks.keys()][0])
  await work
  assert.equal(calls, 2)
  assert.equal(h.state().isFetching, false)
  assert.ok(h.stats.cancels.length)
  assert.equal([...h.tasks.getState().tasks.values()][0].status, 'cancelled')
})

test('external registration rows and newer versions survive a finishing batch', async () => {
  const gate = deferred(),
    h = harness([account('A')], { accountGetSubscriptionUrl: () => gate.promise })
  const work = h.runtime.fetchSubscriptionLinks(
    [...h.accounts.getState().accounts.values()],
    'PRO',
    1,
    'fixture'
  )
  await tick()
  h.runtime.appendSubscriptionLink({
    accountId: 'external',
    email: 'external@example.test',
    status: 'pending'
  })
  h.runtime.updateSubscriptionLink('A', {
    status: 'success',
    url: 'https://fixture.test/newer',
    generatedAt: 123
  })
  gate.resolve({ success: true, url: 'https://fixture.test/older' })
  await work
  assert.equal(h.state().links.find((l) => l.accountId === 'external').status, 'pending')
  assert.equal(h.state().links.find((l) => l.accountId === 'A').url, 'https://fixture.test/newer')
})

test('validation merges current rows and ignores a concurrently regenerated URL', async () => {
  const gate = deferred(),
    h = harness(undefined, { diagnoseHttpProbe: () => gate.promise })
  h.runtime.setSubscriptionLinks([
    {
      accountId: 'A',
      email: 'A',
      status: 'success',
      url: 'https://fixture.test/A',
      generatedAt: Date.now()
    }
  ])
  const work = h.runtime.validateSubscriptionLinks(1, 'fixture')
  h.runtime.importSubscriptionLinks('B@example.test----https://fixture.test/B', false)
  h.runtime.updateSubscriptionLink('A', {
    url: 'https://fixture.test/new',
    generatedAt: Date.now() + 1
  })
  gate.resolve({ success: false, status: 410 })
  await work
  assert.equal(h.state().links.length, 2)
  assert.equal(h.state().links.find((l) => l.accountId === 'A').status, 'success')
  assert.equal(h.state().links.find((l) => l.accountId !== 'A').email, 'B@example.test')
})

test('unsupported HEAD and estimated age do not turn healthy accounts into expired-link cleanup targets', async () => {
  const h = harness(undefined, { diagnoseHttpProbe: async () => ({ success: false, status: 405 }) })
  h.runtime.setSubscriptionLinks([
    {
      accountId: 'A',
      email: 'A',
      status: 'success',
      url: 'https://fixture.test/A',
      generatedAt: Date.now()
    },
    {
      accountId: 'B',
      email: 'B',
      status: 'success',
      url: 'https://fixture.test/B',
      generatedAt: Date.now() - 3600000
    }
  ])
  await h.runtime.validateSubscriptionLinks(2, 'fixture')
  assert.deepEqual(
    h.state().links.map((l) => [l.status, l.validation]),
    [
      ['success', 'unknown'],
      ['success', 'stale']
    ]
  )
  h.window.api.diagnoseHttpProbe = async () => ({ success: false, status: 410 })
  await h.runtime.validateSubscriptionLinks(2, 'fixture')
  assert.equal(h.state().links[0].status, 'expired')
})

test('overage changes merge current usage and publish one account mutation for a fast batch', async () => {
  const gate = deferred(),
    h = harness([account('A'), account('B')], { accountSetOverage: () => gate.promise })
  const work = h.runtime.setAccountOverages(
    [...h.accounts.getState().accounts.values()],
    true,
    2,
    'fixture'
  )
  await tick()
  h.accounts.setState((state) => {
    const accounts = new Map(state.accounts)
    const a = accounts.get('A')
    accounts.set('A', { ...a, usage: { ...a.usage, current: 99 } })
    accounts.delete('B')
    return { accounts }
  })
  gate.resolve({ success: true })
  await work
  assert.equal(h.accounts.getState().accounts.get('A').usage.current, 99)
  assert.equal(h.accounts.getState().accounts.get('A').usage.resourceDetail.overageEnabled, true)
  assert.equal(h.accounts.getState().accounts.has('B'), false)
  assert.equal(h.stats.saves, 1)
})

test('cancelled overage work cannot apply late responses or start conflicting operations', async () => {
  const gate = deferred(),
    h = harness([account('A')], { accountSetOverage: () => gate.promise })
  const work = h.runtime.setAccountOverages(
    [...h.accounts.getState().accounts.values()],
    true,
    1,
    'fixture'
  )
  await tick()
  assert.equal(
    await h.runtime.setAccountOverages(
      [...h.accounts.getState().accounts.values()],
      false,
      1,
      'conflict'
    ),
    false
  )
  h.runtime.cancelSubscriptionOperation('overage')
  await work
  gate.resolve({ success: true })
  await tick()
  assert.equal(h.accounts.getState().accounts.get('A').usage.resourceDetail.overageEnabled, false)
})

test('preflight targets and actual requests agree, and plan selection excludes PLUS by default', async () => {
  const input = [
    account('banned', { status: 'error', lastError: 'suspended' }),
    account('blocked', { subscription: { type: 'Free', upgradeCapability: 'NOT_UPGRADABLE' } }),
    account('valid')
  ]
  const calls = [],
    h = harness(input, {
      accountGetSubscriptions: async (...args) => {
        calls.push(args[6])
        return {
          success: true,
          plans: [{ qSubscriptionType: 'PRO_PLUS' }, { qSubscriptionType: 'PRO' }]
        }
      }
    })
  await h.runtime.loadSubscriptionPlans(input, 'fixture')
  assert.deepEqual(calls, ['valid'])
  assert.equal(h.state().selectedPlanType, 'PRO')
  await h.runtime.fetchSubscriptionLinks(input, 'PRO', 5, 'fixture')
  assert.deepEqual(
    h.state().links.map((l) => l.accountId),
    ['valid']
  )
})

test('link import retains URL characters, handles documented separators and deduplicates URLs', () => {
  const { parseImportedLinks } = loader()('src/renderer/src/subscription/helpers.ts')
  const url = 'https://fixture.test/a(b)?x=%22&y=1'
  assert.deepEqual(parseImportedLinks('A@example.test----' + url), [
    { email: 'A@example.test', url }
  ])
  const h = harness()
  assert.equal(h.runtime.importSubscriptionLinks('A@example.test----' + url + '\n' + url, false), 1)
  assert.equal(h.state().links[0].url, url)
})

function ipcHarness(fetcher, globals = {}) {
  const handlers = {},
    load = loader(
      {
        electron: {
          ipcMain: {
            handle: (name, fn) => {
              handlers[name] = fn
            }
          }
        }
      },
      globals
    )
  load('src/main/ipc/webhooks.ts').registerWebhookIPC(fetcher)
  const send = (id = 'fixture', url = 'https://fixture.test/webhook', kind = 'custom') =>
    handlers['webhook-send'](null, { id, url, kind, body: '{"text":"fixture"}' })
  return { handlers, send }
}
const fastTimers = {
  setTimeout: (fn, ms, ...args) =>
    setTimeout(fn, [1500, 3000, 6000].includes(ms) ? 0 : ms === 8000 ? 10 : ms, ...args)
}

test('webhook HTTP failures, exhausted retries and provider errors report failure', async () => {
  let calls = 0
  let h = ipcHarness(async () => {
    calls++
    return new Response('', { status: 400 })
  }, fastTimers)
  assert.equal((await h.send()).success, false)
  assert.equal(calls, 1)
  calls = 0
  h = ipcHarness(async () => {
    calls++
    throw new Error('network failure')
  }, fastTimers)
  assert.equal((await h.send()).success, false)
  assert.equal(calls, 4)
  h = ipcHarness(async () => new Response('{"ok":false,"description":"rejected"}'), fastTimers)
  assert.deepEqual(await h.send('fixture', 'https://fixture.test', 'telegram'), {
    success: false,
    error: 'rejected'
  })
})

test('webhook deadlines stop a stalled request and clear request timers', async () => {
  let calls = 0
  const watchdogs = new Set()
  const globals = {
    setTimeout: (fn, ms) => {
      let timer
      timer = setTimeout(
        () => {
          watchdogs.delete(timer)
          fn()
        },
        ms === 8000 ? 5 : [1500, 3000, 6000].includes(ms) ? 0 : ms
      )
      if (ms === 8000) watchdogs.add(timer)
      return timer
    },
    clearTimeout: (timer) => {
      watchdogs.delete(timer)
      clearTimeout(timer)
    }
  }
  const h = ipcHarness(async () => {
    calls++
    return new Promise(() => {})
  }, globals)
  assert.equal((await h.send()).success, false)
  assert.equal(calls, 4)
  assert.equal(watchdogs.size, 0)
})

test('webhook destinations serialize attempts and include retries in the minute budget', async () => {
  let active = 0,
    peak = 0,
    calls = 0
  const h = ipcHarness(async () => {
    calls++
    active++
    peak = Math.max(peak, active)
    await tick()
    active--
    return new Response('{}')
  }, fastTimers)
  const work = Array.from({ length: 20 }, (_, i) => h.send('id' + i))
  const dropped = await h.send('extra')
  assert.equal(dropped.success, false)
  assert.equal(dropped.rateLimited, true)
  assert.ok((await Promise.all(work)).every((r) => r.success))
  assert.equal(peak, 1)
  assert.equal(calls, 20)
  assert.equal((await h.send('after-budget')).rateLimited, true)
})

test('webhooks limit global request concurrency to four', async () => {
  const gates = [],
    h = ipcHarness(() => {
      const gate = deferred()
      gates.push(gate)
      return gate.promise
    })
  const work = Array.from({ length: 6 }, (_, i) => h.send('id' + i, 'https://fixture.test/' + i))
  await tick()
  assert.equal(gates.length, 4)
  for (const gate of gates) gate.resolve(new Response('{}'))
  await tick()
  assert.equal(gates.length, 6)
  for (const gate of gates) gate.resolve(new Response('{}'))
  assert.ok((await Promise.all(work)).every((r) => r.success))
})

test('cancelling a queued webhook cannot let its successor overlap the current request', async () => {
  const gates = [],
    h = ipcHarness(() => {
      const gate = deferred()
      gates.push(gate)
      return gate.promise
    })
  const first = h.send('first')
  const second = h.send('second')
  const third = h.send('third')
  await tick()
  h.handlers['webhook-cancel'](null, 'second')
  assert.equal((await second).success, false)
  assert.equal(gates.length, 1)
  gates[0].resolve(new Response('{}'))
  await first
  await tick()
  assert.equal(gates.length, 2)
  gates[1].resolve(new Response('{}'))
  assert.equal((await third).success, true)
})

test('renderer webhook tests return main-process results and edits cancel old deliveries', async () => {
  const cancellations = [],
    sent = []
  const api = {
    webhookSend: async (input) => {
      sent.push(input)
      return { success: false, error: 'HTTP 400' }
    },
    webhookCancel: async (id) => {
      cancellations.push(id)
    }
  }
  const { useWebhookStore } = loader(
    {},
    { window: { api }, localStorage: { getItem: () => null, setItem: noop } }
  )('src/renderer/src/store/webhooks.ts')
  const id = useWebhookStore.getState().addWebhook({
    kind: 'telegram',
    url: 'https://fixture.test/bot',
    telegramChatId: 'fixture',
    enabled: true,
    events: ['risk-warning']
  })
  assert.deepEqual(await useWebhookStore.getState().testWebhook(id), {
    success: false,
    error: 'HTTP 400'
  })
  assert.equal(sent[0].url, 'https://fixture.test/bot/sendMessage')
  assert.equal(JSON.parse(sent[0].body).chat_id, 'fixture')
  useWebhookStore.getState().toggleWebhook(id)
  useWebhookStore.getState().updateWebhook(id, { url: 'https://fixture.test/new' })
  useWebhookStore.getState().removeWebhook(id)
  assert.deepEqual(cancellations, [id, id, id])
})

test('subscription IPC resolves full account context and cancels a pending group', async () => {
  const handlers = {},
    seen = [],
    gate = deferred()
  const load = loader({
    electron: {
      ipcMain: {
        handle: (key, fn) => {
          handlers[key] = fn
        }
      }
    },
    '../proxy/kiroApi': {
      fetchAvailableSubscriptions: async (account, signal) => {
        seen.push(account)
        await gate.promise
        signal.throwIfAborted()
        return { subscriptionPlans: [] }
      },
      fetchSubscriptionToken: async () => ({}),
      setUserPreference: async () => ({ success: true })
    }
  })
  load('src/main/ipc/subscriptions.ts').registerSubscriptionIPC((input) => ({
    ...input,
    accessToken: 'latest',
    proxyUrl: 'http://bound.test',
    machineId: 'bound-machine'
  }))
  const work = handlers['account-get-subscriptions'](
    null,
    'old',
    'us-east-1',
    undefined,
    undefined,
    'BuilderId',
    'IdC',
    'A',
    'job-A'
  )
  await tick()
  handlers['subscription-cancel'](null, 'job-A')
  const result = await work
  assert.equal(result.success, false)
  assert.equal(seen[0].proxyUrl, 'http://bound.test')
  assert.equal(seen[0].accessToken, 'latest')
  gate.resolve()
  await tick()
})

function browserHarness(platform, options = {}) {
  const executions = [],
    spawns = [],
    external = []
  const load = loader(
    {
      electron: {
        shell: {
          openExternal: async (url) => {
            external.push(url)
          }
        }
      },
      'node:util': {
        promisify:
          () =>
          async (...args) => {
            executions.push(args)
            return options.execute
              ? options.execute(...args)
              : {
                  stdout: args[1]?.includes('ProgId')
                    ? 'ChromeHTML'
                    : 'REG_SZ C:\\Browser\\' +
                      (args[1]?.[1]?.match(/([^\\]+)$/)?.[1] || 'chrome.exe')
                }
          }
      },
      'node:child_process': {
        spawn: (exe, args) => {
          spawns.push({ exe, args })
          const child = new EventEmitter()
          child.unref = noop
          queueMicrotask(() =>
            child.emit(
              options.spawnError ? 'error' : 'spawn',
              ...(options.spawnError ? [new Error('launch failed')] : [])
            )
          )
          return child
        }
      }
    },
    { process: { platform, env: {} }, setTimeout: (fn, ms) => setTimeout(fn, ms <= 100 ? 0 : ms) }
  )
  return {
    open: load('src/main/privateBrowser.ts').openBrowserInPrivateMode,
    executions,
    spawns,
    external
  }
}

test('private browser passes imported URL literally and caches Windows discovery across a batch', async () => {
  const h = browserHarness('win32'),
    url = 'https://fixture.test/$(true)/end?x=%22&y=1'
  await Promise.all(Array.from({ length: 20 }, () => h.open(url)))
  assert.equal(h.spawns.length, 20)
  assert.equal(h.spawns[0].args.at(-1), url)
  assert.equal(h.executions.filter((args) => args[1].includes('ProgId')).length, 1)
  assert.ok(h.executions.length <= 5)
  await assert.rejects(h.open('javascript:alert(1)'))
})

test('private browser keeps macOS fallbacks and skips a cancelled queued launch', async () => {
  const gate = deferred()
  let calls = 0
  const h = browserHarness('darwin', {
    execute: async () => {
      calls++
      if (calls === 1) return gate.promise
      return { stdout: '' }
    }
  })
  const first = h.open('https://fixture.test/first'),
    abort = new AbortController()
  const second = h.open('https://fixture.test/cancelled', abort.signal)
  abort.abort()
  await assert.rejects(second, /取消/)
  gate.resolve({ stdout: '' })
  await first
  await h.open('https://fixture.test/third')
  assert.equal(h.executions.length, 2)
  const fallback = browserHarness('darwin', {
    execute: async () => {
      throw new Error('not installed')
    }
  })
  await fallback.open('https://fixture.test/fallback')
  assert.deepEqual(fallback.external, ['https://fixture.test/fallback'])
})

test('cancelled link rows stay outside failed-account cleanup and can be regenerated', async () => {
  const h = harness([account('A')], { accountGetSubscriptionUrl: () => new Promise(() => {}) })
  const work = h.runtime.fetchSubscriptionLinks(
    [...h.accounts.getState().accounts.values()],
    'PRO',
    1,
    'fixture'
  )
  await tick()
  h.runtime.cancelSubscriptionOperation('links')
  await work
  assert.equal(h.state().links[0].status, 'cancelled')
  assert.equal(
    h.state().links.filter((l) => l.status === 'error' || l.status === 'expired').length,
    0
  )
  h.window.api.accountGetSubscriptionUrl = async () => ({
    success: true,
    url: 'https://fixture.test/retry'
  })
  await h.runtime.regenerateSubscriptionLink('A', 'PRO', 'retry')
  assert.equal(h.state().links[0].status, 'success')
})

test('individual regeneration retains the existing ability to manage a now-paid account link', async () => {
  const h = harness([account('A', { subscription: { type: 'Pro', title: 'Pro' } })])
  h.runtime.setSubscriptionLinks([
    { accountId: 'A', email: 'A', status: 'expired', url: 'https://fixture.test/old' }
  ])
  await h.runtime.regenerateSubscriptionLink('A', 'PRO_PLUS', 'fixture')
  assert.equal(h.state().links[0].status, 'success')
})

test('subscription context uses latest credentials, device and active proxy binding', () => {
  const file = 'src/main/index.ts',
    source = fs.readFileSync(file, 'utf8'),
    ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  let callback
  function walk(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'registerSubscriptionIPC')
      callback = node.arguments[0]
    node.forEachChild(walk)
  }
  walk(ast)
  // The shared context resolver is also used by the Kiro settings model list.
  let initializer
  function findResolver(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'resolveSettingsAccount')
      initializer = node.initializer
    node.forEachChild(findResolver)
  }
  findResolver(ast)
  const code = ts.transpileModule(`const resolve=(${(initializer || callback).getText(ast)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText
  const data = {
    accounts: {
      A: {
        email: 'a@example.test',
        machineId: 'latest-machine',
        profileArn: 'latest-arn',
        credentials: { accessToken: 'latest', region: 'eu-central-1' }
      }
    },
    accountProxyBindings: { A: 'p' },
    proxyPool: { p: { url: 'http://bound.test', enabled: true, status: 'alive' } }
  }
  const proxy = {
    getAccountPool: () => ({ getAccount: () => ({ proxyUrl: 'http://stale.test' }) })
  }
  const resolve = new Function('lastSavedData', 'store', 'proxyServer', code + '\nreturn resolve;')(
    data,
    undefined,
    proxy
  )
  const result = resolve({ id: 'A', accessToken: 'old' })
  assert.equal(result.accessToken, 'latest')
  assert.equal(result.machineId, 'latest-machine')
  assert.equal(result.proxyUrl, 'http://bound.test')
  assert.equal(result.region, 'eu-central-1')
  data.proxyPool.p.enabled = false
  assert.equal(resolve({ id: 'A', accessToken: 'old' }).proxyUrl, undefined)
})

test('provider acknowledgement checks preserve custom JSON response semantics', async () => {
  for (const kind of ['dingtalk', 'wechat-work', 'feishu']) {
    const body =
      kind === 'feishu' ? { code: 400, msg: 'rejected' } : { errcode: 400, errmsg: 'rejected' }
    const h = ipcHarness(async () => new Response(JSON.stringify(body)))
    assert.equal((await h.send('fixture', 'https://fixture.test', kind)).success, false)
  }
  const custom = ipcHarness(async () => new Response('{"success":false,"custom_data":true}'))
  assert.equal((await custom.send()).success, true)
})

test('failed-link cleanup calls the bulk account operation once and excludes cancelled or unconfirmed rows', () => {
  const file = 'src/renderer/src/components/pages/SubscriptionPage.tsx',
    source = fs.readFileSync(file, 'utf8'),
    ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let handler
  function walk(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleDeleteFailed')
      handler = node.initializer
    node.forEachChild(walk)
  }
  walk(ast)
  const code = ts.transpileModule(`const cleanup=(${handler.getText(ast)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText
  const links = [
    ...Array.from({ length: 1000 }, (_, i) => ({ accountId: String(i), status: 'error' })),
    { accountId: 'cancelled', status: 'cancelled' },
    { accountId: 'unknown', status: 'success', validation: 'unknown' }
  ]
  const calls = []
  let remaining
  const environment = {
    links,
    deleteAlsoAccount: true,
    isEn: false,
    confirm: () => true,
    removeAccounts: (ids) => calls.push(ids),
    setLinks: (fn) => {
      remaining = fn(links)
    },
    setSelectedLinkIds: (fn) => fn(new Set())
  }
  new Function('env', 'with(env){' + code + ';cleanup();}')(environment)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].length, 1000)
  assert.deepEqual(
    remaining.map((l) => l.accountId),
    ['cancelled', 'unknown']
  )
})

test('loading webhook settings cannot enable a previously disabled malformed record', async () => {
  let sends = 0,
    cancellations = 0
  const records = [
    { id: 'legacy', kind: 'custom', url: 'https://fixture.test', events: ['risk-warning'] }
  ]
  const window = {
    api: {
      webhookSend: async () => {
        sends++
        return { success: true }
      },
      webhookCancel: async () => {
        cancellations++
      }
    }
  }
  const { useWebhookStore } = loader(
    {},
    { window, localStorage: { getItem: () => JSON.stringify(records), setItem: noop } }
  )('src/renderer/src/store/webhooks.ts')
  useWebhookStore.getState().loadFromStorage()
  await useWebhookStore
    .getState()
    .triggerEvent('risk-warning', { title: 'fixture', message: 'fixture', level: 'warn' })
  assert.equal(sends, 0)
  useWebhookStore.getState().updateWebhook('legacy', { label: 'Renamed' })
  assert.equal(cancellations, 0)
})

test('a known Windows browser launch failure retains the system-default fallback', async () => {
  const h = browserHarness('win32', { spawnError: true })
  await h.open('https://fixture.test/default')
  assert.equal(h.spawns.length, 1)
  assert.deepEqual(h.external, ['https://fixture.test/default'])
})

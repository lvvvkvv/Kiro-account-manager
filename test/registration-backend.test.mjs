/* eslint @typescript-eslint/explicit-function-return-type: "off" -- Isolated backend regression fixtures. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const tick = () => new Promise((resolve) => setImmediate(resolve))
const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const noop = () => undefined
const quiet = { log: noop, error: noop, warn: noop }
function harness(overrides = {}, globals = {}, extra = {}) {
  globals = {
    console: quiet,
    fetch: async () => {
      throw new Error('Unexpected external fetch')
    },
    ...globals
  }
  const cache = new Map()
  class Session {
    async destroySession() {
      return undefined
    }
  }
  const deps = {
    electron: {},
    './chainProxy': {},
    '../proxy/systemProxy': {
      getSystemProxy: () => undefined,
      safeCreateProxyAgent: () => undefined
    },
    './tlsClientPool': { acquireModuleClient: async () => ({ getPoolStats: () => null }) },
    tlsclientwrapper: { SessionClient: Session },
    ...overrides
  }
  function load(file) {
    file = path.resolve(file)
    if (cache.has(file)) return cache.get(file)
    const mod = { exports: {} }
    const code = ts.transpileModule(
      fs.readFileSync(file, 'utf8') + '\n' + (extra[path.basename(file)] || ''),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true
        }
      }
    ).outputText
    new Function('require', 'module', 'exports', ...Object.keys(globals), code)(
      (name) =>
        Object.hasOwn(deps, name)
          ? deps[name]
          : name.startsWith('.')
            ? load(path.resolve(path.dirname(file), name) + '.ts')
            : require(name),
      mod,
      mod.exports,
      ...Object.values(globals)
    )
    cache.set(file, mod.exports)
    return mod.exports
  }
  return load
}
const source = (name) => `src/main/registration/${name}.ts`
function mailbox(load) {
  return load(source('email-service'))
}
function registrar(load) {
  return new (load(source('registrar')).Registrar)(
    {
      password: 'fixture',
      proxy: '',
      oidcBase: 'https://oidc.test',
      signinBase: 'https://signin.test'
    },
    () => {}
  )
}
function gpt(api, address = 'ann@example.test', inbox = '') {
  const service = new api.GptMailService({
    domain: 'example.test',
    inboxEmail: inbox,
    getSession: () => ({})
  })
  Object.assign(service, { address, inboxEmail: inbox || address, token: 'fixture' })
  return service
}
const response = (value) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
const mailExtras = {
  'email-service.ts': 'exports.IMAPClient = IMAPClient; exports.decodeMail = decodeMail;'
}

test('deadline and cancellation stop lazy work and observe late rejections', async () => {
  const { withDeadline, waitFor } = harness()(source('async'))
  const controller = new AbortController()
  controller.abort()
  let started = false
  await assert.rejects(
    withDeadline(
      async () => {
        started = true
      },
      10,
      controller.signal
    ),
    /取消/
  )
  assert.equal(started, false)
  await assert.rejects(
    withDeadline(() => new Promise(() => {}), 5),
    /超时/
  )
  const pending = deferred()
  await assert.rejects(waitFor(pending.promise, controller.signal), /取消/)
  pending.resolve('late')
  await tick()
})

test('HTTP owner reuses proxy dispatcher and closes it on proxy changes and cleanup', async () => {
  const agents = []
  const load = harness({
    '../proxy/systemProxy': {
      safeCreateProxyAgent: (proxy) => {
        const agent = {
          proxy,
          closed: 0,
          async close() {
            this.closed++
          },
          async destroy() {
            return undefined
          }
        }
        agents.push(agent)
        return agent
      }
    },
    undici: { fetch: async () => response({ ok: true }) }
  })
  const client = new (load(source('http')).RegistrationHttpClient)()
  await Promise.all(
    Array.from({ length: 20 }, () =>
      client.read('https://fixture.test', 'http://proxy.test', {}, (res) => res.json())
    )
  )
  assert.equal(agents.length, 1)
  await client.read('https://fixture.test', 'http://other.test', {}, (res) => res.json())
  assert.equal(agents[0].closed, 1)
  client.close()
  assert.equal(agents[1].closed, 1)
})

test('100 shared-inbox waiters coalesce lists and details while matching their own recipients', async () => {
  let lists = 0,
    details = 0,
    deleted = 0
  // Native fetch is replaced inside this isolated module graph; no service is contacted.
  const api = harness(
    {},
    {
      fetch: async (url, init) => {
        if (init.method === 'DELETE') {
          deleted++
          return response({ result: true })
        }
        const id = new URL(url).pathname.match(/\/mails\/(\d+)$/)?.[1]
        if (id !== undefined) {
          details++
          return response({
            result: true,
            to: `a${id}@example.test`,
            subject: `Code ${String(Number(id) + 100000)}`
          })
        }
        lists++
        return response({
          result: true,
          mail_list: Array.from({ length: 100 }, (_, id) => ({ mail_id: id }))
        })
      }
    }
  )(source('email-service'))
  const codes = await Promise.all(
    Array.from({ length: 100 }, (_, id) => {
      const service = new api.TempMailPlusService('shared', 'pin', 'example.test')
      service.address = `a${id}@example.test`
      return service.waitForCode(5, 0.001)
    })
  )
  assert.deepEqual(
    codes,
    Array.from({ length: 100 }, (_, id) => String(id + 100000))
  )
  assert.equal(lists, 1)
  assert.equal(details, 100)
  await tick()
  assert.equal(deleted, 100)
})

test('TempMail retries incomplete details and returns OTP without waiting for deletion', async () => {
  const api = mailbox(harness())
  const service = new api.TempMailPlusService('shared', 'pin', 'example.test')
  service.address = 'a@example.test'
  let details = 0
  service.fetchMailList = async () => [{ mail_id: 1 }]
  service.fetchMailDetail = async () =>
    ++details === 1 ? null : { to: service.address, subject: '123456' }
  service.deleteMail = () => new Promise(() => {})
  assert.equal(await service.waitForCode(1, 0.001), '123456')
  assert.equal(details, 2)
})

test('mail deadline includes a pending request and abort prevents further detail/deletion work', async () => {
  const api = mailbox(harness())
  const service = new api.TempMailPlusService('shared', 'pin', 'example.test')
  service.address = 'a@example.test'
  const pending = deferred(),
    entered = deferred()
  service.fetchMailList = () => {
    entered.resolve()
    return pending.promise
  }
  service.fetchMailDetail = () => assert.fail('Detail request after cancellation')
  service.deleteMail = () => assert.fail('Deletion after cancellation')
  const controller = new AbortController()
  const work = service.waitForCode(1, 0.001, controller.signal)
  await entered.promise
  controller.abort()
  await assert.rejects(work, /取消/)
  pending.resolve([{ mail_id: 1 }])
  await tick()
  service.fetchMailList = () => new Promise(() => {})
  await assert.rejects(service.waitForCode(0.01, 0.001), /超时/)
})

test('GPTmail revisits incomplete messages and rejects prefix-only forwarded matches', async () => {
  const api = mailbox(harness())
  const service = gpt(api)
  let rounds = 0
  service.fetchMails = async () => [{ id: 1, content: ++rounds === 1 ? '' : 'Your code is 123456' }]
  assert.equal(await service.waitForCode(1, 0.001), '123456')
  assert.equal(rounds, 2)
  const forwarded = gpt(api, 'ann@example.test', 'shared@inbox.test')
  rounds = 0
  forwarded.fetchMails = async () => [
    { id: ++rounds, content: rounds === 1 ? 'anna@example.test 111111' : 'ann@example.test 222222' }
  ]
  assert.equal(await forwarded.waitForCode(1, 0.001), '222222')
})

test('GPTmail renews private-inbox authorization and reads the latest session getter', async () => {
  let page = 0,
    unlock = 0,
    lists = 0
  const session = {
    async get(url, options) {
      assert.equal(options.retryIsEnabled, false)
      if (!url.includes('/api/')) {
        page++
        return { status: 200, body: 'window.__BROWSER_AUTH = {"token":"page"};' }
      }
      lists++
      return lists === 1
        ? { status: 403, body: '{}' }
        : { status: 200, body: '{"success":true,"data":{"emails":[]}}' }
    },
    async post() {
      unlock++
      return { status: 200, body: '{"success":true,"auth":{"token":"unlocked"}}' }
    }
  }
  let current = null
  const api = mailbox(harness())
  const service = new api.GptMailService({
    domain: 'example.test',
    privatePassword: 'fixture',
    getSession: () => current
  })
  Object.assign(service, {
    address: 'a@example.test',
    inboxEmail: 'a@example.test',
    token: 'expired'
  })
  current = session
  assert.deepEqual(await service.fetchMails(), [])
  assert.equal(page, 1)
  assert.equal(unlock, 1)
  assert.equal(lists, 2)
  current = {
    get: async () => ({ status: 200, body: '{"success":true,"data":{"emails":[{"id":2}]}}' })
  }
  assert.deepEqual(await service.fetchMails(), [{ id: 2 }])
})

function imapHarness(onCommand, options = {}) {
  const sockets = []
  const load = harness(
    {
      tls: {
        connect() {
          const socket = new EventEmitter()
          socket.destroy = () => {
            socket.destroyed = true
            socket.emit('close')
          }
          socket.write = (line) => {
            const tag = line.split(' ')[0]
            const command = line.trim().slice(tag.length + 1)
            queueMicrotask(() => onCommand(socket, tag, command))
          }
          sockets.push(socket)
          if (!options.hangHandshake)
            queueMicrotask(() => {
              socket.emit('secureConnect')
              socket.emit('data', Buffer.from('* OK Ready\r\n'))
            })
          return socket
        }
      }
    },
    { fetch: async () => response({ access_token: 'fixture' }) },
    mailExtras
  )
  return { api: mailbox(load), sockets }
}
function send(socket, text) {
  socket.emit('data', Buffer.from(text, 'latin1'))
}
function literal(socket, tag, raw) {
  send(
    socket,
    `* 1 FETCH (UID 11 BODY[] {${Buffer.byteLength(raw, 'latin1')}}\r\n${raw})\r\n${tag} OK fetched\r\n`
  )
}

test('IMAP parses coalesced lines and exact-length literals containing tag-like body lines', async () => {
  const raw =
    'From: no-reply@signin.aws\r\nContent-Type: text/plain\r\n\r\nA003 OK is body text\r\nYour code is 123456\r\n'
  const { api } = imapHarness((socket, tag, command) => {
    if (command.startsWith('SELECT'))
      send(socket, `* 2 EXISTS\r\n* OK [UIDNEXT 11] next\r\n${tag} OK selected\r\n`)
    else if (command.startsWith('UID FETCH')) literal(socket, tag, raw)
    else send(socket, `${tag} OK authenticated\r\n`)
  })
  const client = new api.IMAPClient()
  try {
    await client.connect()
    await client.authenticate('a@example.test', 'fixture')
    assert.equal(await client.selectInbox(), 11)
    assert.match((await client.fetchMessage(11)).body, /123456/)
  } finally {
    client.close()
  }
})

test('MIME decoding preserves plain text and handles base64, quoted-printable and arbitrary boundaries', () => {
  const { decodeMail } = mailbox(harness({}, {}, mailExtras))
  const body = '验证码 123456'
  assert.equal(
    decodeMail('Content-Type: text/plain\r\n\r\nYour code is 123456').body,
    'Your code is 123456'
  )
  assert.equal(
    decodeMail('Content-Transfer-Encoding: base64\r\n\r\n' + Buffer.from(body).toString('base64'))
      .body,
    body
  )
  assert.equal(
    decodeMail('Content-Transfer-Encoding: quoted-printable\r\n\r\nCode =31=32=33=34=35=36').body,
    'Code 123456'
  )
  const raw =
    'Content-Type: multipart/alternative; boundary="custom"\r\n\r\n--custom\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
    Buffer.from(body).toString('base64') +
    '\r\n--custom--\r\n'
  assert.match(decodeMail(raw).body, /123456/)
})

test('IMAP abort owns the handshake socket and graceful EOF rejects pending reads', async () => {
  const pending = imapHarness(() => {}, { hangHandshake: true })
  const controller = new AbortController(),
    client = new pending.api.IMAPClient(controller.signal)
  const work = client.connect()
  await tick()
  controller.abort()
  await assert.rejects(work, /取消|关闭/)
  assert.equal(pending.sockets[0].destroyed, true)
  const connected = imapHarness(() => {})
  const reader = new connected.api.IMAPClient()
  await reader.connect()
  const read = reader.readLine()
  await tick()
  connected.sockets[0].emit('end')
  await assert.rejects(read, /关闭/)
  reader.close()
})

test('Outlook reuses one connection across polls and does not fetch an unchanged UID twice', async () => {
  let searches = 0,
    unrelatedFetches = 0
  const { api, sockets } = imapHarness((socket, tag, command) => {
    if (command === 'SELECT INBOX') send(socket, `* OK [UIDNEXT 11] next\r\n${tag} OK selected\r\n`)
    else if (command.startsWith('UID SEARCH'))
      send(socket, `* SEARCH ${++searches === 1 ? '11' : '11 12'}\r\n${tag} OK searched\r\n`)
    else if (command.startsWith('UID FETCH 11')) {
      unrelatedFetches++
      literal(socket, tag, 'From: someone@example.test\r\n\r\nUnrelated 111111')
    } else if (command.startsWith('UID FETCH 12'))
      literal(socket, tag, 'From: no-reply@signin.aws\r\n\r\nYour code is 222222')
    else send(socket, `${tag} OK authenticated\r\n`)
  })
  assert.equal(
    await api.waitForOTP(
      { email: 'a@example.test', clientId: 'fixture', refreshToken: 'fixture' },
      { uidNext: 11, since: Date.now() },
      1,
      0.001
    ),
    '222222'
  )
  assert.equal(sockets.length, 1)
  assert.equal(unrelatedFetches, 1)
  assert.ok(sockets.every((socket) => socket.destroyed))
})

test('registration timeout is terminal and late transport responses cannot update workflow state', async () => {
  const load = harness()
  const reg = registrar(load),
    pending = deferred()
  reg.session = { post: () => pending.promise }
  await assert.rejects(
    reg.withTimeout(() => reg.step2Device(), 10, 'Device'),
    /整体超时/
  )
  pending.resolve({ status: 200, body: '{"deviceCode":"late","userCode":"late"}' })
  await tick()
  assert.equal(reg.deviceCode, '')
  await assert.rejects(
    reg.retryStep('Device', () => assert.fail('Retry after terminal timeout'), 3),
    /整体超时/
  )
})

test('installed wrapper and logical retry budget produce three requests instead of twenty-seven', async () => {
  const { ModuleClient, SessionClient } = require('tlsclientwrapper')
  let requests = 0
  const module = new ModuleClient({ customLibraryPath: '/tmp/unused-test-library.so' })
  module.open = async () => {}
  module.pool = {
    run: async ({ fn }) =>
      fn === 'request' ? (requests++, { status: 503, body: 'unavailable', headers: {} }) : {}
  }
  const reg = registrar(harness())
  reg.session = new SessionClient(module)
  reg.abortableSleep = async () => {}
  await assert.rejects(
    reg.retryStep('Portal', () => reg.sendRequest('POST', 'https://fixture.test', {}, '{}'), 3),
    /503/
  )
  assert.equal(requests, 3)
  await reg.session.destroySession()
})

test('TLS initialization completing after destroy does not create a registration session', async () => {
  const pending = deferred()
  let created = 0
  const reg = registrar(
    harness({
      './tlsClientPool': { acquireModuleClient: () => pending.promise },
      tlsclientwrapper: {
        SessionClient: class {
          constructor() {
            created++
          }
        }
      }
    })
  )
  reg.ensureTlsLib = () => ({ downloadDir: '/tmp/fixture' })
  const work = reg.initTlsClient()
  await reg.destroy()
  await assert.rejects(work, /取消/)
  pending.resolve({ getPoolStats: () => null })
  await tick()
  assert.equal(created, 0)
  assert.equal(reg.session, null)
})

test('shared pool disposes a late open and never reopens after shutdown', async () => {
  const pending = deferred()
  let terminated = 0
  const load = harness({
    tlsclientwrapper: {
      ModuleClient: class {
        open() {
          return pending.promise
        }
        async terminate() {
          terminated++
        }
      }
    }
  })
  const pool = load(source('tlsClientPool'))
  const opening = pool.acquireModuleClient({})
  const observed = assert.rejects(opening, /关闭/)
  const closing = pool.shutdownTlsClientPool()
  pending.resolve()
  await observed
  await closing
  assert.equal(terminated, 1)
  await assert.rejects(pool.acquireModuleClient({}), /关闭/)
})

for (const mode of ['run', 'runManualPhase3'])
  test(`${mode} returns rotated credentials and expiry, preserving absent refresh tokens`, async () => {
    const reg = registrar(harness({ './xxtea': { refreshAppJSConfig: async () => {} } }))
    for (const name of [
      'setupProxyChain',
      'initTlsClient',
      'detectExitIP',
      'rebuildTlsClient',
      'humanDelay',
      'abortableSleep',
      'step1OIDC',
      'step2Device',
      'step3Email',
      'step4Portal',
      'step5WorkflowInit',
      'step7Signup',
      'step7_5SignupInit',
      'step7_8ProfileInit',
      'step8ProfileStart',
      'step9SendOTP',
      'step11CreateIdentity',
      'step12SetPassword',
      'step12_8SSOWorkflow'
    ])
      reg[name] = async () => {}
    reg.step6SubmitEmail = async () => 'signup'
    reg.step10GetOTP = async () => '123456'
    reg.step13SSOToken = async () => ({ accessToken: 'old-access', refreshToken: 'old-refresh' })
    reg.doPost = async () => ({
      status: 200,
      body: '{"accessToken":"new-access","refreshToken":"new-refresh","expiresIn":600}'
    })
    reg.doGet = async () => ({ status: 200, body: '{}' })
    const result = await reg[mode]('123456')
    assert.equal(result.status, 'success')
    assert.equal(result.accessToken, 'new-access')
    assert.equal(result.refreshToken, 'new-refresh')
    assert.ok(result.expiresAt > Date.now() + 590000)
    const token = { accessToken: 'old', refreshToken: 'preserve' }
    reg.doPost = async () => ({ status: 200, body: '{"accessToken":"latest"}' })
    await reg.verifyAlive(token)
    assert.equal(token.refreshToken, 'preserve')
    assert.equal(token.accessToken, 'latest')
  })

test('app.js timeout releases all waiters and failures can be retried after the cooldown', async () => {
  let clock = Date.now(),
    calls = 0
  class Clock extends Date {
    static now() {
      return clock
    }
  }
  const load = harness(
    {},
    { Date: Clock, setTimeout: (fn, ms) => setTimeout(fn, ms === 20000 ? 5 : ms) }
  )
  const xx = load(source('xxtea'))
  const hanging = () => {
    calls++
    return new Promise(() => {})
  }
  await Promise.all([xx.refreshAppJSConfig(hanging), xx.refreshAppJSConfig(hanging)])
  assert.equal(calls, 1)
  clock += 60001
  await xx.refreshAppJSConfig(async () => {
    calls++
    return new Response('var a=[1,"fixture",2,3,4]; FWCIM_VERSION="5.0.0"')
  })
  assert.equal(calls, 2)
  assert.equal(xx.getTESVersion(), '5.0.0')
  assert.deepEqual(xx.getActiveKey(), [3, 1, 4, 2])
})

function protonHarness(execute) {
  const windows = []
  class Window extends EventEmitter {
    constructor() {
      super()
      windows.push(this)
      this.webContents = new EventEmitter()
      Object.assign(this.webContents, {
        setUserAgent() {
          return undefined
        },
        setWindowOpenHandler() {
          return undefined
        },
        getURL: () => 'https://mail.proton.me/u/0/inbox',
        executeJavaScript: execute
      })
    }
    isDestroyed() {
      return !!this.destroyed
    }
    destroy() {
      this.destroyed = true
      this.emit('closed')
    }
    async loadURL() {
      queueMicrotask(() => this.webContents.emit('dom-ready'))
    }
  }
  const timers = (fn, ms) => setTimeout(fn, [1200, 250, 1000].includes(ms) ? 1 : ms)
  const load = harness(
    {
      electron: {
        BrowserWindow: Window,
        session: { fromPartition: () => ({ setProxy: async () => {} }) }
      }
    },
    { setTimeout: timers },
    { 'proton-mail-window.ts': 'exports.buildScanScript = buildScanScript;' }
  )
  return { api: load(source('proton-mail-window')), windows }
}

test('Proton cancels queued waits immediately and reuses codes found for another active address', async () => {
  let scans = 0
  const gate = deferred(),
    entered = deferred()
  const { api } = protonHarness(async (script) => {
    if (!script.includes('const addrFull')) return true
    scans++
    if (scans === 1) {
      entered.resolve()
      await gate.promise
      return {
        code: '',
        from: 'none',
        nextOffset: 2,
        messages: [{ address: 'b@example.test', code: '222222' }]
      }
    }
    return { code: '111111', from: 'body', matched: true, nextOffset: 0 }
  })
  const first = api.waitProtonOtp('a@example.test', { timeoutSec: 2, intervalSec: 1 })
  await entered.promise
  const abort = new AbortController()
  const cancelled = api.waitProtonOtp('cancel@example.test', {
    timeoutSec: 2,
    intervalSec: 1,
    signal: abort.signal
  })
  const second = api.waitProtonOtp('b@example.test', { timeoutSec: 2, intervalSec: 1 })
  abort.abort()
  await assert.rejects(cancelled, /取消/)
  gate.resolve()
  assert.equal(await second, '222222')
  assert.equal(await first, '111111')
  assert.equal(scans, 2)
})

test('Proton scan advances past two messages and never accepts an unaddressed foreign OTP', async () => {
  const { api } = protonHarness(async () => true)
  let current = 0,
    recipients = true
  const addresses = ['first@example.test', 'second@example.test', 'target@example.test']
  const items = addresses.map((address, index) => ({
    querySelector(selector) {
      return selector.includes('sender-address')
        ? { getAttribute: () => 'no-reply@signin.aws' }
        : {
            dispatchEvent(event) {
              if (event.type === 'click') current = index
            }
          }
    }
  }))
  const document = {
    querySelectorAll(selector) {
      if (selector.includes('message-item')) return items
      if (selector.startsWith('a['))
        return recipients ? [{ getAttribute: () => `mailto:${addresses[current]}` }] : []
      return []
    },
    querySelector() {
      return {
        contentDocument: {
          body: {
            get innerText() {
              return `Code ${111111 + current}`
            }
          }
        }
      }
    },
    body: { innerText: '' }
  }
  const run = (offset) =>
    vm.runInNewContext(api.buildScanScript('target@example.test', offset), {
      document,
      window: {},
      MouseEvent: class {
        constructor(type) {
          this.type = type
        }
      },
      setTimeout: (fn) => setTimeout(fn, 0)
    })
  const first = await run(0)
  assert.equal(first.code, '')
  assert.equal(first.nextOffset, 2)
  assert.equal((await run(first.nextOffset)).code, '111113')
  recipients = false
  assert.equal((await run(0)).code, '')
})

test('cancelling one coalesced mailbox waiter keeps the other request alive; the last cancel aborts it', async () => {
  let requestSignal
  const entered = deferred()
  const api = mailbox(
    harness(
      {},
      {
        fetch: async (url, options) => {
          requestSignal = options.signal
          entered.resolve()
          return new Promise(() => {})
        }
      }
    )
  )
  const a = new api.TempMailPlusService('shared', 'pin', 'example.test'),
    b = new api.TempMailPlusService('shared', 'pin', 'example.test')
  const first = new AbortController(),
    second = new AbortController()
  const one = a.fetchMailList(first.signal),
    two = b.fetchMailList(second.signal)
  await entered.promise
  first.abort()
  await assert.rejects(one, /取消/)
  assert.equal(requestSignal.aborted, false)
  second.abort()
  await assert.rejects(two, /取消/)
  assert.equal(requestSignal.aborted, true)
})

test('successful API payloads containing timeout or EOF text never trigger retries', async () => {
  const reg = registrar(harness())
  let calls = 0
  reg.session = {
    get: async () => {
      calls++
      return { status: 200, body: '{"name":"eoffrey","timeout":30}' }
    }
  }
  assert.equal((await reg.sendRequest('GET', 'https://fixture.test', {})).status, 200)
  assert.equal(calls, 1)
})

test('SSO cancellation disposes the auxiliary session exactly once', async () => {
  const entered = deferred()
  let closed = 0
  const reg = registrar(
    harness({
      tlsclientwrapper: {
        SessionClient: class {
          post() {
            entered.resolve()
            return new Promise(() => {})
          }
          async destroySession() {
            closed++
          }
        }
      }
    })
  )
  reg.moduleClient = {}
  reg.cookies.set('loginCsrfToken', 'fixture')
  const operation = reg.step13SSOToken()
  await entered.promise
  const cancelled = assert.rejects(operation, /取消/)
  await reg.destroy()
  await cancelled
  assert.equal(closed, 1)
})

test('Outlook reconnects after a dropped connection without re-reading already handled mail', async () => {
  let searches = 0
  const { api, sockets } = imapHarness((socket, tag, command) => {
    if (command === 'SELECT INBOX') send(socket, `* OK [UIDNEXT 11] next\r\n${tag} OK selected\r\n`)
    else if (command.startsWith('UID SEARCH')) {
      if (++searches === 1) socket.emit('end')
      else send(socket, `* SEARCH 11\r\n${tag} OK searched\r\n`)
    } else if (command.startsWith('UID FETCH'))
      literal(socket, tag, 'From: no-reply@signin.aws\r\n\r\nYour code is 222222')
    else send(socket, `${tag} OK authenticated\r\n`)
  })
  assert.equal(
    await api.waitForOTP(
      { email: 'a@example.test', clientId: 'fixture', refreshToken: 'fixture' },
      { uidNext: 11, since: Date.now() },
      1,
      0.001
    ),
    '222222'
  )
  assert.equal(sockets.length, 2)
  assert.ok(sockets.every((socket) => socket.destroyed))
})

test('Outlook timestamp fallback skips historical codes and rejects misleading sender domains', async () => {
  const now = Date.now()
  const { api } = imapHarness((socket, tag, command) => {
    if (command === 'SELECT INBOX') send(socket, `* OK [UIDNEXT 20] next\r\n${tag} OK selected\r\n`)
    else if (command.startsWith('UID SEARCH'))
      send(socket, `* SEARCH 11 12 13\r\n${tag} OK searched\r\n`)
    else if (command.startsWith('UID FETCH')) {
      const uid = command.split(' ')[2]
      const from = uid === '12' ? 'no-reply@signin.aws.evil.test' : 'no-reply@signin.aws'
      const date = new Date(uid === '13' ? now - 3600000 : now).toUTCString()
      literal(
        socket,
        tag,
        `From: ${from}\r\nDate: ${date}\r\n\r\nYour code is ${uid === '11' ? '111111' : '999999'}`
      )
    } else send(socket, `${tag} OK authenticated\r\n`)
  })
  assert.equal(
    await api.waitForOTP(
      { email: 'a@example.test', clientId: 'fixture', refreshToken: 'fixture' },
      { uidNext: 0, since: now },
      1,
      0.001
    ),
    '111111'
  )
})

test('JWE remains decryptable and retains all password claims', () => {
  const crypto = require('node:crypto')
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const { encryptPassword } = harness()(source('jwe'))
  const compact = encryptPassword(
    'fixture密码',
    publicKey.export({ format: 'jwk' }),
    'signin',
    'password',
    'us-east-1'
  )
  const [header, encrypted, iv, ciphertext, tag] = compact.split('.')
  const key = crypto.privateDecrypt(
    { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(encrypted, 'base64url')
  )
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
  decipher.setAAD(Buffer.from(header))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  const claims = JSON.parse(
    Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()])
  )
  assert.equal(claims.password, 'fixture密码')
  assert.equal(claims.iss, 'us-east-1.signin')
  assert.equal(claims.aud, 'us-east-1.password')
  assert.equal(claims.exp - claims.iat, 300)
})

test('fingerprint payloads retain the pre-optimization wire format across registration pages', () => {
  let seed = 0x12345678
  const math = Object.create(Math)
  math.random = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  class Clock extends Date {
    static now() {
      return 1760000000000
    }
  }
  const load = harness({}, { Math: math, Date: Clock })
  const identity = load(source('browser-identity')).randomIdentity(),
    fp = load(source('fingerprint')),
    ctx = fp.newFPContext(identity)
  const hashes = [
    'signin:first_load',
    'signup:PageSubmit',
    'profile:PageLoad',
    'profile:PageSubmit',
    'profile:EmailVerification'
  ].map((step) => {
    const [page, event] = step.split(':')
    const value = fp.generateFingerprint(
      identity,
      'https://fixture.test/path',
      'https://fixture.test',
      ctx,
      page,
      event,
      5000,
      14,
      'a@fixture.test'
    )
    return require('node:crypto').createHash('sha256').update(value).digest('hex')
  })
  assert.deepEqual(hashes, [
    'bd219dd6b21692e068f59974d710f4ce5f3069f1c6f5309cdd2758801b22da17',
    '157581bc9b905ce1f5154c3bafe29139da4769e4cbc6548b1b0c568eac15918f',
    'd240cba2ef82ebf81303284dbeb5e153d234dadbd1716f226b3d286a22b20511',
    '1d614c2238d0644e1aa998d392ebe6d78cc4c36b91849920d505c828f77dabf4',
    '81b32c8f67be63a11a7c67303304cc82fe0de109d83d4f6423f4ab75d8673a2c'
  ])
})

test('Outlook preserves refreshed mailbox credentials between the send and receive steps', async () => {
  const reg = registrar(
    harness({
      './email-service': {
        parseOutlookLines: () => [{ email: 'a@example.test', refreshToken: 'old' }],
        getInboxCheckpoint: async (account) => {
          account.refreshToken = 'rotated'
          return { uidNext: 11, since: Date.now() }
        },
        waitForOTP: async (account) => {
          assert.equal(account.refreshToken, 'rotated')
          return '123456'
        }
      }
    })
  )
  Object.assign(reg.cfg, {
    useOutlook: true,
    outlookData: 'fixture',
    profileBase: 'https://profile.test'
  })
  reg.genFPWithTime = () => ''
  reg.doPost = async () => ({ status: 200 })
  await reg.step3Email()
  await reg.step9SendOTP()
  assert.equal(await reg.step10GetOTP(), '123456')
})

test('native TLS IMAP traffic handles fragmented MIME literals without external services', async (t) => {
  const tls = require('node:tls'),
    os = require('node:os')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-imap-test-'))
  const { CertManager } = harness()('src/main/kproxy/certManager.ts')
  const manager = new CertManager(path.join(directory, 'ca'))
  const ca = await manager.initialize(),
    leaf = await manager.generateCertForHost('localhost')
  const sockets = new Set()
  const server = tls.createServer({ key: leaf.key, cert: leaf.cert }, (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.write('* OK local IMAP\r\n')
    let incoming = ''
    socket.on('data', (chunk) => {
      incoming += chunk.toString()
      let end
      while ((end = incoming.indexOf('\r\n')) >= 0) {
        const line = incoming.slice(0, end)
        incoming = incoming.slice(end + 2)
        const tag = line.split(' ')[0]
        if (line.includes('UID FETCH')) {
          const raw =
            'From: no-reply@signin.aws\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
            Buffer.from('验证码 123456').toString('base64')
          const wire = `* 1 FETCH (BODY[] {${Buffer.byteLength(raw)}}\r\n${raw})\r\n${tag} OK fetched\r\n`
          let offset = 0
          const write = () => {
            if (socket.destroyed || offset >= wire.length) return
            socket.write(wire.slice(offset, offset + 7))
            offset += 7
            setImmediate(write)
          }
          write()
        } else socket.write(`${tag} OK done\r\n`)
      }
    })
  })
  t.after(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(directory, { recursive: true, force: true })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const api = mailbox(
    harness(
      {
        tls: {
          connect: () =>
            tls.connect({
              host: '127.0.0.1',
              port: server.address().port,
              servername: 'localhost',
              ca: ca.certPem
            })
        }
      },
      {},
      mailExtras
    )
  )
  const client = new api.IMAPClient()
  try {
    await client.connect()
    await client.authenticate('a@example.test', 'fixture')
    assert.equal((await client.fetchMessage(11)).body, '验证码 123456')
  } finally {
    client.close()
  }
})

test('single-layer request retries retain the installed wrapper transient status coverage', async () => {
  for (const status of [408, 500, 521, 522, 523, 524]) {
    const reg = registrar(harness())
    let calls = 0
    reg.abortableSleep = async () => undefined
    reg.session = {
      get: async () => (++calls < 3 ? { status, body: 'busy' } : { status: 200, body: '{}' })
    }
    assert.equal((await reg.sendRequest('GET', 'https://fixture.test', {})).status, 200)
    assert.equal(calls, 3)
  }
})

test('Outlook retains SELECT retry for a temporarily busy authenticated mailbox', async () => {
  let selects = 0
  const { api } = imapHarness((socket, tag, command) => {
    if (command === 'SELECT INBOX' && ++selects === 1) send(socket, `${tag} NO mailbox busy\r\n`)
    else if (command === 'SELECT INBOX')
      send(socket, `* OK [UIDNEXT 11] next\r\n${tag} OK selected\r\n`)
    else send(socket, `${tag} OK authenticated\r\n`)
  })
  const client = new api.IMAPClient()
  try {
    await client.connect()
    await client.authenticate('a@example.test', 'fixture')
    assert.equal(await client.selectInbox(), 11)
    assert.equal(selects, 2)
  } finally {
    client.close()
  }
})

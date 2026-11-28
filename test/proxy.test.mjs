/* eslint @typescript-eslint/explicit-function-return-type: "off" -- JavaScript fixtures. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const quiet = {
  log: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined
}
const tick = () => new Promise((resolve) => setImmediate(resolve))
function gate() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function load(file, dependencies = {}, extra = '', globals = {}) {
  const source = fs.readFileSync(file, 'utf8') + '\n' + extra
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }).outputText
  const module = { exports: {} }
  const bindings = { console: quiet, ...globals }
  new Function('require', 'module', 'exports', ...Object.keys(bindings), code)(
    (name) => (name in dependencies ? dependencies[name] : require(name)),
    module,
    module.exports,
    ...Object.values(bindings)
  )
  return module.exports
}
const pool = load('src/main/proxy/accountPool.ts')
const network = { getCachedProxyAgent: () => undefined, getSystemProxy: () => undefined }
const token = {
  countTokens: (text) => text.length,
  getModelContextLength: () => 200000,
  setModelContextWindow: () => undefined,
  getModelContextWindow: () => undefined
}
const apiDependencies = {
  '../../shared/async': load('src/shared/async.ts'),
  './logger': { proxyLogger: quiet },
  '../kproxy': { getKProxyService: () => null },
  '../kproxy/types': { DEVICE_ID_HEADER: 'x-kproxy-device-id' },
  './systemProxy': network,
  './tokenCounter': token,
  '../kiroAuthSync': {
    KIRO_BUILDER_ID_PLACEHOLDER_ARN: 'arn:fixture',
    KIRO_SOCIAL_PROFILE_ARN: 'arn:social',
    isPlaceholderProfileArn: () => false,
    getEnterpriseFallbackArn: () => 'arn:enterprise'
  }
}
function loadApi(globals = {}, deps = {}) {
  return load(
    'src/main/proxy/kiroApi.ts',
    { ...apiDependencies, ...deps },
    'exports.parse = parseEventStream; exports.cachedModels = getCachedKiroModels; exports.conversationId = resolveConversationId; exports.conversations = conversationCache;',
    globals
  )
}
const api = loadApi()
const registry = load('src/main/proxy/toolNameRegistry.ts')
const translator = load('src/main/proxy/translator.ts', {
  './kiroApi': api,
  './toolNameRegistry': registry
})
const cache = load('src/main/proxy/promptCacheTracker.ts', { './kiroApi': api })
function loadServer(apiOverrides = {}, globals = {}, dependencies = {}) {
  return load(
    'src/main/proxy/proxyServer.ts',
    {
      './accountPool': pool,
      './kiroApi': { ...api, ...apiOverrides },
      './logger': { proxyLogger: quiet },
      '../kproxy': { getKProxyService: () => null },
      './systemProxy': network,
      './translator': translator,
      './toolNameRegistry': registry,
      './promptCacheTracker': cache,
      './steeringLoader': { loadSteeringDocuments: () => [], formatSteeringForPrompt: () => '' },
      electron: { app: { getPath: () => { throw Error('A temporary profile is required for certificate tests') } } },
      './selfSignedCert': load('src/main/proxy/selfSignedCert.ts'),
      ...dependencies
    },
    '',
    globals
  ).ProxyServer
}
const ProxyServer = loadServer()
function account(id, extra = {}) {
  return { id, accessToken: 'access-' + id, profileArn: 'arn:fixture', ...extra }
}
const usage = {
  inputTokens: 42,
  outputTokens: 7,
  credits: 1.25,
  cacheReadTokens: 10,
  cacheWriteTokens: 2,
  reasoningTokens: 3
}
function payload() {
  return {
    conversationState: {
      currentMessage: { userInputMessage: { content: 'fixture', modelId: 'CLAUDE_FIXTURE' } },
      history: []
    }
  }
}
function frame(type, data) {
  const name = Buffer.from(':event-type'),
    value = Buffer.from(type),
    body = Buffer.from(JSON.stringify(data))
  const headers = Buffer.alloc(name.length + value.length + 4)
  headers[0] = name.length
  name.copy(headers, 1)
  headers[name.length + 1] = 7
  headers.writeUInt16BE(value.length, name.length + 2)
  value.copy(headers, name.length + 4)
  const result = Buffer.alloc(16 + headers.length + body.length)
  result.writeUInt32BE(result.length, 0)
  result.writeUInt32BE(headers.length, 4)
  headers.copy(result, 12)
  body.copy(result, headers.length + 12)
  return result
}
function stream(frames) {
  return new ReadableStream({
    start(controller) {
      for (const part of frames) controller.enqueue(part)
      controller.close()
    }
  })
}
function response() {
  const res = new EventEmitter()
  return Object.assign(res, {
    data: '',
    headersSent: false,
    writableNeedDrain: false,
    writableEnded: false,
    setHeader: () => undefined,
    writeHead(status) {
      this.status = status
      this.headersSent = true
    },
    write(value) {
      this.data += value
      return !this.writableNeedDrain
    },
    end(value = '') {
      this.data += value
      this.writableEnded = true
    }
  })
}
function logger(write = async () => undefined) {
  const { proxyLogStore } = load('src/main/proxy/logger.ts', {
    fs: { ...fs, promises: { ...fs.promises, writeFile: write } },
    '../utils/redact': { redactString: (v) => v, redactValue: (v) => v }
  })
  proxyLogStore.scheduleSave = () => undefined
  return proxyLogStore
}
const entry = (i) => ({
  timestamp: new Date(1700000000000 + i).toISOString(),
  level: 'INFO',
  category: 'fixture',
  message: '' + i
})

test('bounded logs retain order, incremental cursors and legacy reads across wrap/clear', async () => {
  const logs = logger()
  logs.maxLogs = 3
  for (let i = 0; i < 3; i++) logs.add(entry(i))
  const first = logs.getBatch()
  assert.equal(first.reset, true)
  logs.add(entry(3))
  logs.add(entry(4))
  assert.deepEqual(
    logs.getAll().map((v) => v.message),
    ['2', '3', '4']
  )
  assert.deepEqual(
    logs.getLast(2).map((v) => v.message),
    ['3', '4']
  )
  assert.deepEqual(
    logs.getBatch(first.cursor).entries.map((v) => v.message),
    ['3', '4']
  )
  assert.equal(logs.getBatch(0).reset, true)
  assert.equal(logs.getBatch(5).entries.length, 0)
  logs.clear()
  await logs.flushSaveNow()
  assert.equal(logs.getBatch(5).reset, true)
  assert.equal(logs.count(), 0)
})
test('log flush joins pending writes and persists the latest ordered snapshot', async () => {
  const slow = gate(),
    writes = []
  let active = 0,
    peak = 0
  const logs = logger(async (_path, content) => {
    active++
    peak = Math.max(peak, active)
    writes.push(JSON.parse(content))
    await slow.promise
    active--
  })
  logs.add(entry(1))
  const saving = logs.save()
  logs.add(entry(2))
  let flushed = false
  const flush = logs.flushSaveNow().then(() => {
    flushed = true
  })
  await tick()
  assert.equal(flushed, false)
  slow.resolve()
  await Promise.all([saving, flush])
  assert.equal(peak, 1)
  assert.equal(writes.at(-1).length, 2)
})
test('real upstream usage avoids eager tokenizer work; absent usage retains exact fallback', async () => {
  let calls = 0
  const parser = loadApi(
    {},
    {
      './tokenCounter': {
        ...token,
        countTokens: () => {
          calls++
          return 123
        }
      }
    }
  )
  let actual
  await parser.parse(
    stream([
      frame('messageMetadataEvent', { tokenUsage: { uncachedInputTokens: 42, outputTokens: 7 } })
    ]),
    () => {},
    (u) => {
      actual = u
    },
    0,
    undefined,
    'auto',
    'payload'
  )
  assert.equal(calls, 0)
  assert.equal(actual.inputTokens, 42)
  await parser.parse(
    stream([]),
    () => {},
    (u) => {
      actual = u
    },
    0,
    undefined,
    'auto',
    'payload'
  )
  assert.equal(calls, 1)
  assert.equal(actual.inputTokens, 123)
})
test('context usage keeps precedence over fallback regardless of metadata ordering', async () => {
  for (const frames of [
    [frame('contextUsageEvent', { contextUsagePercentage: 10 })],
    [
      frame('metadataEvent', { inputTokens: 42 }),
      frame('contextUsageEvent', { contextUsagePercentage: 10 })
    ],
    [
      frame('contextUsageEvent', { contextUsagePercentage: 10 }),
      frame('metadataEvent', { inputTokens: 42 })
    ]
  ]) {
    let actual
    await api.parse(
      stream(frames),
      () => {},
      (u) => {
        actual = u
      },
      0,
      undefined,
      'auto',
      'payload'
    )
    assert.equal(actual.inputTokens, frames.length === 1 ? 20000 : 42)
  }
})
test('event parser supports coalesced and byte-fragmented UTF-8 frames without copying the remainder', async () => {
  const data = Buffer.concat([
    frame('assistantResponseEvent', { content: '你好' }),
    frame('codeEvent', { content: 'world' })
  ])
  for (const parts of [[data], Array.from(data, (_, i) => data.subarray(i, i + 1))]) {
    let text = ''
    await api.parse(
      stream(parts),
      (chunk) => {
        text += chunk
      },
      () => {}
    )
    assert.equal(text, '你好world')
  }
  let allocated = 0
  class Bytes extends Uint8Array {
    constructor(...args) {
      super(...args)
      allocated += this.byteLength
    }
  }
  const measured = loadApi({ Uint8Array: Bytes })
  const frames = Array.from({ length: 1500 }, () => frame('metadataEvent', { inputTokens: 42 }))
  const burst = Buffer.concat(frames)
  await measured.parse(
    stream([burst]),
    () => {},
    () => {}
  )
  assert.ok(allocated < burst.length * 2, `Unexpected ${allocated} bytes allocated`)
})
test('event parser awaits downstream backpressure before processing the next event', async () => {
  const hold = gate(),
    seen = []
  const parsing = api.parse(
    stream([
      Buffer.concat([
        frame('assistantResponseEvent', { content: 'one' }),
        frame('assistantResponseEvent', { content: 'two' })
      ])
    ]),
    async (chunk) => {
      seen.push(chunk)
      if (seen.length === 1) await hold.promise
    },
    () => {}
  )
  await tick()
  assert.deepEqual(seen, ['one'])
  hold.resolve()
  await parsing
  assert.deepEqual(seen, ['one', 'two'])
})
test('malformed and incomplete frames fail instead of spinning or reporting success', async () => {
  await assert.rejects(
    api.parse(
      stream([Buffer.alloc(16)]),
      () => {},
      () => {}
    ),
    /Invalid event/
  )
  const broken = frame('metadataEvent', { inputTokens: 3 }).subarray(0, 20)
  await assert.rejects(
    api.parse(
      stream([broken]),
      () => {},
      () => {}
    ),
    /Incomplete event/
  )
})
test('signature errors before output recover once, without changing the caller payload', async () => {
  let requests = 0,
    inputBodies = [],
    complete = false
  const fixture = loadApi({
    fetch: async (_url, options) => {
      requests++
      inputBodies.push(JSON.parse(options.body))
      return new Response(
        stream(
          requests === 1
            ? [frame('exception', { _type: 'error', message: 'THINKING_SIGNATURE_INVALID' })]
            : [frame('metadataEvent', usage)]
        )
      )
    }
  })
  const input = payload()
  input.conversationState.history = [
    { assistantResponseMessage: { content: 'old', reasoningContent: { signature: 'bad' } } }
  ]
  const before = JSON.stringify(input)
  await fixture.callKiroApiStream(
    account('a'),
    input,
    () => {},
    () => {
      complete = true
    },
    (e) => {
      throw e
    }
  )
  assert.equal(requests, 2)
  assert.equal(complete, true)
  assert.equal(JSON.stringify(input), before)
  assert.equal(
    inputBodies[1].conversationState.history[0].assistantResponseMessage.reasoningContent,
    undefined
  )
})
test('upstream errors after emitted content never replay it on another endpoint', async () => {
  let requests = 0,
    text = '',
    error
  const fixture = loadApi({
    fetch: async () => {
      requests++
      return new Response(
        stream([
          frame('assistantResponseEvent', { content: 'partial' }),
          frame('exception', { _type: 'error', message: 'API error 503 fixture' })
        ])
      )
    }
  })
  await fixture.callKiroApiStream(
    account('a'),
    payload(),
    (value) => {
      text += value
    },
    () => assert.fail('unexpected success'),
    (e) => {
      error = e
    }
  )
  assert.equal(requests, 1)
  assert.equal(text, 'partial')
  assert.match(error.message, /503/)
})
test('quota endpoint fallback releases bodies and carries status to account retry', async () => {
  let requests = 0,
    canceled = 0,
    error
  const fixture = loadApi({
    fetch: async () => {
      requests++
      return {
        status: 429,
        body: {
          cancel: async () => {
            canceled++
          }
        }
      }
    }
  })
  await fixture.callKiroApiStream(
    account('a'),
    payload(),
    () => {},
    () => {},
    (e) => {
      error = e
    }
  )
  assert.equal(requests, 2)
  assert.equal(canceled, 2)
  assert.equal(fixture.getKiroErrorStatus(error), 429)
})
test('nonstream calls honor the selected endpoint and preserve response shape', async () => {
  const urls = []
  const fixture = loadApi({
    fetch: async (url) => {
      urls.push(url)
      return new Response(
        stream([
          frame('assistantResponseEvent', { content: 'answer' }),
          frame('metadataEvent', usage)
        ])
      )
    }
  })
  const result = await fixture.callKiroApi(account('a'), payload(), undefined, 'amazonq-cli')
  assert.equal(urls.length, 1)
  assert.match(urls[0], /SendMessageStreaming/)
  assert.equal(result.content, 'answer')
  assert.equal(result.usage.inputTokens, 42)
})
test('model cache misses share work; one waiter abort does not cancel another waiter', async () => {
  const hold = gate()
  let requests = 0
  const fixture = loadApi({
    fetch: async () => {
      requests++
      await hold.promise
      return { ok: true, json: async () => ({ models: [{ modelId: 'fixture' }] }) }
    }
  })
  const abort = new AbortController()
  const first = fixture.cachedModels(account('a'), abort.signal)
  const second = fixture.cachedModels(account('a'))
  abort.abort()
  await assert.rejects(first)
  hold.resolve()
  assert.equal((await second).length, 1)
  assert.equal(requests, 1)
})
test('conversation cache enforces its advertised bound and reuses active conversation IDs', () => {
  for (let i = 0; i < 1200; i++) api.conversationId([], 'session-' + i)
  assert.equal(api.conversations.size, 1000)
  assert.equal(api.conversationId([], 'session-1199'), api.conversationId([], 'session-1199'))
})
test('cache-free prompts skip tokenization and lazy payload serialization entirely', () => {
  let calls = 0
  const module = load('src/main/proxy/promptCacheTracker.ts', {
    './kiroApi': {
      estimateTokens: () => {
        calls++
        return 1
      }
    }
  })
  const tracker = new module.PromptCacheTracker()
  const result = tracker.buildClaudeProfile(
    'system',
    [{ role: 'user', content: 'input' }],
    [],
    () => {
      throw Error('must stay lazy')
    },
    'auto'
  )
  assert.equal(result, null)
  assert.equal(calls, 0)
  assert.ok(
    tracker.buildClaudeProfile(
      [{ type: 'text', text: 'cached', cache_control: { type: 'ephemeral' } }],
      [],
      [],
      () => 100,
      'auto'
    )
  )
})
test('concurrent round-robin selection distributes requests; sticky remains sticky', () => {
  const accounts = new pool.AccountPool()
  accounts.addAccount(account('a'))
  accounts.addAccount(account('b'))
  assert.deepEqual(
    Array.from({ length: 6 }, () => accounts.getNextAccount().id),
    ['a', 'b', 'a', 'b', 'a', 'b']
  )
  accounts.setStrategy('sticky')
  const selected = accounts.getNextAccount()
  accounts.recordSuccess(selected.id)
  assert.equal(accounts.getNextAccount().id, selected.id)
})
test('pool fallback excludes suspended, exhausted and unrefreshable expired accounts', () => {
  const accounts = new pool.AccountPool()
  accounts.addAccount(account('a'))
  accounts.addAccount(account('b'))
  accounts.addAccount(account('c', { expiresAt: 1 }))
  accounts.markSuspended('a', 'suspended')
  accounts.recordError('b', pool.ErrorType.RECOVERABLE, 429)
  assert.equal(accounts.getNextAccount(), null)
  assert.equal(accounts.getNextAvailableAccount('b'), null)
})
test('pool synchronization preserves runtime state and removes absent accounts', () => {
  const accounts = new pool.AccountPool()
  accounts.addAccount(account('a'))
  accounts.addAccount(account('b'))
  accounts.recordSuccess('a', 7)
  accounts.markSuspended('a', 'suspended')
  accounts.syncAccounts([account('a', { groupId: 'new', proxyUrl: 'http://fixture' })])
  assert.equal(accounts.size, 1)
  assert.equal(accounts.getAccount('a').requestCount, 1)
  assert.equal(accounts.getAccount('a').suspendReason, 'suspended')
  assert.equal(accounts.getAccount('a').proxyUrl, 'http://fixture')
})
test('request admission enforces concurrency and removes aborted waiters', async () => {
  const server = new ProxyServer({ maxConcurrent: 1 }),
    first = new AbortController(),
    queued = new AbortController()
  const release = await server.acquireInference(first.signal)
  let admitted = false
  const waiting = server.acquireInference(queued.signal).then(() => {
    admitted = true
  })
  queued.abort()
  await assert.rejects(waiting)
  assert.equal(admitted, false)
  assert.equal(server.waitingInference.size, 0)
  release()
  const next = await server.acquireInference(first.signal)
  next()
  assert.equal(server.activeInference, 0)
})
test('retry selection and refresh fallback obey API key/group restrictions', async () => {
  const server = new ProxyServer({
    apiKeyAccountBindings: { key: ['a'] },
    multiAccountSelectionMode: 'groups',
    multiAccountGroupIds: ['allowed']
  })
  server.accountPool.addAccount(account('a', { groupId: 'allowed' }))
  server.accountPool.addAccount(account('b', { groupId: 'other' }))
  const chosen = await server.getAvailableAccount(undefined, undefined, 'key'),
    tried = []
  await assert.rejects(
    server.callWithRetry(
      chosen,
      async (candidate) => {
        tried.push(candidate.id)
        throw Error('Auth error 403 fixture')
      },
      '/',
      undefined,
      'key'
    )
  )
  assert.deepEqual(tried, ['a'])
  server.accountPool.updateAccount('a', { expiresAt: 1, refreshToken: 'r' })
  server.refreshToken = async () => false
  assert.equal(await server.getAvailableAccount(undefined, undefined, 'key'), null)
})
test('zero retry setting still performs the initial request exactly once', async () => {
  const server = new ProxyServer({ maxRetries: 0 })
  let calls = 0
  await assert.rejects(
    server.callWithRetry(
      account('a'),
      async () => {
        calls++
        throw Error('API error 503 fixture')
      },
      '/'
    )
  )
  assert.equal(calls, 1)
})
test('shared token refresh persists after initiating request disconnects, but ignores stale rotation', async () => {
  const hold = gate(),
    updates = []
  const server = new ProxyServer(
    {},
    { onTokenRefresh: () => hold.promise, onAccountUpdate: (...args) => updates.push(args) }
  )
  server.waitForRetry = async () => {}
  const original = account('a', { refreshToken: 'old' })
  server.accountPool.addAccount(original)
  const controller = new AbortController(),
    running = server.refreshToken(original, controller.signal)
  await tick()
  controller.abort()
  await assert.rejects(running)
  hold.resolve({
    success: true,
    accessToken: 'new',
    refreshToken: 'rotated',
    expiresAt: Date.now() + 3600000
  })
  await tick()
  assert.equal(server.accountPool.getAccount('a').refreshToken, 'rotated')
  assert.equal(updates[0][1], 'old')
  const stale = gate()
  server.events.onTokenRefresh = () => stale.promise
  const pending = server.refreshToken(server.accountPool.getAccount('a'))
  await tick()
  server.accountPool.updateAccount('a', { refreshToken: 'newer' })
  stale.resolve({ success: true, accessToken: 'late', refreshToken: 'outdated' })
  await pending
  assert.equal(server.accountPool.getAccount('a').refreshToken, 'newer')
})
test('stop clears the old force timer and cannot destroy restarted connections', async () => {
  let timer,
    cleared = false,
    destroyed = false
  const Server = loadServer(
    {},
    {
      setTimeout: (fn) => {
        timer = fn
        return 123
      },
      clearTimeout: (id) => {
        if (id === 123) cleared = true
      }
    }
  )
  const server = new Server()
  server.server = { close: (cb) => queueMicrotask(cb) }
  await server.stop()
  server.server = {}
  server.sockets.add({
    destroy() {
      destroyed = true
    }
  })
  timer()
  assert.equal(cleared, true)
  assert.equal(destroyed, false)
})
test('stream retries before output use allowed replacement accounts, and never replay partial output', async () => {
  for (const partial of [false, true]) {
    const tried = [],
      output = []
    let completed, error
    const Server = loadServer({
      callKiroApiStream: async (candidate, _payload, chunk, complete, fail) => {
        tried.push(candidate.id)
        if (candidate.id === 'a') {
          if (partial) await chunk('partial')
          fail(new api.KiroApiError('API error 429 fixture', 429))
        } else {
          await chunk('answer')
          complete(usage)
        }
      }
    })
    const server = new Server()
    server.accountPool.addAccount(account('a'))
    server.accountPool.addAccount(account('b'))
    await server.runKiroStream(
      account('a'),
      payload(),
      (value) => output.push(value),
      (_usage, candidate) => {
        completed = candidate.id
      },
      (e) => {
        error = e
      }
    )
    assert.deepEqual(tried, partial ? ['a'] : ['a', 'b'])
    assert.equal(completed, partial ? undefined : 'b')
    assert.equal(!!error, partial)
  }
})
test('Responses delivers text before upstream completion and retains tool IDs/arguments/final usage', async () => {
  const hold = gate()
  const Server = loadServer({
    callKiroApiStream: async (_account, _payload, chunk, complete) => {
      await chunk('first')
      await hold.promise
      await chunk(' second')
      await chunk('', { toolUseId: 'call-1', name: 'lookup', input: { value: 7 } })
      complete(usage)
    }
  })
  const server = new Server(),
    res = response()
  server.accountPool.addAccount(account('a'))
  const running = server.handleResponsesStream(
    res,
    account('a'),
    payload(),
    'fixture',
    Date.now(),
    undefined,
    new registry.ToolNameRegistry(),
    'previous'
  )
  await tick()
  assert.match(res.data, /response.output_text.delta/)
  assert.equal(res.writableEnded, false)
  hold.resolve()
  await running
  const events = res.data
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)))
  const final = events.find((event) => event.type === 'response.completed').response
  assert.equal(final.previous_response_id, 'previous')
  assert.equal(final.output[0].content[0].text, 'first second')
  assert.equal(final.output[1].call_id, 'call-1')
  assert.equal(final.output[1].arguments, '{"value":7}')
  assert.equal(final.usage.input_tokens, 42)
})
for (const kind of ['openai', 'claude', 'responses', 'gemini']) {
  for (const streaming of [false, true]) {
    test(`${kind} ${streaming ? 'stream' : 'nonstream'} shares complete usage/key accounting`, async () => {
      let saved = 0
      const Server = loadServer({
        callKiroApi: async () => ({ content: 'answer', toolUses: [], usage }),
        callKiroApiStream: async (_account, _payload, chunk, complete) => {
          await chunk('answer')
          complete(usage)
        }
      })
      const key = {
        id: 'key',
        key: 'fixture',
        enabled: true,
        usage: {
          totalRequests: 0,
          totalCredits: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          daily: {}
        }
      }
      const server = new Server({ apiKeys: [key] }, { onConfigChanged: () => saved++ })
      server.accountPool.addAccount(account('a'))
      const req = { headers: {}, matchedApiKey: key },
        res = response()
      const bodies = {
        openai: {
          model: 'auto',
          messages: [{ role: 'user', content: 'hello' }],
          stream: streaming
        },
        claude: {
          model: 'auto',
          messages: [{ role: 'user', content: 'hello' }],
          max_tokens: 100,
          stream: streaming
        },
        responses: { model: 'auto', input: 'hello', stream: streaming },
        gemini: { contents: [{ parts: [{ text: 'hello' }] }] }
      }
      server.readBody = async () => JSON.stringify(bodies[kind])
      if (kind === 'openai') await server.handleOpenAIChat(req, res)
      if (kind === 'claude') await server.handleClaudeMessages(req, res)
      if (kind === 'responses') await server.handleOpenAIResponses(req, res)
      if (kind === 'gemini')
        await server.handleGeminiRequest(
          req,
          res,
          '/v1beta/models/auto:' + (streaming ? 'streamGenerateContent' : 'generateContent')
        )
      assert.equal(server.getStats().totalCredits, 1.25)
      assert.equal(server.getStats().inputTokens, 42)
      assert.equal(server.getStats().cacheReadTokens, 10)
      assert.equal(key.usage.totalRequests, 1)
      assert.equal(saved, 1)
      assert.equal(res.writableEnded, true)
    })
  }
}

function extract(sourcePath, select, bindings) {
  bindings.accountWork ??= new (load('src/main/accountWork.ts').AccountWork)()
  bindings.pendingAccountCredentials ??= new (load('src/main/accountCredentials.ts').PendingAccountCredentials)()

  const source = fs.readFileSync(sourcePath, 'utf8')
  const ast = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  let expression
  function visit(node) {
    if (select(node, ast)) expression = select(node, ast).getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(expression, 'Missing production callback')
  const code = ts.transpileModule(`const run = (${expression});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText
  return new Function('bindings', `with (bindings) { ${code}; return run }`)(bindings)
}

test('proxy credential IPC persists rotation, preserves unrelated data and rejects stale updates', () => {
  const account = {
    id: 'a',
    nickname: 'keep',
    usage: { current: 3 },
    credentials: { accessToken: 'old', refreshToken: 'old', region: 'keep' }
  }
  const changes = []
  const callback = extract(
    'src/renderer/src/App.tsx',
    (node, ast) =>
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === 'window.api.onProxyAccountUpdate'
        ? node.arguments[0]
        : undefined,
    {
      useAccountsStore: { getState: () => ({ accounts: new Map([['a', account]]) }) },
      updateAccount: (_id, patch) => {
        changes.push(patch)
        Object.assign(account, patch)
      }
    }
  )
  callback({
    id: 'a',
    expectedRefreshToken: 'old',
    accessToken: 'new',
    refreshToken: 'rotated',
    expiresAt: 1234
  })
  assert.equal(account.credentials.refreshToken, 'rotated')
  assert.equal(account.credentials.region, 'keep')
  assert.equal(account.nickname, 'keep')
  callback({ id: 'a', expectedRefreshToken: 'old', refreshToken: 'late' })
  assert.equal(changes.length, 1)
  callback({ id: 'a', profileArn: 'arn:new' })
  assert.equal(account.profileArn, 'arn:new')
  assert.equal(account.credentials.refreshToken, 'rotated')
})
test('main proxy updates retain a credential snapshot when no renderer exists', () => {
  const saved = [],
    env = {
      lastSavedData: { accounts: { a: { credentials: { refreshToken: 'old', region: 'keep' } } } },
      mainWindow: null,
      store: { set: (_key, value) => saved.push(structuredClone(value)) }
    }
  env.persistAccountData = (value) => { env.store.set('accountData', value); env.lastSavedData = value }
  const callback = extract(
    'src/main/index.ts',
    (node) =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'persistProxyAccountUpdate'
        ? node
        : undefined,
    env
  )
  callback({ id: 'a', accessToken: 'new', refreshToken: 'rotated', expiresAt: 1234 }, 'old')
  assert.equal(saved[0].accounts.a.credentials.refreshToken, 'rotated')
  assert.equal(saved[0].accounts.a.credentials.region, 'keep')
  callback({ id: 'a', refreshToken: 'stale' }, 'old')
  assert.equal(saved.length, 1)
})
test('manual pool synchronization resolves bound proxy and retains runtime suspension', () => {
  const server = new ProxyServer(),
    old = account('a', { groupId: 'old' })
  server.accountPool.addAccount(old)
  server.accountPool.markSuspended('a', 'suspended')
  const callback = extract(
    'src/main/index.ts',
    (node, ast) =>
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === 'ipcMain.handle' &&
      node.arguments[0]?.text === 'proxy-sync-accounts'
        ? node.arguments[1]
        : undefined,
    {
      initProxyServer: () => server,
      lastSavedData: {
        accountProxyBindings: { a: 'p' },
        proxyPool: { p: { enabled: true, url: 'http://fixture-proxy' } }
      },
      console: quiet
    }
  )
  assert.equal(callback(null, [account('a', { groupId: 'new' })]).success, true)
  assert.equal(server.accountPool.getAccount('a').groupId, 'new')
  assert.equal(server.accountPool.getAccount('a').proxyUrl, 'http://fixture-proxy')
  assert.equal(server.accountPool.getAccount('a').suspendReason, 'suspended')
})
test('lazy pool synchronization carries grouping and proxy data into account selection', async () => {
  const server = new ProxyServer({
    multiAccountSelectionMode: 'groups',
    multiAccountGroupIds: ['group']
  })
  const callback = extract(
    'src/main/index.ts',
    (node) =>
      ts.isPropertyAssignment(node) && node.name.getText() === 'onPoolEmpty'
        ? node.initializer
        : undefined,
    {
      proxyServer: server,
      initStore: async () => undefined,
      console: quiet,
      store: {
        get: () => ({
          accounts: {
            a: {
              id: 'a',
              status: 'active',
              groupId: 'group',
              credentials: { accessToken: 'fixture' }
            }
          },
          accountProxyBindings: { a: 'p' },
          proxyPool: { p: { enabled: true, url: 'http://fixture-proxy' } }
        })
      }
    }
  )
  server.events.onPoolEmpty = callback
  const selected = await server.getAvailableAccount()
  assert.equal(selected.id, 'a')
  assert.equal(selected.groupId, 'group')
  assert.equal(selected.proxyUrl, 'http://fixture-proxy')
})
test('token trimming preserves exact byte accounting and complete user/assistant boundaries', () => {
  const fixture = load(
    'src/main/proxy/kiroApi.ts',
    apiDependencies,
    'exports.trim = trimHistoryByTokens;'
  )
  const input = payload()
  input.conversationState.history = Array.from({ length: 20 }, (_, i) =>
    i % 2
      ? { assistantResponseMessage: { content: '回复'.repeat(80) } }
      : { userInputMessage: { content: '输入'.repeat(80) } }
  )
  const result = fixture.trim(input, 500)
  assert.equal(
    result.finalTokens,
    Math.ceil(Buffer.byteLength(JSON.stringify(input), 'utf8') / 3.5)
  )
  assert.ok(result.trimmed > 0)
  assert.ok(input.conversationState.history[0].userInputMessage)
})
test('fresh credentials restore refresh-disabled accounts without clearing suspensions', () => {
  const accounts = new pool.AccountPool()
  accounts.addAccount(account('a'))
  accounts.markNeedsRefresh('a')
  accounts.updateAccount('a', { accessToken: 'fresh' })
  assert.equal(accounts.getAccount('a').isAvailable, true)
  accounts.markSuspended('a', 'suspended')
  accounts.updateAccount('a', { accessToken: 'newer' })
  assert.equal(accounts.getAccount('a').isAvailable, false)
})

test('real local HTTP/SSE delivers Responses deltas before completion and preserves Claude thinking/tools', async () => {
  const hold = gate()
  let requests = 0
  const upstream = loadApi({
    fetch: async (url) => {
      if (url.includes('ListAvailableModels'))
        return Response.json({ models: [{ modelId: 'CLAUDE_FIXTURE', modelName: 'fixture' }] })
      requests++
      const body = new ReadableStream({
        async start(controller) {
          controller.enqueue(frame('assistantResponseEvent', { content: 'answer' }))
          if (requests === 1) await hold.promise
          controller.enqueue(
            frame('reasoningContentEvent', { text: 'plan', signature: 'signature' })
          )
          controller.enqueue(
            frame('toolUseEvent', { toolUseId: 'call-1', name: 'lookup', input: '{"value":7}' })
          )
          controller.enqueue(frame('toolUseEvent', { stop: true }))
          controller.enqueue(frame('metadataEvent', { inputTokens: 42, outputTokens: 7 }))
          controller.enqueue(frame('meteringEvent', { usage: 1.25 }))
          controller.close()
        }
      })
      return new Response(body)
    }
  })
  const Server = loadServer(upstream),
    server = new Server({ port: 0, host: '127.0.0.1' })
  server.accountPool.addAccount(account('a'))
  await server.start()
  const base = 'http://127.0.0.1:' + server.server.address().port
  try {
    const result = await fetch(base + '/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'auto', input: 'hello', stream: true }),
      signal: AbortSignal.timeout(5000)
    })
    assert.equal(result.status, 200)
    const reader = result.body.getReader(),
      decoder = new TextDecoder()
    let text = ''
    while (!text.includes('response.output_text.delta')) {
      const next = await reader.read()
      assert.equal(next.done, false)
      text += decoder.decode(next.value)
    }
    assert.equal(text.includes('response.completed'), false)
    hold.resolve()
    while (true) {
      const next = await reader.read()
      if (next.done) break
      text += decoder.decode(next.value)
    }
    assert.match(text, /response.function_call_arguments.delta/)
    assert.match(text, /response.completed/)
    const claude = await fetch(base + '/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'auto',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 100,
        stream: true
      }),
      signal: AbortSignal.timeout(5000)
    })
    const sse = await claude.text()
    assert.match(sse, /"thinking":"plan"/)
    assert.match(sse, /"signature":"signature"/)
    assert.match(sse, /input_json_delta/)
    assert.match(sse, /"stop_reason":"tool_use"/)
    assert.equal(server.getStats().successRequests, 2)
    assert.equal(server.getStats().totalCredits, 2.5)
  } finally {
    hold.resolve()
    await server.stop(100)
  }
})

test('service shutdown waits for shared credential rotation before finishing', async () => {
  const slow = gate(),
    updates = []
  const server = new ProxyServer(
    {},
    { onTokenRefresh: () => slow.promise, onAccountUpdate: (value) => updates.push(value) }
  )
  server.waitForRetry = async () => {}
  server.accountPool.addAccount(account('a', { refreshToken: 'old' }))
  const refresh = server.refreshToken(server.accountPool.getAccount('a'))
  await tick()
  let stopped = false
  const shutdown = server.stop().then(() => {
    stopped = true
  })
  await tick()
  assert.equal(stopped, false)
  slow.resolve({ success: true, accessToken: 'new', refreshToken: 'rotated' })
  await Promise.all([refresh, shutdown])
  assert.equal(updates[0].refreshToken, 'rotated')
  assert.equal(stopped, true)
})

test('cancelled account diagnosis preserves shared refresh rotation without issuing a liveness request', async () => {
  const hold = gate()
  const controllers = []
  const saved = [], refreshed = [], calls = []
  const env = {
    lastSavedData: { accounts: { a: { credentials: { accessToken: 'current-access', refreshToken: 'current-refresh', expiresAt: 1, region: 'keep' } } } },
    mainWindow: null,
    store: { set: (_key, value) => saved.push(structuredClone(value)) },
    proxyServer: null,
    beginDiagnostic: () => { const controller = new AbortController(); controllers.push(controller); return { controller, finish: () => undefined } },
    refreshTokenByMethod: (...args) => { refreshed.push(args); return hold.promise },
    callKiroApi: (...args) => { calls.push(args); return Promise.resolve({ content: 'pong' }) },
    openaiToKiro: () => ({}),
    console: quiet
  }
  env.persistAccountData = (value) => { env.store.set('accountData', value); env.lastSavedData = value }
  env.persistProxyAccountUpdate = extract('src/main/index.ts', (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'persistProxyAccountUpdate' ? node : undefined, env)
  const callback = extract('src/main/index.ts', (node) => ts.isCallExpression(node) && node.arguments[0]?.text === 'diagnose:account-liveness' ? node.arguments[1] : undefined, env)
  const running = callback(null, { requestId: 'old-run', account: { id: 'a', accessToken: 'stale-renderer', refreshToken: 'stale-renderer', expiresAt: 1 } })
  controllers[0].abort()
  const cancelled = await running
  assert.equal(cancelled.success, false)
  assert.equal(refreshed[0][0], 'current-refresh')
  assert.equal(calls.length, 0)
  hold.resolve({ success: true, accessToken: 'new-access', refreshToken: 'rotated', expiresIn: 600 })
  await tick()
  assert.equal(saved.at(-1).accounts.a.credentials.refreshToken, 'rotated')
  assert.equal(saved.at(-1).accounts.a.credentials.region, 'keep')
  assert.ok(saved.at(-1).accounts.a.credentials.expiresAt > Date.now())
})

test('K-Proxy auto-start is independent of the API proxy auto-start setting', async () => {
  for (const autoStart of [false, true]) {
    let initialized = 0, started = 0
    const callback = extract('src/main/index.ts', (node, ast) => ts.isCallExpression(node) && node.expression.getText(ast) === 'setTimeout' && node.arguments[0]?.getText(ast).includes('// K-Proxy MITM 自启动') ? node.arguments[0] : undefined, {
      initStore: async () => undefined,
      store: { get: (key) => key === 'kproxyConfig' ? { autoStart } : { autoStart: false } },
      configuredKProxyService: () => ({ initialize: async () => { initialized++ }, start: async () => { started++ } }),
      console: quiet
    })
    await callback()
    assert.equal(initialized, Number(autoStart))
    assert.equal(started, Number(autoStart))
  }
})

test('certificate installation passes paths as individual command arguments without invoking a shell', async () => {
  const commands = []
  const certificatePath = '/fixture/path with spaces/$literal-ca.crt'
  const callback = extract('src/main/index.ts', (node) => ts.isCallExpression(node) && node.arguments[0]?.text === 'kproxy-install-ca-cert' ? node.arguments[1] : undefined, {
    getKProxyService: () => ({ getCACertInfo: () => ({ certPath: certificatePath }) }),
    process: { platform: 'darwin' },
    app: { getPath: () => '/fixture/home' },
    join: (...parts) => parts.join('/'),
    runCertificateCommand: async (...args) => { commands.push(args); return { stdout: '', stderr: '' } },
    console: quiet
  })
  assert.equal((await callback()).success, true)
  assert.deepEqual(commands, [['security', ['add-trusted-cert', '-r', 'trustRoot', '-k', '/fixture/home/Library/Keychains/login.keychain-db', certificatePath]]])
})

test('Kiro requests attach each account mapping only when using the local K-Proxy route', async () => {
  const local = {}, bound = {}, requests = []
  const service = { isRunning: () => true, getConfig: () => ({ host: '127.0.0.1', port: 8899 }), getDeviceIdForAccount: (id) => id === 'a' ? 'a'.repeat(64) : 'b'.repeat(64) }
  const client = load('src/main/proxy/kiroApi.ts', {
    ...apiDependencies,
    '../kproxy': { getKProxyService: () => service },
    './systemProxy': { getCachedProxyAgent: (url) => url === 'http://127.0.0.1:8899' ? local : url === 'http://bound:8080' ? bound : undefined, getSystemProxy: () => undefined },
    undici: { fetch: async (_url, options) => { requests.push(options); return new Response('fixture') } }
  }, 'exports.fetchWithProxy = fetchWithProxy;')
  client.setUseKProxyForApiInProxy(true)
  await Promise.all([
    client.fetchWithProxy('https://example.test', {}, account('a', { machineId: 'c'.repeat(64) })),
    client.fetchWithProxy('https://example.test', {}, account('b')),
    client.fetchWithProxy('https://example.test', {}, account('external', { proxyUrl: 'http://bound:8080' }))
  ])
  assert.equal(requests[0].headers.get('x-kproxy-device-id'), 'a'.repeat(64))
  assert.equal(requests[1].headers.get('x-kproxy-device-id'), 'b'.repeat(64))
  assert.equal(requests[2].headers.has('x-kproxy-device-id'), false)
  assert.equal(requests[2].dispatcher, bound)
})

test('subscription endpoints pass cancellation signals and consume successful response bodies', async () => {
  let reads = 0, calls = 0
  const subscriptions = loadApi({ fetch: async (_url, options) => {
    calls++
    assert.ok(options.signal instanceof AbortSignal)
    return { ok: true, status: 200, text: async () => { reads++; return '{}' } }
  } }, { './systemProxy': network })
  const account = { id: 'fixture', accessToken: 'fixture', machineId: 'fixture' }
  await subscriptions.fetchAvailableSubscriptions(account)
  await subscriptions.fetchSubscriptionToken(account, 'PRO')
  assert.equal((await subscriptions.setUserPreference(account, 'ENABLED')).success, true)
  assert.equal(calls, 3); assert.equal(reads, 3)
})

test('subscription deadlines include a stalled response body', async () => {
  const deadlines = load('src/shared/async.ts', {}, '', { setTimeout: (fn, ms) => setTimeout(fn, ms === 30000 ? 5 : ms) })
  const subscriptions = loadApi({ fetch: async () => ({ ok: true, status: 200, text: () => new Promise(() => {}) }) }, { '../../shared/async': deadlines })
  const result = await subscriptions.setUserPreference({ id: 'fixture', accessToken: 'fixture' }, 'ENABLED')
  assert.equal(result.success, false); assert.match(result.error, /超时/)
})

test('subscription preference success releases a native single-connection transport for the next request', { timeout: 5000 }, async t => {
  const http = require('node:http'), { Agent, fetch } = require('undici')
  let requests = 0
  const server = http.createServer((request, response) => { request.resume(); requests++; response.end('x'.repeat(2 * 1024 * 1024)) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const agent = new Agent({ connections: 1 })
  t.after(async () => { await agent.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const subscriptions = loadApi({ fetch: (_url, options) => fetch('http://127.0.0.1:' + server.address().port, { ...options, dispatcher: agent }) })
  const account = { id: 'fixture', accessToken: 'fixture' }
  assert.equal((await subscriptions.setUserPreference(account, 'ENABLED')).success, true)
  assert.equal((await subscriptions.setUserPreference(account, 'DISABLED')).success, true)
  assert.equal(requests, 2)
})

test('automatic TLS startup coalesces concurrent starts and serves its own loopback health endpoint', async () => {
  const os = await import('node:os'), path = await import('node:path'), https = await import('node:https')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-tls-start-'))
  const Server = loadServer({}, {}, { electron: { app: { getPath: () => root } } })
  const server = new Server({ host: '127.0.0.1', port: 0, tls: { enabled: true } })
  try {
    const first = server.start(), second = server.start()
    assert.equal(first, second)
    await Promise.all([first, second])
    const port = server.server.address().port
    const status = await new Promise((resolve, reject) => {
      const request = https.get(`https://127.0.0.1:${port}/health`, { rejectUnauthorized: false }, response => { response.resume(); response.once('end', () => resolve(response.statusCode)) })
      request.once('error', reject)
    })
    assert.equal(status, 200)
    assert.ok((await server.getSelfSignedCertInfo()).fingerprint)
  } finally {
    await server.stop(0)
    fs.rmSync(root, { recursive: true, force: true })
  }
})
test('stopping during asynchronous TLS preparation waits for startup and leaves no listening server', async () => {
  const os = await import('node:os'), path = await import('node:path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-tls-stop-'))
  const Server = loadServer({}, {}, { electron: { app: { getPath: () => root } } })
  const server = new Server({ host: '127.0.0.1', port: 0, tls: { enabled: true } })
  try {
    const starting = server.start(), stopping = server.stop(0)
    await Promise.all([starting, stopping])
    assert.equal(server.isRunning(), false)
    assert.equal(server.isStarting(), false)
  } finally {
    await server.stop(0)
    fs.rmSync(root, { recursive: true, force: true })
  }
})

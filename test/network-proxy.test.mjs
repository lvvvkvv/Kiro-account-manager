/* eslint @typescript-eslint/explicit-function-return-type: "off" -- JavaScript fixtures. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import tls from 'node:tls'
import http from 'node:http'
import https from 'node:https'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { X509Certificate } from 'node:crypto'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const noop = () => undefined
const quiet = { log: noop, warn: noop, error: noop, info: noop, debug: noop }
function load(file, dependencies = {}, extra = '', globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8') + '\n' + extra, {
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
const tick = () => new Promise((resolve) => setImmediate(resolve))
const { CertManager } = load('src/main/kproxy/certManager.ts')
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-network-tests-'))
const certificates = new CertManager(path.join(base, 'ca'))
const ca = await certificates.initialize()
const leaf = await certificates.generateCertForHost('localhost')
const trustedTls = { ...tls, connect: (options) => tls.connect({ ...options, ca: ca.certPem }) }
const { ChainProxyRelay } = load('src/main/registration/chainProxy.ts', { tls: trustedTls })
const { MitmProxy } = load(
  'src/main/kproxy/mitmProxy.ts',
  {
    './types': { DEVICE_ID_HEADER: 'x-kproxy-device-id' },
    './certManager': { CertManager },
    https: {
      ...https,
      Agent: class extends https.Agent {
        constructor(options) {
          super({ ...options, ca: ca.certPem })
        }
      }
    }
  },
  'exports.MachineIdTransform = MachineIdTransform;'
)
const { MachineIdTransform } = load(
  'src/main/kproxy/mitmProxy.ts',
  { './types': { DEVICE_ID_HEADER: 'x-kproxy-device-id' }, './certManager': { CertManager } },
  'exports.MachineIdTransform = MachineIdTransform;'
)

async function listen(server) {
  const sockets = new Set()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    server,
    port: server.address().port,
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    }
  }
}
function config(patch = {}) {
  return {
    enabled: false,
    port: 0,
    host: '127.0.0.1',
    mitmDomains: ['localhost'],
    deviceId: 'b'.repeat(64),
    autoStart: false,
    logRequests: false,
    ...patch
  }
}
async function reader(socket) {
  let buffer = Buffer.alloc(0)
  const waiting = []
  let ended = false
  const notify = () => {
    for (const resolve of waiting.splice(0)) resolve()
  }
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    notify()
  })
  socket.on('close', () => {
    ended = true
    notify()
  })
  return async function response() {
    for (;;) {
      const sep = buffer.indexOf('\r\n\r\n')
      if (sep >= 0) {
        const header = buffer.toString('latin1', 0, sep)
        const length = Number(header.match(/content-length:\s*(\d+)/i)?.[1] || 0)
        if (buffer.length >= sep + 4 + length) {
          const body = buffer.subarray(sep + 4, sep + 4 + length)
          buffer = buffer.subarray(sep + 4 + length)
          return { header, body }
        }
      }
      if (ended) throw new Error('Connection closed before complete response')
      await new Promise((resolve) => waiting.push(resolve))
    }
  }
}
async function tunnel(port, host, targetPort, secure = false) {
  const socket = net.connect(port, '127.0.0.1')
  await once(socket, 'connect')
  const response = new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      const end = buffer.indexOf('\r\n\r\n')
      if (end < 0) return
      socket.pause()
      socket.removeListener('data', onData)
      if (!buffer.toString().startsWith('HTTP/1.1 200')) {
        socket.destroy()
        reject(new Error(buffer.toString()))
        return
      }
      if (buffer.length > end + 4) socket.unshift(buffer.subarray(end + 4))
      resolve(socket)
    }
    socket.on('data', onData)
    socket.once('error', reject)
  })
  socket.write(`CONNECT ${host}:${targetPort} HTTP/1.1\r\nHost: ${host}:${targetPort}\r\n\r\n`)
  await response
  if (!secure) {
    socket.resume()
    return socket
  }
  const encrypted = tls.connect({ socket, servername: host, ca: ca.certPem })
  await once(encrypted, 'secureConnect')
  return encrypted
}

test.after(() => fs.rmSync(base, { recursive: true, force: true }))

test('machine IDs spanning chunks preserve arbitrary UTF-8 and binary bytes', async () => {
  const input = Buffer.concat([
    Buffer.from('你🙂:'),
    Buffer.from('a'.repeat(64)),
    Buffer.from(':界'),
    Buffer.from([0xff, 0, 0x80])
  ])
  for (let split = 1; split < input.length; split++) {
    const transform = new MachineIdTransform('b'.repeat(64))
    const chunks = []
    transform.on('data', (chunk) => chunks.push(chunk))
    transform.write(input.subarray(0, split))
    transform.end(input.subarray(split))
    await once(transform, 'end')
    assert.deepEqual(
      Buffer.concat(chunks),
      Buffer.concat([Buffer.from('你🙂:' + 'b'.repeat(64) + ':界'), Buffer.from([0xff, 0, 0x80])])
    )
  }
})

test('certificate work yields the event loop, coalesces hostname generation and isolates CAs', async () => {
  const manager = new CertManager(path.join(base, 'other'))
  let finished = false
  const initialization = manager.initialize().then((value) => {
    finished = true
    return value
  })
  await tick()
  assert.equal(finished, false)
  const otherCa = await initialization
  const [one, two] = await Promise.all([
    manager.generateCertForHost('localhost'),
    manager.generateCertForHost('localhost')
  ])
  assert.equal(one, two)
  assert.notEqual(one.cert, leaf.cert)
  assert.equal(
    new X509Certificate(one.cert).verify(new X509Certificate(otherCa.certPem).publicKey),
    true
  )
  assert.equal(
    new X509Certificate(one.cert).verify(new X509Certificate(ca.certPem).publicKey),
    false
  )
})

test(
  'MITM forwards split bodies, chunked payloads and multiple requests on one TLS connection with per-request IDs',
  { timeout: 10000 },
  async () => {
    const received = []
    const target = await listen(
      https.createServer(leaf, async (request, response) => {
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        received.push({ body: Buffer.concat(chunks), headers: request.headers })
        const body = JSON.stringify({ index: received.length })
        response.writeHead(200, { 'Content-Length': Buffer.byteLength(body) })
        response.end(body)
      })
    )
    const proxy = new MitmProxy(certificates, config())
    let socket
    try {
      await proxy.start()
      socket = await tunnel(proxy.server.address().port, 'localhost', target.port, true)
      const response = await reader(socket)
      const body = Buffer.from('你🙂' + 'a'.repeat(64) + '尾')
      socket.write(
        `POST /first HTTP/1.1\r\nHost: localhost:${target.port}\r\nContent-Length: ${body.length}\r\nUser-Agent: KiroIDE-0.6.18-${'a'.repeat(64)}\r\nx-kproxy-device-id: ${'c'.repeat(64)}\r\n\r\n`
      )
      for (let i = 0; i < body.length; i += 3) {
        socket.write(body.subarray(i, i + 3))
        await tick()
      }
      assert.match((await response()).header, /200/)
      // Global config changes after one request must not leak between account IDs.
      proxy.updateConfig({ deviceId: 'd'.repeat(64) })
      const chunk = 'a'.repeat(64)
      socket.write(
        `POST /second HTTP/1.1\r\nHost: localhost:${target.port}\r\nTransfer-Encoding: chunked\r\nx-kproxy-device-id: ${'e'.repeat(64)}\r\n\r\n20\r\n${chunk.slice(0, 32)}\r\n20\r\n${chunk.slice(32)}\r\n0\r\n\r\n`
      )
      await response()
      assert.deepEqual(received[0].body, Buffer.from('你🙂' + 'c'.repeat(64) + '尾'))
      assert.equal(received[0].headers['user-agent'], `KiroIDE-0.6.18-${'c'.repeat(64)}`)
      assert.equal(received[0].headers['x-kproxy-device-id'], undefined)
      assert.equal(received[1].body.toString(), 'e'.repeat(64))
    } finally {
      socket?.destroy()
      await proxy.stop()
      await target.close()
    }
  }
)

test(
  'aborting a MITM client closes its pending upstream and stop/restart emits one stop event',
  { timeout: 10000 },
  async () => {
    let closeUpstream
    const closed = new Promise((resolve) => {
      closeUpstream = resolve
    })
    let ready
    const reached = new Promise((resolve) => {
      ready = resolve
    })
    const target = await listen(
      https.createServer(leaf, (request) => {
        request.socket.once('close', closeUpstream)
        ready()
      })
    )
    const statuses = []
    const proxy = new MitmProxy(certificates, config(), {
      onStatusChange: (running) => statuses.push(running)
    })
    let socket
    try {
      await proxy.start()
      socket = await tunnel(proxy.server.address().port, 'localhost', target.port, true)
      socket.write(`GET /wait HTTP/1.1\r\nHost: localhost:${target.port}\r\n\r\n`)
      await reached
      socket.destroy()
      await closed
      await proxy.stop()
      await proxy.start()
      await tick()
      assert.deepEqual(statuses, [true, false, true])
    } finally {
      socket?.destroy()
      await proxy.stop()
      await target.close()
    }
  }
)

async function connectProxy(secure = false) {
  const server = secure ? https.createServer(leaf) : http.createServer()
  server.on('connect', (request, socket, head) => {
    const address = new URL('http://' + request.url)
    const upstream = net.connect(Number(address.port), address.hostname)
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
    socket.on('close', () => upstream.destroy())
    upstream.on('close', () => socket.destroy())
    upstream.once('connect', () => {
      // Deliberately fragment the response header.
      socket.write('HTTP/1.1 200 Con')
      setImmediate(() => {
        socket.write('nection Established\r\n\r\n')
        if (head.length) upstream.write(head)
        socket.pipe(upstream).pipe(socket)
      })
    })
  })
  return listen(server)
}
async function socksProxy() {
  return listen(
    net.createServer((socket) => {
      let buffer = Buffer.alloc(0),
        greeted = false
      const receive = (chunk) => {
        buffer = Buffer.concat([buffer, chunk])
        if (!greeted) {
          if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return
          buffer = buffer.subarray(2 + buffer[1])
          greeted = true
          socket.write(Buffer.from([5, 0]))
        }
        if (buffer.length < 5) return
        let host, end
        if (buffer[3] === 3) {
          end = 5 + buffer[4]
          if (buffer.length < end + 2) return
          host = buffer.toString('utf8', 5, end)
        } else {
          end = 8
          if (buffer.length < 10) return
          host = Array.from(buffer.subarray(4, 8)).join('.')
        }
        const port = buffer.readUInt16BE(end)
        socket.removeListener('data', receive)
        const upstream = net.connect(port, host)
        upstream.on('error', () => socket.destroy())
        socket.on('close', () => upstream.destroy())
        socket.on('error', () => upstream.destroy())
        upstream.on('close', () => socket.destroy())
        upstream.once('connect', () => {
          socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
          socket.pipe(upstream).pipe(socket)
        })
      }
      socket.on('data', receive)
    })
  )
}

test(
  'proxy chaining supports HTTPS upstream and SOCKS target, preserving fragmented CONNECT requests',
  { timeout: 10000 },
  async () => {
    const upstream = await connectProxy(true)
    const target = await socksProxy()
    const destination = await listen(net.createServer((socket) => socket.pipe(socket)))
    const relay = new ChainProxyRelay(
      `https://localhost:${upstream.port}`,
      `socks5://127.0.0.1:${target.port}`
    )
    let socket
    try {
      await relay.start()
      socket = net.connect(relay.port, '127.0.0.1')
      await once(socket, 'connect')
      const response = await reader(socket)
      socket.write(`CONNECT 127.0.0.1:${destination.port} HTTP/1.1\r\nHo`)
      await tick()
      socket.write('st: test\r\n\r\n')
      assert.match((await response()).header, /200/)
      // Use a separate listener after the CONNECT header has been consumed.
      const echo = once(socket, 'data')
      socket.write('hello-chain')
      assert.equal((await echo)[0].toString(), 'hello-chain')
    } finally {
      socket?.destroy()
      await relay.stop()
      await upstream.close()
      await target.close()
      await destination.close()
    }
  }
)

test(
  'stopping a proxy chain interrupts a pending target CONNECT response',
  { timeout: 10000 },
  async () => {
    const upstream = await connectProxy()
    const target = await listen(net.createServer(() => {}))
    const relay = new ChainProxyRelay(
      `http://127.0.0.1:${upstream.port}`,
      `http://127.0.0.1:${target.port}`
    )
    let socket
    try {
      await relay.start()
      socket = net.connect(relay.port, '127.0.0.1')
      await once(socket, 'connect')
      socket.write('CONNECT example.test:443 HTTP/1.1\r\nHost: example.test\r\n\r\n')
      await tick()
      socket.on('error', () => {})
      const closed = new Promise((resolve) => socket.once('close', resolve))
      await relay.stop()
      await closed
      assert.equal(relay.sockets.size, 0)
    } finally {
      socket?.destroy()
      await relay.stop()
      await upstream.close()
      await target.close()
    }
  }
)

const { Agent, fetch } = require('undici')
test(
  'failed validator responses with an unfinished body release the agent promptly',
  { timeout: 5000 },
  async () => {
    const target = await listen(
      http.createServer((_request, response) => {
        response.writeHead(500)
        response.write('never finishes')
      })
    )
    const handlers = {}
    const { registerProxyPoolIpcHandlers } = load('src/main/ipc/proxyPool.ts', {
      electron: {
        ipcMain: {
          handle: (name, callback) => {
            handlers[name] = callback
          }
        }
      },
      undici: { fetch },
      '../proxy/systemProxy': { safeCreateProxyAgent: () => new Agent() },
      '../registration/chainProxy': { ChainProxyRelay }
    })
    registerProxyPoolIpcHandlers()
    try {
      const result = await handlers['proxy-pool:validate'](null, {
        url: 'http://fixture',
        testUrl: `http://127.0.0.1:${target.port}`,
        timeoutMs: 100
      })
      assert.equal(result.success, false)
      assert.equal(result.error, 'HTTP 500')
    } finally {
      await target.close()
    }
  }
)

test(
  'network diagnosis cancels active requests, consumes no response bodies and rejects invalid proxies',
  { timeout: 5000 },
  async () => {
    const agents = []
    const { runDiagnostics, cancelDiagnostic } = load('src/main/diagnostics.ts', {
      './proxy/systemProxy': {
        safeCreateProxyAgent: (url) => {
          if (url === 'invalid') return undefined
          const agent = new Agent()
          agents.push(agent)
          return agent
        }
      }
    })
    let ready
    const reached = new Promise((resolve) => {
      ready = resolve
    })
    const server = await listen(
      http.createServer((request, response) => {
        ready()
        if (request.url === '/headers') {
          response.writeHead(200)
          response.write('unread stream')
        }
      })
    )
    try {
      const url = `http://127.0.0.1:${server.port}`
      const running = runDiagnostics({
        requestId: 'cancel-test',
        targets: [{ id: 'one', label: 'one', url }]
      })
      await reached
      cancelDiagnostic('cancel-test')
      assert.equal((await running).results[0].error, '已取消')
      assert.equal(
        (
          await runDiagnostics({
            proxyUrl: 'http://fixture',
            targets: [{ id: 'two', label: 'two', url: url + '/headers' }]
          })
        ).results[0].success,
        true
      )
      assert.equal(agents[0].destroyed, true)
      assert.match(
        (
          await runDiagnostics({
            proxyUrl: 'invalid',
            targets: [{ id: 'three', label: 'three', url }]
          })
        ).results[0].error,
        /代理/
      )
    } finally {
      await server.close()
    }
  }
)

test('K-Proxy initialization joins concurrent callers and restores device mappings without rewriting them', async () => {
  let created = 0,
    resolve
  const pending = new Promise((done) => {
    resolve = done
  })
  const { KProxyService } = load('src/main/kproxy/index.ts', {
    electron: { app: { getPath: () => base } },
    './certManager': {
      CertManager,
      createCertManager: () => {
        created++
        return { initialize: () => pending }
      }
    },
    './mitmProxy': { MitmProxy },
    './types': { DEFAULT_KPROXY_CONFIG: config() }
  })
  const updates = []
  const service = new KProxyService(
    {},
    { onDeviceMappingsChange: (mappings) => updates.push(mappings) }
  )
  const one = service.initialize(),
    two = service.initialize()
  assert.equal(created, 1)
  resolve(ca)
  assert.equal(await one, await two)
  service.restoreDeviceIdMappings([{ accountId: 'a', deviceId: 'a'.repeat(64), createdAt: 1 }])
  assert.equal(service.getDeviceIdForAccount('a'), 'a'.repeat(64))
  assert.equal(updates.length, 0)
  service.addDeviceIdMapping({ accountId: 'b', deviceId: 'b'.repeat(64), createdAt: 2 })
  assert.equal(updates[0].length, 2)
})

test('CONNECT parsing preserves early binary tunnel bytes and status-only error diagnostics', async () => {
  const relay = new ChainProxyRelay('http://upstream:80', 'http://target:80')
  for (const error of [false, true]) {
    const server = await listen(
      net.createServer((socket) =>
        socket.once('data', () => {
          if (error) socket.end('HTTP/1.1 610 Rejected\r\n')
          else
            socket.write(
              Buffer.concat([Buffer.from('HTTP/1.1 200 OK\r\n\r\n'), Buffer.from([0xff, 0, 0x80])])
            )
        })
      )
    )
    const socket = net.connect(server.port, '127.0.0.1')
    try {
      await once(socket, 'connect')
      const response = await relay.sendConnectRequest(socket, 'test', 443, {
        protocol: 'http',
        host: 'target',
        port: 80
      })
      assert.equal(response.status, error ? 610 : 200)
      if (!error) assert.deepEqual(socket.read(), Buffer.from([0xff, 0, 0x80]))
    } finally {
      socket.destroy()
      await server.close()
    }
  }
})

test(
  'SOCKS upstream can tunnel through an HTTPS target proxy with normal certificate verification',
  { timeout: 10000 },
  async () => {
    const upstream = await socksProxy()
    const target = await connectProxy(true)
    const destination = await listen(net.createServer((socket) => socket.pipe(socket)))
    const relay = new ChainProxyRelay(
      `socks5://127.0.0.1:${upstream.port}`,
      `https://localhost:${target.port}`
    )
    let socket
    try {
      await relay.start()
      socket = await tunnel(relay.port, '127.0.0.1', destination.port)
      const response = once(socket, 'data')
      socket.write('nested-tls')
      assert.equal((await response)[0].toString(), 'nested-tls')
    } finally {
      socket?.destroy()
      await relay.stop()
      await upstream.close()
      await target.close()
      await destination.close()
    }
  }
)

test(
  'stream forwarding applies backpressure when the upstream stops reading',
  { timeout: 10000 },
  async () => {
    let reached
    const ready = new Promise((resolve) => {
      reached = resolve
    })
    const target = await listen(
      https.createServer(leaf, (request) => {
        request.pause()
        reached()
      })
    )
    const proxy = new MitmProxy(certificates, config())
    let socket
    const { Readable } = require('node:stream')
    let produced = 0
    const chunk = Buffer.alloc(65536, 0x78)
    const input = Readable.from(
      (function* () {
        for (let i = 0; i < 512; i++) {
          produced++
          yield chunk
        }
      })()
    )
    try {
      await proxy.start()
      socket = await tunnel(proxy.server.address().port, 'localhost', target.port, true)
      socket.on('error', noop)
      socket.write(
        `POST /paused HTTP/1.1\r\nHost: localhost:${target.port}\r\nContent-Length: ${chunk.length * 512}\r\n\r\n`
      )
      input.pipe(socket)
      await ready
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.ok(
        produced < 512,
        'producer must wait for the receiver instead of buffering the whole body'
      )
      assert.ok(Array.from(proxy.requests).every((request) => request.writableLength < 1024 * 1024))
    } finally {
      input.destroy()
      socket?.destroy()
      await proxy.stop()
      await target.close()
    }
  }
)

test(
  'a target proxy that never responds to CONNECT times out with stage diagnostics',
  { timeout: 5000 },
  async () => {
    const { ChainProxyRelay: TimedRelay } = load('src/main/registration/chainProxy.ts', {}, '', {
      setTimeout: (callback, delay, ...args) =>
        setTimeout(callback, delay === 20000 ? 40 : delay, ...args)
    })
    const upstream = await connectProxy()
    const target = await listen(net.createServer(() => {}))
    const relay = new TimedRelay(
      `http://127.0.0.1:${upstream.port}`,
      `http://127.0.0.1:${target.port}`
    )
    try {
      const result = await relay.diagnose()
      assert.equal(result.upstreamReachable, true)
      assert.equal(result.targetReachable, true)
      assert.equal(result.endToEndOk, false)
      assert.match(result.endToEndError, /CONNECT.*超时/)
    } finally {
      await relay.stop()
      await upstream.close()
      await target.close()
    }
  }
)

const socksNetwork = load('src/main/proxy/systemProxy.ts')
test(
  'direct SOCKS dispatchers forward HTTP successfully and release stalled handshakes on validation timeout',
  { timeout: 5000 },
  async () => {
    const proxy = await socksProxy()
    const target = await listen(http.createServer((_request, response) => response.end('healthy')))
    const agent = socksNetwork.safeCreateProxyAgent(`socks5://127.0.0.1:${proxy.port}`)
    try {
      assert.equal(
        await (await fetch(`http://127.0.0.1:${target.port}`, { dispatcher: agent })).text(),
        'healthy'
      )
    } finally {
      await agent.destroy()
      await proxy.close()
      await target.close()
    }
    let closed
    const socketClosed = new Promise((resolve) => {
      closed = resolve
    })
    const stalled = await listen(
      net.createServer((socket) => {
        socket.on('data', noop)
        socket.once('close', closed)
      })
    )
    const handlers = {}
    load('src/main/ipc/proxyPool.ts', {
      electron: {
        ipcMain: {
          handle: (name, callback) => {
            handlers[name] = callback
          }
        }
      },
      '../proxy/systemProxy': socksNetwork,
      '../registration/chainProxy': { ChainProxyRelay }
    }).registerProxyPoolIpcHandlers()
    try {
      const result = await handlers['proxy-pool:validate'](null, {
        url: `socks5://127.0.0.1:${stalled.port}`,
        testUrl: 'http://example.test',
        timeoutMs: 50
      })
      assert.equal(result.success, false)
      assert.match(result.error, /超时/)
      await socketClosed
    } finally {
      await stalled.close()
    }
  }
)

test(
  'destroying a SOCKS dispatcher also interrupts its pending TLS handshake',
  { timeout: 5000 },
  async () => {
    let closed
    const socketClosed = new Promise((resolve) => {
      closed = resolve
    })
    const destination = await listen(
      net.createServer((socket) => {
        socket.on('data', noop)
        socket.once('close', closed)
      })
    )
    const proxy = await socksProxy()
    const agent = socksNetwork.safeCreateProxyAgent(`socks5://127.0.0.1:${proxy.port}`)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 100)
    try {
      const failure = await fetch(`https://127.0.0.1:${destination.port}`, {
        dispatcher: agent,
        signal: controller.signal
      }).catch((error) => error)
      assert.equal(controller.signal.aborted, true, String(failure.cause || failure))
      await agent.destroy()
      await socketClosed
    } finally {
      clearTimeout(timer)
      await agent.destroy()
      await proxy.close()
      await destination.close()
    }
  }
)

test(
  'direct SOCKS dispatchers complete HTTPS requests after the SOCKS handshake',
  { timeout: 5000 },
  async () => {
    const proxy = await socksProxy()
    const target = await listen(
      https.createServer(leaf, (_request, response) => response.end('secure-target'))
    )
    const agent = socksNetwork.safeCreateProxyAgent(`socks5://127.0.0.1:${proxy.port}`)
    try {
      const response = await fetch(`https://localhost:${target.port}`, { dispatcher: agent })
      assert.equal(await response.text(), 'secure-target')
    } finally {
      await agent.destroy()
      await proxy.close()
      await target.close()
    }
  }
)

import * as http from 'http'
import * as https from 'https'
import * as net from 'net'
import * as tls from 'tls'
import { Transform, type TransformCallback } from 'stream'
import { DEVICE_ID_HEADER } from './types'
import type { KProxyConfig, KProxyStats, KProxyEvents, KProxyRequestInfo } from './types'
import { CertManager } from './certManager'

const KIRO_UA_REGEX = /KiroIDE[-\s][\d.]+[-\s]([a-f0-9]{64})/i

/** Keep possible ASCII ID prefixes between chunks; other bytes pass through unchanged. */
class MachineIdTransform extends Transform {
  private tail: Buffer = Buffer.alloc(0)
  constructor(private readonly deviceId: string) {
    super()
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.replace(Buffer.concat([this.tail, chunk]), false)
    callback()
  }

  _flush(callback: TransformCallback): void {
    this.replace(this.tail, true)
    callback()
  }

  private replace(data: Buffer, final: boolean): void {
    let end = final ? data.length : Math.max(0, data.length - 63)
    let cursor = 0
    const text = data.toString('latin1')
    const pattern = /[a-f0-9]{64}/gi
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) && match.index < end) {
      this.push(data.subarray(cursor, match.index))
      this.push(match[0].toLowerCase() === this.deviceId.toLowerCase() ? match[0] : this.deviceId)
      cursor = match.index + 64
      end = Math.max(end, cursor)
    }
    if (cursor < end) this.push(data.subarray(cursor, end))
    this.tail = data.subarray(end)
  }
}

export class MitmProxy {
  private server: http.Server | null = null
  private startTask: Promise<void> | null = null
  private stopTask: Promise<void> | null = null
  private readonly sockets = new Set<net.Socket>()
  private readonly requests = new Set<http.ClientRequest>()
  private readonly destinations = new WeakMap<net.Socket, { host: string; port: number }>()
  private readonly httpAgent = new http.Agent({ keepAlive: true })
  private readonly httpsAgent = new https.Agent({ keepAlive: true })
  private readonly decryptedServer: http.Server
  private stats: KProxyStats = {
    totalRequests: 0,
    mitmRequests: 0,
    bypassRequests: 0,
    modifiedRequests: 0,
    startTime: 0,
    lastRequestTime: 0
  }

  constructor(
    private readonly certManager: CertManager,
    private config: KProxyConfig,
    private readonly events: KProxyEvents = {}
  ) {
    // Node's HTTP parser handles chunking, UTF-8 boundaries, keep-alive and pipelining.
    this.decryptedServer = http.createServer((request, response) => {
      const target = this.destinations.get(request.socket)
      if (!target) {
        response.writeHead(502)
        response.end()
        return
      }
      this.forwardHttp(request, response, target.host, target.port, true)
    })
    this.decryptedServer.on('clientError', (_error, socket) => socket.destroy())
  }

  start(): Promise<void> {
    if (this.stopTask) return this.stopTask.then(() => this.start())
    if (this.startTask) return this.startTask
    if (this.server) return Promise.resolve()
    this.startTask = new Promise<void>((resolve, reject) => {
      const server = http.createServer((request, response) =>
        this.handleHttpRequest(request, response)
      )
      this.server = server
      server.on('connection', (socket) => this.track(socket))
      server.on('connect', (request, socket: net.Socket, head) =>
        this.handleConnect(request, socket, head)
      )
      server.on('error', (error: NodeJS.ErrnoException) => {
        if (!server.listening) this.server = null
        this.events.onError?.(error)
        reject(
          error.code === 'EADDRINUSE'
            ? new Error(`Port ${this.config.port} is already in use`)
            : error
        )
      })
      server.listen(this.config.port, this.config.host, () => {
        this.stats.startTime = Date.now()
        this.events.onStatusChange?.(true, this.config.port)
        resolve()
      })
    }).finally(() => {
      this.startTask = null
    })
    return this.startTask
  }

  stop(): Promise<void> {
    if (this.stopTask) return this.stopTask
    this.stopTask = (async () => {
      if (this.startTask) await this.startTask.catch(() => undefined)
      const server = this.server
      if (!server) return
      this.server = null
      for (const request of this.requests) request.destroy()
      for (const socket of this.sockets) socket.destroy()
      this.httpAgent.destroy()
      this.httpsAgent.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      this.events.onStatusChange?.(false, this.config.port)
    })().finally(() => {
      this.stopTask = null
    })
    return this.stopTask
  }

  private track(socket: net.Socket): void {
    this.sockets.add(socket)
    socket.once('close', () => this.sockets.delete(socket))
    socket.on('error', () => socket.destroy())
  }

  private handleHttpRequest(request: http.IncomingMessage, response: http.ServerResponse): void {
    this.stats.totalRequests++
    this.stats.lastRequestTime = Date.now()
    try {
      const target = new URL(request.url || '')
      request.url = target.pathname + target.search
      this.forwardHttp(
        request,
        response,
        target.hostname,
        Number(target.port) || (target.protocol === 'https:' ? 443 : 80),
        target.protocol === 'https:'
      )
    } catch {
      response.writeHead(400)
      response.end('Invalid proxy target')
    }
  }

  private handleConnect(request: http.IncomingMessage, client: net.Socket, head: Buffer): void {
    this.stats.totalRequests++
    this.stats.lastRequestTime = Date.now()
    let target: URL
    try {
      target = new URL(`http://${request.url}`)
    } catch {
      client.end('HTTP/1.1 400 Bad Request\r\n\r\n')
      return
    }
    const hostname = target.hostname.replace(/^\[|\]$/g, '')
    const port = Number(target.port) || 443
    if (this.shouldMitm(hostname)) {
      this.stats.mitmRequests++
      client.pause()
      void this.handleMitmConnect(hostname, port, client, head)
    } else {
      this.stats.bypassRequests++
      const upstream = net.connect(port, hostname)
      this.track(upstream)
      const timer = setTimeout(
        () => upstream.destroy(new Error('Proxy connection timed out')),
        30000
      )
      upstream.once('connect', () => {
        clearTimeout(timer)
        if (client.destroyed) {
          upstream.destroy()
          return
        }
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length) upstream.write(head)
        client.pipe(upstream).pipe(client)
      })
      upstream.once('close', () => {
        clearTimeout(timer)
        client.destroy()
      })
      client.once('close', () => upstream.destroy())
    }
  }

  private shouldMitm(hostname: string): boolean {
    return this.config.mitmDomains.some((domain) => hostname.includes(domain))
  }

  private async handleMitmConnect(
    hostname: string,
    port: number,
    client: net.Socket,
    head: Buffer
  ): Promise<void> {
    try {
      const { cert, key } = await this.certManager.generateCertForHost(hostname)
      if (client.destroyed || !this.server) return
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) client.unshift(head)
      const socket = new tls.TLSSocket(client, { key, cert, isServer: true })
      this.track(socket)
      this.destinations.set(socket, { host: hostname, port })
      this.decryptedServer.emit('connection', socket)
      socket.resume()
    } catch (error) {
      this.events.onError?.(error as Error)
      client.destroy()
    }
  }

  private forwardHttp(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    hostname: string,
    port: number,
    secure: boolean
  ): void {
    const start = Date.now()
    const scopedId = request.headers[DEVICE_ID_HEADER]
    const deviceId =
      typeof scopedId === 'string' && /^[a-f0-9]{64}$/i.test(scopedId)
        ? scopedId
        : this.config.deviceId
    const info: KProxyRequestInfo = {
      timestamp: start,
      method: request.method || 'GET',
      host: hostname,
      path: request.url || '/',
      isMitm: secure,
      deviceIdReplaced: false
    }
    const headers = { ...request.headers }
    delete headers[DEVICE_ID_HEADER]
    delete headers['proxy-authorization']
    delete headers['proxy-connection']
    if (secure && deviceId) {
      for (const name of ['user-agent', 'x-amz-user-agent']) {
        const value = headers[name]
        if (typeof value === 'string' && KIRO_UA_REGEX.test(value)) {
          const updated = value.replace(/[a-f0-9]{64}/gi, deviceId)
          if (updated !== value) {
            info.originalDeviceId = value.match(KIRO_UA_REGEX)?.[1]
            info.newDeviceId = deviceId
            info.deviceIdReplaced = true
            headers[name] = updated
          }
        }
      }
      if (info.deviceIdReplaced) this.stats.modifiedRequests++
    }
    if (secure) {
      this.events.onRequest?.(info)
      this.events.onMitmIntercept?.(hostname, info.deviceIdReplaced)
    }
    const upstream = (secure ? https : http).request({
      hostname,
      port,
      path: request.url,
      method: request.method,
      headers,
      agent: secure ? this.httpsAgent : this.httpAgent
    })
    this.requests.add(upstream)
    upstream.once('close', () => this.requests.delete(upstream))
    upstream.once('socket', (socket) => {
      if (!socket.connecting) return
      const timer = setTimeout(
        () => upstream.destroy(new Error('Proxy TLS connection timed out')),
        30000
      )
      const ready = (): void => {
        clearTimeout(timer)
      }
      socket.once(secure ? 'secureConnect' : 'connect', ready)
      socket.once('close', ready)
    })
    upstream.once('response', (incoming) => {
      response.writeHead(incoming.statusCode || 502, incoming.headers)
      incoming.pipe(response)
      incoming.once('aborted', () => response.destroy())
      incoming.once('error', () => response.destroy())
      response.once(
        'finish',
        () =>
          secure &&
          this.events.onResponse?.({
            timestamp: Date.now(),
            host: hostname,
            statusCode: incoming.statusCode || 502,
            duration: Date.now() - start
          })
      )
    })
    upstream.once('error', (error) => {
      if (!response.headersSent) {
        response.writeHead(502)
        response.end('Bad Gateway')
      } else response.destroy(error)
    })
    request.once('error', () => upstream.destroy())
    response.once('error', () => upstream.destroy())
    request.once('aborted', () => upstream.destroy())
    response.once('close', () => {
      if (!response.writableFinished) upstream.destroy()
    })
    if (secure && deviceId && /^[a-f0-9]{64}$/i.test(deviceId)) {
      const transform = new MachineIdTransform(deviceId)
      transform.once('error', () => upstream.destroy())
      request.pipe(transform).pipe(upstream)
    } else request.pipe(upstream)
  }

  updateConfig(config: Partial<KProxyConfig>): void {
    this.config = { ...this.config, ...config }
  }
  getConfig(): KProxyConfig {
    return { ...this.config }
  }
  getStats(): KProxyStats {
    return { ...this.stats }
  }
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      mitmRequests: 0,
      bypassRequests: 0,
      modifiedRequests: 0,
      startTime: this.stats.startTime,
      lastRequestTime: 0
    }
  }
  isRunning(): boolean {
    return this.server !== null
  }
}

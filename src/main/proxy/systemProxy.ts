// 系统代理检测（Windows 注册表 / macOS scutil）+ 安全 ProxyAgent 工厂
// 含 SOCKS5/SOCKS4 代理支持（通过 socks 包 + undici Agent.connect 钩子）

import { ProxyAgent, Agent, type Dispatcher } from 'undici'
import * as tls from 'tls'
import * as net from 'net'
import { SocksClient } from 'socks'

const cachedAgents = new Map<string, Dispatcher>()
const MAX_CACHED_AGENTS = 128

/** API 请求复用连接；验活等需要自行关闭的调用仍使用 safeCreateProxyAgent。 */
export function getCachedProxyAgent(proxyUrl: string | null | undefined): Dispatcher | undefined {
  if (!proxyUrl) return undefined
  const existing = cachedAgents.get(proxyUrl)
  if (existing) {
    cachedAgents.delete(proxyUrl)
    cachedAgents.set(proxyUrl, existing)
    return existing
  }
  const agent = safeCreateProxyAgent(proxyUrl)
  if (!agent) return undefined
  cachedAgents.set(proxyUrl, agent)
  if (cachedAgents.size > MAX_CACHED_AGENTS) {
    const oldest = cachedAgents.keys().next().value!
    const retired = cachedAgents.get(oldest)!
    cachedAgents.delete(oldest)
    void retired.close().catch(() => {
      /* 退出/网络断开时连接可能已关闭。 */
    })
  }
  return agent
}

export async function closeCachedProxyAgents(force = false): Promise<void> {
  const agents = [...cachedAgents.values()]
  cachedAgents.clear()
  await Promise.allSettled(agents.map((agent) => (force ? agent.destroy() : agent.close())))
}

let _cachedSystemProxy: string | null = null
let _systemProxyCacheTime = 0
const SYSTEM_PROXY_CACHE_TTL = 30_000 // 30秒缓存

/**
 * 检查 URL 是否为 undici ProxyAgent 支持的协议（http / https）
 */
function isHttpLikeProxyUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 解析 Windows ProxyServer 注册表值，仅返回 undici 可用的 http(s) 代理 URL
 *
 * 可能的格式：
 *   1) "host:port"            — 单一代理，应用于所有协议
 *   2) "http=host:port;https=host:port;ftp=host:port;socks=host:port"
 *                              — 按协议分别配置
 *   3) "scheme://host:port"   — 已带 scheme（http / https / socks5 ...）
 *
 * 不支持 socks/socks4/socks5/pac 等非 http(s) 协议，遇到时返回 null（回退直连）
 */
function parseWindowsProxyServer(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  // 形如 "http=host:port;https=host:port;socks=host:port" 的多协议格式
  if (trimmed.includes('=')) {
    const map = new Map<string, string>()
    for (const seg of trimmed.split(';')) {
      const eq = seg.indexOf('=')
      if (eq > 0) {
        const k = seg.slice(0, eq).trim().toLowerCase()
        const v = seg.slice(eq + 1).trim()
        if (k && v) map.set(k, v)
      }
    }
    const https = map.get('https')
    if (https) return `http://${https}`
    const http = map.get('http')
    if (http) return `http://${http}`
    return null
  }

  // 已带 scheme
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return isHttpLikeProxyUrl(trimmed) ? trimmed : null
  }

  // 裸的 host:port，按 http 处理
  return `http://${trimmed}`
}

export function getSystemProxy(): string | null {
  const now = Date.now()
  if (_systemProxyCacheTime > 0 && now - _systemProxyCacheTime < SYSTEM_PROXY_CACHE_TTL) {
    return _cachedSystemProxy
  }
  try {
    if (process.platform === 'win32') {
      const { execSync } = require('child_process')
      const result = execSync(
        'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable',
        { encoding: 'utf8', timeout: 3000, windowsHide: true }
      )
      if (result.includes('0x1')) {
        const serverResult = execSync(
          'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer',
          { encoding: 'utf8', timeout: 3000, windowsHide: true }
        )
        const match = serverResult.match(/ProxyServer\s+REG_SZ\s+(.+)/)
        if (match) {
          const parsed = parseWindowsProxyServer(match[1])
          _cachedSystemProxy = parsed
          _systemProxyCacheTime = now
          return _cachedSystemProxy
        }
      }
    } else if (process.platform === 'darwin') {
      const { execSync } = require('child_process')
      const result = execSync('scutil --proxy', { encoding: 'utf8', timeout: 3000 })
      // 优先 HTTPS 代理，回退到 HTTP 代理（仅 undici 支持的 http/https 协议）
      const httpsEnabled = /HTTPSEnable\s*:\s*1/.test(result)
      if (httpsEnabled) {
        const hostMatch = result.match(/HTTPSProxy\s*:\s*(\S+)/)
        const portMatch = result.match(/HTTPSPort\s*:\s*(\d+)/)
        if (hostMatch) {
          const proxy = `http://${hostMatch[1]}${portMatch ? ':' + portMatch[1] : ''}`
          _cachedSystemProxy = proxy
          _systemProxyCacheTime = now
          return _cachedSystemProxy
        }
      }
      const httpEnabled = /HTTPEnable\s*:\s*1/.test(result)
      if (httpEnabled) {
        const hostMatch = result.match(/HTTPProxy\s*:\s*(\S+)/)
        const portMatch = result.match(/HTTPPort\s*:\s*(\d+)/)
        if (hostMatch) {
          const proxy = `http://${hostMatch[1]}${portMatch ? ':' + portMatch[1] : ''}`
          _cachedSystemProxy = proxy
          _systemProxyCacheTime = now
          return _cachedSystemProxy
        }
      }
      // macOS 仅配 SOCKS 时 undici 不支持，静默回退直连（safeCreateProxyAgent 也会兜底）
    }
  } catch {
    /* 检测失败静默回退直连 */
  }
  _cachedSystemProxy = null
  _systemProxyCacheTime = now
  return null
}

/**
 * 安全地创建 undici Dispatcher
 *
 * 支持协议：
 *   - http: / https: → undici 原生 ProxyAgent
 *   - socks5: / socks4: → 通过 socks 包 + undici Agent 的 connect 钩子实现 SOCKS 隧道
 *
 * URL 无效或协议无法支持时返回 undefined，让调用方回退直连，
 * 而不会让异常向上传播阻塞业务流程。
 */
export function safeCreateProxyAgent(proxyUrl: string | null | undefined): Dispatcher | undefined {
  if (!proxyUrl) return undefined

  // 校验 URL
  let u: URL
  try {
    u = new URL(proxyUrl)
  } catch {
    console.warn(`[Proxy] 代理 URL 无效: ${proxyUrl}`)
    return undefined
  }

  const protocol = u.protocol

  // http / https 走原生 ProxyAgent
  if (protocol === 'http:' || protocol === 'https:') {
    try {
      return new ProxyAgent({ uri: proxyUrl, requestTls: { rejectUnauthorized: false } })
    } catch (err) {
      console.warn(`[Proxy] 创建 HTTP ProxyAgent 失败，回退直连: ${proxyUrl}`, err)
      return undefined
    }
  }

  // SOCKS 走自定义 connect
  if (
    protocol === 'socks5:' ||
    protocol === 'socks5h:' ||
    protocol === 'socks4:' ||
    protocol === 'socks4a:'
  ) {
    try {
      return createSocksDispatcher(u)
    } catch (err) {
      console.warn(`[Proxy] 创建 SOCKS Agent 失败，回退直连: ${proxyUrl}`, err)
      return undefined
    }
  }

  console.warn(`[Proxy] 忽略不支持的代理协议 (仅支持 http/https/socks5/socks4): ${proxyUrl}`)
  return undefined
}

/**
 * 通过 undici Agent 的 connect 钩子实现 SOCKS5/4 隧道
 * 流程：socks.createConnection 建立 TCP 隧道 → 如目标是 https 再 TLS 升级 → 把 socket 交给 undici
 */
function createSocksDispatcher(u: URL): Agent {
  return new SocksProxyAgent(u)
}

/** Own sockets before SOCKS/TLS handshakes finish, when Undici cannot yet see them. */
class SocksProxyAgent extends Agent {
  private readonly pendingSockets: Set<net.Socket>

  constructor(url: URL) {
    const pending = new Set<net.Socket>()
    const type: 4 | 5 = url.protocol === 'socks5:' || url.protocol === 'socks5h:' ? 5 : 4
    const proxy = {
      host: url.hostname,
      port: Number(url.port) || 1080,
      type,
      userId: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined
    }
    super({
      connect: (options, callback): void => {
        const host = options.hostname || options.host || ''
        const port = Number(options.port) || (options.protocol === 'https:' ? 443 : 80)
        const socket = net.connect(proxy.port, proxy.host)
        pending.add(socket)
        let encrypted: tls.TLSSocket | undefined
        let finished = false
        const timer = setTimeout(() => fail(new Error('SOCKS connection timed out')), 30000)
        const finish = (error?: Error, connected?: net.Socket): void => {
          if (finished) return
          finished = true
          clearTimeout(timer)
          pending.delete(socket)
          socket.removeListener('error', fail)
          socket.removeListener('close', closed)
          if (encrypted) {
            pending.delete(encrypted)
            encrypted.removeListener('error', fail)
            encrypted.removeListener('close', closed)
          }
          if (error || !connected) {
            socket.destroy()
            encrypted?.destroy()
            callback(error || new Error('SOCKS connection closed'), null)
          } else callback(null, connected)
        }
        const fail = (error: Error): void => finish(error)
        const closed = (): void => fail(new Error('SOCKS connection closed'))
        socket.once('error', fail)
        socket.once('close', closed)
        socket.once('connect', () => {
          void SocksClient.createConnection({
            existing_socket: socket,
            proxy,
            command: 'connect',
            destination: { host, port },
            timeout: 30000
          })
            .then(({ socket: tunnel }) => {
              if (finished) {
                tunnel.destroy()
                return
              }
              tunnel.setTimeout(0)
              if (options.protocol !== 'https:') {
                finish(undefined, tunnel)
                return
              }
              encrypted = tls.connect({
                socket: tunnel,
                servername: net.isIP(options.servername || host)
                  ? undefined
                  : options.servername || host,
                rejectUnauthorized: false
              })
              pending.add(encrypted)
              encrypted.once('error', fail)
              encrypted.once('close', closed)
              encrypted.once('secureConnect', () => finish(undefined, encrypted))
            })
            .catch(fail)
        })
      }
    })
    this.pendingSockets = pending
  }

  destroy(error: Error | null, callback: () => void): void
  destroy(callback: () => void): void
  destroy(error?: Error | null): Promise<void>
  destroy(
    errorOrCallback?: Error | null | (() => void),
    callback?: () => void
  ): Promise<void> | void {
    for (const socket of this.pendingSockets) socket.destroy()
    this.pendingSockets.clear()
    if (typeof errorOrCallback === 'function') return super.destroy(errorOrCallback)
    if (callback) return super.destroy(errorOrCallback || null, callback)
    return super.destroy(errorOrCallback || null)
  }
}

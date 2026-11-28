// 代理服务器日志模块
import * as fs from 'fs'
import * as path from 'path'
import { redactString, redactValue } from '../utils/redact'

import type { ProxyLogEntry as LogEntry, ProxyLogBatch } from '../../shared/proxyLogs'

class ProxyLogger {
  private isWriting = false
  private write(rawEntry: LogEntry): void {
    // 统一脱敏：message + data 里的代理账密 / token / password 等，避免明文落盘或上屏
    const entry: LogEntry = {
      ...rawEntry,
      message: redactString(rawEntry.message),
      data: rawEntry.data === undefined ? undefined : redactValue(rawEntry.data)
    }

    {
      const prefix = `[${entry.level}][${entry.category}]`
      // 设置 flag 防止 console 拦截器重复写入 proxyLogStore
      this.isWriting = true
      if (entry.level === 'ERROR') {
        console.error(prefix, entry.message, entry.data || '')
      } else if (entry.level === 'WARN') {
        console.warn(prefix, entry.message, entry.data || '')
      } else {
        console.log(prefix, entry.message, entry.data || '')
      }
      this.isWriting = false
    }

    // 同时添加到内存存储（用于 UI 显示）
    proxyLogStore.add(entry)
  }

  get _isWriting(): boolean { return this.isWriting }

  debug(category: string, message: string, data?: unknown): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'DEBUG',
      category,
      message,
      data
    })
  }

  info(category: string, message: string, data?: unknown): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'INFO',
      category,
      message,
      data
    })
  }

  warn(category: string, message: string, data?: unknown): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'WARN',
      category,
      message,
      data
    })
  }

  error(category: string, message: string, data?: unknown): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      category,
      message,
      data
    })
  }

}

// 有界内存日志；文件格式仍为按时间排列的 JSON 数组。
class ProxyLogStore {
  private logs: LogEntry[] = []
  // 5 万条 × 平均 200 字节 ≈ 10 MB；既能覆盖常规调试需求，又把单次写盘成本控制在可接受范围内
  private maxLogs: number = 50000
  private head = 0
  private sequence = 0
  private storePath: string = ''

  private initialized = false
  initialize(userDataPath: string): void {
    if (this.initialized) return
    this.initialized = true
    this.storePath = path.join(userDataPath, 'proxy-logs.json')
    this.load()
  }

  private load(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        const data = fs.readFileSync(this.storePath, 'utf-8')
        const parsed = JSON.parse(data)
        // 验证并过滤有效的日志条目
        const filtered = Array.isArray(parsed) ? parsed.filter((log: LogEntry) => {
          if (!log.timestamp || isNaN(new Date(log.timestamp).getTime())) return false
          if (!log.level || !log.category) return false
          return true
        }) : []
        // 加载时也施加上限，避免旧版本遗留的超大日志文件导致首次启动卡顿
        this.logs = filtered.length > this.maxLogs ? filtered.slice(-this.maxLogs) : filtered
        this.sequence = this.logs.length
        console.log(`[ProxyLogStore] Loaded ${this.logs.length} valid logs`)
      }
    } catch (error) {
      console.error('[ProxyLogStore] Failed to load logs:', error)
      this.logs = []
    }
  }

  private saveTask: Promise<void> | null = null
  private writePending = false

  save(): Promise<void> {
    this.writePending = true
    if (!this.saveTask) {
      this.saveTask = this.writeSnapshots().finally(() => { this.saveTask = null })
    }
    return this.saveTask
  }

  private async writeSnapshots(): Promise<void> {
    while (this.writePending) {
      this.writePending = false
      try {
        await fs.promises.writeFile(this.storePath, JSON.stringify(this.getAll()), 'utf-8')
      } catch (error) {
        console.error('[ProxyLogStore] Failed to save logs:', error)
      }
    }
  }

  private saveTimer: NodeJS.Timeout | null = null

  add(entry: LogEntry): void {
    if (this.logs.length < this.maxLogs) {
      this.logs.push(entry)
    } else {
      this.logs[this.head] = entry
      this.head = (this.head + 1) % this.maxLogs
    }
    this.sequence++

    // 节流调度异步保存
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.saveTimer) return  // 已调度，等待 flush
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, 30_000) // 30 秒批量写盘一次（异步、不阻塞）
  }

  /** 强制立即写盘（用于退出场景），保证最新数据落盘 */
  async flushSaveNow(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    await this.save()
  }

  getAll(): LogEntry[] {
    return this.getLast(this.logs.length)
  }

  getLast(count: number): LogEntry[] {
    const size = Math.min(this.logs.length, Math.max(0, Math.floor(count)))
    const result: LogEntry[] = []
    for (let i = this.logs.length - size; i < this.logs.length; i++) {
      result.push(this.logs[(this.head + i) % this.logs.length])
    }
    return result
  }

  clear(): void {
    this.logs = []
    this.head = 0
    this.sequence++
    void this.save()
  }

  count(): number {
    return this.logs.length
  }

  getBatch(cursor?: number, limit = this.maxLogs): ProxyLogBatch {
    const earliest = this.sequence - this.logs.length
    const reset = cursor === undefined || cursor < earliest || cursor > this.sequence
    const count = reset ? limit : Math.min(limit, this.sequence - cursor!)
    return {
      entries: this.getLast(count),
      cursor: this.sequence,
      reset,
      total: this.logs.length
    }
  }

}

export const proxyLogStore = new ProxyLogStore()

// 单例导出
export const proxyLogger = new ProxyLogger()

// 拦截主进程 console 输出，自动转发到 proxyLogStore
// 这样所有 console.log/warn/error 都能在日志页面显示
let consoleIntercepted = false
export function interceptConsole(): void {
  if (consoleIntercepted) return
  consoleIntercepted = true

  const originalLog = console.log
  const originalWarn = console.warn
  const originalError = console.error

  const parseConsoleCategory = (args: unknown[]): { category: string; message: string } => {
    const first = String(args[0] || '')
    // 匹配 [Category] 或 [INFO][Category] 格式
    const bracketMatch = first.match(/^\[(?:DEBUG|INFO|WARN|ERROR)\]?\[?([^\]]*)\]?\s*(.*)/)
    if (bracketMatch) {
      return { category: bracketMatch[1] || 'App', message: bracketMatch[2] || '' }
    }
    const simpleMatch = first.match(/^\[([^\]]+)\]\s*(.*)/)
    if (simpleMatch) {
      return { category: simpleMatch[1], message: simpleMatch[2] || '' }
    }
    return { category: 'App', message: first }
  }

  const buildEntry = (args: unknown[], level: 'INFO' | 'WARN' | 'ERROR'): LogEntry => {
    const { category, message } = parseConsoleCategory(args)
    const rest = args.slice(1)
    // data: 后续参数（对象/数组保留结构，字符串拼接）
    let data: unknown = undefined
    if (rest.length === 1) {
      data = rest[0]
    } else if (rest.length > 1) {
      // 如果全是字符串，拼成一个；否则保持数组
      const allStrings = rest.every(r => typeof r === 'string')
      data = allStrings ? (rest as string[]).join(' ') : rest
    }
    return { timestamp: new Date().toISOString(), level, category, message, data }
  }

  console.log = (...args: unknown[]) => {
    originalLog.apply(console, args)
    if (proxyLogger._isWriting) return
    proxyLogStore.add(buildEntry(args, 'INFO'))
  }

  console.warn = (...args: unknown[]) => {
    originalWarn.apply(console, args)
    if (proxyLogger._isWriting) return
    proxyLogStore.add(buildEntry(args, 'WARN'))
  }

  console.error = (...args: unknown[]) => {
    originalError.apply(console, args)
    if (proxyLogger._isWriting) return
    proxyLogStore.add(buildEntry(args, 'ERROR'))
  }
}

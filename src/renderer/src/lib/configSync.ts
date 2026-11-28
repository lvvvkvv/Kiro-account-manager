import { isRecord } from '../../../shared/kiroSettings'
import { parseProxyUrl, useAccountsStore } from '../store/accounts'
import { parseWebhookInput, useWebhookStore, type WebhookInput } from '../store/webhooks'
import type { ProxyEntry, ProxyImportEntry, ProxyPoolConfig } from '../types/proxy'
import { resolveLanguage, type Language } from './language'
import { resolveThemeMode, type ThemeMode } from './theme'
import {
  normalizeConfig,
  parseTemplates,
  REGISTRATION_PREFERENCE_KEYS,
  HISTORY_KEY,
  STORAGE_KEY,
  TEMPLATES_KEY,
  type RegisterConfig,
  type RegisterTemplate
} from './registration'

interface AppSettings {
  theme?: ThemeMode
  darkMode?: boolean
  language?: Language
  autoRefreshEnabled?: boolean
  autoRefreshInterval?: number
  autoRefreshConcurrency?: number
  statusCheckInterval?: number
  privacyMode?: boolean
  usagePrecision?: boolean
  autoSwitchEnabled?: boolean
  autoSwitchThreshold?: number
  autoSwitchInterval?: number
  switchTarget?: 'ide' | 'cli' | 'both'
}
export interface PortableConfig {
  version: 1
  app: 'kiro-account-manager'
  exportedAt?: string
  proxyPool?: ProxyImportEntry[]
  proxyPoolConfig?: Partial<ProxyPoolConfig>
  webhooks?: WebhookInput[]
  registerConfig?: Partial<RegisterConfig>
  registerTemplates?: RegisterTemplate[]
  registerLocalStorage?: Record<string, string>
  appSettings?: AppSettings
}
export interface ConfigExportOptions {
  proxyPool: boolean
  webhooks: boolean
  registerConfig: boolean
  registerTemplates: boolean
  registerSettings: boolean
  appSettings: boolean
  includeProxyCredentials: boolean
}
export interface ConfigImportResult {
  success: boolean
  counts?: Record<string, number>
  skipped?: Record<string, number>
  error?: string
}
function object(value: unknown, section: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`配置格式无效: ${section}`)
  return value
}
function array(value: unknown, section: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`配置格式无效: ${section}`)
  return value
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

function proxyInput(value: unknown): ProxyImportEntry {
  const p = object(value, '代理池')
  if (p.label !== undefined && typeof p.label !== 'string') throw new Error('代理标签无效')
  if (p.tags !== undefined && !strings(p.tags)) throw new Error('代理标签列表无效')
  let url = typeof p.url === 'string' && !p.url.includes('***') ? p.url : undefined
  if (!url && typeof p.host === 'string' && Number.isInteger(p.port)) {
    url = `${p.protocol || 'http'}://${p.host}:${p.port}`
  }
  const parsed = url && parseProxyUrl(url)
  if (!parsed || parsed.port < 1 || parsed.port > 65535) throw new Error('代理地址无效')
  return {
    url: parsed.normalized,
    label: p.label as string | undefined,
    tags: p.tags as string[] | undefined,
    source:
      typeof p.url === 'string' && p.url.includes('***') ? 'import-config-masked' : 'import-config'
  }
}
function poolSettings(value: unknown): Partial<ProxyPoolConfig> {
  const input = object(value, '代理池设置'),
    result: Partial<ProxyPoolConfig> = {}
  for (const key of ['enabled', 'validateOnStartup', 'autoDisableDead'] as const) {
    if (input[key] === undefined) continue
    if (typeof input[key] !== 'boolean') throw new Error(`代理池字段无效: ${key}`)
    result[key] = input[key]
  }
  for (const key of [
    'failureThreshold',
    'testTimeoutMs',
    'autoValidateIntervalMin',
    'autoValidateConcurrency'
  ] as const) {
    if (input[key] === undefined) continue
    const v = input[key]
    if (
      typeof v !== 'number' ||
      !Number.isFinite(v) ||
      v < 0 ||
      (key !== 'autoValidateIntervalMin' && v === 0)
    )
      throw new Error(`代理池字段无效: ${key}`)
    result[key] = v
  }
  if (input.strategy !== undefined) {
    if (!['round_robin', 'random', 'least_used', 'fastest'].includes(String(input.strategy)))
      throw new Error('代理调度策略无效')
    result.strategy = input.strategy as ProxyPoolConfig['strategy']
  }
  if (input.testUrl !== undefined) {
    if (
      typeof input.testUrl !== 'string' ||
      !['http:', 'https:'].includes(new URL(input.testUrl).protocol)
    )
      throw new Error('代理测试地址无效')
    result.testUrl = input.testUrl
  }
  if (input.upstreamProxy !== undefined) {
    if (
      typeof input.upstreamProxy !== 'string' ||
      (input.upstreamProxy && !parseProxyUrl(input.upstreamProxy))
    )
      throw new Error('上游代理地址无效')
    result.upstreamProxy = input.upstreamProxy
  }
  return result
}
function appSettings(value: unknown): AppSettings {
  const input = object(value, 'App 设置'),
    result: AppSettings = {}
  for (const key of [
    'darkMode',
    'autoRefreshEnabled',
    'privacyMode',
    'usagePrecision',
    'autoSwitchEnabled'
  ] as const) {
    if (input[key] === undefined) continue
    if (typeof input[key] !== 'boolean') throw new Error(`App 字段无效: ${key}`)
    result[key] = input[key]
  }
  for (const key of [
    'autoRefreshInterval',
    'autoRefreshConcurrency',
    'statusCheckInterval',
    'autoSwitchThreshold',
    'autoSwitchInterval'
  ] as const) {
    if (input[key] === undefined) continue
    const v = input[key]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0)
      throw new Error(`App 字段无效: ${key}`)
    result[key] = v
  }
  if (input.theme !== undefined) result.theme = resolveThemeMode(input.theme)
  if (input.language !== undefined) result.language = resolveLanguage(input.language)
  if (input.switchTarget !== undefined) {
    if (
      input.switchTarget !== 'ide' &&
      input.switchTarget !== 'cli' &&
      input.switchTarget !== 'both'
    )
      throw new Error('账号切换目标无效')
    result.switchTarget = input.switchTarget
  }
  return result
}
function registrationConfig(value: unknown): Partial<RegisterConfig> {
  const input = object(value, '注册配置'),
    config = normalizeConfig(input)
  if (input.mode !== undefined && !config.mode) throw new Error('注册模式无效')
  return config
}
function preferences(value: unknown): Record<string, string> {
  const input = object(value, '注册偏好'),
    result: Record<string, string> = {}
  for (const key of REGISTRATION_PREFERENCE_KEYS) {
    if (input[key] === undefined) continue
    if (typeof input[key] !== 'string') throw new Error(`注册偏好无效: ${key}`)
    const v = input[key]
    if (key.endsWith('schedule-time')) {
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new Error('定时注册时间无效')
    } else if (key.endsWith('mixed-sources')) {
      const sources: unknown = JSON.parse(v)
      if (
        !strings(sources) ||
        !sources.every((source) => ['outlook', 'tempmail', 'proton', 'gptmail'].includes(source))
      )
        throw new Error('混合邮箱源无效')
    } else if (key.endsWith('mixed-weights')) {
      const weights: unknown = JSON.parse(v)
      if (
        !isRecord(weights) ||
        !Object.values(weights).every(
          (w) => typeof w === 'number' && Number.isFinite(w) && w >= 0 && w <= 100
        )
      )
        throw new Error('混合邮箱权重无效')
    } else if (
      ['enabled', 'autobackoff', 'autopause-risk'].some((suffix) => key.endsWith(suffix))
    ) {
      if (!['0', '1'].includes(v)) throw new Error(`注册开关无效: ${key}`)
    } else if (
      !/^\d+$/.test(v) ||
      !Number.isSafeInteger(Number(v)) ||
      (key.endsWith('week-mask') && Number(v) > 127)
    )
      throw new Error(`注册数值无效: ${key}`)
    result[key] = v
  }
  return result
}
interface ParsedConfig extends PortableConfig {
  legacyProxyPool?: ProxyEntry[]
  legacyPreferences?: Record<string, string>
}

/** Adapt the former Settings-page format before any live store is changed. */
function parseLegacyConfig(input: Record<string, unknown>): ParsedConfig {
  if (input.version !== 1) throw new Error('不支持的配置版本')
  const result: ParsedConfig = { version: 1, app: 'kiro-account-manager' }
  if (input.proxyPool !== undefined) {
    result.legacyProxyPool = Object.entries(object(input.proxyPool, '代理池')).map(
      ([id, value]) => {
        const source = object(value, '代理条目'),
          entry = proxyInput(source),
          parsed = parseProxyUrl(entry.url)!
        if (!id || (source.id !== undefined && source.id !== id)) throw new Error('代理 ID 无效')
        if (source.enabled !== undefined && typeof source.enabled !== 'boolean')
          throw new Error('代理开关无效')
        if (
          source.status !== undefined &&
          !['untested', 'testing', 'alive', 'dead', 'slow'].includes(String(source.status))
        )
          throw new Error('代理状态无效')
        const number = (key: string, fallback = 0): number => {
          const value = source[key]
          if (value === undefined) return fallback
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
            throw new Error(`代理字段无效: ${key}`)
          return value
        }
        const text = (key: string): string | undefined => {
          const value = source[key]
          if (value !== undefined && typeof value !== 'string')
            throw new Error(`代理字段无效: ${key}`)
          return value as string | undefined
        }
        return {
          id,
          url: parsed.normalized,
          protocol: parsed.protocol,
          host: parsed.host,
          port: parsed.port,
          username: parsed.username,
          password: parsed.password,
          label: entry.label,
          tags: entry.tags,
          source: text('source') || 'import-config',
          enabled: source.enabled !== false,
          status:
            source.status === 'testing' || source.status === undefined
              ? 'untested'
              : (source.status as ProxyEntry['status']),
          usedCount: number('usedCount'),
          failCount: number('failCount'),
          createdAt: number('createdAt', Date.now()),
          latencyMs: source.latencyMs === undefined ? undefined : number('latencyMs'),
          lastTestedAt: source.lastTestedAt === undefined ? undefined : number('lastTestedAt'),
          lastUsedAt: source.lastUsedAt === undefined ? undefined : number('lastUsedAt'),
          lastError: text('lastError'),
          lastBoundEmail: text('lastBoundEmail')
        }
      }
    )
  }
  if (input.proxyPoolConfig !== undefined)
    result.proxyPoolConfig = poolSettings(input.proxyPoolConfig)
  if (input.localStorage !== undefined) {
    const values = object(input.localStorage, '本地偏好')
    result.registerLocalStorage = preferences(values)
    result.legacyPreferences = {}
    for (const key of [
      STORAGE_KEY,
      TEMPLATES_KEY,
      HISTORY_KEY,
      'kiro-webhooks',
      'accounts_viewMode',
      'accounts_activeGroupTab',
      'systemLogs_displayLimit',
      'kiro-diagnose-moemail',
      'proxyLogs_timeRange',
      'proxyLogs_displayLimit'
    ]) {
      const text = values[key]
      if (text === undefined) continue
      if (typeof text !== 'string') throw new Error(`偏好字段无效: ${key}`)
      if (key === STORAGE_KEY) result.registerConfig = registrationConfig(JSON.parse(text))
      else if (key === TEMPLATES_KEY) result.registerTemplates = parseTemplates(JSON.parse(text))
      else if (key === 'kiro-webhooks') {
        const hooks = array(JSON.parse(text), 'Webhook').map((value) => {
          const source = object(value, 'Webhook'),
            hook = parseWebhookInput(source)
          if (typeof source.id !== 'string' || !source.id) throw new Error('Webhook ID 无效')
          return {
            ...hook,
            id: source.id,
            createdAt:
              typeof source.createdAt === 'number' && Number.isFinite(source.createdAt)
                ? source.createdAt
                : Date.now()
          }
        })
        result.legacyPreferences[key] = JSON.stringify(hooks)
      } else {
        if (
          key === HISTORY_KEY &&
          !array(JSON.parse(text), '注册历史').every(
            (value) =>
              isRecord(value) && typeof value.id === 'string' && typeof value.email === 'string'
          )
        )
          throw new Error('注册历史无效')
        if (key === 'accounts_viewMode' && !['grid', 'list'].includes(text))
          throw new Error('账号视图无效')
        if (key.endsWith('displayLimit') && text !== 'all' && !/^\d+$/.test(text))
          throw new Error('显示数量无效')
        result.legacyPreferences[key] = text
      }
    }
  }
  return result
}

export function parsePortableConfig(value: unknown): ParsedConfig {
  const input = object(value, '配置文件')
  if (input.type === 'kiro-account-manager-config') return parseLegacyConfig(input)
  if (input.app !== 'kiro-account-manager') throw new Error('文件不是有效的 Kiro 账号管理器配置')
  // Legacy hand-written exports without a version remain readable; unknown versions never mutate stores.
  if (input.version !== undefined && input.version !== 1) throw new Error('不支持的配置版本')
  const result: PortableConfig = { version: 1, app: 'kiro-account-manager' }
  if (input.proxyPool !== undefined)
    result.proxyPool = array(input.proxyPool, '代理池').map(proxyInput)
  if (input.proxyPoolConfig !== undefined)
    result.proxyPoolConfig = poolSettings(input.proxyPoolConfig)
  if (input.webhooks !== undefined)
    result.webhooks = array(input.webhooks, 'Webhook').map(parseWebhookInput)
  if (input.registerConfig !== undefined)
    result.registerConfig = registrationConfig(input.registerConfig)
  if (input.registerTemplates !== undefined)
    result.registerTemplates = parseTemplates(input.registerTemplates)
  if (input.registerLocalStorage !== undefined)
    result.registerLocalStorage = preferences(input.registerLocalStorage)
  if (input.appSettings !== undefined) result.appSettings = appSettings(input.appSettings)
  return result
}
export function buildPortableConfig(opts: ConfigExportOptions): PortableConfig {
  const store = useAccountsStore.getState()
  const result: PortableConfig = {
    version: 1,
    app: 'kiro-account-manager',
    exportedAt: new Date().toISOString()
  }
  if (opts.proxyPool) {
    result.proxyPool = Array.from(store.proxyPool.values(), (p) => {
      if (opts.includeProxyCredentials) return { ...p }
      const publicProxy = { ...p }
      delete publicProxy.password
      delete publicProxy.username
      return { ...publicProxy, url: `${p.protocol}://${p.host}:${p.port}` }
    })
    result.proxyPoolConfig = { ...store.proxyPoolConfig }
    if (!opts.includeProxyCredentials && result.proxyPoolConfig.upstreamProxy) {
      const parsed = parseProxyUrl(result.proxyPoolConfig.upstreamProxy)
      if (parsed)
        result.proxyPoolConfig.upstreamProxy = `${parsed.protocol}://${parsed.host}:${parsed.port}`
    }
  }
  if (opts.webhooks)
    result.webhooks = Array.from(useWebhookStore.getState().webhooks.values(), (w) => ({ ...w }))
  if (opts.registerConfig) {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) result.registerConfig = registrationConfig(JSON.parse(raw))
  }
  if (opts.registerTemplates) {
    const raw = localStorage.getItem(TEMPLATES_KEY)
    if (raw) result.registerTemplates = parseTemplates(JSON.parse(raw))
  }
  if (opts.registerSettings) {
    result.registerLocalStorage = {}
    for (const key of REGISTRATION_PREFERENCE_KEYS) {
      const value = localStorage.getItem(key)
      if (value !== null) result.registerLocalStorage[key] = value
    }
  }
  if (opts.appSettings) {
    const {
      theme,
      darkMode,
      language,
      autoRefreshEnabled,
      autoRefreshInterval,
      autoRefreshConcurrency,
      statusCheckInterval,
      privacyMode,
      usagePrecision,
      autoSwitchEnabled,
      autoSwitchThreshold,
      autoSwitchInterval,
      switchTarget
    } = store
    result.appSettings = {
      theme,
      darkMode,
      language,
      autoRefreshEnabled,
      autoRefreshInterval,
      autoRefreshConcurrency,
      statusCheckInterval,
      privacyMode,
      usagePrecision,
      autoSwitchEnabled,
      autoSwitchThreshold,
      autoSwitchInterval,
      switchTarget
    }
  }
  return result
}
export function containsConfigSecrets(config: PortableConfig): boolean {
  const secrets = (value?: Partial<RegisterConfig>): boolean =>
    !!(value?.outlookData || value?.tempMailEpin || value?.gptMailPrivatePassword)
  const auth = (url?: string): boolean => {
    if (!url) return false
    const parsed = parseProxyUrl(url)
    return !!(parsed?.username || parsed?.password)
  }
  return !!(
    config.webhooks?.length ||
    config.proxyPool?.some((p) => auth(p.url)) ||
    auth(config.proxyPoolConfig?.upstreamProxy) ||
    secrets(config.registerConfig) ||
    config.registerTemplates?.some((t) => secrets(t.config))
  )
}
export async function importPortableConfig(value: unknown): Promise<ConfigImportResult> {
  const counts: Record<string, number> = {},
    skipped: Record<string, number> = {}
  const previous = new Map<string, string | null>()
  try {
    const config = parsePortableConfig(value)
    const writes: Record<string, string> = {
      ...config.registerLocalStorage,
      ...config.legacyPreferences
    }
    if (config.registerConfig) writes[STORAGE_KEY] = JSON.stringify(config.registerConfig)
    if (config.registerTemplates) writes[TEMPLATES_KEY] = JSON.stringify(config.registerTemplates)
    try {
      for (const [key, text] of Object.entries(writes)) {
        previous.set(key, localStorage.getItem(key))
        localStorage.setItem(key, text)
      }
      if (config.webhooks) {
        const result = useWebhookStore.getState().importWebhooks(config.webhooks)
        counts.Webhook = result.added
        skipped.Webhook = result.skipped
      }
    } catch (error) {
      for (const [key, text] of previous) {
        try {
          if (text === null) localStorage.removeItem(key)
          else localStorage.setItem(key, text)
        } catch {
          /* Report the original persistence failure; no account mutations have run. */
        }
      }
      throw error
    }
    if (config.registerConfig) counts['注册配置'] = 1
    if (config.registerTemplates) counts['注册模板'] = config.registerTemplates.length
    if (config.registerLocalStorage)
      counts['注册偏好'] = Object.keys(config.registerLocalStorage).length
    const store = useAccountsStore.getState()
    if (config.legacyPreferences?.['kiro-webhooks'] !== undefined) {
      // Cancel pending deliveries before replacing the legacy snapshot.
      for (const id of useWebhookStore.getState().webhooks.keys())
        void window.api.webhookCancel(id).catch(() => {})
      useWebhookStore.getState().loadFromStorage()
      counts.Webhook = useWebhookStore.getState().webhooks.size
    }
    if (config.legacyPreferences?.accounts_activeGroupTab !== undefined)
      store.setActiveGroupTab(config.legacyPreferences.accounts_activeGroupTab)
    if (config.legacyProxyPool) {
      store.replaceProxyPool(config.legacyProxyPool)
      counts['代理池'] = config.legacyProxyPool.length
    }
    if (config.proxyPool) {
      const result = store.addProxies(config.proxyPool)
      counts['代理池'] = result.added
      skipped['代理池'] = result.skipped
    }
    if (config.proxyPoolConfig) store.setProxyPoolConfig(config.proxyPoolConfig)
    const s = config.appSettings
    if (s) {
      if (s.theme !== undefined) store.setTheme(s.theme)
      else if (s.darkMode !== undefined) store.setDarkMode(s.darkMode)
      if (s.language !== undefined) store.setLanguage(s.language)
      // Apply scheduling options before starting timers.
      if (s.autoRefreshConcurrency !== undefined)
        store.setAutoRefreshConcurrency(s.autoRefreshConcurrency)
      if (s.statusCheckInterval !== undefined) store.setStatusCheckInterval(s.statusCheckInterval)
      if (s.privacyMode !== undefined) store.setPrivacyMode(s.privacyMode)
      if (s.usagePrecision !== undefined) store.setUsagePrecision(s.usagePrecision)
      if (s.switchTarget !== undefined) store.setSwitchTarget(s.switchTarget)
      if (s.autoRefreshEnabled !== undefined || s.autoRefreshInterval !== undefined)
        store.setAutoRefresh(
          s.autoRefreshEnabled ?? store.autoRefreshEnabled,
          s.autoRefreshInterval
        )
      if (
        s.autoSwitchEnabled !== undefined ||
        s.autoSwitchThreshold !== undefined ||
        s.autoSwitchInterval !== undefined
      )
        store.setAutoSwitch(
          s.autoSwitchEnabled ?? store.autoSwitchEnabled,
          s.autoSwitchThreshold,
          s.autoSwitchInterval
        )
      counts['App 设置'] = 1
    }
    if (config.proxyPool || config.legacyProxyPool || config.proxyPoolConfig || s)
      await store.flushSaveImmediately()
    return { success: true, counts, skipped }
  } catch (error) {
    return {
      success: false,
      counts,
      skipped,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

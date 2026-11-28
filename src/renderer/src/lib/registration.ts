import type { RegistrationResult as RegResult, RegStepName } from '../../../shared/registration'
export type {
  RegistrationResult as RegResult,
  FingerprintSnapshot,
  RegStepName
} from '../../../shared/registration'

export type ErrCategory =
  | 'risk_control'
  | 'proxy_chain'
  | 'strict_proxy'
  | 'proxy_whitelist'
  | 'eof'
  | 'otp_timeout'
  | 'network'
  | 'email_used'
  | 'rate_limit'
  | 'auth'
  | 'suspended'
  | 'unknown'

export interface ErrorDiagnosis {
  category: ErrCategory
  title: string
  reasons: string[]
  suggestions: string[]
}

export function diagnoseRegError(err: string | undefined): ErrorDiagnosis {
  const e = (err || '').toLowerCase()
  if (!e) {
    return {
      category: 'unknown',
      title: '未知错误',
      reasons: ['未捕获到具体错误信息'],
      suggestions: ['查看完整日志']
    }
  }
  // AWS 风控
  if (
    e.includes('aws-risk-control') ||
    e.includes('风控') ||
    e.includes('请稍后再试') ||
    e.includes('try again later')
  ) {
    return {
      category: 'risk_control',
      title: 'AWS 风控触发',
      reasons: [
        '注册请求被 AWS 安全策略拦截',
        '常见诱因：同 IP 短时注册多账号、行为节奏机械化、邮箱域名被关联'
      ],
      suggestions: [
        '启用代理池 + 每号唯一 session（每号一个 IP）',
        '降低速率（限速 10/分钟或更低）',
        '邮箱用多域名轮换',
        '若用 bestproxy 类住宅代理，确保来源 IP 非大陆'
      ]
    }
  }
  // bestproxy 610 / IP 白名单类
  if (
    e.includes('610') ||
    e.includes('whitelist') ||
    (e.includes('connect') && e.includes('http 4'))
  ) {
    return {
      category: 'proxy_whitelist',
      title: '代理认证 / 白名单失败',
      reasons: [
        '目标代理拒绝认证（账密错或来源 IP 不在白名单）',
        'bestproxy 的 610 = 来源 IP 未授权'
      ],
      suggestions: [
        '在代理后台把当前出口 IP 加入白名单',
        '或改用账密直连模式 + 确保来源是允许地区',
        '配合"上游中转代理"用非大陆中转'
      ]
    }
  }
  // 代理链失败
  if (e.includes('proxychain') || e.includes('代理链') || e.includes('上游中转')) {
    return {
      category: 'proxy_chain',
      title: '代理链建立失败',
      reasons: ['"上游中转 → 目标代理"链路握手未通过'],
      suggestions: [
        '到「代理池」页面点「诊断」定位哪一层挂了',
        '确认上游中转端口（如 socks5://127.0.0.1:7890）已在跑',
        '若目标代理要求白名单，确保中转出口 IP 已加白'
      ]
    }
  }
  // 严格代理（无可用代理拒绝裸奔）
  if (e.includes('严格代理') || (e.includes('strict') && e.includes('proxy'))) {
    return {
      category: 'strict_proxy',
      title: '严格代理模式拦截',
      reasons: ['代理池启用了"绝不裸奔直连"，但当前无可用代理'],
      suggestions: [
        '到代理池验活，确认至少 1 条 alive',
        '检查代理是否被自动停用',
        '临时可手动启用所有代理 / 关掉"失败自动停用"'
      ]
    }
  }
  // EOF / status=0 网络抖动
  if (
    e.includes('eof') ||
    (e.includes('status=0') && e.includes('failed to do request')) ||
    e.includes('connection reset')
  ) {
    return {
      category: 'eof',
      title: '网络瞬时断开（EOF）',
      reasons: [
        'TLS 连接在握手或传输中被对端 RST/关闭',
        '常见于代理不稳定 / 高并发挤压 / 中间网络抖动'
      ],
      suggestions: [
        '降低并发数',
        '换代理 / 加上游中转',
        '已内置重试，偶发可忽略；连续大量则更换出口'
      ]
    }
  }
  // OTP 超时
  if (
    (e.includes('timeout') || e.includes('超时')) &&
    (e.includes('otp') || e.includes('验证码') || e.includes('code'))
  ) {
    return {
      category: 'otp_timeout',
      title: '等待验证码超时',
      reasons: [
        '临时邮箱未在期限内收到 AWS 验证邮件',
        '可能 AWS 没发（风控拦截）/ 邮件落到垃圾 / 临时邮箱服务延迟'
      ],
      suggestions: [
        '确认临时邮箱服务可用',
        '该邮箱域名可能被 AWS 标黑，换域名重试',
        '若反复出现，多半是 AWS 静默风控，需换 IP/换节奏'
      ]
    }
  }
  // 一般网络
  if (
    e.includes('timeout') ||
    e.includes('超时') ||
    e.includes('etimedout') ||
    e.includes('fetch failed') ||
    e.includes('econnreset') ||
    e.includes('econnrefused') ||
    e.includes('enotfound') ||
    e.includes('network')
  ) {
    return {
      category: 'network',
      title: '网络错误',
      reasons: ['连接 / DNS / 超时类失败'],
      suggestions: ['检查本机网络与代理可达性', '降低并发再试']
    }
  }
  // 邮箱已被注册
  if (
    e.includes('已注册') ||
    (e.includes('email') &&
      (e.includes('already') ||
        e.includes('exists') ||
        e.includes('used') ||
        e.includes('已存在') ||
        e.includes('已被')))
  ) {
    return {
      category: 'email_used',
      title: '邮箱已被注册',
      reasons: ['该邮箱地址 AWS 侧已存在'],
      suggestions: [
        '前缀生成器近期已增强随机性（中间名/双姓），再跑一次几乎不会撞',
        '使用多域名进一步降低冲突'
      ]
    }
  }
  // 限流
  if (
    e.includes('rate') ||
    e.includes('limit') ||
    e.includes('too many') ||
    e.includes('限流') ||
    e.includes('429')
  ) {
    return {
      category: 'rate_limit',
      title: '触发限流',
      reasons: ['短时请求次数超出 AWS 接受范围'],
      suggestions: ['降低 maxPerMinute 与并发', '启用风控自动暂停']
    }
  }
  // suspended
  if (e.includes('suspended')) {
    return {
      category: 'suspended',
      title: '账号已被停用',
      reasons: [
        '注册流程跑完但 AWS 在最后一步把账号标为 suspended',
        '通常是风控级判定（域名/IP/指纹综合）'
      ],
      suggestions: ['换出口 IP / 换邮箱域名 / 降低速率', '可看作"软风控"信号，应立刻放慢']
    }
  }
  // 鉴权
  if (e.includes('unauthorized') || e.includes('401') || e.includes('403')) {
    return {
      category: 'auth',
      title: '鉴权失败',
      reasons: ['上游接口返回 401/403'],
      suggestions: ['检查凭据 / 看接口侧响应体']
    }
  }
  return {
    category: 'unknown',
    title: '其他错误',
    reasons: [err || ''],
    suggestions: ['查看完整日志定位']
  }
}

export function classifyError(
  err: string | undefined
): 'network' | 'otp_timeout' | 'email_used' | 'rate_limit' | 'auth' | 'risk_control' | 'unknown' {
  const cat = diagnoseRegError(err).category
  if (cat === 'risk_control') return 'risk_control'
  if (cat === 'otp_timeout') return 'otp_timeout'
  if (cat === 'email_used') return 'email_used'
  if (cat === 'rate_limit') return 'rate_limit'
  if (cat === 'auth') return 'auth'
  if (
    cat === 'eof' ||
    cat === 'network' ||
    cat === 'proxy_chain' ||
    cat === 'proxy_whitelist' ||
    cat === 'strict_proxy'
  )
    return 'network'
  return 'unknown'
}

export function randomSession(len = 8): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let s = ''
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

export function injectProxySession(url: string): string {
  if (!url) return url
  const session = randomSession()
  if (url.includes('{session}')) {
    return url.replace(/\{session\}/g, session)
  }
  const m = url.match(/^(\w+:\/\/)([^@/]+)@(.+)$/)
  if (m) {
    const [, scheme, userinfo, hostpart] = m
    const ci = userinfo.indexOf(':')
    const username = ci >= 0 ? userinfo.slice(0, ci) : userinfo
    const password = ci >= 0 ? userinfo.slice(ci + 1) : ''
    const isParamStyle = /_(area|life|city|state|session|region|country)-/i.test(username)
    if (isParamStyle && !/_session-/i.test(username)) {
      const newUser = `${username}_session-${session}`
      return `${scheme}${newUser}${ci >= 0 ? ':' + password : ''}@${hostpart}`
    }
  }
  return url
}

export type RegMode = 'manual' | 'outlook' | 'tempmail' | 'proton' | 'gptmail' | 'mixed'

export type AutoEmailSource = 'outlook' | 'tempmail' | 'proton' | 'gptmail'

export type Phase =
  | 'idle'
  | 'initializing'
  | 'email'
  | 'otp'
  | 'running'
  | 'done'
  | 'importing'
  | 'fetching-link'
  | 'finalized'

export type BatchItemStatus =
  | 'pending'
  | 'running'
  | 'retrying'
  | 'success'
  | 'failed'
  | 'imported'
  | 'import_failed'
  | 'cancelled'

export interface HistoryItem {
  id: string
  time: number
  email: string
  status: 'success' | 'failed'
  error?: string
  password?: string
  result?: RegResult
  imported: boolean
  subscriptionUrl?: string
}

export const STEP_LABEL_CN: Record<RegStepName, string> = {
  init: '初始化',
  'proxy-chain-ready': '代理链就绪',
  'tls-ready': 'TLS 就绪',
  'exit-ip': '探出口 IP',
  oidc: 'OIDC',
  device: '设备授权',
  'email-created': '邮箱已创建',
  portal: 'Portal',
  'workflow-init': '工作流',
  'submit-email': '提交邮箱',
  signup: 'Signup',
  'send-otp': '发送验证码',
  'waiting-otp': '等验证码',
  'otp-received': '验证码到',
  'create-identity': '建身份',
  'set-password': '设密码',
  'sso-workflow': 'SSO 工作流',
  'sso-token': '取 Token',
  'verify-alive': '验活',
  done: '完成'
}

export interface BatchItem {
  id: string
  index: number
  status: BatchItemStatus
  email: string
  error?: string
  retryCount: number
  result?: RegResult
  historyId?: string
  /** 实时进度：当前 step、起步时间、当前 step 起步时间、出口 IP */
  currentStep?: RegStepName
  startedAt?: number
  stepStartedAt?: number
  exitIp?: string
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${m}m${s.toString().padStart(2, '0')}s`
}

export const CORE_STEPS = ['OIDC', 'Email', 'Verify', 'Password', 'Token', 'Done'] as const

export function buildManualSteps(hasImport: boolean, hasProLink: boolean): readonly string[] {
  const extras: string[] = []
  if (hasImport) extras.push('Import')
  if (hasProLink) extras.push('ProLink')
  if (extras.length === 0) return CORE_STEPS
  // 在 Done 之前插入额外步骤；'Done' 永远在最后
  return [...CORE_STEPS.slice(0, -1), ...extras, 'Done']
}

export function phaseToStep(
  phase: Phase,
  lastLog: string | undefined,
  steps: readonly string[]
): number {
  // 步骤索引辅助：找具体步骤名在动态数组中的位置
  const idxOf = (name: string): number => steps.indexOf(name)
  const lastIdx = steps.length - 1

  switch (phase) {
    case 'idle':
      return -1
    case 'initializing':
      return idxOf('OIDC')
    case 'email':
      return idxOf('Email')
    case 'otp':
      return idxOf('Verify')
    case 'done':
      return idxOf('Done') // 核心流程完成（未启用后处理时即最终态）
    case 'importing': {
      const i = idxOf('Import')
      return i >= 0 ? i : idxOf('Done')
    }
    case 'fetching-link': {
      const i = idxOf('ProLink')
      return i >= 0 ? i : idxOf('Done')
    }
    case 'finalized':
      return lastIdx
    case 'running': {
      if (!lastLog) return Math.max(0, idxOf('Email'))
      const log = lastLog.toLowerCase()
      // 自动模式 OTP 提交时也走 running，这里识别后处理消息
      if (
        log.includes('正在获取 pro') ||
        log.includes('pro link') ||
        log.includes('fetching pro')
      ) {
        const i = idxOf('ProLink')
        if (i >= 0) return i
      }
      if (log.includes('正在导入') || log.includes('importing') || log.includes('已导入')) {
        const i = idxOf('Import')
        if (i >= 0) return i
      }
      // [13] SSO Token / [12.5] complete-signup / 验活成功
      if (
        log.includes('sso') ||
        log.includes('token') ||
        log.includes('验活') ||
        log.includes('complete') ||
        log.includes('end-of-workflow')
      )
        return idxOf('Token')
      // [12] 设置密码 / SetPassword / 加密公钥
      if (log.includes('密码') || log.includes('password') || log.includes('加密公钥'))
        return idxOf('Password')
      // [9] OTP / [10] verify-email / signup verify
      if (log.includes('验证码') || log.includes('otp') || log.includes('verify'))
        return idxOf('Verify')
      // [7-8] Signup / SignupInit / Profile
      if (log.includes('signup') || log.includes('profile') || log.includes('注册初始化'))
        return idxOf('Verify')
      // [6] 提交邮箱 / SubmitEmail
      if (log.includes('提交邮箱') || log.includes('submit') || log.includes('邮箱'))
        return idxOf('Email')
      return Math.max(0, idxOf('Email'))
    }
  }
}

export const STORAGE_KEY = 'kiro-register-config'

export const HISTORY_KEY = 'kiro-register-history'

export const EMAIL_BLACKLIST_KEY = 'kiro-register-email-blacklist'

export const TEMPLATES_KEY = 'kiro-register-templates'

export interface RegisterTemplate {
  id: string
  name: string
  config: RegisterConfig
  createdAt: number
}

export function loadTemplates(): RegisterTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY)
    return raw ? parseTemplates(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

export function saveTemplates(items: RegisterTemplate[]): void {
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(items))
  } catch {
    /* ignore */
  }
}

export function loadEmailBlacklist(): Set<string> {
  try {
    const raw = localStorage.getItem(EMAIL_BLACKLIST_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as string[]
    return new Set(arr.map((e) => e.toLowerCase()))
  } catch {
    return new Set()
  }
}

export function saveEmailBlacklist(set: Set<string>): void {
  try {
    // 限制最多 5000 条，避免无限增长
    const arr = Array.from(set).slice(-5000)
    localStorage.setItem(EMAIL_BLACKLIST_KEY, JSON.stringify(arr))
  } catch {
    /* ignore */
  }
}

export function clearEmailBlacklist(): void {
  try {
    localStorage.removeItem(EMAIL_BLACKLIST_KEY)
  } catch {
    /* ignore */
  }
}

export function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter(
          (item) =>
            item &&
            typeof item === 'object' &&
            typeof item.id === 'string' &&
            typeof item.email === 'string'
        )
      : []
  } catch {
    return []
  }
}

export function saveHistory(items: HistoryItem[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 100)))
  } catch {
    /* ignore */
  }
}

export type ProPlanType =
  | 'Q_DEVELOPER_STANDALONE_PRO'
  | 'Q_DEVELOPER_STANDALONE_PRO_PLUS'
  | 'Q_DEVELOPER_STANDALONE_POWER'

export interface RegisterConfig {
  mode: RegMode
  outlookData: string
  fullName: string
  batchCount: number
  batchInterval: number
  batchAutoImport: boolean
  batchRetries: number
  batchConcurrency: number
  autoFetchProLink: boolean
  proPlanType: ProPlanType
  tempMailEmail: string
  tempMailEpin: string
  tempMailDomain: string
  /** Proton 母邮箱（点号别名母号，如 evanbartellchae@protonmail.com）*/
  protonBaseEmail: string
  /** GPTmail (mail.chatgpt.org.uk) — 支持两种模式：私有域名直收（inbox 留空）或 CF 转发（填 inbox）；
   *   私有域名设了密码时填 privatePassword */
  gptMailBaseURL: string
  gptMailInboxEmail: string
  gptMailDomain: string
  gptMailPrefix: string
  gptMailPrivatePassword: string
  /** 手动模式 — 母邮箱（收验证码的真实邮箱）*/
  manualParentEmail: string
  /** 手动模式 — 启用匿名邮箱（点号变体）*/
  manualAnonymousEmail: boolean
  /** 混合模式 — 启用的邮箱源 */
  mixedEnabledSources?: AutoEmailSource[]
}

export function loadConfig(): Partial<RegisterConfig> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? normalizeConfig(JSON.parse(raw)) : {}
  } catch {
    return {}
  }
}

export function saveConfig(cfg: RegisterConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
  } catch {
    /* ignore */
  }
}

export function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.floor(value)))
    : fallback
}

export function normalizeConfig(value: unknown): Partial<RegisterConfig> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  const result: Partial<RegisterConfig> = {}
  const modes = ['manual', 'outlook', 'tempmail', 'proton', 'gptmail', 'mixed']
  if (input.mode === 'moemail') result.mode = 'outlook'
  else if (typeof input.mode === 'string' && modes.includes(input.mode))
    result.mode = input.mode as RegMode
  for (const key of [
    'outlookData',
    'fullName',
    'tempMailEmail',
    'tempMailEpin',
    'tempMailDomain',
    'protonBaseEmail',
    'gptMailBaseURL',
    'gptMailInboxEmail',
    'gptMailDomain',
    'gptMailPrefix',
    'gptMailPrivatePassword',
    'manualParentEmail'
  ] as const) {
    if (typeof input[key] === 'string') result[key] = input[key]
  }
  for (const key of ['batchAutoImport', 'autoFetchProLink', 'manualAnonymousEmail'] as const)
    if (typeof input[key] === 'boolean') result[key] = input[key]
  result.batchCount = boundedInteger(input.batchCount, 1, 1, 100)
  result.batchConcurrency = boundedInteger(input.batchConcurrency, 1, 1, 100)
  result.batchRetries = boundedInteger(input.batchRetries, 1, 0, 10)
  result.batchInterval = boundedInteger(input.batchInterval, 5, 0, 300)
  if (
    [
      'Q_DEVELOPER_STANDALONE_PRO',
      'Q_DEVELOPER_STANDALONE_PRO_PLUS',
      'Q_DEVELOPER_STANDALONE_POWER'
    ].includes(String(input.proPlanType))
  )
    result.proPlanType = input.proPlanType as ProPlanType
  if (Array.isArray(input.mixedEnabledSources))
    result.mixedEnabledSources = input.mixedEnabledSources.filter(
      (source): source is AutoEmailSource =>
        ['outlook', 'tempmail', 'proton', 'gptmail'].includes(source)
    )
  return result
}

export function parseTemplates(value: unknown): RegisterTemplate[] {
  if (!Array.isArray(value)) throw new Error('文件格式无效')
  return value.map((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.id !== 'string' ||
      !entry.id ||
      typeof entry.name !== 'string' ||
      !entry.name.trim() ||
      !entry.config ||
      typeof entry.config !== 'object' ||
      Array.isArray(entry.config)
    )
      throw new Error('模板配置无效')
    const config = normalizeConfig(entry.config)
    if (!config.mode) throw new Error('模板注册模式无效')
    return {
      id: entry.id,
      name: entry.name,
      createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : Date.now(),
      config: config as RegisterConfig
    }
  })
}

/** Portable preferences only: exclude history, quota counters and the last scheduler run. */
export const REGISTRATION_PREFERENCE_KEYS = [
  'kiro-register-ratelimit-enabled', 'kiro-register-ratelimit-max',
  'kiro-register-ratelimit-burst', 'kiro-register-backoff-base-sec',
  'kiro-register-backoff-max-sec', 'kiro-register-autobackoff',
  'kiro-register-autopause-risk', 'kiro-register-dailyquota-limit',
  'kiro-register-schedule-enabled', 'kiro-register-schedule-time',
  'kiro-register-schedule-week-mask', 'kiro-register-mixed-sources',
  'kiro-register-mixed-weights'
]

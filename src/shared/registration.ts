export interface RegistrationConfig {
  // AWS
  oidcBase: string
  signinBase: string
  profileBase: string
  viewBase: string
  portalBase: string
  directoryId: string
  startURL: string

  // 默认值
  password: string
  fullName: string

  // 运行时
  proxy: string
  /** 上游中转代理（可选，用于代理链）：让对 proxy(目标代理) 的连接经非大陆中转发起 */
  upstreamProxy: string
  /**
   * 严格代理模式：开启后任何「代理缺失/代理链失败/回退环境变量」情况都立即抛错中止注册，
   * 杜绝静默回退到本机真实 IP 直连。批量注册启用代理池时由前端强制开启。
   */
  strictProxy: boolean

  // MoEmail 配置
  moEmailBaseURL: string
  moEmailAPIKey: string

  // Outlook 模式
  useOutlook: boolean
  outlookData: string

  // TempMail.Plus + 自建域名
  useTempMailPlus: boolean
  tempMailPlusEmail: string // tempmail.plus 用户名（不含 @mailto.plus）
  tempMailPlusEpin: string
  tempMailPlusDomain: string // 自建域名

  // Proton 点号别名（webview 借壳官方网页取码，需先在应用内登录 Proton）
  useProton: boolean
  protonEmail: string // 本次注册使用的 Proton 邮箱地址（母邮箱或其点号变体，由前端生成）

  // GPTmail (mail.chatgpt.org.uk) — 域名邮箱取码，支持两种玩法：
  //   A. 私有域名直收：MX 解析到 GPTmail，inboxEmail 留空（私有域名需密码解锁则填 privatePassword）
  //   B. CF Email Routing 转发：inboxEmail 填一个固定 GPTmail 邮箱
  useGptMail: boolean
  gptMailBaseURL: string // 可选，默认 https://mail.chatgpt.org.uk；私有部署可改
  gptMailInboxEmail: string // 可选：填了 = CF 转发模式（所有 prefix@domain 转发到此邮箱）；留空 = 私有域名直收
  gptMailDomain: string // 必填：用户自己的域名池，多个用空格/逗号
  gptMailPrefix: string // 可选：固定前缀，留空则 randomEmailPrefix() 生成
  gptMailPrivatePassword: string // 可选：仅私有域名模式有效。在 GPTmail 设私有域名时设的密码

  // 手动模式
  manualMode: boolean
}

export interface FingerprintSnapshot {
  chromeVer: string
  ua: string
  gpuVendor: string
  gpuModel: string
  canvasHash: number
  screen: { width: number; height: number }
  /** 注册时使用的出口代理 URL（脱敏前缀） */
  proxyUrl?: string
  /** 探测到的出口 IP（注册时实际用的公网 IP） */
  exitIP?: string
}

export interface RegistrationResult {
  status: 'success' | 'failed'
  email: string
  password?: string
  error?: string
  clientId?: string
  clientSecret?: string
  refreshToken?: string
  accessToken?: string
  expiresAt?: number
  region?: string
  provider?: string
  verify?: Record<string, unknown>
  /** 本次注册使用的指纹摘要（用于审计与后续复用） */
  fingerprint?: FingerprintSnapshot
}

/** 注册流程的可观察「阶段」标识，供前端按 taskId 实时显示进度 */
export type RegStepName =
  | 'init'
  | 'proxy-chain-ready'
  | 'tls-ready'
  | 'exit-ip'
  | 'oidc'
  | 'device'
  | 'email-created'
  | 'portal'
  | 'workflow-init'
  | 'submit-email'
  | 'signup'
  | 'send-otp'
  | 'waiting-otp'
  | 'otp-received'
  | 'create-identity'
  | 'set-password'
  | 'sso-workflow'
  | 'sso-token'
  | 'verify-alive'
  | 'done'

export interface RegStepEvent {
  name: RegStepName
  ts: number
  email?: string
  exitIp?: string
  extra?: Record<string, unknown>
}

export type RegistrationStartConfig = Partial<RegistrationConfig> & { taskId?: string }
export type RegistrationReply = { success: boolean; result?: RegistrationResult; error?: string }

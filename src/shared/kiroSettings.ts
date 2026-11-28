export interface KiroSettings {
  agentAutonomy: string
  modelSelection: string
  enableDebugLogs: boolean
  enableTabAutocomplete: boolean
  enableCodebaseIndexing: boolean
  usageSummary: boolean
  codeReferences: boolean
  configureMCP: string
  trustedCommands: string[]
  trustedTools: Record<string, boolean>
  commandDenylist: string[]
  ignoreFiles: string[]
  mcpApprovedEnvVars: string[]
  notificationsActionRequired: boolean
  notificationsFailure: boolean
  notificationsSuccess: boolean
  notificationsBilling: boolean
}

export const DEFAULT_KIRO_SETTINGS: KiroSettings = {
  agentAutonomy: 'Autopilot',
  modelSelection: 'auto',
  enableDebugLogs: false,
  enableTabAutocomplete: false,
  enableCodebaseIndexing: false,
  usageSummary: true,
  codeReferences: false,
  configureMCP: 'Enabled',
  trustedCommands: [],
  trustedTools: {},
  commandDenylist: [],
  ignoreFiles: [],
  mcpApprovedEnvVars: [],
  notificationsActionRequired: true,
  notificationsFailure: false,
  notificationsSuccess: false,
  notificationsBilling: true
}

export const KIRO_SETTING_KEYS = {
  modelSelection: 'kiroAgent.modelSelection',
  agentAutonomy: 'kiroAgent.agentAutonomy',
  enableDebugLogs: 'kiroAgent.enableDebugLogs',
  enableTabAutocomplete: 'kiroAgent.enableTabAutocomplete',
  enableCodebaseIndexing: 'kiroAgent.enableCodebaseIndexing',
  usageSummary: 'kiroAgent.usageSummary',
  codeReferences: 'kiroAgent.codeReferences.referenceTracker',
  configureMCP: 'kiroAgent.configureMCP',
  trustedCommands: 'kiroAgent.trustedCommands',
  trustedTools: 'kiroAgent.trustedTools',
  commandDenylist: 'kiroAgent.commandDenylist',
  ignoreFiles: 'kiroAgent.ignoreFiles',
  mcpApprovedEnvVars: 'kiroAgent.mcpApprovedEnvVars',
  notificationsActionRequired: 'kiroAgent.notifications.agent.actionRequired',
  notificationsFailure: 'kiroAgent.notifications.agent.failure',
  notificationsSuccess: 'kiroAgent.notifications.agent.success',
  notificationsBilling: 'kiroAgent.notifications.billing'
} as const satisfies Record<keyof KiroSettings, string>

/** Only expose fields supported by the local-process editor; retain all other fields on disk. */
export interface McpServerEdit {
  command: string
  args?: string[]
  env?: Record<string, string>
}
export interface McpServer {
  command?: string
  url?: string
  args?: string[]
  env?: Record<string, string>
  [key: string]: unknown
}
export interface McpConfig {
  mcpServers: Record<string, McpServer>
}
export interface KiroSettingsResult {
  settings?: Partial<KiroSettings>
  mcpConfig?: McpConfig
  steeringFiles?: string[]
  errors?: Partial<Record<'settings' | 'mcp' | 'steering', string>>
  error?: string
}
export interface KiroFileResult {
  success: boolean
  error?: string
  cancelled?: boolean
}
export interface KiroModelOption {
  id: string
  name: string
  description: string
}
export interface KiroModelsResult {
  models: KiroModelOption[]
  error?: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseKiroSettings(value: unknown): Partial<KiroSettings> {
  if (!isRecord(value)) throw new Error('Kiro 设置格式无效')
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(KIRO_SETTING_KEYS) as (keyof KiroSettings)[]) {
    const v = value[key]
    if (v === undefined) continue
    const defaultValue = DEFAULT_KIRO_SETTINGS[key]
    const valid = Array.isArray(defaultValue)
      ? Array.isArray(v) && v.every((item) => typeof item === 'string')
      : key === 'trustedTools'
        ? isRecord(v) && Object.values(v).every((item) => typeof item === 'boolean')
        : typeof v === typeof defaultValue
    if (!valid) throw new Error(`Kiro 设置字段无效: ${key}`)
    result[key] = v
  }
  return result
}

export type OSType = 'windows' | 'macos' | 'linux' | 'unknown'
export interface MachineIdConfig {
  autoSwitchOnAccountChange: boolean
  bindMachineIdToAccount: boolean
  useBindedMachineId: boolean
}
export interface MachineIdHistoryEntry {
  id: string
  machineId: string
  timestamp: number
  action: 'initial' | 'manual' | 'auto_switch' | 'restore' | 'bind'
  accountId?: string
  accountEmail?: string
}
export interface MachineIdResult {
  success: boolean
  machineId?: string
  error?: string
  warning?: string
  cancelled?: boolean
  requiresAdmin?: boolean
}
/** System UUID / Linux machine-id only. API device IDs use their separate 64-hex format. */
export function normalizeMachineId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim().toLowerCase()
  const hex = id.replace(/-/g, '')
  if (
    !(
      /^[\da-f]{32}$/.test(id) ||
      /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(id)
    ) ||
    /^0+$/.test(hex)
  )
    return null
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

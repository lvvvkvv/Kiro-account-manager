export interface ProxyLogEntry {
  timestamp: string
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  category: string
  message: string
  data?: unknown
}

export interface ProxyLogBatch {
  entries: ProxyLogEntry[]
  cursor: number
  reset: boolean
  total: number
}

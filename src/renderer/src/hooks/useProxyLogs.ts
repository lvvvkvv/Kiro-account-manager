import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProxyLogEntry } from '../../../shared/proxyLogs'

/** Fetch only new logs; polling waits for each request to finish. */
export function useProxyLogs(
  enabled: boolean,
  limit: number,
  isAtBottom: boolean
): {
  logs: ProxyLogEntry[]
  totalCount: number
  loading: boolean
  newLogCount: number
  setNewLogCount: (value: number) => void
  refresh: () => Promise<void>
  clear: () => Promise<void>
} {
  const [logs, setLogs] = useState<ProxyLogEntry[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [newLogCount, setNewLogCount] = useState(0)
  const atBottom = useRef(isAtBottom)
  atBottom.current = isAtBottom
  const pending = useRef<Promise<void> | null>(null)
  const loadRef = useRef<(reset?: boolean) => Promise<void>>(async () => undefined)

  useEffect(() => {
    if (isAtBottom) setNewLogCount(0)
  }, [isAtBottom])

  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let cursor: number | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async (reset = false): Promise<void> => {
      while (pending.current) await pending.current
      if (disposed) return
      const task = (async () => {
        try {
          const batch = await window.api.proxyGetLogBatch(reset ? undefined : cursor, limit)
          if (disposed) return
          const added = cursor === undefined || batch.reset ? 0 : batch.cursor - cursor
          cursor = batch.cursor
          setTotalCount(batch.total)
          if (batch.reset || batch.entries.length) {
            setLogs((previous) =>
              batch.reset ? batch.entries : [...previous, ...batch.entries].slice(-limit)
            )
          }
          if (batch.reset) setNewLogCount(0)
          else if (!atBottom.current && added > 0) setNewLogCount((count) => count + added)
        } catch (error) {
          console.error('Failed to load logs:', error)
        }
      })()
      pending.current = task
      await task
      if (pending.current === task) pending.current = null
    }
    loadRef.current = load
    const poll = async (): Promise<void> => {
      await load()
      if (!disposed) {
        setLoading(false)
        timer = setTimeout(() => {
          void poll()
        }, 1500)
      }
    }
    setLoading(true)
    void poll()
    return () => {
      disposed = true
      clearTimeout(timer)
      loadRef.current = async () => undefined
    }
  }, [enabled, limit])

  const refresh = useCallback(() => loadRef.current(), [])
  const clear = useCallback(async () => {
    await window.api.proxyClearLogs()
    await loadRef.current(true)
  }, [])

  return { logs, totalCount, loading, newLogCount, setNewLogCount, refresh, clear }
}

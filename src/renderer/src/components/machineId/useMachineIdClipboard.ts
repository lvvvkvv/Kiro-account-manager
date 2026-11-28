import { useEffect, useRef, useState } from 'react'
import { useAccountsStore } from '@/store/accounts'
export function useMachineIdClipboard(): {
  copiedId: string | null
  copyToClipboard: (text: string, id?: string) => Promise<void>
} {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const active = useRef(false)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      clearTimeout(timer.current)
    }
  }, [])
  const copyToClipboard = async (text: string, id = 'default'): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      if (!active.current) return
      clearTimeout(timer.current)
      setCopiedId(id)
      timer.current = setTimeout(() => setCopiedId(null), 1500)
    } catch (error) {
      useAccountsStore.setState({ machineIdError: String(error) })
    }
  }
  return { copiedId, copyToClipboard }
}

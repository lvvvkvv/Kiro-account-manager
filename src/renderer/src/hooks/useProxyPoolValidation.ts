import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAccountsStore } from '@/store/accounts'

/** Lives with the app so navigation and pool mutations do not reset the deadline. */
export function useProxyPoolValidation(ready: boolean): void {
  const { interval, startup } = useAccountsStore(
    useShallow((state) => ({
      interval: state.proxyPoolConfig.autoValidateIntervalMin,
      startup: state.proxyPoolConfig.validateOnStartup
    }))
  )
  const startupChecked = useRef(false)
  const lastRun = useRef(Date.now())
  useEffect(() => {
    if (!ready) return
    const validate = (): void => {
      const state = useAccountsStore.getState()
      const ids = Array.from(state.proxyPool.values())
        .filter((proxy) => proxy.enabled)
        .map((proxy) => proxy.id)
      lastRun.current = Date.now()
      if (ids.length)
        void state.validateProxiesBatch(ids, state.proxyPoolConfig.autoValidateConcurrency || 5)
    }
    if (!startupChecked.current) {
      startupChecked.current = true
      if (startup) validate()
    }
    if (interval <= 0) return
    const timer = setInterval(() => {
      if (Date.now() - lastRun.current >= interval * 60000) validate()
    }, 60000)
    return () => clearInterval(timer)
  }, [ready, interval, startup])
}

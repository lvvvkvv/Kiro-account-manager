import { useEffect, useRef } from 'react'
import { useAccountsStore } from '@/store/accounts'
import { BannedAccountNotifications } from '@/lib/bannedNotifications'

export function useBannedAccountNotifications(storageReady: boolean): void {
  const graceUntil = useRef(Date.now() + 8000)
  useEffect(() => {
    if (!storageReady || typeof Notification === 'undefined') return
    const notifications = new BannedAccountNotifications(
      useAccountsStore.getState,
      graceUntil.current
    )
    notifications.update(useAccountsStore.getState().accounts)
    const unsubscribe = useAccountsStore.subscribe((state, previous) => {
      if (state.accounts !== previous.accounts) notifications.update(state.accounts)
    })
    return () => {
      unsubscribe()
      notifications.dispose()
    }
  }, [storageReady])
}

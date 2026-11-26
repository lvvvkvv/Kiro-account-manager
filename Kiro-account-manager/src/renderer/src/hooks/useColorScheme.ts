import { useEffect } from 'react'
import { useAccountsStore } from '@/store/accounts'

export function useColorScheme(): void {
  const theme = useAccountsStore((state) => state.theme)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => useAccountsStore.getState().applyTheme()
    apply()
    if (theme !== 'system') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
}

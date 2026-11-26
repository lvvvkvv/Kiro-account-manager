import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type JSX
} from 'react'
import type { AppUpdateState } from '../../../shared/update'

const initial: AppUpdateState = {
  revision: -1,
  currentVersion: '…',
  supported: false,
  enabled: false,
  checking: false,
  downloading: false,
  installing: false,
  available: null,
  ready: null,
  progress: null,
  error: null,
  recovery: null,
  routingInUse: false,
  dismissedVersion: null
}
interface Updates {
  state: AppUpdateState
  notice: 'latest' | string | null
  check: () => Promise<void>
  install: () => Promise<void>
  setEnabled: (enabled: boolean) => Promise<void>
  dismiss: () => Promise<void>
  openDownload: () => Promise<void>
}
const Context = createContext<Updates | null>(null)

export function UpdateProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState(initial)
  const [notice, setNotice] = useState<string | null>(null)
  const accept = useCallback((next: AppUpdateState) => {
    setState((current) => (next.revision >= current.revision ? next : current))
  }, [])
  const perform = useCallback(async (action: () => Promise<unknown>) => {
    setNotice(null)
    try {
      await action()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }, [])
  useEffect(() => {
    let disposed = false
    const receive = (next: AppUpdateState): void => {
      if (!disposed) accept(next)
    }
    const unsubscribe = window.api.onAppUpdateState(receive)
    void window.api
      .getUpdateState()
      .then(receive)
      .catch((error) => {
        if (!disposed) setNotice(String(error))
      })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [accept])
  useEffect(() => {
    if (!state.ready) return
    const timer = setInterval(() => {
      void window.api
        .getUpdateState()
        .then(accept)
        .catch(() => {})
    }, 5000)
    return () => clearInterval(timer)
  }, [state.ready, accept])
  return (
    <Context.Provider
      value={{
        state,
        notice,
        check: () =>
          perform(async () => {
            const next = await window.api.checkAppUpdate()
            accept(next)
            if (!next.available && !next.ready) setNotice('latest')
          }),
        install: () => perform(() => window.api.installAppUpdate()),
        setEnabled: (enabled) =>
          perform(async () => accept(await window.api.setAutoUpdateEnabled(enabled))),
        dismiss: () => perform(async () => accept(await window.api.dismissAppUpdate())),
        openDownload: () => perform(() => window.api.openUpdateDownloadPage())
      }}
    >
      {children}
    </Context.Provider>
  )
}

// The hook and provider deliberately share this single context instance.
// eslint-disable-next-line react-refresh/only-export-components
export function useAppUpdate(): Updates {
  const value = useContext(Context)
  if (!value) throw new Error('UpdateProvider is missing')
  return value
}

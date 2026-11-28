import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type JSX
} from 'react'
import type { AppUpdateInfo, AppUpdateState } from '../../../shared/update'

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
  notice: string | null
  check: () => Promise<void>
  install: () => Promise<void>
  setEnabled: (enabled: boolean) => Promise<void>
  dismiss: () => Promise<void>
  openDownload: () => Promise<void>
}
const Context = createContext<Updates | null>(null)
const BadgeContext = createContext<boolean | null>(null)

function sameInfo(a: AppUpdateInfo | null, b: AppUpdateInfo | null): boolean {
  return (
    a === b ||
    !!(
      a &&
      b &&
      a.version === b.version &&
      a.notes === b.notes &&
      a.publishedAt === b.publishedAt &&
      a.installable === b.installable
    )
  )
}

function sameState(a: AppUpdateState, b: AppUpdateState): boolean {
  return (
    Object.keys(a).length === Object.keys(b).length &&
    (Object.keys(b) as (keyof AppUpdateState)[]).every((key) =>
      key === 'available' || key === 'ready' ? sameInfo(a[key], b[key]) : a[key] === b[key]
    )
  )
}

export function UpdateProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState(initial)
  const [notice, setNotice] = useState<string | null>(null)
  const current = useRef(initial)
  const operation = useRef(0)
  const accept = useCallback((next: AppUpdateState) => {
    if (next.revision < current.current.revision || sameState(current.current, next)) return
    current.current = next
    setState(next)
  }, [])
  const perform = useCallback(async (action: () => Promise<string | void>) => {
    const id = ++operation.current
    setNotice(null)
    try {
      const result = await action()
      if (id === operation.current) setNotice(result || null)
    } catch (error) {
      if (id === operation.current)
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
  const readyVersion = state.ready?.version
  useEffect(() => {
    if (!readyVersion) return
    const timer = setInterval(() => {
      void window.api
        .getUpdateState()
        .then(accept)
        .catch(() => {})
    }, 5000)
    return () => clearInterval(timer)
  }, [readyVersion, accept])
  const actions = useMemo(
    () => ({
      check: () =>
        perform(async () => {
          const next = await window.api.checkAppUpdate()
          accept(next)
          if (
            !next.available &&
            !next.ready &&
            !current.current.available &&
            !current.current.ready &&
            !current.current.error
          )
            return 'latest'
          return undefined
        }),
      install: () =>
        perform(async () => {
          await window.api.installAppUpdate()
        }),
      setEnabled: (enabled: boolean) =>
        perform(async () => accept(await window.api.setAutoUpdateEnabled(enabled))),
      dismiss: () => perform(async () => accept(await window.api.dismissAppUpdate())),
      openDownload: () =>
        perform(async () => {
          await window.api.openUpdateDownloadPage()
        })
    }),
    [accept, perform]
  )
  const visibleNotice =
    notice === 'latest' && (state.available || state.ready || state.checking || state.error)
      ? null
      : notice
  const value = useMemo(
    () => ({ state, notice: visibleNotice, ...actions }),
    [state, visibleNotice, actions]
  )
  return (
    <BadgeContext.Provider value={!!(state.available || state.ready)}>
      <Context.Provider value={value}>{children}</Context.Provider>
    </BadgeContext.Provider>
  )
}

// The hook and provider deliberately share this single context instance.
// eslint-disable-next-line react-refresh/only-export-components
export function useAppUpdate(): Updates {
  const value = useContext(Context)
  if (!value) throw new Error('UpdateProvider is missing')
  return value
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppUpdateBadge(): boolean {
  const value = useContext(BadgeContext)
  if (value === null) throw new Error('UpdateProvider is missing')
  return value
}

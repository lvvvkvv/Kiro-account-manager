import React from 'react'
import { createRoot } from 'react-dom/client'
import { UpdateProvider } from '../../src/renderer/src/contexts/UpdateContext'
import { UpdateSection } from '../../src/renderer/src/components/updates/UpdateSection'
import { AutoUpdatePrompt } from '../../src/renderer/src/components/updates/AutoUpdatePrompt'
import { Sidebar } from '../../src/renderer/src/components/layout/Sidebar'

const listeners = new Set<(value: any) => void>()
let state = {
  revision: 0,
  currentVersion: '1.7.10',
  supported: true,
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
const calls: string[] = []
const push = (change: any) => {
  state = { ...state, ...change, revision: state.revision + 1 }
  listeners.forEach((callback) => callback(state))
  return state
}
Object.assign(window, { updateTest: { push, calls, getState: () => state } })
Object.assign(window, {
  api: {
    getUpdateState: async () => state,
    onAppUpdateState: (callback: any) => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
    checkAppUpdate: async () => {
      calls.push('check')
      return push({
        available: {
          version: '1.8.0',
          notes: '统一更新入口，支持后台下载和失败恢复。',
          installable: true
        }
      })
    },
    installAppUpdate: async () => {
      calls.push('install')
      push({ installing: true })
    },
    setAutoUpdateEnabled: async (enabled: boolean) => {
      calls.push('enabled')
      return push({ enabled, downloading: enabled, progress: 42 })
    },
    dismissAppUpdate: async () => {
      calls.push('dismiss')
      return push({ dismissedVersion: state.ready?.version })
    },
    openUpdateDownloadPage: async () => {
      calls.push('manual')
    },
    openExternal: () => {
      calls.push('external')
    }
  }
})
createRoot(document.getElementById('root')!).render(
  <UpdateProvider>
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar
        currentPage="about"
        collapsed={false}
        onToggleCollapse={() => {}}
        onPageChange={() => {}}
      />
      <main className="relative min-w-0 flex-1 p-6">
        <h1 className="mb-5 text-title">关于本应用</h1>
        <UpdateSection />
        <AutoUpdatePrompt />
      </main>
    </div>
  </UpdateProvider>
)

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useAccountsStore } from '@/store/accounts'
import { useTranslation } from '@/hooks/useTranslation'
import type { AccountStorageStatus } from '../../../../shared/accountData'

export function AccountStorageNotice({ onRetryLoad }: { onRetryLoad: () => void }): ReactNode {
  const { actualLanguage } = useTranslation()
  const loadError = useAccountsStore((state) => (state.storageLoaded ? state.storageError : null))
  const saveError = useAccountsStore((state) => state.storageSaveError)
  const [status, setStatus] = useState<AccountStorageStatus>({
    backupError: null,
    writeError: null
  })
  const [saving, setSaving] = useState(false)
  const retrying = useRef(false)
  useEffect(() => {
    let active = true,
      received = false
    const unsubscribe = window.api.onAccountStorageStatus((value) => {
      received = true
      if (active) setStatus(value)
    })
    void window.api
      .getAccountStorageStatus()
      .then((value) => {
        if (active && !received) setStatus(value)
      })
      .catch(console.error)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  if (!loadError && !saveError && !status.writeError && !status.backupError) return null
  const isEn = actualLanguage === 'en'
  const retry = async (): Promise<void> => {
    if (retrying.current) return
    retrying.current = true
    setSaving(true)
    try {
      if (saveError) await useAccountsStore.getState().flushSaveImmediately()
      setStatus(await window.api.retryAccountStorage())
    } catch (error) {
      console.warn('[Store] Save retry failed:', error)
    } finally {
      retrying.current = false
      setSaving(false)
    }
  }
  return (
    <div
      role="alert"
      className="border-b px-4 py-2 text-caption bg-warning-soft text-warning-text space-y-1"
    >
      {loadError && (
        <div className="flex items-center gap-3">
          <span>
            {isEn ? 'Could not reload data: ' : '数据加载失败：'}
            {loadError}
          </span>
          <button className="underline" onClick={onRetryLoad}>
            {isEn ? 'Retry' : '重试'}
          </button>
        </div>
      )}
      {(saveError || status.writeError) && (
        <div className="flex items-center gap-3">
          <span>
            {isEn ? 'Could not save data: ' : '数据保存失败：'}
            {saveError || status.writeError}
          </span>
          {(saveError || status.writeError) && (
            <button disabled={saving} onClick={() => void retry()} className="underline">
              {isEn ? 'Retry' : '重试'}
            </button>
          )}
        </div>
      )}
      {status.backupError && (
        <p>
          {isEn
            ? 'The latest backup could not be updated; primary account data remains available. Automatic retries are limited; check disk space and directory access: '
            : '最新备份更新失败，主账号数据仍可用，将有限重试，请检查磁盘空间和目录权限：'}
          {status.backupError}{' '}
          <button disabled={saving} onClick={() => void retry()} className="underline">
            {isEn ? 'Retry' : '重试'}
          </button>
        </p>
      )}
    </div>
  )
}

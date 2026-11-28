import type { JSX } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '../ui/button'
import { useAppUpdate } from '@/contexts/UpdateContext'
import { useTranslation } from '@/hooks/useTranslation'

export function AutoUpdatePrompt(): JSX.Element | null {
  const { state, notice, dismiss, install, openDownload } = useAppUpdate()
  const { actualLanguage } = useTranslation()
  const en = actualLanguage === 'en'
  const version = state.ready?.version
  if (!version || state.dismissedVersion === version) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute bottom-4 right-4 z-30 w-[280px] max-w-[calc(100%-2rem)] rounded-panel border bg-card px-3 pb-3 pt-2 shadow-lg"
    >
      <p className="flex items-center gap-1.5 text-body font-medium">
        <Download className="size-3.5 shrink-0 text-primary" />
        {en ? `v${version} is ready to install` : `v${version} 已准备好安装`}
      </p>
      <p className="mt-1 pl-5 text-caption text-muted-foreground">
        {state.routingInUse
          ? en
            ? 'Restarting will interrupt active proxy requests.'
            : '重启将中断正在进行的反代请求。'
          : en
            ? 'Restart to finish the update when convenient.'
            : '方便时重启应用即可完成更新。'}
      </p>
      {(state.error || notice) && (
        <div className="mt-2 text-caption text-danger-text">
          <p>{state.error || notice}</p>
          <button className="mt-1 underline" onClick={() => void openDownload()}>
            {en ? 'Manual download' : '手动下载'}
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5 pt-3">
        <Button
          size="sm"
          variant="outline"
          disabled={state.installing}
          onClick={() => void dismiss()}
        >
          {en ? 'Later' : '稍后'}
        </Button>
        <Button
          size="sm"
          disabled={state.installing || state.downloading || state.checking}
          onClick={() => void install()}
        >
          {state.installing ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              {en ? 'Installing…' : '安装中…'}
            </>
          ) : en ? (
            'Install now'
          ) : (
            '立即安装'
          )}
        </Button>
      </div>
    </div>
  )
}

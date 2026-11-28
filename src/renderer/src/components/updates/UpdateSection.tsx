import type { JSX } from 'react'
import { Download, RefreshCw, CheckCircle, ExternalLink } from 'lucide-react'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'
import { useAppUpdate } from '@/contexts/UpdateContext'
import { useTranslation } from '@/hooks/useTranslation'
import kiroLogo from '@/assets/kiro-high-resolution-logo-transparent.png'
import { useAccountsStore } from '@/store/accounts'
import { cn } from '@/lib/utils'

export function UpdateSection(): JSX.Element {
  const { state, notice, check, install, setEnabled, openDownload } = useAppUpdate()
  const { actualLanguage } = useTranslation()
  const en = actualLanguage === 'en'
  const darkMode = useAccountsStore((state) => state.darkMode)
  const info = state.available ?? state.ready
  const busy = state.checking || state.downloading || state.installing
  const handleClick = (): Promise<void> =>
    info ? (info.installable ? install() : openDownload()) : check()
  return (
    <section
      aria-label={en ? 'Application updates' : '应用更新'}
      className="divide-y overflow-hidden rounded-panel border bg-card"
    >
      <div className="flex flex-wrap items-center gap-4 px-5 py-4">
        <img
          src={kiroLogo}
          alt=""
          className={cn('h-10 w-10 shrink-0 object-contain', darkMode && 'invert brightness-0')}
        />
        <div className="min-w-0 flex-1">
          <p className="text-title font-semibold">
            {en ? 'Kiro Account Manager' : 'Kiro 账户管理器'}
          </p>
          <p className="text-caption tabular-nums text-muted-foreground">
            {en ? 'Version' : '版本'} v{state.currentVersion}
          </p>
        </div>
        <Button
          variant={info ? 'default' : 'outline'}
          onClick={() => void handleClick()}
          disabled={busy}
        >
          {busy ? (
            <RefreshCw className="size-4 animate-spin" />
          ) : info ? (
            <Download className="size-4" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          {state.installing
            ? en
              ? 'Installing…'
              : '正在安装…'
            : state.downloading
              ? en
                ? 'Downloading…'
                : '正在下载…'
              : state.checking
                ? en
                  ? 'Checking…'
                  : '检查中…'
                : info
                  ? en
                    ? `Update to v${info.version}`
                    : `更新到 v${info.version}`
                  : en
                    ? 'Check for updates'
                    : '检查更新'}
        </Button>
      </div>
      {info && (
        <div className="space-y-2 px-5 py-4 text-body" aria-live="polite">
          <p className="font-medium">
            {en ? `New version v${info.version} is available` : `发现新版本 v${info.version}`}
          </p>
          {info.notes && (
            <p className="line-clamp-3 whitespace-pre-line text-muted-foreground">{info.notes}</p>
          )}
          {state.ready?.version === info.version ? (
            <p className="flex items-center gap-1.5 text-success-text">
              <CheckCircle className="size-4" />
              {en ? 'Downloaded. Restart when you are ready.' : '已下载，等待你确认重启安装。'}
            </p>
          ) : state.downloading ? (
            <p className="text-muted-foreground">
              {en ? 'Downloading in the background' : '正在后台下载'}
              {state.progress !== null ? ` · ${state.progress.toFixed(0)}%` : ''}
            </p>
          ) : null}
          {!info.installable && (
            <p className="text-muted-foreground">
              {en
                ? 'Please download and install this release manually.'
                : '此版本请前往下载页面手动安装。'}
            </p>
          )}
          {state.routingInUse && (
            <p className="text-muted-foreground">
              {en
                ? 'Restarting will interrupt active proxy requests.'
                : '重启将中断正在进行的反代请求。'}
            </p>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div>
          <label htmlFor="auto-app-update" className="text-body font-medium">
            {en ? 'Automatically download updates' : '自动下载更新'}
          </label>
          <p className="mt-1 text-caption text-muted-foreground">
            {en
              ? 'Download in the background. Install only when you confirm.'
              : '后台下载新版本，由你确认后安装。'}
          </p>
          {!state.supported && (
            <p className="mt-1 text-caption text-muted-foreground">
              {en
                ? 'Automatic installation is unavailable here. Use the download page.'
                : '当前安装方式不支持自动安装，请使用下载页面。'}
            </p>
          )}
        </div>
        <Switch
          id="auto-app-update"
          checked={state.enabled && state.supported}
          disabled={!state.supported || state.installing}
          onCheckedChange={(enabled) => void setEnabled(enabled)}
        />
      </div>
      {(state.error || notice || state.recovery) && (
        <div role="status" className="space-y-2 px-5 py-3 text-caption">
          {state.recovery && (
            <p>
              {en ? 'Previous update: ' : '上次更新：'}
              {state.recovery}
            </p>
          )}
          {(state.error || notice) && (
            <p
              className={
                notice === 'latest' && !state.error ? 'text-success-text' : 'text-danger-text'
              }
            >
              {state.error ||
                (notice === 'latest'
                  ? en
                    ? 'You are up to date.'
                    : '当前已是最新版本。'
                  : notice)}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2 px-5 py-3">
        <Button variant="outline" size="sm" onClick={() => void openDownload()}>
          <ExternalLink className="size-4" />
          {en ? 'Manual download' : '手动下载'}
        </Button>
        {info && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              window.api.openExternal(
                `https://github.com/lvvvkvv/Kiro-account-manager/releases/tag/v${info.version}`
              )
            }
          >
            {en ? 'Release notes' : '更新说明'}
          </Button>
        )}
      </div>
    </section>
  )
}

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Download, RefreshCw, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useTranslation } from '@/hooks/useTranslation'

interface UpdateInfo {
  version: string
  releaseDate?: string
  releaseNotes?: string
}

interface DownloadProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'

export function UpdateDialog() {
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<UpdateStatus>('idle')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // 监听更新事件
    const unsubChecking = window.api.onUpdateChecking(() => {
      setStatus('checking')
    })

    const unsubAvailable = window.api.onUpdateAvailable((info) => {
      setUpdateInfo(info)
      setStatus('available')
      setOpen(true) // 有更新时自动打开弹窗
    })

    const unsubNotAvailable = window.api.onUpdateNotAvailable(() => {
      setStatus('idle')
    })

    const unsubProgress = window.api.onUpdateDownloadProgress((prog) => {
      setProgress(prog)
      setStatus('downloading')
    })

    const unsubDownloaded = window.api.onUpdateDownloaded((info) => {
      setUpdateInfo(info)
      setStatus('downloaded')
    })

    const unsubError = window.api.onUpdateError((err) => {
      setError(err)
      setStatus('error')
    })

    return () => {
      unsubChecking()
      unsubAvailable()
      unsubNotAvailable()
      unsubProgress()
      unsubDownloaded()
      unsubError()
    }
  }, [])

  const handleDownload = async () => {
    setStatus('downloading')
    setProgress(null)
    await window.api.downloadUpdate()
  }

  const handleInstall = () => {
    window.api.installUpdate()
  }

  const handleClose = () => {
    if (status !== 'downloading') {
      setOpen(false)
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const formatSpeed = (bytesPerSecond: number) => {
    return `${formatBytes(bytesPerSecond)}/s`
  }

  if (!open) return null

  return createPortal(
    <div className="ui-dialog-overlay">
      <div className="absolute inset-0" data-update-backdrop onClick={handleClose} />
      <div
        className="ui-dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
      >
        <div className="ui-dialog-header pr-14">
          <h2 id="update-title">{isEn ? 'New Version Available' : '发现新版本'}</h2>
          {updateInfo && (
            <p className="text-body text-muted-foreground break-all">v{updateInfo.version}</p>
          )}
          {status !== 'downloading' && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-4 top-4"
              aria-label={isEn ? 'Close' : '关闭'}
              onClick={handleClose}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
        <div className={`ui-dialog-body space-y-4 ${status === 'downloading' ? 'pb-5' : ''}`}>
          {status === 'checking' && (
            <p className="flex items-center gap-2 text-body text-muted-foreground">
              <RefreshCw className="size-4 animate-spin" />
              {isEn ? 'Checking for updates…' : '正在检查更新…'}
            </p>
          )}
          {status === 'idle' && (
            <p className="text-body text-muted-foreground">
              {isEn ? 'You are up to date.' : '当前已是最新版本。'}
            </p>
          )}
          {status === 'available' && (
            <>
              <p className="text-body text-text-secondary">
                {isEn
                  ? 'A new version is available with the latest features and fixes.'
                  : '新版本已发布，建议立即更新以获得最新功能和修复。'}
              </p>
              {updateInfo?.releaseNotes && (
                <div
                  className="max-h-32 overflow-y-auto rounded-panel bg-muted p-4 text-caption text-text-secondary [&_ul]:list-disc [&_ul]:pl-4 [&_li]:my-0.5 [&_h1]:text-strong [&_h2]:text-body [&_h3]:text-body [&_p]:my-1 [&_hr]:my-2"
                  dangerouslySetInnerHTML={{ __html: updateInfo.releaseNotes }}
                />
              )}
            </>
          )}
          {status === 'downloading' && (
            <>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-body">
                  <span className="text-text-secondary">
                    {isEn ? 'Downloading update…' : '正在下载更新…'}
                  </span>
                  <span className="font-mono tabular-nums">
                    {progress ? `${progress.percent.toFixed(1)}%` : '0%'}
                  </span>
                </div>
                <Progress value={progress?.percent ?? 0} className="h-1.5" />
                {progress && (
                  <div className="flex flex-wrap justify-between gap-2 text-caption text-muted-foreground">
                    <span>
                      {formatBytes(progress.transferred)} / {formatBytes(progress.total)}
                    </span>
                    <span>{formatSpeed(progress.bytesPerSecond)}</span>
                  </div>
                )}
              </div>
              <p className="flex items-center gap-2 text-body text-muted-foreground">
                <RefreshCw className="size-4 animate-spin shrink-0" />
                {isEn ? 'Please keep the application open…' : '请勿关闭应用…'}
              </p>
            </>
          )}
          {status === 'downloaded' && (
            <>
              <p className="flex items-center gap-2 text-body font-medium text-success-text">
                <CheckCircle className="size-4 shrink-0" />
                {isEn ? 'Download complete!' : '下载完成！'}
              </p>
              <p className="text-body text-text-secondary">
                {isEn
                  ? 'Restart the application to finish installing the update.'
                  : '更新已下载完成，点击下方按钮重启应用以完成安装。'}
              </p>
            </>
          )}
          {status === 'error' && (
            <p className="text-body text-danger-text">
              {isEn ? 'Update check failed: ' : '更新检查失败: '}
              {error}
            </p>
          )}
        </div>
        {status !== 'downloading' && (
          <div className="ui-dialog-footer">
            {status === 'available' ? (
              <>
                <Button variant="outline" onClick={handleClose}>
                  {isEn ? 'Remind Me Later' : '稍后提醒'}
                </Button>
                <Button onClick={handleDownload}>
                  <Download className="size-4" />
                  {isEn ? 'Download Now' : '立即下载'}
                </Button>
              </>
            ) : status === 'downloaded' ? (
              <>
                <Button variant="outline" onClick={handleClose}>
                  {isEn ? 'Install Later' : '稍后安装'}
                </Button>
                <Button onClick={handleInstall}>
                  <RefreshCw className="size-4" />
                  {isEn ? 'Restart Now' : '立即重启'}
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={handleClose}>
                {isEn ? 'Close' : '关闭'}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

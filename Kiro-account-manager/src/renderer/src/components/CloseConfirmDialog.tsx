import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Minimize2, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '../hooks/useTranslation'

export function CloseConfirmDialog() {
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'
  const [open, setOpen] = useState(false)
  const [rememberChoice, setRememberChoice] = useState(false)

  useEffect(() => {
    const unsubscribe = window.api.onShowCloseConfirmDialog(() => {
      setOpen(true)
      setRememberChoice(false)
    })
    return () => unsubscribe()
  }, [])

  const handleAction = (action: 'minimize' | 'quit' | 'cancel') => {
    window.api.sendCloseConfirmResponse(action, rememberChoice)
    setOpen(false)
  }

  if (!open) return null

  return createPortal(
    <div className="ui-dialog-overlay">
      <div
        className="absolute inset-0"
        data-close-backdrop
        onClick={() => handleAction('cancel')}
      />
      <div
        className="ui-dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-confirm-title"
        aria-describedby="close-confirm-description"
      >
        <div className="ui-dialog-header pr-14">
          <h2 id="close-confirm-title">{isEn ? 'Close Window' : '关闭窗口'}</h2>
          <p className="text-body text-muted-foreground">
            {isEn ? 'Choose an action' : '请选择关闭行为'}
          </p>
          <Button
            size="icon"
            variant="ghost"
            className="absolute right-4 top-4"
            aria-label={isEn ? 'Close' : '关闭'}
            onClick={() => handleAction('cancel')}
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="ui-dialog-body space-y-4">
          <p id="close-confirm-description" className="text-body text-text-secondary">
            {isEn
              ? 'Would you like to minimize to system tray or exit the application?'
              : '您想要最小化到系统托盘还是退出程序？'}
          </p>
          <p className="rounded-panel bg-muted p-4 text-caption text-muted-foreground">
            {isEn
              ? 'When minimized to tray, the app will continue running in the background and the proxy service will remain available. You can reopen the window by clicking the tray icon.'
              : '最小化到托盘后，程序将在后台继续运行，代理服务保持可用。您可以通过点击托盘图标重新打开窗口。'}
          </p>
          <div className="space-y-2">
            <Button
              variant="outline"
              className="h-auto min-h-[52px] w-full justify-start gap-3 whitespace-normal px-4 py-3 text-left"
              onClick={() => handleAction('minimize')}
            >
              <Minimize2 className="size-4 shrink-0 text-text-secondary" />
              <span className="min-w-0">
                <span className="block text-body font-medium">
                  {isEn ? 'Minimize to Tray' : '最小化到托盘'}
                </span>
                <span className="block text-caption font-normal text-muted-foreground">
                  {isEn ? 'Continue running in background' : '在后台继续运行'}
                </span>
              </span>
            </Button>
            <Button
              variant="outline"
              className="h-auto min-h-[52px] w-full justify-start gap-3 whitespace-normal px-4 py-3 text-left"
              onClick={() => handleAction('quit')}
            >
              <LogOut className="size-4 shrink-0 text-danger-text" />
              <span className="min-w-0">
                <span className="block text-body font-medium">
                  {isEn ? 'Exit Application' : '退出程序'}
                </span>
                <span className="block text-caption font-normal text-muted-foreground">
                  {isEn ? 'Close the app completely' : '完全关闭应用'}
                </span>
              </span>
            </Button>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-body text-text-secondary">
            <input
              type="checkbox"
              checked={rememberChoice}
              onChange={(event) => setRememberChoice(event.target.checked)}
            />
            {isEn ? 'Remember my choice' : '记住我的选择'}
          </label>
        </div>
        <div className="ui-dialog-footer">
          <Button variant="ghost" onClick={() => handleAction('cancel')}>
            {isEn ? 'Cancel' : '取消'}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}

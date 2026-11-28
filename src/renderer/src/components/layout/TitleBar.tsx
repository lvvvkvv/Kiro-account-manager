import { useEffect, useState } from 'react'
import { Minus, Square, X, Copy as RestoreIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/hooks/useTranslation'
import { TaskCenterButton } from './TaskCenter'

/**
 * 跨平台自定义 titlebar
 * - macOS: 居中标题 + 左侧 traffic lights 留位（系统渲染）
 * - Windows/Linux: 左侧应用图标+标题 + 右侧自绘按钮
 *
 * 拖动：整条 titlebar 用 -webkit-app-region: drag
 * 按钮区：使用 no-drag 让点击生效
 */
export function TitleBar(): React.ReactNode {
  const { actualLanguage } = useTranslation()
  const isEn = actualLanguage === 'en'
  const [platform, setPlatform] = useState<NodeJS.Platform>('win32')
  const [isMaximized, setIsMaximized] = useState(false)
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    let active = true
    const cleanup = window.api.window.onMaximizeChange((value) => {
      if (active) setIsMaximized(value)
    })
    void Promise.all([
      window.api.window.getPlatform(),
      window.api.window.isMaximized(),
      window.api.getAppVersion()
    ])
      .then(([platform, maximized, version]) => {
        if (active) {
          setPlatform(platform)
          setIsMaximized(maximized)
          setAppVersion(version)
        }
      })
      .catch((error) => console.warn('[TitleBar] init failed', error))
    return () => {
      active = false
      cleanup()
    }
  }, [])

  const isMac = platform === 'darwin'

  return (
    <div
      className={cn(
        'flex items-center h-8 w-full select-none flex-shrink-0',
        'bg-sidebar text-text-secondary',
        'border-b border-border'
      )}
      style={
        {
          // 整条 titlebar 可拖动
          WebkitAppRegion: 'drag',
          // mac 留 80px 给 traffic lights
          paddingLeft: isMac ? 80 : 12,
          paddingRight: isMac ? 12 : 0
        } as React.CSSProperties
      }
    >
      {/* 应用图标 + 标题 */}
      <div
        className={cn(
          'flex items-center gap-2 text-caption',
          isMac ? 'flex-1 justify-center' : 'flex-1'
        )}
      >
        {!isMac && (
          <img
            src="./icon.png"
            alt=""
            className="h-4 w-4 opacity-90"
            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
          />
        )}
        <span className="font-medium text-text-secondary">
          {isEn ? 'Kiro Account Manager' : 'Kiro 账号管理器'}
          {appVersion && ` v${appVersion}`}
        </span>
      </div>

      {/* 任务中心入口（仅当有任务时显示） */}
      <div
        className="flex items-center gap-1 px-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <TaskCenterButton />
      </div>

      {/* Windows/Linux 按钮组 */}
      {!isMac && (
        <div
          className="flex items-stretch h-full"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <TitleBarButton
            onClick={() => window.api.window.minimize()}
            title={isEn ? 'Minimize' : '最小化'}
          >
            <Minus className="h-3.5 w-3.5" strokeWidth={2} />
          </TitleBarButton>
          <TitleBarButton
            onClick={() => window.api.window.maximizeToggle()}
            title={isMaximized ? (isEn ? 'Restore' : '还原') : isEn ? 'Maximize' : '最大化'}
          >
            {isMaximized ? (
              <RestoreIcon className="h-3 w-3" strokeWidth={2} />
            ) : (
              <Square className="h-3 w-3" strokeWidth={2} />
            )}
          </TitleBarButton>
          <TitleBarButton
            onClick={() => window.api.window.close()}
            title={isEn ? 'Close' : '关闭'}
            variant="close"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </TitleBarButton>
        </div>
      )}
    </div>
  )
}

interface TitleBarButtonProps {
  onClick: () => void
  title: string
  variant?: 'default' | 'close'
  children: React.ReactNode
}

function TitleBarButton({
  onClick,
  title,
  variant = 'default',
  children
}: TitleBarButtonProps): React.ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'flex items-center justify-center w-12 h-full text-text-secondary transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
        'hover:text-foreground',
        variant === 'close' ? 'hover:bg-red-500 hover:text-white' : 'hover:bg-muted'
      )}
    >
      {children}
    </button>
  )
}

import { useAppUpdateBadge } from '@/contexts/UpdateContext'
import {
  Home,
  Users,
  Settings,
  Info,
  ChevronRight,
  Fingerprint,
  Sparkles,
  Server,
  Shield,
  UserPlus,
  CreditCard,
  ScrollText,
  Network,
  Bell,
  Stethoscope,
  Archive
} from 'lucide-react'
import { memo, useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import kiroLogoSmall from '@/assets/Kiro Logo.svg'
import { useAccountsStore } from '@/store/accounts'
import { useTranslation } from '@/hooks/useTranslation'

export type PageType =
  | 'home'
  | 'accounts'
  | 'machineId'
  | 'kiroSettings'
  | 'proxy'
  | 'kproxy'
  | 'proxyPool'
  | 'register'
  | 'subscription'
  | 'webhooks'
  | 'diagnose'
  | 'configSync'
  | 'logs'
  | 'settings'
  | 'about'

interface SidebarProps {
  currentPage: PageType
  onPageChange: (page: PageType) => void
  collapsed: boolean
  onToggleCollapse: () => void
}

const menuItemsConfig: { id: PageType; labelKey: string; icon: React.ElementType }[] = [
  { id: 'home', labelKey: 'nav.home', icon: Home },
  { id: 'accounts', labelKey: 'nav.accounts', icon: Users },
  { id: 'machineId', labelKey: 'nav.machineId', icon: Fingerprint },
  { id: 'kiroSettings', labelKey: 'nav.kiroSettings', icon: Sparkles },
  { id: 'proxy', labelKey: 'nav.proxy', icon: Server },
  { id: 'kproxy', labelKey: 'nav.kproxy', icon: Shield },
  { id: 'proxyPool', labelKey: 'nav.proxyPool', icon: Network },
  { id: 'register', labelKey: 'nav.register', icon: UserPlus },
  { id: 'subscription', labelKey: 'nav.subscription', icon: CreditCard },
  { id: 'webhooks', labelKey: 'nav.webhooks', icon: Bell },
  { id: 'diagnose', labelKey: 'nav.diagnose', icon: Stethoscope },
  { id: 'configSync', labelKey: 'nav.configSync', icon: Archive },
  { id: 'logs', labelKey: 'nav.logs', icon: ScrollText },
  { id: 'settings', labelKey: 'nav.settings', icon: Settings },
  { id: 'about', labelKey: 'nav.about', icon: Info }
]

export const Sidebar = memo(function Sidebar({
  currentPage,
  onPageChange,
  collapsed,
  onToggleCollapse
}: SidebarProps) {
  const darkMode = useAccountsStore((state) => state.darkMode)
  const hasUpdate = useAppUpdateBadge()
  const { t, actualLanguage } = useTranslation()
  const isEn = actualLanguage === 'en'
  const [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null)
  const tipId = useId()
  const toggleLabel = collapsed
    ? isEn
      ? 'Expand'
      : '展开侧边栏'
    : isEn
      ? 'Collapse'
      : '收起侧边栏'
  const showTip = (element: HTMLElement, text: string): void => {
    const rect = element.getBoundingClientRect()
    setTip({ text, top: rect.top + rect.height / 2, left: rect.right + 6 })
  }

  useEffect(() => {
    if (!collapsed || !tip) return
    const dismiss = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setTip(null)
    }
    document.addEventListener('keydown', dismiss)
    return () => document.removeEventListener('keydown', dismiss)
  }, [collapsed, tip])

  return (
    <aside
      aria-label={isEn ? 'Main navigation' : '主导航'}
      style={{ width: collapsed ? 64 : 200 }}
      className="flex min-h-0 shrink-0 flex-col overflow-hidden border-r bg-sidebar text-body"
    >
      <div
        className={cn(
          'flex h-11 shrink-0 items-center gap-2',
          collapsed ? 'justify-center px-2' : 'px-4'
        )}
      >
        <svg
          viewBox="4 154 124 128"
          role="img"
          aria-label="Kiro"
          className={cn('size-5 shrink-0', darkMode && 'invert brightness-0')}
        >
          <image href={kiroLogoSmall} width="541" height="461" />
        </svg>
        {!collapsed && (
          <span className="truncate text-strong font-semibold">
            {isEn ? 'Account Manager' : '账户管理器'}
          </span>
        )}
      </div>
      <nav
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-2"
        onScroll={() => setTip(null)}
      >
        {menuItemsConfig.map((item) => {
          const Icon = item.icon
          const label = t(item.labelKey)
          return (
            <button
              type="button"
              key={item.id}
              aria-label={label}
              aria-current={currentPage === item.id ? 'page' : undefined}
              aria-describedby={collapsed && tip?.text === label ? tipId : undefined}
              onClick={() => {
                setTip(null)
                onPageChange(item.id)
              }}
              onMouseEnter={(event) => collapsed && showTip(event.currentTarget, label)}
              onMouseLeave={() => setTip(null)}
              onFocus={(event) => {
                if (collapsed && event.currentTarget.matches(':focus-visible'))
                  showTip(event.currentTarget, label)
              }}
              onBlur={() => setTip(null)}
              className={cn(
                'ui-nav-row focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                currentPage === item.id ? 'hover:bg-accent' : 'hover:bg-muted',
                collapsed
                  ? 'mx-auto h-8 w-8 justify-center p-0'
                  : 'mx-2 h-nav-row w-[184px] text-left'
              )}
            >
              <span className="relative shrink-0">
                <Icon className={cn('shrink-0', collapsed ? 'size-5' : 'size-[18px]')} />
                {item.id === 'about' && hasUpdate && (
                  <span
                    aria-label={isEn ? 'Update available' : '有可用更新'}
                    className="absolute -right-1 -top-1 size-2 rounded-full bg-red-500"
                  />
                )}
              </span>
              {!collapsed && <span className="min-w-0 truncate">{label}</span>}
            </button>
          )
        })}
      </nav>
      <div className="shrink-0 border-t p-2">
        <button
          type="button"
          aria-label={toggleLabel}
          aria-expanded={!collapsed}
          onClick={() => {
            setTip(null)
            onToggleCollapse()
          }}
          onMouseEnter={(event) => collapsed && showTip(event.currentTarget, toggleLabel)}
          onMouseLeave={() => setTip(null)}
          onFocus={(event) => {
            if (collapsed && event.currentTarget.matches(':focus-visible'))
              showTip(event.currentTarget, toggleLabel)
          }}
          onBlur={() => setTip(null)}
          className="ui-nav-row h-7 w-full justify-center hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <ChevronRight className={cn('size-4 shrink-0', !collapsed && 'rotate-180')} />
          {!collapsed && <span>{isEn ? 'Collapse' : '收起'}</span>}
        </button>
      </div>
      {collapsed &&
        tip &&
        createPortal(
          <div
            id={tipId}
            role="tooltip"
            className="ui-tooltip pointer-events-none fixed z-50 -translate-y-1/2"
            style={{ top: tip.top, left: tip.left }}
          >
            {tip.text}
          </div>,
          document.body
        )}
    </aside>
  )
})

import { useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '../ui'

export interface AccountListAction {
  label: string
  icon: ReactNode
  onClick?: (event: MouseEvent<HTMLElement>) => void
  href?: string
  disabled?: boolean
  destructive?: boolean
}

interface AccountListMoreMenuProps {
  label: string
  actions: AccountListAction[]
}

/** Portal 避免菜单被虚拟列表的 overflow 和相邻行裁切。 */
export function AccountListMoreMenu({ label, actions }: AccountListMoreMenuProps): ReactNode {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!trigger || !menu) return

    const rect = trigger.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom - 12
    const above = rect.top - 12
    const openBelow = below >= menu.offsetHeight || below >= above
    menu.style.maxHeight = `${Math.max(0, openBelow ? below : above)}px`
    menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`
    menu.style.top = `${openBelow ? rect.bottom + 4 : rect.top - menu.offsetHeight - 4}px`
    menu.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()

    const dismissOutside = (event: PointerEvent): void => {
      if (!menu.contains(event.target as Node) && !trigger.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const dismiss = (): void => setOpen(false)
    const dismissOnScroll = (event: Event): void => {
      if (!menu.contains(event.target as Node)) dismiss()
    }
    // 侧栏展开也会改变容器宽度，此时关闭原位置的浮层。
    const list = trigger.closest('.account-list')
    const initialWidth = list?.clientWidth
    const observer = new ResizeObserver(() => {
      if (list?.clientWidth !== initialWidth) dismiss()
    })
    if (list) observer.observe(list)
    document.addEventListener('pointerdown', dismissOutside)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismissOnScroll, true)
    return () => {
      observer.disconnect()
      document.removeEventListener('pointerdown', dismissOutside)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismissOnScroll, true)
    }
  }, [open])

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        size="icon"
        variant="ghost"
        className="account-list-more-trigger h-7 w-7 text-muted-foreground"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          event.stopPropagation()
          setOpen(!open)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            event.stopPropagation()
            setOpen(true)
          }
        }}
      >
        <MoreHorizontal />
      </Button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            className="ui-menu fixed z-50 w-44 max-w-[calc(100vw-16px)] overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Escape' || event.key === 'Tab') {
                if (event.key === 'Escape') event.preventDefault()
                setOpen(false)
                triggerRef.current?.focus()
              } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault()
                const items = Array.from(
                  menuRef.current!.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')
                )
                const index = items.indexOf(document.activeElement as HTMLElement)
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? items.length - 1
                      : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
                items[next]?.focus()
              }
            }}
          >
            {actions.map((action) => {
              const props = {
                role: 'menuitem',
                tabIndex: -1,
                className:
                  'ui-menu-item w-full text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-45 [&>svg]:shrink-0',
                'data-variant': action.destructive ? 'danger' : undefined,
                onClick: (event: MouseEvent<HTMLElement>): void => {
                  event.stopPropagation()
                  setOpen(false)
                  triggerRef.current?.focus()
                  action.onClick?.(event)
                },
                children: (
                  <>
                    {action.icon}
                    <span>{action.label}</span>
                  </>
                )
              }
              return action.href ? (
                <a
                  key={action.label}
                  {...props}
                  href={action.href}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              ) : (
                <button key={action.label} {...props} type="button" disabled={action.disabled} />
              )
            })}
          </div>,
          document.body
        )}
    </>
  )
}

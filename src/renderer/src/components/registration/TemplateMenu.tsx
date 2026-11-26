import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** 只约束浮层位置；模板选择、删除、文件导入和开关状态仍由注册页处理。 */
export function TemplateMenu({ children }: { children: ReactNode }): ReactNode {
  const markerRef = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // 保存模板等操作会在锚点前插入日志；每次渲染后重定位，保持原菜单打开状态。
  useLayoutEffect(() => {
    const anchor = markerRef.current?.parentElement
    const menu = menuRef.current
    if (!anchor || !menu) return
    const place = (): void => {
      const rect = anchor.getBoundingClientRect()
      const width = Math.min(360, window.innerWidth - 32)
      const below = Math.max(0, window.innerHeight - 16 - rect.bottom - 8)
      const above = Math.max(0, rect.top - 16 - 8)
      const naturalHeight = Math.min(400, menu.scrollHeight + 2)
      const openBelow = below >= naturalHeight || below >= above
      const available = openBelow ? below : above
      menu.style.width = `${width}px`
      menu.style.maxHeight = `${Math.min(400, available, window.innerHeight - 32)}px`
      menu.style.left = `${Math.max(16, Math.min(rect.right - width, window.innerWidth - 16 - width))}px`
      const height = menu.getBoundingClientRect().height
      menu.style.top = `${Math.max(16, Math.min(openBelow ? rect.bottom + 8 : rect.top - 8 - height, window.innerHeight - 16 - height))}px`
      menu.style.visibility = 'visible'
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(anchor)
    observer.observe(menu)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  })

  return (
    <>
      <span ref={markerRef} hidden aria-hidden="true" />
      {createPortal(
        <div
          ref={menuRef}
          className="ui-menu fixed z-50 w-[360px] overflow-y-auto"
          style={{ visibility: 'hidden' }}
        >
          {children}
        </div>,
        document.body
      )}
    </>
  )
}

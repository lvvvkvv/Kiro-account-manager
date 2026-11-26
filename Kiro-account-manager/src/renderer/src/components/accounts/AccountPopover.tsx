import { useLayoutEffect, useRef, type HTMLAttributes } from 'react'

/** 保留菜单的原有 DOM 与事件边界，仅将浮层限制在窗口可用空间内。 */
export function AccountPopover(props: HTMLAttributes<HTMLDivElement>): React.ReactNode {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const update = (): void => {
      menu.style.maxWidth = 'calc(100vw - 32px)'
      menu.style.transform = 'none'
      const rect = menu.getBoundingClientRect()
      const shift = Math.max(16 - rect.left, Math.min(0, window.innerWidth - 16 - rect.right))
      menu.style.transform = `translateX(${shift}px)`
      menu.style.maxHeight = `${Math.max(0, window.innerHeight - rect.top - 16)}px`
      menu.style.overflowY = 'auto'
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(menu)
    const toolbar = menu.parentElement?.parentElement?.parentElement
    if (toolbar) observer.observe(toolbar)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  return <div {...props} ref={ref} data-account-popover="" />
}

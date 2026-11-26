import { useLayoutEffect, useRef, type HTMLAttributes } from 'react'

/** 仅限制菜单的呈现空间，保留原下拉框的 DOM、选择和外部点击边界。 */
export function ProxyDropdownMenu(props: HTMLAttributes<HTMLDivElement>): React.ReactNode {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const panel = menu.closest('.ui-dialog-panel')
    const update = (): void => {
      const bounds = panel?.getBoundingClientRect()
      const left = Math.max(16, (bounds?.left ?? 8) + 8)
      const right = Math.min(window.innerWidth - 16, (bounds?.right ?? window.innerWidth) - 8)
      menu.style.maxWidth = `${Math.max(0, right - left)}px`
      menu.style.transform = 'none'
      const rect = menu.getBoundingClientRect()
      const shift = Math.max(left - rect.left, Math.min(0, right - rect.right))
      menu.style.transform = `translateX(${shift}px)`
      menu.style.maxHeight = `${Math.max(0, Math.min(window.innerHeight - 16, bounds?.bottom ?? window.innerHeight) - rect.top - 8)}px`
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(menu)
    if (panel) observer.observe(panel)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  return <div {...props} ref={ref} />
}

import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useId,
  type KeyboardEvent,
  type JSX
} from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '../../lib/utils'

interface SelectOption {
  value: string
  label: string
  description?: string
}

interface SelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  disabled?: boolean
}

export function Select({
  value,
  options,
  onChange,
  placeholder = '请选择',
  className,
  disabled,
  id,
  ...labelProps
}: SelectProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [placement, setPlacement] = useState({ above: false, height: 240 })
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const selectedOption = options.find((opt) => opt.value === value)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useLayoutEffect(() => {
    if (!isOpen) return
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      const below = window.innerHeight - rect.bottom - 12
      const above = rect.top - 12
      const openAbove = below < 160 && above > below
      setPlacement({
        above: openAbove,
        height: Math.max(32, Math.min(240, openAbove ? above : below))
      })
    }
    const selected = menuRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="option"]')
    const focusedOption = selected || first
    focusedOption?.focus()
  }, [isOpen])

  const close = (): void => {
    setIsOpen(false)
    triggerRef.current?.focus()
  }

  const handleOptionsKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []
    )
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    let next: number
    switch (event.key) {
      case 'ArrowDown':
        next = (current + 1) % buttons.length
        break
      case 'ArrowUp':
        next = (current - 1 + buttons.length) % buttons.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = buttons.length - 1
        break
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        close()
        return
      default:
        return
    }
    event.preventDefault()
    buttons[next]?.focus()
  }

  return (
    <div
      ref={ref}
      className={cn('relative min-w-0', className)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsOpen(false)
      }}
    >
      <button
        {...labelProps}
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setIsOpen(true)
          }
        }}
        className={cn(
          'flex h-control items-center justify-between gap-2 px-2.5 w-full rounded-control border border-input bg-card text-body text-foreground transition-colors',
          'hover:border-border-strong focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20 dark:focus-visible:ring-ring/15 disabled:opacity-45',
          isOpen && 'border-ring ring-[3px] ring-ring/20 dark:ring-ring/15'
        )}
      >
        <span className={cn('truncate', !selectedOption && 'text-muted-foreground')}>
          {selectedOption?.label || placeholder}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn('h-4 w-4 shrink-0 text-muted-foreground', isOpen && 'rotate-180')}
        />
      </button>
      {isOpen && !disabled && (
        <div
          ref={menuRef}
          id={listId}
          role="listbox"
          aria-label={labelProps['aria-label'] || selectedOption?.label || placeholder}
          onKeyDown={handleOptionsKeyDown}
          style={{ maxHeight: placement.height }}
          className={cn(
            'ui-menu absolute left-0 right-0 z-50 overflow-y-auto',
            placement.above ? 'bottom-full mb-1' : 'top-full mt-1'
          )}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              tabIndex={-1}
              onClick={() => {
                onChange(option.value)
                close()
              }}
              className={cn(
                'flex items-center justify-between gap-2 w-full rounded-control px-2 py-[5px] text-body text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
                option.value === value && 'bg-accent'
              )}
            >
              <div className="min-w-0 break-words">
                <p className="font-medium">{option.label}</p>
                {option.description && (
                  <p className="text-caption text-muted-foreground mt-0.5">{option.description}</p>
                )}
              </div>
              {option.value === value && (
                <Check aria-hidden="true" className="h-4 w-4 text-action-text shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

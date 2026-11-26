import type { ButtonHTMLAttributes, JSX } from 'react'
import { cn } from '../../lib/utils'

interface ToggleProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange' | 'onClick'
> {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  size?: 'sm' | 'md'
}

export function Toggle({
  checked,
  onChange,
  disabled = false,
  size = 'md',
  className,
  ...props
}: ToggleProps): JSX.Element {
  const sizes = {
    sm: { track: 'w-[26px] h-4', thumb: 'w-3 h-3', translate: 'translate-x-2.5' },
    md: { track: 'w-[30px] h-[18px]', thumb: 'w-3.5 h-3.5', translate: 'translate-x-3' }
  }

  const s = sizes[size]

  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        s.track,
        checked ? 'bg-primary' : 'bg-control-off',
        disabled && 'opacity-45 cursor-not-allowed',
        className
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block rounded-full bg-white shadow-[var(--surface-shadow)] transition-transform duration-150 motion-reduce:transition-none',
          s.thumb,
          checked ? s.translate : 'translate-x-0'
        )}
      />
    </button>
  )
}

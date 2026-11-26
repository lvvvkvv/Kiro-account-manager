import * as React from 'react'
import { cn } from '../../lib/utils'

export interface SwitchProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange' | 'onClick'
> {
  checked?: boolean
  size?: 'default' | 'sm'
  onCheckedChange?: (checked: boolean) => void
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  (
    { id, checked = false, size = 'default', onCheckedChange, disabled, className, ...props },
    ref
  ) => {
    return (
      <button
        {...props}
        type="button"
        ref={ref}
        id={id}
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange?.(!checked)}
        className={cn(
          'peer relative inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-150 before:absolute before:-inset-x-1.5 before:-inset-y-1.5 before:content-[""] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-45',
          size === 'sm' ? 'h-4 w-[26px]' : 'h-[18px] w-[30px]',
          checked ? 'bg-primary' : 'bg-control-off',
          className
        )}
      >
        <span
          className={cn(
            'pointer-events-none block rounded-full bg-white shadow-[var(--surface-shadow)] transition-transform duration-150 motion-reduce:transition-none',
            size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5',
            checked ? (size === 'sm' ? 'translate-x-2.5' : 'translate-x-3') : 'translate-x-0'
          )}
        />
      </button>
    )
  }
)
Switch.displayName = 'Switch'

export { Switch }

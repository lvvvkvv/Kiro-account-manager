import * as React from 'react'
import { cn } from '../../lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-control min-w-0 w-full rounded-control border border-input bg-card px-2.5 py-1 text-body text-foreground transition-colors file:border-0 file:bg-transparent file:text-body file:font-medium placeholder:text-muted-foreground hover:border-border-strong focus-visible:outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 dark:focus-visible:ring-ring/15 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/25 disabled:cursor-not-allowed disabled:opacity-45',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }

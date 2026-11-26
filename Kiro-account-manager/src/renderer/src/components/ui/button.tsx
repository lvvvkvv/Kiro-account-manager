import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-control text-body font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'border border-transparent bg-primary font-semibold text-primary-foreground hover:bg-action-hover',
        destructive:
          'border border-transparent bg-destructive text-destructive-foreground hover:brightness-110',
        outline: 'border border-border-strong bg-card text-foreground hover:bg-muted',
        secondary: 'text-text-secondary hover:bg-muted hover:text-foreground',
        ghost: 'text-text-secondary hover:bg-muted hover:text-foreground',
        link: 'text-action-text underline-offset-4 hover:underline',
        // 兼容旧调用方，强调变体统一为实色主操作。
        gradient:
          'border border-transparent bg-primary font-semibold text-primary-foreground hover:bg-action-hover'
      },
      size: {
        default: 'h-control px-3.5',
        sm: 'h-control-sm px-3',
        lg: 'h-9 px-4',
        cta: 'h-9 px-4 font-semibold',
        icon: 'h-control w-control p-0'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }

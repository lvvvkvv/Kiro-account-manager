import * as React from 'react'
import { cn } from '@/lib/utils'

export type CardVariant = 'glass' | 'glass-strong' | 'glass-subtle' | 'solid' | 'elevated'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 旧 glass 变体映射实色层级，保留调用接口。 */
  variant?: CardVariant
  /** 是否启用 hover 阴影反馈 */
  interactive?: boolean
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'glass', interactive = false, ...props }, ref) => {
    const variantClass: Record<CardVariant, string> = {
      glass: 'glass-card text-card-foreground',
      'glass-strong': 'glass-card-strong text-card-foreground',
      'glass-subtle': 'glass-card-subtle text-card-foreground',
      solid: 'bg-card text-card-foreground border shadow-[var(--surface-shadow)]',
      elevated: 'bg-card text-card-foreground border shadow-[var(--popover-shadow)]'
    }
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-panel',
          variantClass[variant],
          interactive && 'hover-lift cursor-pointer',
          className
        )}
        {...props}
      />
    )
  }
)
Card.displayName = 'Card'

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1 p-4', className)} {...props} />
  )
)
CardHeader.displayName = 'CardHeader'

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-section font-semibold', className)} {...props} />
  )
)
CardTitle.displayName = 'CardTitle'

const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
  )
)
CardDescription.displayName = 'CardDescription'

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-4 pt-0', className)} {...props} />
  )
)
CardContent.displayName = 'CardContent'

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-4 pt-0', className)} {...props} />
  )
)
CardFooter.displayName = 'CardFooter'

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }

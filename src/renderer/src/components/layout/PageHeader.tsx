import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  icon?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  titleExtra?: ReactNode
  actions?: ReactNode
  className?: string
}

/** 纯呈现页头；窗口控制与拖动由 TitleBar 负责，业务动作由调用方传入。 */
export function PageHeader({
  icon,
  title,
  subtitle,
  titleExtra,
  actions,
  className
}: PageHeaderProps): ReactNode {
  return (
    <header className={cn('ui-page-header shrink-0 py-2', className)}>
      <div className="ui-page-heading flex-1 flex-wrap gap-y-1">
        {icon && (
          <span className="ui-page-icon text-foreground [&>svg]:size-[22px]" aria-hidden="true">
            {icon}
          </span>
        )}
        <h1 className="ui-page-title min-w-0 break-words">{title}</h1>
        {(subtitle || titleExtra) && (
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {subtitle && (
              <span className="min-w-0 break-words text-body text-muted-foreground">
                {subtitle}
              </span>
            )}
            {titleExtra}
          </div>
        )}
      </div>
      {actions && <div className="ui-toolbar ml-auto max-w-full justify-end">{actions}</div>}
    </header>
  )
}

import { ElementType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface AdminSectionProps {
  title: ReactNode
  description?: ReactNode
  icon?: ElementType
  children: ReactNode
  className?: string
  contentClassName?: string
}

export function AdminSection({
  title,
  description,
  icon: Icon,
  children,
  className,
  contentClassName
}: AdminSectionProps) {
  return (
    <div className={cn("rounded-xl border bg-card shadow-soft overflow-hidden", className)}>
      <div className="px-5 py-4 border-b bg-muted/20 flex items-center gap-2.5">
        {Icon && <Icon className="h-4 w-4 text-primary shrink-0" />}
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{title}</p>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </div>
      <div className={cn("p-5", contentClassName)}>
        {children}
      </div>
    </div>
  )
}

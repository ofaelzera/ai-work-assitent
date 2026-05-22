import { ReactNode, ElementType } from 'react'
import { cn } from '@/lib/utils'

interface AdminPageLayoutProps {
  title: ReactNode
  description?: ReactNode
  icon?: ElementType
  action?: ReactNode
  children: ReactNode
  maxWidth?: '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl' | 'full'
  className?: string
}

export function AdminPageLayout({
  title,
  description,
  icon: Icon,
  action,
  children,
  maxWidth = '5xl',
  className
}: AdminPageLayoutProps) {
  const maxWidthClass = {
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '4xl': 'max-w-4xl',
    '5xl': 'max-w-5xl',
    '6xl': 'max-w-6xl',
    '7xl': 'max-w-7xl',
    'full': 'max-w-full'
  }[maxWidth]

  return (
    <div className={cn(`p-6 ${maxWidthClass} mx-auto space-y-6 h-full overflow-y-auto`, className)}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            {Icon && <Icon className="h-5 w-5 text-primary" />}
            {title}
          </h1>
          {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
        </div>
        {action && (
          <div className="shrink-0 ml-4">
            {action}
          </div>
        )}
      </div>
      {children}
    </div>
  )
}

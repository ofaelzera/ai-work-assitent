'use client'

import * as React from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'

import { cn } from '@/lib/utils'

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  // Avoid hydration mismatch
  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <button className={cn("p-2 rounded-xl text-muted-foreground hover:bg-accent", className)}>
        <Sun className="h-4 w-4 opacity-0" />
      </button>
    )
  }

  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className={cn(
        "p-2 rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-300 relative overflow-hidden",
        className
      )}
      title="Alternar Tema (Claro/Escuro)"
    >
      <Sun className={cn("h-4 w-4 transition-all duration-300", theme === 'dark' ? '-translate-y-full opacity-0' : 'translate-y-0 opacity-100')} />
      <Moon className={cn("absolute h-4 w-4 top-2 left-2 transition-all duration-300", theme === 'dark' ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0')} />
    </button>
  )
}

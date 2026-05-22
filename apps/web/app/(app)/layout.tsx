'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard,
  MessageSquare,
  Kanban,
  Calendar,
  Lock,
  FolderOpen,
  Settings,
  LogOut,
  Bot,
  Building2,
  Users,
  CheckSquare,
  UserCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth'
import { logout, refreshToken } from '@/lib/auth'
import { apiFetch, getAccessToken } from '@/lib/api'
import { ThemeToggle } from '@/components/ThemeToggle'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/inbox', label: 'Inbox', icon: MessageSquare },
  { href: '/kanban', label: 'Kanban', icon: Kanban },
  { href: '/calendar', label: 'Agenda', icon: Calendar },
  { href: '/tasks', label: 'Tarefas', icon: CheckSquare },
  { href: '/contacts', label: 'Contatos', icon: Users },
  { href: '/companies', label: 'Empresas', icon: Building2 },
  { href: '/vault', label: 'Cofre', icon: Lock },
  { href: '/storage', label: 'Arquivos', icon: FolderOpen },
]

const adminItems = [
  { href: '/admin/channels', label: 'Canais' },
  { href: '/admin/agents', label: 'Agentes IA' },
  { href: '/admin/prompts', label: 'Prompts' },
  { href: '/admin/ai-logs', label: 'Logs IA' },
  { href: '/admin/events', label: 'Eventos' },
  { href: '/admin/reports', label: 'Relatórios' },
  { href: '/admin/users', label: 'Usuários' },
  { href: '/admin/roles', label: 'Roles e permissões' },
  { href: '/admin/settings', label: 'Configurações' },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, setUser, clear } = useAuthStore()
  const [ready, setReady] = useState(false)

  // Restaura o access token via refresh cookie antes de qualquer query disparar
  useEffect(() => {
    if (user) { setReady(true); return }

    refreshToken()
      .then(async (ok) => {
        if (!ok) { clear(); router.replace('/login'); return }
        const me = await apiFetch<{ sub: string; workspaceId: string; role: 'ADMIN' | 'MEMBER' }>('/auth/me')
        setUser(me, getAccessToken())
      })
      .catch(() => { clear(); router.replace('/login') })
      .finally(() => setReady(true))
  }, [])

  const handleLogout = async () => {
    await logout()
    clear()
    router.push('/login')
  }

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground text-sm">
        <div className="flex flex-col items-center gap-3 animate-pulse">
          <Bot className="h-8 w-8 text-primary/50" />
          <span>Carregando ambiente...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Modern Sidebar */}
      <aside className="w-64 flex-shrink-0 bg-card flex flex-col shadow-soft z-10">
        <div className="p-4 pr-3 pb-2">
          <div className="flex items-center justify-between gap-1 animate-fade-in">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <span className="font-bold text-[14px] tracking-tight">AI Work Assistant</span>
            </div>
            <ThemeToggle />
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-4 space-y-1 py-2">
          {navItems.map((item, index) => {
            const isActive = pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 animate-slide-up',
                  isActive
                    ? 'bg-primary/10 text-primary shadow-sm'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  `delay-${(index % 4) * 100}`
                )}
              >
                {isActive && (
                  <div className="absolute left-0 w-1 h-8 bg-primary rounded-r-full shadow-[0_0_8px_rgba(var(--primary),0.5)]" />
                )}
                <item.icon className={cn("h-[18px] w-[18px] transition-transform duration-200", isActive ? "scale-110" : "group-hover:scale-110")} />
                {item.label}
              </Link>
            )
          })}

          {/* Itens admin só aparecem para ADMINs */}
          {user?.role === 'ADMIN' && (
            <div className="animate-slide-up delay-400">
              <div className="pt-6 pb-2">
                <p className="px-3 text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest">
                  Administração
                </p>
              </div>

              {adminItems.map((item) => {
                const isActive = pathname.startsWith(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
                      isActive
                        ? 'bg-primary/10 text-primary shadow-sm'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                    )}
                  >
                    {isActive && (
                      <div className="absolute left-0 w-1 h-6 bg-primary rounded-r-full" />
                    )}
                    <Settings className={cn("h-4 w-4 transition-transform duration-200", isActive ? "scale-110" : "group-hover:rotate-90")} />
                    {item.label}
                  </Link>
                )
              })}
            </div>
          )}
        </nav>

        <div className="p-4 mt-auto">
          <div className="rounded-xl bg-accent/30 p-2 space-y-1 animate-slide-up delay-400">
            <Link
              href="/profile"
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all',
                pathname.startsWith('/profile')
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-background hover:text-foreground shadow-sm'
              )}
            >
              <UserCircle className="h-[18px] w-[18px]" />
              Meu Perfil
            </Link>
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-all hover:bg-destructive/10 hover:text-destructive"
            >
              <LogOut className="h-[18px] w-[18px]" />
              Sair da Conta
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden flex flex-col bg-muted/20 relative">
        <div className="absolute inset-0 bg-grid-black/[0.02] dark:bg-grid-white/[0.02] pointer-events-none" />
        <div className="relative flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  )
}

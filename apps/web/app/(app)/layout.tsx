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
import { useQuery } from '@tanstack/react-query'

/**
 * Itens do menu principal.
 *
 * `perm` (opcional): permissão necessária pra o item aparecer no menu.
 * Quando omitido, item aparece pra qualquer user autenticado.
 * ADMIN base sempre vê tudo (bypass no usePermission).
 */
const navItems: Array<{ href: string; label: string; icon: any; perm?: string }> = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/inbox',     label: 'Inbox',     icon: MessageSquare },
  { href: '/chat',      label: 'Chat',      icon: MessageSquare },
  { href: '/kanban',    label: 'Kanban',    icon: Kanban },
  { href: '/calendar',  label: 'Agenda',    icon: Calendar },
  { href: '/tasks',     label: 'Tarefas',   icon: CheckSquare },
  { href: '/contacts',  label: 'Contatos',  icon: Users,     perm: 'contacts.view' },
  { href: '/companies', label: 'Empresas',  icon: Building2, perm: 'companies.view' },
  { href: '/vault',     label: 'Cofre',     icon: Lock },
  { href: '/storage',   label: 'Arquivos',  icon: FolderOpen },
]

/**
 * Itens admin — cada um exige sua perm granular.
 * A seção inteira só aparece se o user tiver pelo menos UMA.
 */
const adminItems: Array<{ href: string; label: string; perm: string }> = [
  { href: '/admin/channels', label: 'Canais',              perm: 'admin.channels' },
  { href: '/admin/agents',   label: 'Agentes IA',          perm: 'admin.agents' },
  { href: '/admin/prompts',  label: 'Prompts',             perm: 'admin.agents' },
  { href: '/admin/ai-logs',  label: 'Logs IA',             perm: 'admin.agents' },
  { href: '/admin/events',   label: 'Eventos',             perm: 'admin.events' },
  { href: '/admin/reports',  label: 'Relatórios',          perm: 'reports.view' },
  { href: '/admin/users',    label: 'Usuários',            perm: 'admin.users' },
  { href: '/admin/roles',    label: 'Roles e permissões',  perm: 'admin.users' },
  { href: '/admin/settings', label: 'Configurações',       perm: 'admin.settings' },
]

function userHasPerm(user: { role: string; permissions?: string[] } | null, perm?: string): boolean {
  if (!user) return false
  if (!perm) return true
  if (user.role === 'ADMIN') return true
  return (user.permissions ?? []).includes(perm)
}

function ChatUnreadBadge() {
  const { data } = useQuery({
    queryKey: ['chat', 'unread-total'],
    queryFn: () => apiFetch<{ total: number }>('/chat/unread-count'),
    refetchInterval: 30_000,
    staleTime: 5_000,
  })
  const total = data?.total ?? 0
  if (total === 0) return null
  return (
    <span className="h-5 min-w-[20px] px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shrink-0">
      {total > 99 ? '99+' : total}
    </span>
  )
}

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

  // Re-busca permissões quando a aba volta a ter foco (resolve perms stale após
  // admin editar role, sem precisar de logout/refresh manual)
  useEffect(() => {
    if (!ready || !user?.sub) return
    const refetchMe = async () => {
      try {
        const me = await apiFetch<{ sub: string; workspaceId: string; role: 'ADMIN' | 'MEMBER'; permissions?: string[] }>('/auth/me')
        setUser(me, getAccessToken())
      } catch { /* silencioso */ }
    }
    const onFocus = () => refetchMe()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [ready, user?.sub, setUser])

  const handleLogout = async () => {
    await logout()
    clear()
    router.push('/login')
  }

  // Busca dados do "me" (inclui settings.avatarUrl) só depois do auth pronto
  const { data: me } = useQuery<{ id: string; name: string; email: string; settings?: { avatarUrl?: string | null } | null }>({
    queryKey: ['me-profile'],
    queryFn: () => apiFetch('/users/me'),
    enabled: ready && !!user?.sub,
    staleTime: 60_000,
  })
  const avatarUrl = me?.settings?.avatarUrl ?? null
  const displayName = me?.name ?? me?.email ?? 'Meu Perfil'
  const fallback = ((displayName ?? '?').trim()[0] ?? '?').toUpperCase()

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
          {navItems.filter(it => userHasPerm(user, it.perm)).map((item, index) => {
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
                <span className="flex-1">{item.label}</span>
                {item.href === '/chat' && <ChatUnreadBadge />}
              </Link>
            )
          })}

          {/* Itens admin — cada um exige sua perm; seção aparece se houver pelo menos um visível */}
          {(() => {
            const visibleAdmin = adminItems.filter(it => userHasPerm(user, it.perm))
            if (visibleAdmin.length === 0) return null
            return (
            <div className="animate-slide-up delay-400">
              <div className="pt-6 pb-2">
                <p className="px-3 text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest">
                  Administração
                </p>
              </div>

              {visibleAdmin.map((item) => {
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
            )
          })()}
        </nav>

        <div className="p-4 mt-auto">
          <div className="rounded-xl bg-accent/30 p-2 space-y-1 animate-slide-up delay-400">
            <Link
              href="/profile"
              className={cn(
                'flex items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium transition-all',
                pathname.startsWith('/profile')
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-background hover:text-foreground shadow-sm'
              )}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName} className="h-7 w-7 rounded-full object-cover shrink-0" />
              ) : (
                <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary to-violet-600 flex items-center justify-center text-[11px] font-semibold text-white shrink-0">
                  {fallback}
                </div>
              )}
              <span className="truncate">{me?.name ? 'Meu Perfil' : 'Meu Perfil'}</span>
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

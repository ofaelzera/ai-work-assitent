'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSSE } from '@/lib/sse'
import { useTheme } from 'next-themes'
import { NotificationManager } from '@/components/providers/NotificationManager'

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
  { href: '/admin/ai-settings', label: 'Provedores de IA',  perm: 'admin.settings' },
  // { href: '/admin/prompts',  label: 'Prompts',             perm: 'admin.agents' },
  { href: '/admin/ai-logs',  label: 'Logs IA',             perm: 'admin.agents' },
  { href: '/admin/events',   label: 'Eventos',             perm: 'admin.events' },
  { href: '/admin/reports',  label: 'Relatórios',          perm: 'reports.view' },
  { href: '/admin/users',    label: 'Usuários',            perm: 'admin.users' },
  { href: '/admin/roles',    label: 'Roles e permissões',  perm: 'admin.users' },
  { href: '/admin/teams',           label: 'Setores',              perm: 'teams.manage' },
  { href: '/admin/routing-rules',   label: 'Regras de roteamento', perm: 'flows.manage' },
  { href: '/admin/flows',           label: 'Fluxos',               perm: 'flows.manage' },
  { href: '/admin/quick-replies',     label: 'Respostas Rápidas',   perm: 'admin.settings' },
  { href: '/admin/evolution-servers', label: 'Servidores Evolution', perm: 'admin.settings' },
  { href: '/admin/branding',          label: 'Marca & White-label',  perm: 'admin.settings' },
  { href: '/admin/settings',          label: 'Configurações',        perm: 'admin.settings' },
]

function userHasPerm(user: { role: string; permissions?: string[] } | null, perm?: string): boolean {
  if (!user) return false
  if (!perm) return true
  if (user.role === 'ADMIN') return true
  return (user.permissions ?? []).includes(perm)
}

/**
 * Badge com tooltip via portal — escapa qualquer `overflow:hidden/auto`
 * dos containers pais (a sidebar tem `overflow-y-auto`, que cortava o tooltip).
 */
function BadgeDot({
  count,
  tooltip,
  color,
}: {
  count: number
  tooltip: string
  color: 'primary' | 'amber'
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const colorClass =
    color === 'amber'
      ? 'bg-amber-500 text-white'
      : 'bg-primary text-primary-foreground'

  function show() {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ x: r.left + r.width / 2, y: r.top })
  }
  function hide() { setPos(null) }

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className={cn(
          'h-5 min-w-[20px] px-1.5 rounded-full text-[10px] font-bold flex items-center justify-center cursor-default',
          colorClass,
        )}
      >
        {count > 99 ? '99+' : count}
      </span>
      {pos && typeof document !== 'undefined' && createPortal(
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            left: pos.x,
            top: pos.y - 6,
            transform: 'translate(-50%, -100%)',
            zIndex: 9999,
            pointerEvents: 'none',
          }}
          className="whitespace-nowrap rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 border border-border px-2 py-1 text-[11px] font-medium shadow-lg animate-in fade-in zoom-in-95 duration-150"
        >
          {tooltip}
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-border" />
        </div>,
        document.body,
      )}
    </>
  )
}

function ChatUnreadBadge() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['chat', 'unread-total'],
    queryFn: () => apiFetch<{ total: number }>('/chat/unread-count'),
    refetchInterval: 60_000,
    staleTime: 5_000,
  })

  // Atualização instantânea via SSE — sem esperar polling
  useSSE((ev) => {
    if (
      ev.type === 'chat.message.new' ||
      ev.type === 'chat.room.read' ||
      ev.type === 'chat.room.updated'
    ) {
      qc.invalidateQueries({ queryKey: ['chat', 'unread-total'] })
    }
  })

  const total = data?.total ?? 0
  if (total === 0) return null
  return (
    <BadgeDot
      count={total}
      tooltip={`${total} mensagem${total === 1 ? '' : 's'} de chat não lida${total === 1 ? '' : 's'}`}
      color="primary"
    />
  )
}

function InboxBadges() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['inbox', 'badges'],
    queryFn: () => apiFetch<{ queueCount: number; myUnreadCount: number }>('/inbox/badges'),
    refetchInterval: 60_000,
    staleTime: 5_000,
  })

  // Atualização instantânea via SSE
  useSSE((ev) => {
    if (
      ev.type === 'message.received' ||
      ev.type === 'message.sent' ||
      ev.type === 'conversation.read' ||
      ev.type === 'conversation.claimed' ||
      ev.type === 'conversation.released' ||
      ev.type === 'conversation.assigned' ||
      ev.type === 'conversation.status_changed' ||
      ev.type === 'conversation.moved'
    ) {
      qc.invalidateQueries({ queryKey: ['inbox', 'badges'] })
    }
  })

  const queue = data?.queueCount ?? 0
  const mine = data?.myUnreadCount ?? 0
  if (queue === 0 && mine === 0) return null

  return (
    <span className="flex items-center gap-1 shrink-0">
      {mine > 0 && (
        <BadgeDot
          count={mine}
          tooltip={`${mine} conversa${mine === 1 ? '' : 's'} sua${mine === 1 ? '' : 's'} não lida${mine === 1 ? '' : 's'}`}
          color="primary"
        />
      )}
      {queue > 0 && (
        <BadgeDot
          count={queue}
          tooltip={`${queue} na fila — sem atendente`}
          color="amber"
        />
      )}
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

  // White-label: nome do sistema e logo no header da sidebar
  const { data: branding } = useQuery<{
    systemTitle?: string
    logoUrl?: string | null
    logoDarkUrl?: string | null
  }>({
    queryKey: ['system-settings'],
    queryFn: () => apiFetch('/system-settings/public', { skipAuth: true }),
    staleTime: 60_000,
  })
  const systemTitle = branding?.systemTitle ?? 'Work Assistant'
  // Escolhe a logo certa pro tema atual. Se não tem versão escura, usa a clara.
  const { resolvedTheme } = useTheme()
  const logoUrl =
    resolvedTheme === 'dark'
      ? (branding?.logoDarkUrl || branding?.logoUrl || null)
      : (branding?.logoUrl || null)

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
    <div className="flex h-screen overflow-hidden bg-background relative">
      {/* Background Mesh Gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background pointer-events-none" />
      <div className="absolute inset-0 bg-grid-black/[0.02] dark:bg-grid-white/[0.02] pointer-events-none" />

      {/* Modern Sidebar with Glassmorphism */}
      <aside className="w-64 flex-shrink-0 bg-card/60 backdrop-blur-xl border-r flex flex-col shadow-2xl z-10">
        <div className="p-5 pb-3">
          <div className="flex items-center justify-between gap-1 animate-fade-in">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={systemTitle}
                  className="h-14 max-h-14 max-w-full w-auto object-contain"
                />
              ) : (
                <>
                  <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/20 shrink-0">
                    <Bot className="h-4 w-4 text-primary-foreground" />
                  </div>
                  <span className="font-bold text-[15px] tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70 truncate">
                    {systemTitle}
                  </span>
                </>
              )}
            </div>
            <ThemeToggle />
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-4 space-y-1.5 py-4">
          {navItems.filter(it => userHasPerm(user, it.perm)).map((item, index) => {
            const isActive = pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-300 animate-slide-up relative overflow-hidden',
                  isActive
                    ? 'bg-primary/10 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]'
                    : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
                  `delay-${(index % 4) * 100}`
                )}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-1/2 bg-primary rounded-r-full shadow-[0_0_12px_rgba(var(--primary),0.8)]" />
                )}
                {isActive && (
                  <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-transparent pointer-events-none" />
                )}
                <item.icon className={cn("h-[18px] w-[18px] transition-transform duration-300 relative z-10", isActive ? "scale-110" : "group-hover:scale-110 group-hover:rotate-3")} />
                <span className="flex-1 relative z-10">{item.label}</span>
                <div className="relative z-10 flex items-center">
                  {item.href === '/chat' && <ChatUnreadBadge />}
                  {item.href === '/inbox' && <InboxBadges />}
                </div>
              </Link>
            )
          })}

          {/* Itens admin */}
          {(() => {
            const visibleAdmin = adminItems.filter(it => userHasPerm(user, it.perm))
            if (visibleAdmin.length === 0) return null
            return (
            <div className="animate-slide-up delay-400 mt-4">
              <div className="pt-6 pb-2">
                <div className="flex items-center gap-2 px-3">
                  <div className="h-px flex-1 bg-border/50" />
                  <p className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-[0.2em]">
                    Administração
                  </p>
                  <div className="h-px flex-1 bg-border/50" />
                </div>
              </div>

              <div className="space-y-1 mt-2">
                {visibleAdmin.map((item) => {
                  const isActive = pathname.startsWith(item.href)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'group flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-all duration-300 relative',
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
                      )}
                    >
                      {isActive && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-1/2 bg-primary rounded-r-full shadow-[0_0_12px_rgba(var(--primary),0.8)]" />
                      )}
                      <Settings className={cn("h-[16px] w-[16px] transition-all duration-300", isActive ? "scale-110 text-primary" : "group-hover:rotate-90")} />
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            </div>
            )
          })()}
        </nav>

        <div className="p-4 mt-auto">
          <div className="rounded-2xl border bg-card/50 backdrop-blur-sm p-1 shadow-sm transition-all animate-slide-up delay-400 group">
            <details className="relative">
              <summary className="flex items-center gap-3 rounded-xl px-2 py-2 text-sm font-medium transition-all cursor-pointer hover:bg-accent/50 list-none [&::-webkit-details-marker]:hidden">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={displayName} className="h-8 w-8 rounded-lg object-cover shrink-0 ring-1 ring-border shadow-sm" />
                ) : (
                  <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-[12px] font-bold text-primary-foreground shrink-0 shadow-sm">
                    {fallback}
                  </div>
                )}
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="truncate text-[13px] text-foreground">{me?.name || 'Meu Perfil'}</span>
                  <span className="truncate text-[10px] text-muted-foreground font-normal">{user?.role === 'ADMIN' ? 'Administrador' : 'Membro'}</span>
                </div>
              </summary>
              <div className="absolute bottom-full left-0 w-full mb-2 bg-popover border text-popover-foreground rounded-xl shadow-lg shadow-black/5 animate-in fade-in slide-in-from-bottom-2 z-50">
                <Link
                  href="/profile"
                  className="flex items-center gap-2 w-full px-3 py-2 text-[13px] hover:bg-accent hover:text-accent-foreground rounded-t-xl transition-colors"
                >
                  <UserCircle className="h-4 w-4" />
                  Ver Perfil
                </Link>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 w-full px-3 py-2 text-[13px] text-red-500 hover:bg-red-500/10 hover:text-red-600 rounded-b-xl transition-colors text-left"
                >
                  <LogOut className="h-4 w-4" />
                  Sair da Conta
                </button>
              </div>
            </details>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative overflow-hidden z-0">
        <div className="relative flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
      <NotificationManager />
    </div>
  )
}

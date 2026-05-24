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
      ev.type === 'conversation.claimed' ||
      ev.type === 'conversation.released' ||
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
                {item.href === '/inbox' && <InboxBadges />}
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

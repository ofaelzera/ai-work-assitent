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
      <div className="flex h-screen items-center justify-center text-muted-foreground text-sm">
        Carregando...
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 border-r bg-card flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <span className="font-semibold text-sm">AI Work Assistant</span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                pathname.startsWith(item.href)
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}

          {/* Itens admin só aparecem para ADMINs */}
          {user?.role === 'ADMIN' && (
            <>
              <div className="pt-3 pb-1">
                <p className="px-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Admin
                </p>
              </div>

              {adminItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                    pathname.startsWith(item.href)
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  <Settings className="h-4 w-4" />
                  {item.label}
                </Link>
              ))}
            </>
          )}
        </nav>

        <div className="p-3 border-t space-y-0.5">
          <Link
            href="/profile"
            className={cn(
              'flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
              pathname.startsWith('/profile')
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <UserCircle className="h-4 w-4" />
            Meu perfil
          </Link>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-hidden flex flex-col">{children}</main>
    </div>
  )
}

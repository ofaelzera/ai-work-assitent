'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { ShieldAlert } from 'lucide-react'

/**
 * Mapa: prefixo de path → perm necessária pra acessar.
 * O mais específico vence (primeiro match).
 */
const PATH_PERMS: Array<{ prefix: string; perm: string }> = [
  { prefix: '/admin/channels', perm: 'admin.channels' },
  { prefix: '/admin/agents',   perm: 'admin.agents' },
  { prefix: '/admin/prompts',  perm: 'admin.agents' },
  { prefix: '/admin/ai-logs',  perm: 'admin.agents' },
  { prefix: '/admin/events',   perm: 'admin.events' },
  { prefix: '/admin/reports',  perm: 'reports.view' },
  { prefix: '/admin/users',    perm: 'admin.users' },
  { prefix: '/admin/roles',    perm: 'admin.users' },
  { prefix: '/admin/teams',           perm: 'teams.manage' },
  { prefix: '/admin/routing-rules',   perm: 'flows.manage' },
  { prefix: '/admin/flows',           perm: 'flows.manage' },
  { prefix: '/admin/settings',          perm: 'admin.settings' },
  { prefix: '/admin/quick-replies',     perm: 'admin.settings' },
  { prefix: '/admin/evolution-servers', perm: 'admin.settings' },
]

/** Perms que destravam acesso a alguma sub-página de /admin/*. */
const ADMIN_PERMS = Array.from(new Set(PATH_PERMS.map(p => p.perm)))

function userHasPerm(user: { role: string; permissions?: string[] } | null, perm: string): boolean {
  if (!user) return false
  if (user.role === 'ADMIN') return true
  return (user.permissions ?? []).includes(perm)
}

/**
 * Guard duplo:
 *  1) /admin/* — exige PELO MENOS UMA perm admin (senão redireciona pro dashboard)
 *  2) Sub-path — exige a perm específica daquele path (senão mostra "Acesso restrito")
 *
 * Antes era checado apenas `role === 'ADMIN'`, o que quebrava custom roles
 * (Supervisor com admin.users não conseguia acessar /admin/users).
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const user = useAuthStore(s => s.user)

  const hasAnyAdminPerm = (() => {
    if (!user) return false
    if (user.role === 'ADMIN') return true
    const list = user.permissions ?? []
    return ADMIN_PERMS.some(p => list.includes(p))
  })()

  useEffect(() => {
    if (user && !hasAnyAdminPerm) {
      router.replace('/dashboard')
    }
  }, [user, hasAnyAdminPerm, router])

  if (!user) {
    return <div className="p-8 text-sm text-muted-foreground">Carregando...</div>
  }

  if (!hasAnyAdminPerm) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <ShieldAlert className="h-12 w-12 text-muted-foreground mb-3" />
        <h1 className="text-lg font-semibold">Acesso restrito</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Você não tem permissões administrativas neste workspace.
        </p>
      </div>
    )
  }

  // Checagem granular do sub-path (acessou direto via URL → bloqueia se sem perm específica)
  const matched = PATH_PERMS.find(p => pathname.startsWith(p.prefix))
  if (matched && !userHasPerm(user, matched.perm)) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <ShieldAlert className="h-12 w-12 text-muted-foreground mb-3" />
        <h1 className="text-lg font-semibold">Acesso restrito</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          Você não tem a permissão <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{matched.perm}</code> necessária para acessar esta página.
        </p>
      </div>
    )
  }

  return <>{children}</>
}

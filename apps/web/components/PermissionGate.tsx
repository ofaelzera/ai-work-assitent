'use client'
import { ShieldAlert } from 'lucide-react'
import { useAuthStore } from '@/store/auth'

interface PermissionGateProps {
  /** Permissão única — bloqueia se não tiver. */
  perm?: string
  /** Lista — bloqueia se não tiver TODAS (modo "all") ou NENHUMA (modo "any"). */
  perms?: string[]
  mode?: 'all' | 'any'
  /** Fallback alternativo. Se omitido, mostra o card padrão de "Acesso restrito". */
  fallback?: React.ReactNode
  children: React.ReactNode
}

/**
 * Gate de página — esconde conteúdo se o user não tiver a permissão.
 * ADMIN base passa sempre (bypass, igual no backend).
 *
 * Uso:
 *   <PermissionGate perm="companies.view">
 *     <CompaniesPage />
 *   </PermissionGate>
 */
export function PermissionGate({ perm, perms, mode = 'all', fallback, children }: PermissionGateProps) {
  const user = useAuthStore(s => s.user)

  if (!user) {
    return <div className="p-8 text-sm text-muted-foreground">Carregando...</div>
  }

  const allowed = (() => {
    if (user.role === 'ADMIN') return true
    const list = user.permissions ?? []
    const required = perm ? [perm] : (perms ?? [])
    if (required.length === 0) return true
    return mode === 'any'
      ? required.some(p => list.includes(p))
      : required.every(p => list.includes(p))
  })()

  if (!allowed) {
    if (fallback !== undefined) return <>{fallback}</>
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <ShieldAlert className="h-12 w-12 text-muted-foreground mb-3" />
        <h1 className="text-lg font-semibold">Acesso restrito</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          Você não tem permissão para acessar esta área. Solicite acesso ao administrador do workspace.
        </p>
      </div>
    )
  }

  return <>{children}</>
}

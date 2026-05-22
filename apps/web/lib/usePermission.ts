'use client'
import { useAuthStore } from '@/store/auth'

/**
 * Hook pra checar permissões granulares no frontend.
 * Usa o array `permissions` populado pelo /auth/me.
 *
 * ADMIN sempre retorna true (bypass — backend tem a verdade).
 *
 * Uso:
 *   const canArchive = usePermission('conversations.archive')
 *   {canArchive && <button>Arquivar</button>}
 */
export function usePermission(perm: string): boolean {
  const user = useAuthStore(s => s.user)
  if (!user) return false
  if (user.role === 'ADMIN') return true
  return user.permissions?.includes(perm) ?? false
}

/** Variante com várias permissões: retorna true se TEM TODAS. */
export function useAllPermissions(...perms: string[]): boolean {
  const user = useAuthStore(s => s.user)
  if (!user) return false
  if (user.role === 'ADMIN') return true
  const list = user.permissions ?? []
  return perms.every(p => list.includes(p))
}

/** Variante com várias permissões: retorna true se tem PELO MENOS UMA. */
export function useAnyPermission(...perms: string[]): boolean {
  const user = useAuthStore(s => s.user)
  if (!user) return false
  if (user.role === 'ADMIN') return true
  const list = user.permissions ?? []
  return perms.some(p => list.includes(p))
}

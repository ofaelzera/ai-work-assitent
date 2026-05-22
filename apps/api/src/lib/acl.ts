/**
 * Helpers de autorização baseados em permissões (RBAC).
 *
 * Resolução de permissões (em ordem):
 *   1. ADMIN base (User.role === 'ADMIN') → bypass total (true sempre)
 *   2. User.customRoleId setado → usa permissões do CustomRole (cacheado 60s em memória)
 *   3. Caso contrário (MEMBER sem custom role) → DEFAULT_MEMBER_PERMISSIONS
 */
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { JwtPayload } from '@aiwa/shared'
import { prisma } from './prisma.js'
import {
  DEFAULT_MEMBER_PERMISSIONS,
  isValidPermission,
  type PermissionKey,
} from './permissions.js'

const ROLE_CACHE_TTL = 60_000  // 60s

interface RoleCacheEntry {
  permissions: PermissionKey[]
  expiresAt: number
}
const roleCache = new Map<string, RoleCacheEntry>()

async function getRolePermissions(roleId: string): Promise<PermissionKey[]> {
  const cached = roleCache.get(roleId)
  if (cached && cached.expiresAt > Date.now()) return cached.permissions

  const role = await prisma.customRole.findUnique({
    where: { id: roleId },
    select: { permissions: true },
  })
  const arr = Array.isArray(role?.permissions) ? role.permissions : []
  const perms = arr.filter((p): p is PermissionKey => typeof p === 'string' && isValidPermission(p))

  roleCache.set(roleId, { permissions: perms, expiresAt: Date.now() + ROLE_CACHE_TTL })
  return perms
}

/** Invalida o cache de um role (chamar após PATCH /roles/:id). */
export function invalidateRoleCache(roleId?: string): void {
  if (roleId) roleCache.delete(roleId)
  else roleCache.clear()
}

/**
 * Verifica se o usuário tem permissão pra ação.
 * ADMIN base sempre passa (bypass).
 */
export async function hasPermission(user: JwtPayload, perm: PermissionKey): Promise<boolean> {
  if (user.role === 'ADMIN') return true

  // Busca o user pra pegar customRoleId (1 query, cacheado pela própria sessão)
  const dbUser = await prisma.user.findUnique({
    where: { id: user.sub },
    select: { customRoleId: true },
  })

  if (dbUser?.customRoleId) {
    const perms = await getRolePermissions(dbUser.customRoleId)
    return perms.includes(perm)
  }

  // Fallback pra defaults do MEMBER
  return DEFAULT_MEMBER_PERMISSIONS.includes(perm)
}

/**
 * Pre-handler Fastify que bloqueia o endpoint se o usuário não tiver a permissão.
 * Uso:
 *   { onRequest: [app.authenticate, requirePerm('admin.channels')] }
 */
export function requirePerm(perm: PermissionKey) {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    const ok = await hasPermission(req.user, perm)
    if (!ok) {
      return reply.forbidden(`Permissão necessária: ${perm}`)
    }
  }
}

/**
 * Hook útil pra rotas que retornam dados filtrados por permissão.
 * Carrega TODAS as permissões do user de uma vez (útil pro /auth/me retornar a lista).
 */
export async function listPermissions(user: JwtPayload): Promise<PermissionKey[]> {
  if (user.role === 'ADMIN') {
    const { ALL_PERMISSION_KEYS } = await import('./permissions.js')
    return ALL_PERMISSION_KEYS
  }
  const dbUser = await prisma.user.findUnique({
    where: { id: user.sub },
    select: { customRoleId: true },
  })
  if (dbUser?.customRoleId) return getRolePermissions(dbUser.customRoleId)
  return [...DEFAULT_MEMBER_PERMISSIONS]
}

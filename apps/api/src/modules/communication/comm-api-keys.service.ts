import { randomBytes, createHash } from 'node:crypto'
import { prisma } from '../../lib/prisma.js'

/**
 * API keys da Central de Comunicação para integração externa.
 * Formato do segredo: `cck_<40 hex>`. Guardamos só o hash SHA-256 e o prefixo
 * visível (primeiros 8 chars depois de `cck_`). O segredo completo só é exibido
 * uma vez, na criação.
 */
const KEY_PREFIX = 'cck_'

export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

export interface CreatedApiKey {
  id: string
  name: string
  prefix: string
  secret: string // só retornado uma vez
  scopes: string[]
  createdAt: Date
}

export async function createApiKey(
  workspaceId: string,
  name: string,
  opts: { scopes?: string[]; expiresAt?: Date | null; createdBy?: string } = {},
): Promise<CreatedApiKey> {
  const raw = randomBytes(20).toString('hex') // 40 hex chars
  const secret = `${KEY_PREFIX}${raw}`
  const prefix = raw.slice(0, 8)
  const scopes = opts.scopes ?? ['messages.send']

  const key = await prisma.commApiKey.create({
    data: {
      workspaceId,
      name,
      prefix,
      keyHash: hashApiKey(secret),
      scopes,
      expiresAt: opts.expiresAt ?? null,
      createdBy: opts.createdBy ?? null,
    },
  })

  return { id: key.id, name: key.name, prefix: key.prefix, secret, scopes, createdAt: key.createdAt }
}

export async function listApiKeys(workspaceId: string) {
  return prisma.commApiKey.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
    },
  })
}

export async function revokeApiKey(workspaceId: string, id: string): Promise<boolean> {
  const key = await prisma.commApiKey.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!key) return false
  await prisma.commApiKey.update({ where: { id }, data: { revokedAt: new Date() } })
  return true
}

/**
 * Valida um segredo de API key. Retorna o workspaceId + scopes se válido,
 * ou null se inexistente/revogado/expirado. Atualiza lastUsedAt de forma
 * fire-and-forget.
 */
export async function authenticateApiKeySecret(
  secret: string,
): Promise<{ workspaceId: string; keyId: string; scopes: string[] } | null> {
  if (!secret || !secret.startsWith(KEY_PREFIX)) return null
  const keyHash = hashApiKey(secret)
  const key = await prisma.commApiKey.findFirst({
    where: { keyHash },
    select: { id: true, workspaceId: true, scopes: true, revokedAt: true, expiresAt: true },
  })
  if (!key) return null
  if (key.revokedAt) return null
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return null

  void prisma.commApiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {})

  const scopes = Array.isArray(key.scopes) ? (key.scopes as string[]) : []
  return { workspaceId: key.workspaceId, keyId: key.id, scopes }
}

import { prisma } from '../../../lib/prisma.js'
import { decrypt } from '../../../lib/crypto.js'
import { env } from '../../../config/env.js'

export const AI_PROVIDERS = ['gemini', 'openrouter', 'anthropic', 'openai'] as const
export type ProviderName = (typeof AI_PROVIDERS)[number]

export interface ResolvedProviderConfig {
  provider: ProviderName
  enabled: boolean
  apiKey: string | null
  extra: Record<string, unknown>
}

// Cache em memória — evita query+decrypt a cada chamada de IA.
const CACHE_TTL_MS = 30_000
let cache: { at: number; data: Map<string, ResolvedProviderConfig> } | null = null

export function invalidateProviderConfigCache(): void {
  cache = null
}

/** Lê do .env como fallback quando não há registro no DB (retrocompat). */
function envFallback(name: ProviderName): ResolvedProviderConfig {
  const map: Record<ProviderName, { apiKey?: string; extra?: Record<string, unknown> }> = {
    gemini: { apiKey: env.GEMINI_API_KEY },
    openrouter: { apiKey: env.OPENROUTER_API_KEY, extra: { siteUrl: env.OPENROUTER_SITE_URL } },
    anthropic: { apiKey: env.ANTHROPIC_API_KEY },
    openai: { apiKey: env.OPENAI_API_KEY },
  }
  const entry = map[name]
  return {
    provider: name,
    enabled: !!entry.apiKey,
    apiKey: entry.apiKey ?? null,
    extra: entry.extra ?? {},
  }
}

async function loadAll(): Promise<Map<string, ResolvedProviderConfig>> {
  const rows = await prisma.aiProviderConfig.findMany()
  const byProvider = new Map(rows.map((r) => [r.provider, r]))

  const result = new Map<string, ResolvedProviderConfig>()
  for (const name of AI_PROVIDERS) {
    const row = byProvider.get(name)
    if (!row) {
      result.set(name, envFallback(name))
      continue
    }

    let apiKey: string | null = null
    if (row.apiKeyCiphertext && row.apiKeyIv && row.apiKeyAuthTag) {
      try {
        apiKey = decrypt(
          Buffer.from(row.apiKeyCiphertext),
          Buffer.from(row.apiKeyIv),
          Buffer.from(row.apiKeyAuthTag),
        )
      } catch {
        apiKey = null
      }
    }

    result.set(name, {
      provider: name,
      enabled: row.enabled,
      apiKey: apiKey ?? envFallback(name).apiKey,
      extra: (row.extra as Record<string, unknown>) ?? {},
    })
  }
  return result
}

export async function getProviderConfig(name: ProviderName): Promise<ResolvedProviderConfig> {
  if (!cache || Date.now() - cache.at > CACHE_TTL_MS) {
    cache = { at: Date.now(), data: await loadAll() }
  }
  return cache.data.get(name) ?? envFallback(name)
}

/**
 * Resolve o modelo padrão do sistema (usado p/ sugestões e fallback):
 * o AiModel marcado como isDefault; senão, o primeiro modelo habilitado.
 */
export async function getDefaultModel(): Promise<{ provider: string; modelId: string } | null> {
  const def = await prisma.aiModel.findFirst({
    where: { enabled: true, isDefault: true },
  })
  if (def) return { provider: def.provider, modelId: def.modelId }

  const first = await prisma.aiModel.findFirst({
    where: { enabled: true },
    orderBy: { createdAt: 'asc' },
  })
  return first ? { provider: first.provider, modelId: first.modelId } : null
}

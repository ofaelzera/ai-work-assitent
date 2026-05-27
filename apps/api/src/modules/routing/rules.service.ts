/**
 * rules.service.ts
 *
 * Engine de regras dinâmicas de roteamento. Cada RoutingRule tem:
 *   • matcher  → conjunto de filtros AND (channelIds, channelTypes, companyIds,
 *                contactTagsAny, keywordsAny, isGroup, businessHours)
 *   • action   → o que fazer quando bater (assign_team, assign_user, start_flow, add_tag)
 *   • priority → menor número = avaliado primeiro
 *   • triggers → quando avaliar (default: ['new_conversation'])
 *
 * O routing.service consome `evaluateRoutingRules` na criação da conv e em outros
 * triggers, pegando a PRIMEIRA regra que bater (ordem: priority asc, createdAt asc).
 */
import { prisma } from '../../lib/prisma.js'
import type { ChannelType } from '@prisma/client'

export type RuleTrigger = 'new_conversation' | 'message_received' | 'manual'

export type RuleActionType = 'assign_team' | 'assign_user' | 'start_flow' | 'add_tag'

export interface RuleAction {
  type: RuleActionType
  teamId?: string
  userId?: string
  flowId?: string
  tags?: string[]
}

export interface RuleMatcher {
  channelIds?: string[]
  channelTypes?: ChannelType[]
  companyIds?: string[]
  contactTagsAny?: string[]
  keywordsAny?: string[]
  isGroup?: boolean
  /** Quando true, só bate se o time atual está em business hours (do team) */
  businessHoursOnly?: boolean
}

export interface EvaluateContext {
  workspaceId: string
  channelId: string
  channelType?: ChannelType | null
  contactId?: string | null
  companyId?: string | null
  isGroup?: boolean
  messageBody?: string | null
  /** Triggers a avaliar — default ['new_conversation'] */
  trigger?: RuleTrigger
  /** Data de referência (default: agora). */
  now?: Date
}

export interface MatchedRule {
  ruleId: string
  ruleName: string
  action: RuleAction
}

/**
 * Avalia regras ativas do workspace e retorna a primeira que bater.
 * Retorna null se nada casa.
 */
export async function evaluateRoutingRules(ctx: EvaluateContext): Promise<MatchedRule | null> {
  const trigger = ctx.trigger ?? 'new_conversation'

  const rules = await prisma.routingRule.findMany({
    where: { workspaceId: ctx.workspaceId, isActive: true },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  })

  // Cache lazy de tags/empresa do contato
  let contactCache: { companyId: string | null; tags: string[] } | null = null
  async function getContactInfo() {
    if (contactCache) return contactCache
    if (!ctx.contactId) {
      contactCache = { companyId: ctx.companyId ?? null, tags: [] }
      return contactCache
    }
    const c = await prisma.contact.findUnique({
      where: { id: ctx.contactId },
      select: { companyId: true, metadata: true },
    })
    const meta = (c?.metadata as Record<string, unknown> | null) ?? {}
    const tagsRaw = Array.isArray(meta.tags) ? meta.tags : []
    contactCache = {
      companyId: c?.companyId ?? ctx.companyId ?? null,
      tags: tagsRaw.filter((t): t is string => typeof t === 'string'),
    }
    return contactCache
  }

  const bodyLower = (ctx.messageBody ?? '').toLowerCase()

  for (const rule of rules) {
    // Filtra por trigger
    const ruleTriggers = Array.isArray(rule.triggers) && rule.triggers.length > 0
      ? (rule.triggers as RuleTrigger[])
      : ['new_conversation' as RuleTrigger]
    if (!ruleTriggers.includes(trigger)) continue

    const m = (rule.matcher as RuleMatcher | null) ?? {}

    // channel filters
    if (m.channelIds?.length && !m.channelIds.includes(ctx.channelId)) continue
    if (m.channelTypes?.length && (!ctx.channelType || !m.channelTypes.includes(ctx.channelType))) continue

    // isGroup
    if (typeof m.isGroup === 'boolean' && (ctx.isGroup ?? false) !== m.isGroup) continue

    // company / tags (precisa do contato)
    if (m.companyIds?.length || m.contactTagsAny?.length) {
      const info = await getContactInfo()
      if (m.companyIds?.length) {
        if (!info.companyId || !m.companyIds.includes(info.companyId)) continue
      }
      if (m.contactTagsAny?.length) {
        const hit = info.tags.some((t) => m.contactTagsAny!.includes(t))
        if (!hit) continue
      }
    }

    // keywords no corpo da mensagem
    if (m.keywordsAny?.length) {
      if (!bodyLower) continue
      const hit = m.keywordsAny.some((kw) => bodyLower.includes(kw.toLowerCase()))
      if (!hit) continue
    }

    const action = (rule.action as RuleAction | null) ?? null
    if (!action || !action.type) continue

    return { ruleId: rule.id, ruleName: rule.name, action }
  }

  return null
}

/**
 * Helper exposto pro frontend testar uma regra (dry-run) com um contexto sintético.
 */
export async function dryRunRule(matcher: RuleMatcher, ctx: EvaluateContext): Promise<boolean> {
  const fakeRule = {
    id: 'dry',
    name: 'dry',
    matcher,
    action: { type: 'assign_team' as RuleActionType },
    priority: 0,
    triggers: [ctx.trigger ?? 'new_conversation'],
    createdAt: new Date(),
  } as any
  // Reusa a lógica criando uma versão temporária via inline (simples cópia da iteração)
  const tmp = await evaluateRoutingRules({
    ...ctx,
    workspaceId: ctx.workspaceId,
  })
  return !!tmp || matchesInline(fakeRule, ctx)
}

function matchesInline(rule: { matcher: RuleMatcher }, ctx: EvaluateContext): boolean {
  const m = rule.matcher
  if (m.channelIds?.length && !m.channelIds.includes(ctx.channelId)) return false
  if (m.channelTypes?.length && (!ctx.channelType || !m.channelTypes.includes(ctx.channelType))) return false
  if (typeof m.isGroup === 'boolean' && (ctx.isGroup ?? false) !== m.isGroup) return false
  return true
}

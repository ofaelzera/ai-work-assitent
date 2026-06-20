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

/** Janela de horário (HH:MM) opcionalmente restrita a dias da semana. */
export interface TimeWindow {
  /** 'HH:MM' (24h) */
  start: string
  /** 'HH:MM' (24h). Se end < start, a janela cruza a meia-noite. */
  end: string
  /** Dias da semana 0=Dom..6=Sáb. Vazio/ausente = todos. */
  days?: number[]
  /** Fuso. Default 'America/Sao_Paulo'. */
  tz?: string
}

export interface RuleMatcher {
  channelIds?: string[]
  channelTypes?: ChannelType[]
  companyIds?: string[]
  contactTagsAny?: string[]
  /** Exige TODAS estas tags no contato. */
  contactTagsAll?: string[]
  keywordsAny?: string[]
  /** Como casar keywordsAny: 'any' (contém qualquer) | 'all' | 'regex'. Default 'any'. */
  keywordMode?: 'any' | 'all' | 'regex'
  isGroup?: boolean
  /** Quando true, só bate se o time atual está em business hours (do team) */
  businessHoursOnly?: boolean
  // ── Alvo específico ──
  /** Contatos específicos (id). */
  contactIds?: string[]
  /** Exclui contatos específicos (tem precedência: se bater aqui, regra não casa). */
  excludeContactIds?: string[]
  /** Conversas/grupos específicos pelo externalId (JID do grupo no WhatsApp). */
  conversationExternalIds?: string[]
  /** Prefixos de telefone (ex: DDD '44'); casa por início do telefone (com/sem '55'). */
  phonePrefixes?: string[]
  // ── Tempo ──
  /** Só casa dentro desta janela de horário. */
  timeWindow?: TimeWindow
  /**
   * Cooldown (minutos) para o gatilho 'message_received' em conversa existente:
   * não redispara o mesmo fluxo se já rodou nessa janela. Default 5.
   */
  cooldownMin?: number
}

export interface EvaluateContext {
  workspaceId: string
  channelId: string
  channelType?: ChannelType | null
  contactId?: string | null
  companyId?: string | null
  isGroup?: boolean
  messageBody?: string | null
  /** Telefone do remetente (dígitos) — permite phonePrefixes sem contato cadastrado. */
  contactPhone?: string | null
  /** externalId da conversa (JID do grupo / chat). Usado por conversationExternalIds. */
  conversationExternalId?: string | null
  /** Triggers a avaliar — default ['new_conversation'] */
  trigger?: RuleTrigger
  /** Data de referência (default: agora). */
  now?: Date
}

export interface MatchedRule {
  ruleId: string
  ruleName: string
  /** Ação principal (1ª de roteamento) — mantido por compat. */
  action: RuleAction
  /** Todas as ações da regra (suporta múltiplas: ex add_tag + start_flow). */
  actions: RuleAction[]
  /** Cooldown (min) do gatilho message_received. undefined = default do caller. */
  cooldownMin?: number
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

  // Cache lazy de tags/empresa/telefone do contato
  let contactCache: { companyId: string | null; tags: string[]; phone: string | null } | null = null
  async function getContactInfo() {
    if (contactCache) return contactCache
    if (!ctx.contactId) {
      contactCache = { companyId: ctx.companyId ?? null, tags: [], phone: ctx.contactPhone ?? null }
      return contactCache
    }
    const c = await prisma.contact.findUnique({
      where: { id: ctx.contactId },
      select: { companyId: true, metadata: true, phone: true },
    })
    const meta = (c?.metadata as Record<string, unknown> | null) ?? {}
    const tagsRaw = Array.isArray(meta.tags) ? meta.tags : []
    contactCache = {
      companyId: c?.companyId ?? ctx.companyId ?? null,
      tags: tagsRaw.filter((t): t is string => typeof t === 'string'),
      phone: c?.phone ?? null,
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

    // conversa/grupo específico (externalId / JID)
    if (m.conversationExternalIds?.length) {
      if (!ctx.conversationExternalId || !m.conversationExternalIds.includes(ctx.conversationExternalId)) continue
    }

    // contatos específicos / exclusão (precisa do contactId)
    if (m.excludeContactIds?.length && ctx.contactId && m.excludeContactIds.includes(ctx.contactId)) continue
    if (m.contactIds?.length) {
      if (!ctx.contactId || !m.contactIds.includes(ctx.contactId)) continue
    }

    // company / tags / telefone (precisa do contato)
    if (m.companyIds?.length || m.contactTagsAny?.length || m.contactTagsAll?.length || m.phonePrefixes?.length) {
      const info = await getContactInfo()
      if (m.companyIds?.length) {
        if (!info.companyId || !m.companyIds.includes(info.companyId)) continue
      }
      if (m.contactTagsAny?.length) {
        if (!info.tags.some((t) => m.contactTagsAny!.includes(t))) continue
      }
      if (m.contactTagsAll?.length) {
        if (!m.contactTagsAll.every((t) => info.tags.includes(t))) continue
      }
      if (m.phonePrefixes?.length) {
        if (!matchesPhonePrefix(info.phone, m.phonePrefixes)) continue
      }
    }

    // keywords no corpo da mensagem (any | all | regex)
    if (m.keywordsAny?.length) {
      if (!bodyLower) continue
      const mode = m.keywordMode ?? 'any'
      if (!matchesKeywords(bodyLower, m.keywordsAny, mode)) continue
    }

    // janela de horário
    if (m.timeWindow && !withinTimeWindow(m.timeWindow, ctx.now ?? new Date())) continue

    // Ações: aceita single (action) ou múltiplas (action é array).
    const actions = normalizeActions(rule.action)
    if (actions.length === 0) continue
    const primary = actions.find((a) => a.type !== 'add_tag') ?? actions[0]

    return { ruleId: rule.id, ruleName: rule.name, action: primary, actions, cooldownMin: m.cooldownMin }
  }

  return null
}

/** Normaliza o campo `action` (objeto único ou array) para uma lista de ações. */
function normalizeActions(raw: unknown): RuleAction[] {
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : []
  return arr.filter((a): a is RuleAction => !!a && typeof (a as any).type === 'string')
}

/** Casa keywords no corpo conforme o modo. */
function matchesKeywords(bodyLower: string, keywords: string[], mode: 'any' | 'all' | 'regex'): boolean {
  if (mode === 'regex') {
    return keywords.some((kw) => {
      try { return new RegExp(kw, 'i').test(bodyLower) } catch { return false }
    })
  }
  const kws = keywords.map((k) => k.toLowerCase())
  if (mode === 'all') return kws.every((kw) => bodyLower.includes(kw))
  return kws.some((kw) => bodyLower.includes(kw))
}

/** Casa o telefone (com ou sem código do país 55) contra prefixos (ex: DDD). */
function matchesPhonePrefix(phone: string | null, prefixes: string[]): boolean {
  if (!phone) return false
  const digits = phone.replace(/\D/g, '')
  const candidates = [digits]
  if (digits.startsWith('55')) candidates.push(digits.slice(2))
  return prefixes.some((p) => {
    const pp = p.replace(/\D/g, '')
    return pp.length > 0 && candidates.some((c) => c.startsWith(pp))
  })
}

/** Verifica se `date` está dentro da janela (no fuso da janela). */
function withinTimeWindow(win: TimeWindow, date: Date): boolean {
  const tz = win.tz || 'America/Sao_Paulo'
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(date)
  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  const wdShort = parts.find((p) => p.type === 'weekday')?.value ?? ''
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const weekday = wdMap[wdShort] ?? new Date(date).getDay()
  if (win.days?.length && !win.days.includes(weekday)) return false
  const cur = hh * 60 + mm
  const [sh, sm] = win.start.split(':').map(Number)
  const [eh, em] = win.end.split(':').map(Number)
  const startMin = (sh || 0) * 60 + (sm || 0)
  const endMin = (eh || 0) * 60 + (em || 0)
  if (startMin <= endMin) return cur >= startMin && cur <= endMin
  // janela cruza meia-noite (ex: 22:00–06:00)
  return cur >= startMin || cur <= endMin
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

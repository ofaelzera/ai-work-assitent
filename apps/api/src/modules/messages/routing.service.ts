/**
 * routing.service.ts
 *
 * Roteamento de novas conversas. Define para QUEM (assignee) e para QUAL setor (team)
 * uma conversa nova vai. NÃO faz auto-atribuição: o atendente sempre tem que clicar
 * "Assumir" para iniciar (dispara boas-vindas + cronômetro de SLA).
 *
 * Ordem de precedência (primeira que casa, ganha):
 *   1. RoutingRule (matcher → action) — regras dinâmicas configuradas no admin
 *   2. Empresa (via contato) — Company.distributionMode + defaultAssigneeId/RR
 *   3. Fallback (Workspace Settings) — distribuição global (regra padrão)
 *
 * Resultado:
 *   • teamId            → time atualmente dono (null quando legado/fila pública)
 *   • eligibleAssigneeIds → array de userIds elegíveis (null = fila pública)
 *   • assigneeId        → só preenchido em fluxos proativos (autoAssign=true)
 *   • flowId            → flow a iniciar (quando rota veio de start_flow ou Channel.defaultFlowId)
 *
 * Compat: chamadas existentes continuam funcionando — campos novos são opcionais
 * no resultado e os workers só leem o que sabem usar.
 */
import { prisma } from '../../lib/prisma.js'
import type { ChannelType } from '@prisma/client'
import { resolveTeamEligibility } from '../teams/teams.service.js'
import { evaluateRoutingRules } from '../routing/rules.service.js'

export type DistMode = 'all' | 'fixed' | 'round_robin' | 'load_balanced'
export type RouteSource = 'rule' | 'company' | 'fallback'

export interface RouteResult {
  /** Atribuído imediatamente (raro — só em fluxos proativos com autoAssign=true). */
  assigneeId: string | null
  /** Time atualmente dono da conversa (null = sem time / legado). */
  teamId: string | null
  /** Lista de userIds que podem ver/assumir. null = fila pública geral. */
  eligibleAssigneeIds: string[] | null
  distMode: DistMode
  source: RouteSource
  /** Quando preenchido, o caller deve iniciar este flow para a conversa. */
  flowId?: string | null
  /** ID da regra que casou (quando source='rule'). */
  ruleId?: string | null
}

interface RouteArgs {
  workspaceId: string
  channelId: string
  contactId: string | null
  /** Tipo do canal — usado por RoutingRules. Opcional (será carregado se omitido). */
  channelType?: ChannelType | null
  /** Indica se é grupo (WA) — usado por matchers. */
  isGroup?: boolean
  /** Corpo da primeira mensagem — usado por matchers de keyword. */
  messageBody?: string | null
  /**
   * Quando true (padrão false), atribui imediatamente se houver regra
   * fixed/RR/LB. Quando false, sempre deixa em fila (atendente precisa Assumir).
   */
  autoAssign?: boolean
  /** Usuário fallback quando autoAssign=true e não há regra. */
  fallbackUserId?: string | null
}

export async function routeNewConversation(args: RouteArgs): Promise<RouteResult> {
  const {
    workspaceId,
    channelId,
    contactId,
    autoAssign = false,
    fallbackUserId = null,
    isGroup = false,
    messageBody = null,
  } = args

  // Carrega canal (sempre precisamos pra defaultTeamId/defaultFlowId/settings)
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: {
      type: true,
      settings: true,
      defaultTeamId: true,
      defaultFlowId: true,
    },
  })
  const channelType = args.channelType ?? channel?.type ?? null
  const channelSettings = (channel?.settings as Record<string, unknown> | null) ?? {}

  // 1) RULES — primeira regra que casa
  const matched = await evaluateRoutingRules({
    workspaceId,
    channelId,
    channelType,
    contactId,
    isGroup,
    messageBody,
    trigger: 'new_conversation',
  })

  if (matched) {
    const action = matched.action
    if (action.type === 'assign_team' && action.teamId) {
      const elig = await resolveTeamEligibility({ teamId: action.teamId })
      const eligible = elig.userIds.length > 0 ? elig.userIds : null
      // Se overflow e há team de overflow configurado, tenta uma vez
      let finalTeamId: string | null = action.teamId
      let finalEligible = eligible
      if (elig.overflowed) {
        const ovf = await prisma.team.findUnique({
          where: { id: action.teamId },
          select: { overflowTeamId: true },
        })
        if (ovf?.overflowTeamId) {
          const elig2 = await resolveTeamEligibility({ teamId: ovf.overflowTeamId })
          finalTeamId = ovf.overflowTeamId
          finalEligible = elig2.userIds.length > 0 ? elig2.userIds : null
        }
      }
      return {
        assigneeId: autoAssign && finalEligible?.[0] ? finalEligible[0] : null,
        teamId: finalTeamId,
        eligibleAssigneeIds: finalEligible,
        distMode: elig.distMode,
        source: 'rule',
        ruleId: matched.ruleId,
        flowId: channel?.defaultFlowId ?? null,
      }
    }
    if (action.type === 'assign_user' && action.userId) {
      return {
        assigneeId: autoAssign ? action.userId : null,
        teamId: null,
        eligibleAssigneeIds: [action.userId],
        distMode: 'fixed',
        source: 'rule',
        ruleId: matched.ruleId,
        flowId: channel?.defaultFlowId ?? null,
      }
    }
    if (action.type === 'start_flow' && action.flowId) {
      // Flow vai cuidar do roteamento posteriormente; cai como fila pública até lá
      return {
        assigneeId: null,
        teamId: null,
        eligibleAssigneeIds: null,
        distMode: 'all',
        source: 'rule',
        ruleId: matched.ruleId,
        flowId: action.flowId,
      }
    }
    // add_tag etc — continua avaliando próximos níveis (não retorna)
  }



  // 3) FALLBACK (Regra Padrão)
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true },
  })
  const wsSettings = (workspace?.settings as Record<string, unknown> | null) ?? {}
  const wsMode = wsSettings.distributionMode as DistMode | undefined

  if (wsMode === 'fixed') {
    const u = (wsSettings.defaultAssigneeId as string | null) ?? null
    if (u) {
      return {
        assigneeId: autoAssign ? u : null,
        teamId: null,
        eligibleAssigneeIds: [u],
        distMode: 'fixed',
        source: 'fallback',
        flowId: channel?.defaultFlowId ?? null,
      }
    }
  }
  if (wsMode === 'round_robin') {
    const userIds = (wsSettings.roundRobinUserIds as string[] | undefined) ?? []
    if (userIds.length > 0) {
      const lastIdx = typeof wsSettings.rrCursor === 'number' ? wsSettings.rrCursor : -1
      const nextIdx = (lastIdx + 1) % userIds.length
      const picked = userIds[nextIdx] ?? null
      await prisma.workspace.update({
        where: { id: workspaceId },
        data: { settings: { ...wsSettings, rrCursor: nextIdx } as any },
      }).catch(() => {})
      return {
        assigneeId: autoAssign && picked ? picked : null,
        teamId: null,
        eligibleAssigneeIds: picked ? [picked] : null,
        distMode: 'round_robin',
        source: 'fallback',
        flowId: channel?.defaultFlowId ?? null,
      }
    }
  }

  // Fila pública geral (all)
  return {
    assigneeId: autoAssign ? (fallbackUserId ?? null) : null,
    teamId: null,
    eligibleAssigneeIds: null,
    distMode: 'all',
    source: 'fallback',
    flowId: channel?.defaultFlowId ?? null,
  }
}

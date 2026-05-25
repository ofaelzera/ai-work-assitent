/**
 * routing.service.ts
 *
 * Lógica centralizada de roteamento de conversas — define QUEM pode ver/assumir
 * uma conversa nova na fila. NÃO faz auto-atribuição: o atendente sempre tem
 * que clicar em "Assumir" para iniciar (isso dispara boas-vindas e zera o
 * cronômetro de SLA).
 *
 * Precedência: empresa (via contato) > canal > workspace > fallback.
 *
 * Resultado:
 *  - `eligibleAssigneeIds = null` → fila pública (todos veem)
 *  - `eligibleAssigneeIds = [userId, ...]` → só esses usuários veem na fila
 *  - `assigneeId` só vem preenchido quando o caller pede explicitamente
 *    (ex: conversa proativa criada por um atendente que quer já assumir)
 */
import { prisma } from '../../lib/prisma.js'

export interface RouteResult {
  /** Atribuído imediatamente (raramente — só em fluxos proativos). */
  assigneeId: string | null
  /** Lista de usuários que podem ver/assumir. null = fila pública. */
  eligibleAssigneeIds: string[] | null
  distMode: 'all' | 'fixed' | 'round_robin'
  source: 'company' | 'channel' | 'workspace' | 'fallback'
}

interface RouteArgs {
  workspaceId: string
  channelId: string
  contactId: string | null
  /**
   * Quando true (padrão), retorna `assigneeId=null` para que o usuário precise
   * clicar em Assumir. Quando false, atribui imediatamente se houver regra
   * fixed/RR, ou cai no `fallbackUserId`.
   */
  autoAssign?: boolean
  /** Usuário fallback (ex: o criador da conv proativa). Usado se autoAssign=true e não houver regra. */
  fallbackUserId?: string | null
}

export async function routeNewConversation(args: RouteArgs): Promise<RouteResult> {
  const { workspaceId, channelId, contactId, autoAssign = false, fallbackUserId = null } = args

  // 1) Empresa via contato
  const contact = contactId
    ? await prisma.contact.findUnique({
        where: { id: contactId },
        select: { companyId: true },
      })
    : null

  const companyRules = contact?.companyId
    ? await prisma.company.findUnique({
        where: { id: contact.companyId },
        select: {
          id: true,
          distributionMode: true,
          defaultAssigneeId: true,
          roundRobinUserIds: true,
          rrCursor: true,
        },
      })
    : null

  // 2) Canal
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { settings: true },
  })
  const channelSettings = (channel?.settings as Record<string, unknown> | null) ?? {}

  // 3) Workspace
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true },
  })
  const workspaceSettings = (workspace?.settings as Record<string, unknown> | null) ?? {}

  const companyMode = companyRules?.distributionMode as 'all' | 'fixed' | 'round_robin' | null | undefined
  const channelMode = channelSettings.distributionMode as 'all' | 'fixed' | 'round_robin' | undefined
  const wsMode = workspaceSettings.distributionMode as 'all' | 'fixed' | 'round_robin' | undefined

  const distMode = (companyMode ?? channelMode ?? wsMode ?? 'all') as 'all' | 'fixed' | 'round_robin'
  const source: RouteResult['source'] = companyMode
    ? 'company'
    : channelMode
      ? 'channel'
      : wsMode
        ? 'workspace'
        : 'fallback'

  // Resolve usuário(s) elegível(eis) pela regra ativa
  let pickedUserId: string | null = null
  let eligible: string[] | null = null

  if (distMode === 'fixed') {
    const fixedUser =
      (companyMode === 'fixed' ? companyRules?.defaultAssigneeId : null) ??
      (channelMode === 'fixed' ? (channelSettings.defaultAssigneeId as string | null) : null) ??
      (wsMode === 'fixed' ? (workspaceSettings.defaultAssigneeId as string | null) : null) ??
      null
    if (fixedUser) {
      pickedUserId = fixedUser
      eligible = [fixedUser]
    }
  } else if (distMode === 'round_robin') {
    if (companyMode === 'round_robin' && companyRules) {
      const userIds = (companyRules.roundRobinUserIds as string[] | null) ?? []
      if (userIds.length > 0) {
        const lastIdx = typeof companyRules.rrCursor === 'number' ? companyRules.rrCursor : -1
        const nextIdx = (lastIdx + 1) % userIds.length
        pickedUserId = userIds[nextIdx] ?? null
        eligible = pickedUserId ? [pickedUserId] : null
        await prisma.company.update({
          where: { id: companyRules.id },
          data: { rrCursor: nextIdx },
        }).catch(() => {})
      }
    } else if (channelMode === 'round_robin') {
      const userIds = (channelSettings.roundRobinUserIds as string[] | undefined) ?? []
      if (userIds.length > 0) {
        const lastIdx = typeof channelSettings.rrCursor === 'number' ? channelSettings.rrCursor : -1
        const nextIdx = (lastIdx + 1) % userIds.length
        pickedUserId = userIds[nextIdx] ?? null
        eligible = pickedUserId ? [pickedUserId] : null
        await prisma.channel.update({
          where: { id: channelId },
          data: { settings: { ...channelSettings, rrCursor: nextIdx } as any },
        }).catch(() => {})
      }
    } else if (wsMode === 'round_robin') {
      const userIds = (workspaceSettings.roundRobinUserIds as string[] | undefined) ?? []
      if (userIds.length > 0) {
        const lastIdx = typeof workspaceSettings.rrCursor === 'number' ? workspaceSettings.rrCursor : -1
        const nextIdx = (lastIdx + 1) % userIds.length
        pickedUserId = userIds[nextIdx] ?? null
        eligible = pickedUserId ? [pickedUserId] : null
        await prisma.workspace.update({
          where: { id: workspaceId },
          data: { settings: { ...workspaceSettings, rrCursor: nextIdx } as any },
        }).catch(() => {})
      }
    }
  }
  // distMode === 'all' → eligible permanece null (fila pública)

  // Por padrão NUNCA atribui automaticamente. A conv entra na fila — restrita
  // ou pública — e o atendente precisa clicar Assumir.
  let assigneeId: string | null = null

  // Override apenas para fluxos proativos (autoAssign=true)
  if (autoAssign) {
    assigneeId = pickedUserId ?? fallbackUserId
  }

  return { assigneeId, eligibleAssigneeIds: eligible, distMode, source }
}

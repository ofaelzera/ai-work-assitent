import { z } from 'zod'
import { prisma } from '../../../lib/prisma.js'
import { eventBus } from '../../../lib/eventBus.js'
import { logger } from '../../../lib/logger.js'
import { createGoogleEvent } from '../../calendar/google.service.js'
import type { ToolDef } from './types.js'

const paramsSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  startAt: z.string().datetime().describe('ISO 8601 timestamp do início'),
  endAt: z.string().datetime().describe('ISO 8601 timestamp do fim'),
  ownerId: z.string().optional().describe('User dono do evento. Se omitido, usa o 1º admin do workspace.'),
  accountId: z.string().optional().describe('Conta Google Calendar pra sincronizar. Se omitido, usa a 1ª conta do owner. Use "none" pra criar só local.'),
})

export const createCalendarEventTool: ToolDef<typeof paramsSchema> = {
  name: 'createCalendarEvent',
  description:
    'Cria um evento no calendário. Sincroniza com Google Calendar se o dono tiver conta conectada. ' +
    'Use pra agendar reuniões, follow-ups ou compromissos mencionados em conversas. ' +
    'Auto-vincula ao contato/conversa do evento que disparou o agente.',
  parameters: paramsSchema,
  parametersJsonSchema: {
    type: 'object',
    required: ['title', 'startAt', 'endAt'],
    properties: {
      title: { type: 'string', maxLength: 200 },
      description: { type: 'string' },
      startAt: { type: 'string', format: 'date-time' },
      endAt: { type: 'string', format: 'date-time' },
      ownerId: { type: 'string' },
      accountId: { type: 'string', description: 'Use "none" pra forçar só evento local sem Google sync.' },
    },
  },
  async execute(ctx, params) {
    // Resolve owner
    let ownerId = params.ownerId
    if (ownerId) {
      const user = await prisma.user.findFirst({
        where: { id: ownerId, workspaceId: ctx.workspaceId, deletedAt: null },
        select: { id: true },
      })
      if (!user) return { ok: false, error: `Usuário ${ownerId} não encontrado` }
    } else {
      const admin = await prisma.user.findFirst({
        where: { workspaceId: ctx.workspaceId, deletedAt: null, role: 'ADMIN' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })
      ownerId = admin?.id
    }
    if (!ownerId) return { ok: false, error: 'Nenhum dono pôde ser resolvido (workspace sem usuários?)' }

    // Valida horários
    const start = new Date(params.startAt)
    const end = new Date(params.endAt)
    if (end.getTime() <= start.getTime()) {
      return { ok: false, error: 'endAt precisa ser depois de startAt' }
    }

    // Resolve conta Google (a menos que explicitamente desligado)
    let validAccountId: string | null = null
    let externalId: string | null = null
    let syncError: string | null = null

    if (params.accountId !== 'none') {
      const account = params.accountId
        ? await prisma.calendarAccount.findFirst({
            where: { id: params.accountId, workspaceId: ctx.workspaceId, userId: ownerId },
            select: { id: true, tokens: true },
          })
        : await prisma.calendarAccount.findFirst({
            where: { workspaceId: ctx.workspaceId, userId: ownerId },
            orderBy: { createdAt: 'asc' },
            select: { id: true, tokens: true },
          })

      if (account) {
        try {
          const created = await createGoogleEvent(account, {
            summary: params.title,
            description: ctx.triggerEvent?.conversationId
              ? `${params.description ?? ''}\n\n— Origem: conversa ${ctx.triggerEvent.conversationId}`.trim()
              : params.description ?? null,
            startAt: start,
            endAt: end,
          })
          externalId = created.id
          validAccountId = account.id
        } catch (err) {
          syncError = err instanceof Error ? err.message : String(err)
          logger.warn({ err, agentId: ctx.agentId }, 'createCalendarEvent: falha no sync com Google — salvando só local')
        }
      }
    }

    // Sempre persiste local
    const event = await prisma.calendarEvent.create({
      data: {
        workspaceId: ctx.workspaceId,
        ownerId,
        calendarAccountId: validAccountId,
        externalId,
        title: params.title,
        description: params.description ?? null,
        startAt: start,
        endAt: end,
        ...(ctx.triggerEvent?.contactId && { contactId: ctx.triggerEvent.contactId }),
        ...(ctx.triggerEvent?.conversationId && { conversationId: ctx.triggerEvent.conversationId }),
        ...(ctx.triggerEvent?.messageId && { messageId: ctx.triggerEvent.messageId }),
      },
      select: { id: true, title: true, startAt: true },
    })

    await eventBus.audit(ctx.workspaceId, 'calendar.event.created', {
      actorUserId: null,
      targetType: 'calendar_event', targetId: event.id,
      payload: {
        origin: 'AI',
        agentId: ctx.agentId,
        title: event.title,
        startAt: event.startAt.toISOString(),
        googleSynced: !!externalId,
        ...(syncError && { syncError }),
      },
    })

    return {
      ok: true,
      result: {
        eventId: event.id,
        googleEventId: externalId,
        googleSynced: !!externalId,
        ...(syncError && { warning: `Salvo local. Google sync falhou: ${syncError}` }),
      },
    }
  },
}

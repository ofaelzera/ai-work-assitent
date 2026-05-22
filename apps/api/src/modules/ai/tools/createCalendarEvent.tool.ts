import { z } from 'zod'
import { prisma } from '../../../lib/prisma.js'
import { eventBus } from '../../../lib/eventBus.js'
import type { ToolDef } from './types.js'

const paramsSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  startAt: z.string().datetime().describe('ISO 8601 timestamp do início'),
  endAt: z.string().datetime().describe('ISO 8601 timestamp do fim'),
  ownerId: z.string().optional().describe('User dono do evento. Se omitido, sem dono — só evento local.'),
})

export const createCalendarEventTool: ToolDef<typeof paramsSchema> = {
  name: 'createCalendarEvent',
  description:
    'Cria um evento no calendário local do workspace (sem sync com Google). ' +
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
    },
  },
  async execute(ctx, params) {
    // Valida ownerId se vier
    let ownerId = params.ownerId
    if (ownerId) {
      const user = await prisma.user.findFirst({
        where: { id: ownerId, workspaceId: ctx.workspaceId, deletedAt: null },
        select: { id: true },
      })
      if (!user) return { ok: false, error: `Usuário ${ownerId} não encontrado` }
    } else {
      // Fallback: primeiro admin do workspace
      const admin = await prisma.user.findFirst({
        where: { workspaceId: ctx.workspaceId, deletedAt: null, role: 'ADMIN' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })
      ownerId = admin?.id
    }

    if (!ownerId) return { ok: false, error: 'Nenhum dono pôde ser resolvido (workspace sem usuários?)' }

    const start = new Date(params.startAt)
    const end = new Date(params.endAt)
    if (end.getTime() <= start.getTime()) {
      return { ok: false, error: 'endAt precisa ser depois de startAt' }
    }

    const event = await prisma.calendarEvent.create({
      data: {
        workspaceId: ctx.workspaceId,
        ownerId,
        calendarAccountId: null,
        externalId: null,
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
      payload: { origin: 'AI', agentId: ctx.agentId, title: event.title, startAt: event.startAt.toISOString() },
    })

    return { ok: true, result: { eventId: event.id, note: 'Evento criado localmente. Sync com Google requer ação manual do usuário.' } }
  },
}

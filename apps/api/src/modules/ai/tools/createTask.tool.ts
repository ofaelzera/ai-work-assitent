import { z } from 'zod'
import { prisma } from '../../../lib/prisma.js'
import { eventBus } from '../../../lib/eventBus.js'
import type { ToolDef } from './types.js'

const paramsSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  remindAt: z.string().datetime().optional().describe('Quando lembrar (ISO 8601). Omita pra tarefa sem deadline.'),
  assigneeId: z.string().optional().describe('Usuário responsável. Se omitido, fica sem assignee (qualquer admin vê).'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
})

export const createTaskTool: ToolDef<typeof paramsSchema> = {
  name: 'createTask',
  description:
    'Cria uma tarefa / lembrete. Use pra registrar follow-ups, callbacks ou TODOs ' +
    'identificados a partir de uma conversa. Auto-vincula ao contato/conversa do evento.',
  parameters: paramsSchema,
  parametersJsonSchema: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string', maxLength: 200 },
      description: { type: 'string' },
      remindAt: { type: 'string', format: 'date-time' },
      assigneeId: { type: 'string' },
      priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
    },
  },
  async execute(ctx, params) {
    // Valida assigneeId pertence ao workspace
    if (params.assigneeId) {
      const user = await prisma.user.findFirst({
        where: { id: params.assigneeId, workspaceId: ctx.workspaceId, deletedAt: null },
        select: { id: true },
      })
      if (!user) return { ok: false, error: `Usuário ${params.assigneeId} não encontrado neste workspace` }
    }

    const task = await prisma.task.create({
      data: {
        workspaceId: ctx.workspaceId,
        title: params.title,
        description: params.description,
        done: false,
        ...(params.remindAt && { remindAt: new Date(params.remindAt) }),
        ...(params.assigneeId && { assigneeId: params.assigneeId }),
        ...(ctx.triggerEvent?.contactId && { contactId: ctx.triggerEvent.contactId }),
        ...(ctx.triggerEvent?.conversationId && { conversationId: ctx.triggerEvent.conversationId }),
        ...(ctx.triggerEvent?.messageId && { messageId: ctx.triggerEvent.messageId }),
      },
      select: { id: true, title: true, assigneeId: true },
    })

    await eventBus.audit(ctx.workspaceId, 'task.created', {
      actorUserId: null,
      targetType: 'task', targetId: task.id,
      payload: { origin: 'AI', agentId: ctx.agentId, title: task.title, assigneeId: task.assigneeId },
    })

    return { ok: true, result: { taskId: task.id } }
  },
}

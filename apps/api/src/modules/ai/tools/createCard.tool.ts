import { z } from 'zod'
import { prisma } from '../../../lib/prisma.js'
import { eventBus } from '../../../lib/eventBus.js'
import type { ToolDef } from './types.js'

const paramsSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  boardId: z.string().optional().describe('Se omitido, usa o board público padrão do workspace'),
  columnId: z.string().optional().describe('Se omitido, usa a primeira coluna do board'),
  dueDate: z.string().datetime().optional(),
  checklist: z.array(z.object({ text: z.string(), done: z.boolean().default(false) })).optional(),
})

export const createCardTool: ToolDef<typeof paramsSchema> = {
  name: 'createCard',
  description:
    'Cria um card no Kanban. Use pra registrar uma demanda/oportunidade vinda de uma conversa. ' +
    'Se boardId/columnId não forem informados, escolhe o primeiro board público do workspace.',
  parameters: paramsSchema,
  parametersJsonSchema: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string', maxLength: 200 },
      description: { type: 'string' },
      priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
      boardId: { type: 'string' },
      columnId: { type: 'string' },
      dueDate: { type: 'string', format: 'date-time' },
      checklist: {
        type: 'array',
        items: {
          type: 'object',
          required: ['text'],
          properties: { text: { type: 'string' }, done: { type: 'boolean' } },
        },
      },
    },
  },
  async execute(ctx, params) {
    // Resolve coluna: explícita → board explícito (primeira coluna) → board público padrão
    let columnId = params.columnId
    let resolvedBoardId = params.boardId

    if (!columnId) {
      if (!resolvedBoardId) {
        const fallbackBoard = await prisma.board.findFirst({
          where: { workspaceId: ctx.workspaceId, deletedAt: null, visibility: 'PUBLIC' },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        })
        if (!fallbackBoard) return { ok: false, error: 'Nenhum board público encontrado e nenhum boardId informado' }
        resolvedBoardId = fallbackBoard.id
      }
      const firstCol = await prisma.column.findFirst({
        where: { boardId: resolvedBoardId, board: { workspaceId: ctx.workspaceId } },
        orderBy: { position: 'asc' },
        select: { id: true },
      })
      if (!firstCol) return { ok: false, error: `Board ${resolvedBoardId} não tem colunas` }
      columnId = firstCol.id
    }

    // Valida coluna pertence ao workspace
    const column = await prisma.column.findFirst({
      where: { id: columnId, board: { workspaceId: ctx.workspaceId } },
      select: { id: true, boardId: true },
    })
    if (!column) return { ok: false, error: `Coluna ${columnId} não encontrada` }

    const last = await prisma.card.findFirst({
      where: { columnId, deletedAt: null },
      orderBy: { position: 'desc' },
      select: { position: true },
    })

    const card = await prisma.card.create({
      data: {
        workspaceId: ctx.workspaceId,
        columnId,
        title: params.title,
        description: params.description,
        priority: params.priority,
        position: (last?.position ?? -1) + 1,
        ...(params.dueDate && { dueDate: new Date(params.dueDate) }),
        ...(ctx.triggerEvent?.contactId && { contactId: ctx.triggerEvent.contactId }),
        ...(ctx.triggerEvent?.conversationId && { conversationId: ctx.triggerEvent.conversationId }),
        ...(params.checklist && { checklist: params.checklist }),
      },
      select: { id: true, title: true },
    })

    await eventBus.audit(ctx.workspaceId, 'card.created', {
      actorUserId: null,
      targetType: 'card', targetId: card.id,
      payload: { origin: 'AI', agentId: ctx.agentId, boardId: column.boardId, title: card.title },
    })

    return { ok: true, result: { cardId: card.id, boardId: column.boardId } }
  },
}

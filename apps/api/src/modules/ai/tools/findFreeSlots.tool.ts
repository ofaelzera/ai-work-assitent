import { z } from 'zod'
import { prisma } from '../../../lib/prisma.js'
import { findFreeSlots } from '../../calendar/availability.service.js'
import type { ToolDef } from './types.js'

const paramsSchema = z.object({
  userId: z.string().describe('User cujo calendário será consultado'),
  durationMin: z.number().int().positive().optional().describe('Duração de cada slot em minutos (default 30)'),
  daysAhead: z.number().int().positive().optional().describe('Janela de busca a partir de agora, em dias (default 7)'),
  maxSlots: z.number().int().positive().optional().describe('Máximo de slots retornados (default 10)'),
})

export const findFreeSlotsTool: ToolDef<typeof paramsSchema> = {
  name: 'findFreeSlots',
  description:
    'Lista os próximos horários livres na agenda de um usuário, respeitando horário de trabalho, ' +
    'horário de funcionamento da empresa, feriados, bloqueios e compromissos já existentes. ' +
    'Use antes de oferecer horários ao cliente para agendamento.',
  parameters: paramsSchema,
  parametersJsonSchema: {
    type: 'object',
    required: ['userId'],
    properties: {
      userId: { type: 'string' },
      durationMin: { type: 'number' },
      daysAhead: { type: 'number' },
      maxSlots: { type: 'number' },
    },
  },
  async execute(ctx, params) {
    const user = await prisma.user.findFirst({
      where: { id: params.userId, workspaceId: ctx.workspaceId, deletedAt: null },
      select: { id: true },
    })
    if (!user) return { ok: false, error: `Usuário ${params.userId} não encontrado` }

    const durationMin = params.durationMin ?? 30
    const daysAhead = params.daysAhead ?? 7
    const maxSlots = params.maxSlots ?? 10
    const from = new Date()
    const to = new Date(from.getTime() + daysAhead * 24 * 60 * 60 * 1000)

    const slots = await findFreeSlots(ctx.workspaceId, params.userId, { from, to }, durationMin)
    const top = slots.slice(0, maxSlots)

    return {
      ok: true,
      result: {
        durationMin,
        count: top.length,
        slots: top.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
      },
    }
  },
}

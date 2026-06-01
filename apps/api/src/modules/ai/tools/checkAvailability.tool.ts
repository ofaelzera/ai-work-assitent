import { z } from 'zod'
import { prisma } from '../../../lib/prisma.js'
import {
  isWithinCompanyHours,
  isWithinWorkingHours,
  hasConflict,
} from '../../calendar/availability.service.js'
import type { ToolDef } from './types.js'

const paramsSchema = z.object({
  userId: z.string().optional().describe('User a checar disponibilidade. Omitir para checar só o horário da empresa.'),
  at: z.string().datetime().optional().describe('Instante a checar (ISO 8601). Default: agora.'),
  endAt: z.string().datetime().optional().describe('Fim do intervalo (ISO 8601) para checar conflito. Requer userId e at.'),
})

export const checkAvailabilityTool: ToolDef<typeof paramsSchema> = {
  name: 'checkAvailability',
  description:
    'Verifica disponibilidade da agenda: se a empresa está dentro do horário de funcionamento, ' +
    'se um usuário está dentro do horário de trabalho, e se há conflito num intervalo. ' +
    'Use para decidir se um agendamento é possível antes de criá-lo.',
  parameters: paramsSchema,
  parametersJsonSchema: {
    type: 'object',
    properties: {
      userId: { type: 'string' },
      at: { type: 'string', format: 'date-time' },
      endAt: { type: 'string', format: 'date-time' },
    },
  },
  async execute(ctx, params) {
    const at = params.at ? new Date(params.at) : new Date()

    const companyOpen = await isWithinCompanyHours(ctx.workspaceId, at)

    let userAvailable: boolean | null = null
    let conflict: boolean | null = null

    if (params.userId) {
      const user = await prisma.user.findFirst({
        where: { id: params.userId, workspaceId: ctx.workspaceId, deletedAt: null },
        select: { id: true },
      })
      if (!user) return { ok: false, error: `Usuário ${params.userId} não encontrado` }

      userAvailable = await isWithinWorkingHours(ctx.workspaceId, params.userId, at)

      if (params.endAt) {
        const end = new Date(params.endAt)
        if (end <= at) return { ok: false, error: 'endAt precisa ser depois de at' }
        conflict = await hasConflict(ctx.workspaceId, params.userId, at, end)
      }
    }

    return {
      ok: true,
      result: {
        at: at.toISOString(),
        companyOpen,
        userAvailable,
        conflict,
      },
    }
  },
}

import { z } from 'zod'
import { eventBus } from '../../../lib/eventBus.js'
import type { ToolDef } from './types.js'

const paramsSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().max(500).optional(),
  link: z.string().url().optional().describe('URL pra abrir ao clicar (ex: /inbox/abc123)'),
  level: z.enum(['info', 'success', 'warning', 'error']).default('info'),
})

export const notifyTool: ToolDef<typeof paramsSchema> = {
  name: 'notify',
  description:
    'Envia uma notificação para todos os usuários do workspace. Use pra alertar sobre algo que precisa de atenção (cliente VIP, urgência, evento importante).',
  parameters: paramsSchema,
  parametersJsonSchema: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string', maxLength: 120, description: 'Título curto da notificação' },
      body: { type: 'string', maxLength: 500, description: 'Texto da notificação (opcional)' },
      link: { type: 'string', description: 'URL relativa pra abrir ao clicar (ex: /inbox/abc)' },
      level: { type: 'string', enum: ['info', 'success', 'warning', 'error'], description: 'Severidade visual' },
    },
  },
  async execute(ctx, params) {
    await eventBus.audit(ctx.workspaceId, 'notification', {
      actorUserId: null,
      targetType: 'workspace',
      targetId: ctx.workspaceId,
      payload: {
        title: params.title,
        body: params.body ?? null,
        link: params.link ?? null,
        level: params.level ?? 'info',
        source: 'ai-agent',
        agentId: ctx.agentId ?? null,
      },
    })
    return { ok: true, result: { delivered: true } }
  },
}

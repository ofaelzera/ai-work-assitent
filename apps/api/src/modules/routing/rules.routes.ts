import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { requirePerm } from '../../lib/acl.js'
import { eventBus } from '../../lib/eventBus.js'

const channelTypeEnum = z.enum(['WHATSAPP', 'GMAIL', 'IMAP_SMTP', 'INTERNAL', 'META_WHATSAPP', 'META_INSTAGRAM', 'META_MESSENGER'])

const timeWindowSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  days: z.array(z.number().int().min(0).max(6)).optional(),
  tz: z.string().optional(),
})

const matcherSchema = z.object({
  channelIds: z.array(z.string()).optional(),
  channelTypes: z.array(channelTypeEnum).optional(),
  companyIds: z.array(z.string()).optional(),
  contactTagsAny: z.array(z.string()).optional(),
  contactTagsAll: z.array(z.string()).optional(),
  keywordsAny: z.array(z.string()).optional(),
  keywordMode: z.enum(['any', 'all', 'regex']).optional(),
  isGroup: z.boolean().optional(),
  businessHoursOnly: z.boolean().optional(),
  contactIds: z.array(z.string()).optional(),
  excludeContactIds: z.array(z.string()).optional(),
  conversationExternalIds: z.array(z.string()).optional(),
  phonePrefixes: z.array(z.string()).optional(),
  timeWindow: timeWindowSchema.optional(),
  cooldownMin: z.number().int().min(0).max(1440).optional(),
}).strict()

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('assign_team'), teamId: z.string() }),
  z.object({ type: z.literal('assign_user'), userId: z.string() }),
  z.object({ type: z.literal('start_flow'), flowId: z.string() }),
  z.object({ type: z.literal('add_tag'), tags: z.array(z.string()).min(1) }),
])

/** Aceita uma ação única (compat) ou uma lista de ações. */
const actionsField = z.union([actionSchema, z.array(actionSchema).min(1)])

/** Extrai o teamId do 1º assign_team (para a coluna denormalizada assignTeamId). */
function deriveAssignTeamId(action: z.infer<typeof actionsField>): string | null {
  const arr = Array.isArray(action) ? action : [action]
  const t = arr.find((a) => a.type === 'assign_team')
  return t && t.type === 'assign_team' ? t.teamId : null
}

const triggerSchema = z.enum(['new_conversation', 'message_received', 'manual'])

const baseFields = {
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  matcher: matcherSchema,
  action: actionsField,
  priority: z.number().int().min(0).max(10000).optional(),
  isActive: z.boolean().optional(),
  triggers: z.array(triggerSchema).optional(),
}

export const routingRulesRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── List ─────────────────────────────────────────────────────────────────
  app.get(
    '/routing-rules',
    { onRequest: [app.authenticate, requirePerm('flows.manage')] },
    async (req) => {
      const { workspaceId } = req.user
      return prisma.routingRule.findMany({
        where: { workspaceId },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        include: {
          assignTeam: { select: { id: true, name: true, color: true } },
        },
      })
    },
  )

  // ── Create ───────────────────────────────────────────────────────────────
  app.post(
    '/routing-rules',
    {
      onRequest: [app.authenticate, requirePerm('flows.manage')],
      schema: { body: z.object(baseFields) },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const body = req.body
      const assignTeamId = deriveAssignTeamId(body.action)
      const rule = await prisma.routingRule.create({
        data: {
          workspaceId,
          name: body.name,
          description: body.description ?? null,
          matcher: body.matcher as any,
          action: body.action as any,
          priority: body.priority ?? 100,
          isActive: body.isActive ?? true,
          triggers: body.triggers ?? ['new_conversation'] as any,
          assignTeamId,
        },
      })
      await eventBus.audit(workspaceId, 'routing_rule.created', {
        actorUserId: req.user.sub, targetType: 'routing_rule', targetId: rule.id,
        payload: { name: rule.name },
      })
      return reply.code(201).send(rule)
    },
  )

  // ── Update ───────────────────────────────────────────────────────────────
  app.patch(
    '/routing-rules/:id',
    {
      onRequest: [app.authenticate, requirePerm('flows.manage')],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object(baseFields).partial(),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const existing = await prisma.routingRule.findFirst({
        where: { id: req.params.id, workspaceId },
        select: { id: true },
      })
      if (!existing) return reply.notFound('Regra não encontrada')

      const body = req.body
      const data: any = {}
      if (body.name !== undefined) data.name = body.name
      if (body.description !== undefined) data.description = body.description
      if (body.matcher !== undefined) data.matcher = body.matcher
      if (body.action !== undefined) {
        data.action = body.action
        data.assignTeamId = deriveAssignTeamId(body.action)
      }
      if (body.priority !== undefined) data.priority = body.priority
      if (body.isActive !== undefined) data.isActive = body.isActive
      if (body.triggers !== undefined) data.triggers = body.triggers

      return prisma.routingRule.update({ where: { id: req.params.id }, data })
    },
  )

  // ── Delete ───────────────────────────────────────────────────────────────
  app.delete(
    '/routing-rules/:id',
    {
      onRequest: [app.authenticate, requirePerm('flows.manage')],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const existing = await prisma.routingRule.findFirst({
        where: { id: req.params.id, workspaceId },
        select: { id: true },
      })
      if (!existing) return reply.notFound('Regra não encontrada')
      await prisma.routingRule.delete({ where: { id: req.params.id } })
      return reply.code(204).send()
    },
  )

  // ── Reorder (batch) — reordena prioridades de várias regras ──────────────
  app.post(
    '/routing-rules/reorder',
    {
      onRequest: [app.authenticate, requirePerm('flows.manage')],
      schema: {
        body: z.object({
          order: z.array(z.object({ id: z.string(), priority: z.number().int() })),
        }),
      },
    },
    async (req) => {
      const { workspaceId } = req.user
      await prisma.$transaction(
        req.body.order.map((o) =>
          prisma.routingRule.updateMany({
            where: { id: o.id, workspaceId },
            data: { priority: o.priority },
          }),
        ),
      )
      return { ok: true }
    },
  )
}

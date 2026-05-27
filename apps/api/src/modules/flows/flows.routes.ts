import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { requirePerm } from '../../lib/acl.js'
import { eventBus } from '../../lib/eventBus.js'
import { startFlowForConversation, cancelActiveFlows } from './flow.executor.js'

const triggerSchema = z.object({
  type: z.enum(['new_conversation', 'message_received', 'manual']),
  filters: z.object({
    channelIds: z.array(z.string()).optional(),
    channelTypes: z.array(z.string()).optional(),
    keywordsAny: z.array(z.string()).optional(),
    companyIds: z.array(z.string()).optional(),
  }).optional(),
})

const positionSchema = z.object({ x: z.number(), y: z.number() }).optional()

const nodeSchema = z.object({
  id: z.string(),
  type: z.enum([
    'start', 'message', 'menu', 'condition',
    'assign_team', 'assign_user', 'start_bot',
    'wait_for_human', 'tag', 'end',
  ]),
  position: positionSchema,
  data: z.record(z.string(), z.any()),
})

const edgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().nullable().optional(),
})

const graphSchema = z.object({
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
})

const baseFields = {
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  trigger: triggerSchema,
  graph: graphSchema,
  isActive: z.boolean().optional(),
  priority: z.number().int().min(0).max(10000).optional(),
}

/**
 * Valida grafo: deve ter exatamente 1 nó 'start' e nenhum órfão (sem entrada
 * que não seja start). Não bloqueia salvar mas retorna warnings na resposta.
 */
function validateGraph(graph: z.infer<typeof graphSchema>): string[] {
  const warnings: string[] = []
  const starts = graph.nodes.filter((n) => n.type === 'start')
  if (starts.length === 0) warnings.push('Grafo sem nó "start"')
  if (starts.length > 1) warnings.push(`Existem ${starts.length} nós "start" — apenas 1 é executado`)
  const ids = new Set(graph.nodes.map((n) => n.id))
  for (const e of graph.edges) {
    if (!ids.has(e.source)) warnings.push(`Edge ${e.id}: source ${e.source} não existe`)
    if (!ids.has(e.target)) warnings.push(`Edge ${e.id}: target ${e.target} não existe`)
  }
  return warnings
}

export const flowsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/flows',
    { onRequest: [app.authenticate, requirePerm('flows.manage')] },
    async (req) => {
      const { workspaceId } = req.user
      return prisma.flow.findMany({
        where: { workspaceId },
        orderBy: [{ isActive: 'desc' }, { priority: 'asc' }, { name: 'asc' }],
        select: {
          id: true, name: true, description: true,
          trigger: true, isActive: true, priority: true, version: true,
          createdAt: true, updatedAt: true,
          _count: { select: { executions: true } },
        },
      })
    },
  )

  app.get(
    '/flows/:id',
    {
      onRequest: [app.authenticate, requirePerm('flows.manage')],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const flow = await prisma.flow.findFirst({
        where: { id: req.params.id, workspaceId },
      })
      if (!flow) return reply.notFound('Flow não encontrado')
      return flow
    },
  )

  app.post(
    '/flows',
    {
      onRequest: [app.authenticate, requirePerm('flows.manage')],
      schema: { body: z.object(baseFields) },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const warnings = validateGraph(req.body.graph)
      const flow = await prisma.flow.create({
        data: {
          workspaceId,
          name: req.body.name,
          description: req.body.description ?? null,
          trigger: req.body.trigger as any,
          graph: req.body.graph as any,
          isActive: req.body.isActive ?? false,  // novos flows começam inativos
          priority: req.body.priority ?? 100,
        },
      })
      await eventBus.audit(workspaceId, 'flow.created', {
        actorUserId: req.user.sub, targetType: 'flow', targetId: flow.id,
        payload: { name: flow.name },
      })
      return reply.code(201).send({ ...flow, warnings })
    },
  )

  app.patch(
    '/flows/:id',
    {
      onRequest: [app.authenticate, requirePerm('flows.manage')],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object(baseFields).partial(),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const existing = await prisma.flow.findFirst({
        where: { id: req.params.id, workspaceId },
        select: { id: true, version: true },
      })
      if (!existing) return reply.notFound('Flow não encontrado')

      const data: any = {}
      const warnings: string[] = []
      if (req.body.name !== undefined) data.name = req.body.name
      if (req.body.description !== undefined) data.description = req.body.description
      if (req.body.trigger !== undefined) data.trigger = req.body.trigger
      if (req.body.graph !== undefined) {
        data.graph = req.body.graph
        // mudou o grafo → incrementa versão
        data.version = existing.version + 1
        warnings.push(...validateGraph(req.body.graph))
      }
      if (req.body.isActive !== undefined) data.isActive = req.body.isActive
      if (req.body.priority !== undefined) data.priority = req.body.priority

      const flow = await prisma.flow.update({
        where: { id: req.params.id },
        data,
      })
      return { ...flow, warnings }
    },
  )

  app.delete(
    '/flows/:id',
    {
      onRequest: [app.authenticate, requirePerm('flows.manage')],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const existing = await prisma.flow.findFirst({
        where: { id: req.params.id, workspaceId },
        select: { id: true },
      })
      if (!existing) return reply.notFound('Flow não encontrado')

      // Cancela execuções abertas
      await prisma.flowExecution.updateMany({
        where: { flowId: req.params.id, status: { in: ['RUNNING', 'WAITING_INPUT'] } },
        data: { status: 'CANCELLED', completedAt: new Date() },
      })
      await prisma.flow.delete({ where: { id: req.params.id } })
      return reply.code(204).send()
    },
  )

  // ── Disparar manualmente em uma conversa ─────────────────────────────────
  app.post(
    '/flows/:id/run',
    {
      onRequest: [app.authenticate, requirePerm('flows.manage')],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ conversationId: z.string() }),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const flow = await prisma.flow.findFirst({
        where: { id: req.params.id, workspaceId, isActive: true },
        select: { id: true },
      })
      if (!flow) return reply.notFound('Flow ativo não encontrado')
      const conv = await prisma.conversation.findFirst({
        where: { id: req.body.conversationId, workspaceId },
        select: { id: true },
      })
      if (!conv) return reply.notFound('Conversa não encontrada')

      // Cancela quaisquer flows ativos antes
      await cancelActiveFlows(conv.id, 'Substituído por run manual')
      const exec = await startFlowForConversation({
        workspaceId,
        flowId: flow.id,
        conversationId: conv.id,
      })
      return { ok: true, executionId: exec?.id ?? null }
    },
  )

  // ── Listar execuções (debug) ─────────────────────────────────────────────
  app.get(
    '/flows/:id/executions',
    {
      onRequest: [app.authenticate, requirePerm('flows.manage')],
      schema: {
        params: z.object({ id: z.string() }),
        querystring: z.object({ limit: z.coerce.number().default(50) }),
      },
    },
    async (req) => {
      const { workspaceId } = req.user
      return prisma.flowExecution.findMany({
        where: { workspaceId, flowId: req.params.id },
        orderBy: { startedAt: 'desc' },
        take: req.query.limit,
        include: {
          conversation: {
            select: {
              id: true,
              contact: { select: { name: true, phone: true } },
            },
          },
        },
      })
    },
  )

  // ── Cancelar execução ────────────────────────────────────────────────────
  app.post(
    '/flow-executions/:id/cancel',
    {
      onRequest: [app.authenticate, requirePerm('flows.manage')],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const exec = await prisma.flowExecution.findFirst({
        where: { id: req.params.id, workspaceId },
        select: { id: true, status: true },
      })
      if (!exec) return reply.notFound('Execução não encontrada')
      if (exec.status === 'COMPLETED' || exec.status === 'CANCELLED' || exec.status === 'FAILED') {
        return reply.conflict('Execução já encerrada')
      }
      await prisma.flowExecution.update({
        where: { id: req.params.id },
        data: { status: 'CANCELLED', completedAt: new Date() },
      })
      return { ok: true }
    },
  )
}

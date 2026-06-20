import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { requirePerm } from '../../lib/acl.js'
import { eventBus } from '../../lib/eventBus.js'
import { startFlowForConversation, cancelActiveFlows } from './flow.executor.js'
import { syncFlowCron, removeFlowCron } from './flowCronSync.js'

const triggerSchema = z.object({
  type: z.enum(['new_conversation', 'message_received', 'manual', 'webhook', 'cron']),
  filters: z.object({
    channelIds: z.array(z.string()).optional(),
    channelTypes: z.array(z.string()).optional(),
    keywordsAny: z.array(z.string()).optional(),
    companyIds: z.array(z.string()).optional(),
  }).optional(),
  webhookToken: z.string().min(8).optional(),
  schedule: z.string().min(1).optional(),
  scheduleTz: z.string().min(1).optional(),
})

const positionSchema = z.object({ x: z.number(), y: z.number() }).optional()

const nodeSchema = z.object({
  id: z.string(),
  type: z.enum([
    'start', 'message', 'menu', 'condition',
    'assign_team', 'assign_user', 'start_bot',
    'wait_for_human', 'tag', 'end',
    'check_company_hours', 'check_user_available', 'find_free_slots', 'create_appointment',
    'input', 'http_request', 'set_variable', 'code', 'switch', 'loop', 'call_flow',
    'close_conversation', 'ai_generate', 'send_message', 'check_notified',
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

/**
 * Verifica referências do grafo/trigger contra o workspace de destino (usado no
 * import). IDs de agente/setor/usuário/sub-fluxo/canal são específicos do
 * workspace de origem — aqui avisamos quais não existem para reconfigurar.
 */
async function scanGraphRefs(graph: any, trigger: any, workspaceId: string): Promise<string[]> {
  const w: string[] = []
  const agentIds = new Set<string>(), teamIds = new Set<string>(), userIds = new Set<string>(), flowIds = new Set<string>()
  for (const n of graph?.nodes ?? []) {
    const d = (n.data ?? {}) as any
    if (d.agentId) agentIds.add(d.agentId)
    if ((n.type === 'assign_team' || n.type === 'wait_for_human') && d.teamId) teamIds.add(d.teamId)
    if (d.userId) userIds.add(d.userId)
    if (d.ownerId) userIds.add(d.ownerId)
    if (n.type === 'call_flow' && d.flowId) flowIds.add(d.flowId)
  }
  const channelIds: string[] = Array.isArray(trigger?.filters?.channelIds) ? trigger.filters.channelIds : []

  const check = async (ids: Iterable<string>, exists: (id: string) => Promise<boolean>, label: string) => {
    for (const id of ids) if (!(await exists(id))) w.push(`${label} "${id}" não existe neste workspace — reconfigure no editor.`)
  }
  await check(agentIds, async (id) => !!(await prisma.agent.findFirst({ where: { id, workspaceId }, select: { id: true } })), 'Agente')
  await check(teamIds, async (id) => !!(await prisma.team.findFirst({ where: { id, workspaceId }, select: { id: true } })), 'Setor')
  await check(userIds, async (id) => !!(await prisma.user.findFirst({ where: { id }, select: { id: true } })), 'Usuário')
  await check(flowIds, async (id) => !!(await prisma.flow.findFirst({ where: { id, workspaceId }, select: { id: true } })), 'Sub-fluxo')
  await check(channelIds, async (id) => !!(await prisma.channel.findFirst({ where: { id, workspaceId }, select: { id: true } })), 'Canal (filtro do gatilho)')
  return w
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
      void syncFlowCron(flow.id)
      return reply.code(201).send({ ...flow, warnings })
    },
  )

  // ── Exportar fluxo (JSON portável) ───────────────────────────────────────
  app.get(
    '/flows/:id/export',
    {
      onRequest: [app.authenticate, requirePerm('flows.manage')],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const flow = await prisma.flow.findFirst({
        where: { id: req.params.id, workspaceId },
        select: { name: true, description: true, trigger: true, graph: true },
      })
      if (!flow) return reply.notFound('Flow não encontrado')
      const trigger = { ...((flow.trigger as Record<string, unknown> | null) ?? {}) }
      delete (trigger as any).webhookToken // não exporta segredo do webhook
      return {
        _type: 'aiwa.flow',
        _version: 1,
        exportedAt: new Date().toISOString(),
        name: flow.name,
        description: flow.description,
        trigger,
        graph: flow.graph,
      }
    },
  )

  // ── Importar fluxo ───────────────────────────────────────────────────────
  app.post(
    '/flows/import',
    {
      onRequest: [app.authenticate, requirePerm('flows.manage')],
      schema: {
        body: z.object({
          _type: z.string().optional(),
          _version: z.number().optional(),
          exportedAt: z.string().optional(),
          name: z.string().min(1).max(120).optional(),
          description: z.string().nullable().optional(),
          trigger: triggerSchema.optional(),
          graph: graphSchema,
        }).passthrough(),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const body = req.body
      const warnings = validateGraph(body.graph)
      warnings.push(...(await scanGraphRefs(body.graph, body.trigger, workspaceId)))

      const trigger = { ...((body.trigger as Record<string, unknown> | undefined) ?? { type: 'manual' }) }
      delete (trigger as any).webhookToken // segredo não vem no import

      const flow = await prisma.flow.create({
        data: {
          workspaceId,
          name: body.name?.trim() || 'Fluxo importado',
          description: body.description ?? null,
          trigger: trigger as any,
          graph: body.graph as any,
          isActive: false, // importado sempre inativo — revise e publique
          priority: 100,
        },
      })
      await eventBus.audit(workspaceId, 'flow.imported', {
        actorUserId: req.user.sub, targetType: 'flow', targetId: flow.id,
        payload: { name: flow.name, warnings: warnings.length },
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
      // Trigger/isActive podem ter mudado → re-sincroniza o cron
      void syncFlowCron(flow.id)
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
      void removeFlowCron(req.params.id)
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

  // ── Trigger por webhook externo (público, validado por token) ────────────
  // Inicia o fluxo numa conversa existente, com o payload do webhook em
  // ctx.vars.webhook. Conversa é obrigatória pois o engine é conversation-bound.
  app.post(
    '/flows/:id/webhook/:token',
    {
      schema: {
        params: z.object({ id: z.string(), token: z.string() }),
        body: z.object({ conversationId: z.string() }).passthrough(),
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const flow = await prisma.flow.findFirst({
        where: { id: req.params.id, isActive: true },
        select: { id: true, workspaceId: true, trigger: true },
      })
      if (!flow) return reply.notFound('Flow ativo não encontrado')
      const trigger = (flow.trigger as { type?: string; webhookToken?: string } | null) ?? {}
      if (trigger.type !== 'webhook' || !trigger.webhookToken || trigger.webhookToken !== req.params.token) {
        return reply.unauthorized('Token de webhook inválido')
      }
      const { conversationId, ...payload } = req.body as Record<string, unknown> & { conversationId: string }
      const conv = await prisma.conversation.findFirst({
        where: { id: conversationId, workspaceId: flow.workspaceId },
        select: { id: true },
      })
      if (!conv) return reply.notFound('Conversa não encontrada')

      const exec = await startFlowForConversation({
        workspaceId: flow.workspaceId,
        flowId: flow.id,
        conversationId: conv.id,
        initialContext: { vars: { webhook: payload } },
      })
      return reply.code(202).send({ ok: true, executionId: exec?.id ?? null })
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

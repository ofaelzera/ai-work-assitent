import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { runAgent } from './agents/runAgent.js'
import { runAgentWithTools } from './agents/runAgentWithTools.js'
import { REPLY_SUGGESTER_SYSTEM_PROMPT } from './agents/prompts.js'
import { listAvailableTools } from './tools/registry.js'
import { invalidateAgentCache } from '../../workers/agentDispatcher.worker.js'
import { syncAgentCron, removeAgentCron } from './cronSync.js'

const triggerSchema = z.object({
  type: z.enum(['message.received', 'conversation.created', 'cron', 'manual']),
  filters: z.object({
    channelId: z.string().optional(),
    channelType: z.string().optional(),
    conversationExternalId: z.string().optional(),
    bodyContains: z.string().optional(),
    direction: z.enum(['INBOUND', 'OUTBOUND']).optional(),
  }).optional(),
  schedule: z.string().optional(),
}).nullable()

export const aiRoutes: FastifyPluginAsyncZod = async (app) => {

  // ── Agentes ────────────────────────────────────────────────────────────────

  app.get('/ai/agents', { onRequest: [app.authenticate] }, async (req) => {
    return prisma.agent.findMany({
      where: { workspaceId: req.user.workspaceId },
      orderBy: { createdAt: 'asc' },
    })
  })

  app.post(
    '/ai/agents',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          name: z.string().min(1),
          description: z.string().optional(),
          systemPrompt: z.string().min(1),
          model: z.string().default('gemini-2.5-flash'),
          provider: z.string().default('gemini'),
          temperature: z.number().min(0).max(2).default(0.4),
          trigger: triggerSchema.optional(),
          enabledTools: z.array(z.string()).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { trigger, enabledTools, ...rest } = req.body
      const agent = await prisma.agent.create({
        data: {
          workspaceId: req.user.workspaceId,
          ...rest,
          ...(trigger !== undefined && { trigger: trigger as any }),
          ...(enabledTools && { enabledTools: enabledTools as any }),
        },
      })
      invalidateAgentCache(req.user.workspaceId)
      void syncAgentCron(agent.id)
      return reply.code(201).send(agent)
    },
  )

  app.patch(
    '/ai/agents/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().optional(),
          description: z.string().optional(),
          systemPrompt: z.string().optional(),
          model: z.string().optional(),
          provider: z.string().optional(),
          temperature: z.number().min(0).max(2).optional(),
          isActive: z.boolean().optional(),
          trigger: triggerSchema.optional(),
          enabledTools: z.array(z.string()).optional(),
        }),
      },
    },
    async (req) => {
      const { trigger, enabledTools, ...rest } = req.body
      const updated = await prisma.agent.update({
        where: { id: req.params.id, workspaceId: req.user.workspaceId },
        data: {
          ...rest,
          ...(trigger !== undefined && { trigger: trigger as any }),
          ...(enabledTools !== undefined && { enabledTools: enabledTools as any }),
        },
      })
      invalidateAgentCache(req.user.workspaceId)
      void syncAgentCron(req.params.id)
      return updated
    },
  )

  app.delete('/ai/agents/:id', { onRequest: [app.authenticate] }, async (req: any, reply) => {
    await prisma.agent.delete({ where: { id: req.params.id, workspaceId: req.user.workspaceId } })
    invalidateAgentCache(req.user.workspaceId)
    void removeAgentCron(req.params.id)
    return reply.code(204).send()
  })

  // ── Listagem de tools disponíveis (pra UI montar o multi-select) ──────────
  app.get('/ai/tools', { onRequest: [app.authenticate] }, async () => {
    return listAvailableTools()
  })

  // ── Prompts ────────────────────────────────────────────────────────────────

  app.get('/ai/prompts', { onRequest: [app.authenticate] }, async (req) => {
    return prisma.prompt.findMany({
      where: { workspaceId: req.user.workspaceId },
      orderBy: { createdAt: 'asc' },
    })
  })

  app.post(
    '/ai/prompts',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          name: z.string().min(1),
          body: z.string().min(1),
          tags: z.array(z.string()).optional(),
        }),
      },
    },
    async (req, reply) => {
      const prompt = await prisma.prompt.create({
        data: {
          workspaceId: req.user.workspaceId,
          name: req.body.name,
          body: req.body.body,
          tags: req.body.tags ?? [],
        },
      })
      return reply.code(201).send(prompt)
    },
  )

  app.patch(
    '/ai/prompts/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().optional(),
          body: z.string().optional(),
          tags: z.array(z.string()).optional(),
          version: z.number().int().optional(),
        }),
      },
    },
    async (req) => {
      return prisma.prompt.update({
        where: { id: req.params.id, workspaceId: req.user.workspaceId },
        data: req.body,
      })
    },
  )

  app.delete('/ai/prompts/:id', { onRequest: [app.authenticate] }, async (req: any, reply) => {
    await prisma.prompt.delete({ where: { id: req.params.id, workspaceId: req.user.workspaceId } })
    return reply.code(204).send()
  })

  // ── Execução manual de agente (debug) ─────────────────────────────────────

  app.post(
    '/ai/agents/:id/run',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          input: z.string().min(1),
          dryRun: z.boolean().optional(),
        }),
      },
    },
    async (req) => {
      // Se o agente tem tools habilitados, usa o runtime v2 — senão, fallback simples
      const agent = await prisma.agent.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId },
        select: { enabledTools: true },
      })
      const hasTools = Array.isArray(agent?.enabledTools) && (agent!.enabledTools as string[]).length > 0

      if (hasTools) {
        return runAgentWithTools({
          agentId: req.params.id,
          workspaceId: req.user.workspaceId,
          userMessage: req.body.input,
          dryRun: req.body.dryRun ?? false,
        })
      }

      return runAgent({
        agentId: req.params.id,
        workspaceId: req.user.workspaceId,
        messages: [{ role: 'user', content: req.body.input }],
      })
    },
  )

  // ── Logs de execução ───────────────────────────────────────────────────────

  app.get(
    '/ai/logs',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          agentId: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          limit: z.coerce.number().default(50),
          cursor: z.string().optional(),
        }),
      },
    },
    async (req) => {
      const { workspaceId } = req.user
      const { agentId, from, to, limit, cursor } = req.query

      const logs = await prisma.aIExecutionLog.findMany({
        where: {
          workspaceId,
          ...(agentId && { agentId }),
          ...(from && { createdAt: { gte: new Date(from) } }),
          ...(to && { createdAt: { lte: new Date(to) } }),
          ...(cursor && { createdAt: { lt: new Date(cursor) } }),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: { agent: { select: { id: true, name: true } } },
      })

      const nextCursor = logs.length === limit
        ? logs[logs.length - 1].createdAt.toISOString()
        : null

      return { logs, nextCursor }
    },
  )

  // ── Sugestão de resposta ───────────────────────────────────────────────────

  app.post(
    '/conversations/:id/suggest-reply',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req) => {
      const { workspaceId } = req.user
      const { id } = req.params

      // Busca últimas mensagens da conversa para contexto
      const messages = await prisma.message.findMany({
        where: { conversationId: id, workspaceId },
        orderBy: { sentAt: 'desc' },
        take: 20,
        select: { body: true, direction: true },
      })

      const historyText = messages
        .reverse()
        .map(m => `[${m.direction === 'INBOUND' ? 'Cliente' : 'Agente'}]: ${m.body}`)
        .join('\n')

      // Agente suggester configurado no workspace, ou usa defaults
      const agent = await prisma.agent.findFirst({
        where: {
          workspaceId,
          isActive: true,
          OR: [
            { name: { contains: 'reply' } },
            { name: { contains: 'sugest' } },
            { name: { contains: 'Sugest' } },
          ],
        },
      })

      const result = await runAgent({
        agentId: agent?.id,
        workspaceId,
        systemPrompt: agent ? undefined : REPLY_SUGGESTER_SYSTEM_PROMPT,
        model: agent?.model ?? 'gemini-2.5-flash',
        provider: agent?.provider ?? 'gemini',
        messages: [{ role: 'user', content: historyText }],
        responseFormat: 'json',
      })

      const parsed = result.parsed as { suggestions: ({ label: string; text: string } | string)[] } | undefined
      // Normaliza: suporte a formato antigo ["string"] e novo [{ label, text }]
      const suggestions = (parsed?.suggestions ?? []).map((s, i) =>
        typeof s === 'string'
          ? { label: `Opção ${i + 1}`, text: s }
          : s
      )
      return { suggestions }
    },
  )
}

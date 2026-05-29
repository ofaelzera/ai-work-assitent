import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { runAgent } from './agents/runAgent.js'
import { runAgentWithTools } from './agents/runAgentWithTools.js'
import { REPLY_SUGGESTER_SYSTEM_PROMPT } from './agents/prompts.js'
import { listAvailableTools } from './tools/registry.js'
import { invalidateAgentCache } from '../../workers/agentDispatcher.worker.js'
import { syncAgentCron, removeAgentCron } from './cronSync.js'
import { encrypt } from '../../lib/crypto.js'
import {
  getProvider,
  getProviderConfig,
  getDefaultModel,
  invalidateProviderConfigCache,
  AI_PROVIDERS,
} from './providers/index.js'

/** Mostra só os últimos 4 chars da key (ex: "••••••••abcd"). */
function maskKey(key: string | null): string | null {
  if (!key) return null
  if (key.length <= 4) return '••••'
  return '••••••••' + key.slice(-4)
}

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
      schema: { 
        params: z.object({ id: z.string() }),
        body: z.object({ draft: z.string().optional() }).optional(),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const { id } = req.params
      const { draft } = req.body ?? {}

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

      // Agente de sugestão escolhido em Configurações → IA (aiSuggestReplyAgentId).
      // Se não houver nenhum configurado/ativo, cai no modelo padrão (getDefaultModel).
      const ws = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { settings: true },
      })
      const suggestAgentId = (ws?.settings as Record<string, unknown> | null)?.aiSuggestReplyAgentId as string | undefined
      const agent = suggestAgentId
        ? await prisma.agent.findFirst({ where: { id: suggestAgentId, workspaceId, isActive: true } })
        : null

      let promptContent = historyText
      let systemPrompt = agent ? undefined : REPLY_SUGGESTER_SYSTEM_PROMPT

      // Se o usuário já digitou algo, a instrução muda para "melhorar" o texto
      if (draft && draft.trim().length > 0) {
        promptContent = `Histórico da conversa:\n${historyText}\n\nO atendente escreveu o seguinte rascunho de resposta:\n"${draft}"\n\nPor favor, melhore este rascunho. Corrija erros gramaticais, melhore o tom (mais profissional ou empático, conforme o contexto) e forneça 2 a 3 variações aprimoradas desse texto.`
        if (!agent) {
          systemPrompt = `Você é um assistente de IA focado em melhorar textos. Você receberá o histórico de uma conversa e um rascunho de resposta. Seu objetivo é melhorar o rascunho do atendente para enviar ao cliente. Responda SEMPRE com um JSON contendo uma propriedade "suggestions" que é um array de objetos com "label" (ex: "Mais Formal", "Mais Amigável", "Direto") e "text" (a resposta melhorada).`
        } else {
          // Garante que mesmo com agente customizado, ele receba a instrução explícita
          promptContent += `\n\nResponda em formato JSON com um array 'suggestions' com objetos contendo 'label' e 'text'.`
        }
      }

      // Sem agente dedicado: usa o modelo padrão cadastrado no painel
      const fallback = agent ? null : await getDefaultModel()
      if (!agent && !fallback) {
        return reply.badRequest('Nenhum modelo de IA cadastrado. Configure em Admin → Provedores de IA.')
      }

      const result = await runAgent({
        agentId: agent?.id,
        workspaceId,
        systemPrompt: systemPrompt,
        model: agent?.model ?? fallback!.modelId,
        provider: agent?.provider ?? fallback!.provider,
        messages: [{ role: 'user', content: promptContent }],
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

  // ── Config de provedores de IA (Admin) ───────────────────────────────────────

  // GET /ai/providers/config — lista os 4 providers com key mascarada
  app.get(
    '/ai/providers/config',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      if (req.user.role !== 'ADMIN') return reply.unauthorized('Apenas admins')

      const rows = await prisma.aiProviderConfig.findMany()
      const byProvider = new Map(rows.map((r) => [r.provider, r]))

      const models = await prisma.aiModel.findMany({ orderBy: { createdAt: 'asc' } })
      const modelsByProvider = new Map<string, typeof models>()
      for (const m of models) {
        const arr = modelsByProvider.get(m.provider) ?? []
        arr.push(m)
        modelsByProvider.set(m.provider, arr)
      }

      const items = await Promise.all(
        AI_PROVIDERS.map(async (name) => {
          const row = byProvider.get(name)
          const cfg = await getProviderConfig(name)
          return {
            provider: name,
            enabled: row?.enabled ?? cfg.enabled,
            extra: (row?.extra as Record<string, unknown>) ?? {},
            hasKey: !!cfg.apiKey,
            maskedKey: maskKey(cfg.apiKey),
            models: modelsByProvider.get(name) ?? [],
          }
        }),
      )

      return { providers: items }
    },
  )

  // PUT /ai/providers/config/:provider — upsert; cifra a key se enviada
  app.put(
    '/ai/providers/config/:provider',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ provider: z.enum(AI_PROVIDERS) }),
        body: z.object({
          enabled: z.boolean().optional(),
          // key nova em texto puro; omita ou envie null pra manter a atual
          apiKey: z.string().nullish(),
          extra: z.record(z.any()).optional(),
        }),
      },
    },
    async (req, reply) => {
      if (req.user.role !== 'ADMIN') return reply.unauthorized('Apenas admins')

      const { provider } = req.params
      const { enabled, apiKey, extra } = req.body

      const data: Record<string, unknown> = {}
      if (enabled !== undefined) data.enabled = enabled
      if (extra !== undefined) data.extra = extra

      // Só re-cifra se uma key não-vazia foi enviada (evita sobrescrever com máscara/vazio)
      if (apiKey) {
        const { ciphertext, iv, authTag } = encrypt(apiKey)
        data.apiKeyCiphertext = ciphertext
        data.apiKeyIv = iv
        data.apiKeyAuthTag = authTag
      }

      await prisma.aiProviderConfig.upsert({
        where: { provider },
        update: data,
        create: { provider, enabled: enabled ?? false, ...data },
      })

      invalidateProviderConfigCache()

      const cfg = await getProviderConfig(provider)
      return {
        provider,
        enabled: cfg.enabled,
        hasKey: !!cfg.apiKey,
        maskedKey: maskKey(cfg.apiKey),
      }
    },
  )

  // ── Modelos cadastrados por provedor (Admin) ─────────────────────────────────

  const modelBodySchema = z.object({
    provider: z.enum(AI_PROVIDERS),
    modelId: z.string().min(1),
    label: z.string().min(1),
    description: z.string().nullish(),
    temperature: z.number().min(0).max(2).nullish(),
    maxTokens: z.number().int().positive().nullish(),
    enabled: z.boolean().optional(),
    isDefault: z.boolean().optional(),
  })

  // GET /ai/models — lista todos os modelos cadastrados (p/ dropdowns)
  app.get('/ai/models', { onRequest: [app.authenticate] }, async () => {
    return prisma.aiModel.findMany({ orderBy: [{ provider: 'asc' }, { createdAt: 'asc' }] })
  })

  // POST /ai/models — cadastra modelo sob um provedor
  app.post(
    '/ai/models',
    { onRequest: [app.authenticate], schema: { body: modelBodySchema } },
    async (req, reply) => {
      if (req.user.role !== 'ADMIN') return reply.unauthorized('Apenas admins')

      const { isDefault, ...rest } = req.body
      // Garante que exista a config do provedor (FK)
      await prisma.aiProviderConfig.upsert({
        where: { provider: rest.provider },
        update: {},
        create: { provider: rest.provider, enabled: false },
      })

      // Só pode haver um modelo padrão no sistema
      if (isDefault) await prisma.aiModel.updateMany({ data: { isDefault: false } })

      const created = await prisma.aiModel.create({
        data: { ...rest, isDefault: isDefault ?? false },
      })
      return reply.code(201).send(created)
    },
  )

  // PATCH /ai/models/:id — edita modelo
  app.patch(
    '/ai/models/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: modelBodySchema.partial().omit({ provider: true }),
      },
    },
    async (req, reply) => {
      if (req.user.role !== 'ADMIN') return reply.unauthorized('Apenas admins')

      const { isDefault, ...rest } = req.body
      if (isDefault) await prisma.aiModel.updateMany({ data: { isDefault: false } })

      const updated = await prisma.aiModel.update({
        where: { id: req.params.id },
        data: { ...rest, ...(isDefault !== undefined && { isDefault }) },
      })
      return updated
    },
  )

  // DELETE /ai/models/:id
  app.delete(
    '/ai/models/:id',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      if (req.user.role !== 'ADMIN') return reply.unauthorized('Apenas admins')
      await prisma.aiModel.delete({ where: { id: req.params.id } })
      return reply.code(204).send()
    },
  )

  // POST /ai/models/:id/test — valida o modelo cadastrado com chamada curta
  app.post(
    '/ai/models/:id/test',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      if (req.user.role !== 'ADMIN') return reply.unauthorized('Apenas admins')

      const model = await prisma.aiModel.findUnique({ where: { id: req.params.id } })
      if (!model) return reply.notFound('Modelo não encontrado')

      try {
        const ai = await getProvider(model.provider)
        const out = await ai.generate({
          model: model.modelId,
          messages: [{ role: 'user', content: 'Responda apenas: ok' }],
          temperature: 0,
          maxTokens: 16,
          maxRetries: 0, // teste deve falhar rápido (ex: 429) em vez de travar minutos
        })
        return { ok: true, model: model.modelId, sample: out.text.slice(0, 200) }
      } catch (err) {
        let msg = err instanceof Error ? err.message : String(err)
        if (/\b429\b/.test(msg)) {
          msg = 'Rate-limited (429) — comum em modelos :free. Tente de novo ou use um modelo pago.'
        }
        return reply.send({ ok: false, model: model.modelId, error: msg })
      }
    },
  )
}

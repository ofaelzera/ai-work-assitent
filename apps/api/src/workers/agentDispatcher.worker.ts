import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'
import { logger } from '../lib/logger.js'
import { isTriggerConfig, matchesTrigger, type TriggerEvent } from '../modules/ai/triggers.js'
import { agentRunQueue } from './agentRun.worker.js'

/**
 * Cache leve de agentes por workspace (TTL 60s) pra evitar query em todo evento.
 */
interface CachedAgents {
  agents: { id: string; trigger: unknown }[]
  expiresAt: number
}
const cache = new Map<string, CachedAgents>()
const TTL_MS = 60_000

async function getAgentsForWorkspace(workspaceId: string) {
  const now = Date.now()
  const cached = cache.get(workspaceId)
  if (cached && cached.expiresAt > now) return cached.agents

  const agents = await prisma.agent.findMany({
    where: { workspaceId, isActive: true, trigger: { not: undefined as any } },
    select: { id: true, trigger: true },
  })
  cache.set(workspaceId, { agents, expiresAt: now + TTL_MS })
  return agents
}

export function invalidateAgentCache(workspaceId?: string) {
  if (workspaceId) cache.delete(workspaceId)
  else cache.clear()
}

async function dispatch(event: TriggerEvent) {
  try {
    const agents = await getAgentsForWorkspace(event.workspaceId)
    for (const a of agents) {
      if (!isTriggerConfig(a.trigger)) continue
      if (!matchesTrigger(a.trigger, event)) continue

      const userMessage = event.body
        ?? `Evento ${event.type} disparado.`
      await agentRunQueue.add('run', {
        agentId: a.id,
        workspaceId: event.workspaceId,
        userMessage,
        triggerEvent: event,
      }, { removeOnComplete: 50, removeOnFail: 50 })
      logger.info({ agentId: a.id, trigger: event.type }, 'agentDispatcher: enfileirado')
    }
  } catch (err) {
    logger.error({ err, eventType: event.type }, 'agentDispatcher: erro ao despachar')
  }
}

/**
 * Inicia o dispatcher — assina o eventBus pra os tipos relevantes.
 * Idempotente: chamar mais de uma vez não duplica listeners.
 */
let started = false
export function startAgentDispatcher() {
  if (started) return
  started = true

  // message.received → trigger "message.received"
  eventBus.on('message.received', (e: { workspaceId: string; payload: any }) => {
    void dispatch({
      type: 'message.received',
      workspaceId: e.workspaceId,
      messageId: e.payload?.messageId,
      conversationId: e.payload?.conversationId,
      contactId: e.payload?.contactId,
      channelId: e.payload?.channelId,
      channelType: e.payload?.channelType,
      conversationExternalId: e.payload?.conversationExternalId,
      body: e.payload?.body,
      direction: e.payload?.direction ?? 'INBOUND',
      payload: e.payload,
    })
  })

  // (Outros tipos podem ser adicionados aqui — conversation.created, etc.)
  logger.info('agentDispatcher: iniciado')
}

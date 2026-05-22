import { Worker, Queue } from 'bullmq'
import { redis } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import { runAgentWithTools } from '../modules/ai/agents/runAgentWithTools.js'
import type { TriggerEvent } from '../modules/ai/triggers.js'

export interface AgentRunJobData {
  agentId: string
  workspaceId: string
  userMessage: string
  triggerEvent?: TriggerEvent
}

export const agentRunQueue = new Queue<AgentRunJobData>('agentRun', { connection: redis })

export function startAgentRunWorker() {
  const worker = new Worker<AgentRunJobData>(
    'agentRun',
    async (job) => {
      const { agentId, workspaceId, userMessage, triggerEvent } = job.data
      logger.info({ agentId, workspaceId, trigger: triggerEvent?.type }, 'agentRun: executando agente')
      const result = await runAgentWithTools({
        agentId,
        workspaceId,
        userMessage,
        triggerEvent,
      })
      logger.info(
        { agentId, toolCalls: result.toolInvocations.length, tokens: result.tokensIn + result.tokensOut },
        'agentRun: concluído',
      )
      return { ok: true, toolCalls: result.toolInvocations.length, logId: result.logId }
    },
    {
      connection: redis,
      concurrency: 4,
    },
  )

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'agentRun: falha')
  })

  return worker
}

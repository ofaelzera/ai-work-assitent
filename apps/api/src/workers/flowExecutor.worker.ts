/**
 * flowExecutor.worker.ts
 *
 * Worker BullMQ que executa flows de forma assíncrona. Disparado por:
 *  - ingestWhatsapp/ingestMeta quando route.flowId vem preenchido (nova conv com flow)
 *  - mensagem do cliente chega numa conv com FlowExecution.status='WAITING_INPUT'
 *  - chamada manual via /flows/:id/run (front-end)
 *
 * Idempotência: a engine grava trace em FlowExecution; reprocessar o mesmo job
 * não duplica side-effects relevantes (a maioria das ações é mutação de estado
 * com guard via status).
 */
import { Worker, Queue } from 'bullmq'
import { redis } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import {
  startFlowForConversation,
  handleIncomingFlowMessage,
  runFlow,
  runFlowDetached,
} from '../modules/flows/flow.executor.js'

export type FlowJobData =
  | {
      kind: 'start'
      workspaceId: string
      flowId: string
      conversationId: string
    }
  | {
      kind: 'message'
      conversationId: string
      messageBody: string
    }
  | {
      kind: 'resume'
      flowExecutionId: string
    }
  | {
      kind: 'cron'
      workspaceId: string
      flowId: string
    }

export const flowQueue = new Queue<FlowJobData>('flowExecutor', { connection: redis })

export function startFlowExecutorWorker() {
  const worker = new Worker<FlowJobData>(
    'flowExecutor',
    async (job) => {
      const data = job.data
      if (data.kind === 'start') {
        await startFlowForConversation({
          workspaceId: data.workspaceId,
          flowId: data.flowId,
          conversationId: data.conversationId,
        })
        return { ok: true }
      }
      if (data.kind === 'message') {
        const handled = await handleIncomingFlowMessage({
          conversationId: data.conversationId,
          messageBody: data.messageBody,
        })
        return { handled }
      }
      if (data.kind === 'resume') {
        await runFlow({ flowExecutionId: data.flowExecutionId })
        return { ok: true }
      }
      if (data.kind === 'cron') {
        await runFlowDetached({ workspaceId: data.workspaceId, flowId: data.flowId })
        return { ok: true }
      }
      return { ok: false, reason: 'unknown kind' }
    },
    { connection: redis, concurrency: 4 },
  )

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message, data: job?.data }, 'flowExecutor: falha')
  })

  return worker
}

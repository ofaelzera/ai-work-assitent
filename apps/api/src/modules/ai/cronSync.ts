/**
 * Sincroniza jobs cron (BullMQ repeatable) com agentes cujo trigger.type === 'cron'.
 *
 * Cada agente cron vira um repeatable job no nome `cron-agent:<agentId>`.
 * Ao salvar/editar/deletar um agente, chamar `syncAgentCron(agentId)` pra
 * recriar/remover o job conforme o estado atual no banco.
 *
 * No boot, `syncAllCronAgents()` faz uma varredura completa pra alinhar com o DB.
 */

import { prisma } from '../../lib/prisma.js'
import { logger } from '../../lib/logger.js'
import { agentRunQueue } from '../../workers/agentRun.worker.js'
import { isTriggerConfig } from './triggers.js'

function jobIdFor(agentId: string): string {
  return `cron-agent:${agentId}`
}

/**
 * Remove qualquer job repetível pertencente a este agente.
 */
async function removeCronJob(agentId: string): Promise<void> {
  const repeatables = await agentRunQueue.getRepeatableJobs()
  const target = repeatables.filter((r) => r.id === jobIdFor(agentId))
  for (const r of target) {
    await agentRunQueue.removeRepeatableByKey(r.key)
  }
}

/**
 * Resync de um agente específico. Idempotente.
 *  - Se agente não existe, está inativo, ou não tem trigger cron válido → remove
 *  - Se tem trigger.type='cron' + schedule → adiciona repeatable
 */
export async function syncAgentCron(agentId: string): Promise<void> {
  await removeCronJob(agentId)

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, workspaceId: true, isActive: true, trigger: true },
  })
  if (!agent || !agent.isActive) return
  if (!isTriggerConfig(agent.trigger)) return
  if (agent.trigger.type !== 'cron' || !agent.trigger.schedule) return

  try {
    await agentRunQueue.add(
      'cron-fire',
      {
        agentId: agent.id,
        workspaceId: agent.workspaceId,
        userMessage: `Execução agendada (cron: ${agent.trigger.schedule})`,
        triggerEvent: {
          type: 'cron',
          workspaceId: agent.workspaceId,
        },
      },
      {
        jobId: jobIdFor(agent.id),
        repeat: { pattern: agent.trigger.schedule },
        removeOnComplete: 20,
        removeOnFail: 20,
      },
    )
    logger.info({ agentId, schedule: agent.trigger.schedule }, 'cron registrado pra agente')
  } catch (err) {
    logger.error({ err, agentId, schedule: agent.trigger.schedule }, 'falha ao registrar cron de agente')
  }
}

/**
 * Sweep completo: alinha todos os repeatable jobs com o estado do DB.
 * Chamar no boot do worker.
 */
export async function syncAllCronAgents(): Promise<void> {
  // 1) Remove repeatables órfãos (de agentes deletados ou que mudaram de trigger)
  const repeatables = await agentRunQueue.getRepeatableJobs()
  const agentRepeatables = repeatables.filter((r) => r.id?.startsWith('cron-agent:'))

  const activeIds = new Set(
    (await prisma.agent.findMany({
      where: { isActive: true },
      select: { id: true, trigger: true },
    }))
      .filter((a) => isTriggerConfig(a.trigger) && a.trigger.type === 'cron' && a.trigger.schedule)
      .map((a) => a.id),
  )

  let removed = 0
  for (const r of agentRepeatables) {
    const id = r.id!.replace('cron-agent:', '')
    if (!activeIds.has(id)) {
      await agentRunQueue.removeRepeatableByKey(r.key)
      removed++
    }
  }

  // 2) Garante que todos os agentes cron ativos estão registrados (re-add é idempotente via jobId)
  let added = 0
  for (const id of activeIds) {
    await syncAgentCron(id)
    added++
  }

  logger.info({ removed, active: added }, 'syncAllCronAgents: alinhamento concluído')
}

/**
 * Chamada quando agente é deletado.
 */
export async function removeAgentCron(agentId: string): Promise<void> {
  await removeCronJob(agentId)
}

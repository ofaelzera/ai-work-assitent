/**
 * Sincroniza jobs cron (BullMQ repeatable) com fluxos cujo trigger.type === 'cron'.
 *
 * Espelha cronSync.ts (agentes), mas para fluxos: cada fluxo cron vira um
 * repeatable job `cron-flow:<flowId>` na flowQueue, com job kind 'cron'.
 * O worker chama runFlowDetached (execução proativa, sem conversa).
 *
 * Ao salvar/editar/deletar um fluxo, chamar syncFlowCron(flowId).
 * No boot, syncAllCronFlows() alinha tudo com o DB.
 */
import { prisma } from '../../lib/prisma.js'
import { logger } from '../../lib/logger.js'
import { flowQueue } from '../../workers/flowExecutor.worker.js'
import type { FlowTrigger } from './flow.types.js'

function jobIdFor(flowId: string): string {
  return `cron-flow:${flowId}`
}

/** Fuso padrão dos crons de fluxo — o cron é interpretado neste fuso. */
const DEFAULT_TZ = 'America/Sao_Paulo'

function cronTrigger(trigger: unknown): { schedule: string; tz: string } | null {
  const t = trigger as (FlowTrigger & { scheduleTz?: string }) | null
  if (!t || t.type !== 'cron' || !t.schedule || typeof t.schedule !== 'string') return null
  return { schedule: t.schedule, tz: t.scheduleTz || DEFAULT_TZ }
}

async function removeCronJob(flowId: string): Promise<void> {
  const repeatables = await flowQueue.getRepeatableJobs()
  for (const r of repeatables.filter((x) => x.id === jobIdFor(flowId))) {
    await flowQueue.removeRepeatableByKey(r.key)
  }
}

/**
 * Resync de um fluxo. Idempotente.
 *  - Sem fluxo / inativo / sem trigger cron válido → remove o repeatable.
 *  - trigger.type='cron' + schedule → (re)registra o repeatable.
 */
export async function syncFlowCron(flowId: string): Promise<void> {
  await removeCronJob(flowId)

  const flow = await prisma.flow.findUnique({
    where: { id: flowId },
    select: { id: true, workspaceId: true, isActive: true, trigger: true },
  })
  if (!flow || !flow.isActive) return
  const cron = cronTrigger(flow.trigger)
  if (!cron) return

  try {
    await flowQueue.add(
      'cron',
      { kind: 'cron', workspaceId: flow.workspaceId, flowId: flow.id },
      {
        jobId: jobIdFor(flow.id),
        repeat: { pattern: cron.schedule, tz: cron.tz },
        removeOnComplete: 20,
        removeOnFail: 20,
      },
    )
    logger.info({ flowId, schedule: cron.schedule, tz: cron.tz }, 'cron registrado pra flow')
  } catch (err) {
    logger.error({ err, flowId, schedule: cron.schedule }, 'falha ao registrar cron de flow')
  }
}

/** Sweep completo no boot: alinha os repeatable jobs com o estado do DB. */
export async function syncAllCronFlows(): Promise<void> {
  const repeatables = await flowQueue.getRepeatableJobs()
  const flowRepeatables = repeatables.filter((r) => r.id?.startsWith('cron-flow:'))

  const activeIds = new Set(
    (await prisma.flow.findMany({
      where: { isActive: true },
      select: { id: true, trigger: true },
    }))
      .filter((f) => cronTrigger(f.trigger))
      .map((f) => f.id),
  )

  let removed = 0
  for (const r of flowRepeatables) {
    const id = r.id!.replace('cron-flow:', '')
    if (!activeIds.has(id)) {
      await flowQueue.removeRepeatableByKey(r.key)
      removed++
    }
  }

  for (const id of activeIds) await syncFlowCron(id)

  logger.info({ removed, active: activeIds.size }, 'syncAllCronFlows: alinhamento concluído')
}

/** Chamada quando o fluxo é deletado. */
export async function removeFlowCron(flowId: string): Promise<void> {
  await removeCronJob(flowId)
}

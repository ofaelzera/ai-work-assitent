import { startIngestWhatsappWorker } from './ingestWhatsapp.worker.js'
import { startClassifyWorker } from './classifyMessage.worker.js'
import { startDailyDigestWorker } from './dailyDigest.worker.js'
import { startAgentRunWorker } from './agentRun.worker.js'
import { startAgentDispatcher } from './agentDispatcher.worker.js'
import { syncAllCronAgents } from '../modules/ai/cronSync.js'
import { logger } from '../lib/logger.js'

export function startWorkers() {
  const workers = [
    startIngestWhatsappWorker(),
    startClassifyWorker(),
    startDailyDigestWorker(),
    startAgentRunWorker(),
  ]
  // Dispatcher é só listeners no eventBus, não retorna Worker
  startAgentDispatcher()

  // Sweep inicial dos crons de agente (alinha BullMQ com o DB)
  syncAllCronAgents().catch((err) => logger.error({ err }, 'syncAllCronAgents inicial falhou'))

  logger.info(`${workers.length} worker(s) iniciado(s) + dispatcher + cron sweep`)
  return workers
}

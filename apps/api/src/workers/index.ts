import { startIngestWhatsappWorker } from './ingestWhatsapp.worker.js'
import { startIngestMetaWorker } from './ingestMeta.worker.js'
import { startDailyDigestWorker } from './dailyDigest.worker.js'
import { startAgentRunWorker } from './agentRun.worker.js'
import { startAgentDispatcher } from './agentDispatcher.worker.js'
import { startCalendarSyncWorker } from './calendarSync.worker.js'
import { startFlowExecutorWorker } from './flowExecutor.worker.js'
import { startWhatsappGroupsSyncWorker } from './whatsappGroupsSync.worker.js'
import { startCommDispatchWorker } from './commDispatch.worker.js'
import { startCampaignDispatchWorker } from './campaignDispatch.worker.js'
import { startCommScheduler } from './commScheduler.js'
import { startRemindersScheduler } from './remindersScheduler.js'
import { syncAllCronAgents } from '../modules/ai/cronSync.js'
import { syncAllCronFlows } from '../modules/flows/flowCronSync.js'
import { logger } from '../lib/logger.js'

export function startWorkers() {
  const workers = [
    startIngestWhatsappWorker(),
    startIngestMetaWorker(),
    startDailyDigestWorker(),
    startAgentRunWorker(),
    startCalendarSyncWorker(),
    startFlowExecutorWorker(),
    startWhatsappGroupsSyncWorker(),
    startCommDispatchWorker(),
    startCampaignDispatchWorker(),
  ]
  // Dispatcher é só listeners no eventBus, não retorna Worker
  startAgentDispatcher()

  // Scheduler da Central de Comunicação (varredura de agendados a cada 30s)
  startCommScheduler()

  // Scheduler de lembretes/notificações (Task/Card/CalendarEvent a cada 60s)
  startRemindersScheduler()

  // Sweep inicial dos crons de agente (alinha BullMQ com o DB)
  syncAllCronAgents().catch((err) => logger.error({ err }, 'syncAllCronAgents inicial falhou'))
  // Sweep inicial dos crons de fluxo
  syncAllCronFlows().catch((err) => logger.error({ err }, 'syncAllCronFlows inicial falhou'))

  logger.info(`${workers.length} worker(s) iniciado(s) + dispatcher + scheduler + cron sweep`)
  return workers
}

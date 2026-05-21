import { startIngestWhatsappWorker } from './ingestWhatsapp.worker.js'
import { startClassifyWorker } from './classifyMessage.worker.js'
import { startDailyDigestWorker } from './dailyDigest.worker.js'
import { logger } from '../lib/logger.js'

export function startWorkers() {
  const workers = [
    startIngestWhatsappWorker(),
    startClassifyWorker(),
    startDailyDigestWorker(),
  ]
  logger.info(`${workers.length} worker(s) iniciado(s)`)
  return workers
}

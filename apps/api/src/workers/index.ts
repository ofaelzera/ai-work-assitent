import { startIngestWhatsappWorker } from './ingestWhatsapp.worker.js'
import { logger } from '../lib/logger.js'

export function startWorkers() {
  const workers = [startIngestWhatsappWorker()]
  logger.info(`${workers.length} worker(s) iniciado(s)`)
  return workers
}

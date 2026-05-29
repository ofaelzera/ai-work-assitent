import { Worker, Queue } from 'bullmq'
import { redis } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import { syncAllChannelsGroups } from '../modules/channels/groups-sync.service.js'

export const whatsappGroupsSyncQueue = new Queue('whatsappGroupsSync', { connection: redis })

export function startWhatsappGroupsSyncWorker() {
  const worker = new Worker(
    'whatsappGroupsSync',
    async (job) => {
      logger.info({ jobId: job.id }, 'WhatsApp groups sync: iniciando')
      const { synced, failed } = await syncAllChannelsGroups()
      logger.info({ jobId: job.id, synced, failed }, 'WhatsApp groups sync: concluído')
      return { synced, failed }
    },
    { connection: redis, concurrency: 1 },
  )

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'whatsappGroupsSync worker falhou')
  })

  // Job repetível a cada 10 min
  whatsappGroupsSyncQueue
    .add('sync', {}, {
      repeat: { pattern: '*/10 * * * *' },
      jobId: 'whatsapp-groups-sync-repeat',
    })
    .catch((err) => logger.error({ err }, 'Falha ao registrar job repetível de groups sync'))

  // Roda uma vez logo na subida pra deixar tudo aquecido
  whatsappGroupsSyncQueue
    .add('sync-initial', {}, { jobId: `wa-groups-sync-initial-${Date.now()}` })
    .catch((err) => logger.error({ err }, 'Falha ao agendar sync inicial de grupos'))

  logger.info('WhatsApp groups sync worker iniciado (cron: */10 * * * *, + sync inicial)')
  return worker
}

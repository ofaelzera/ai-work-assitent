import { Worker } from 'bullmq'
import { redis } from '../lib/redis.js'
import { prisma } from '../lib/prisma.js'
import { logger } from '../lib/logger.js'
import { resolveChannel } from '../modules/communication/comm-channel.resolver.js'
import { sendThroughChannel } from '../modules/communication/comm-sender.service.js'

/**
 * Despacha uma mensagem individual da Central de Comunicação.
 * Cada job carrega `{ messageId }`. Resolve o canal físico, envia (reusando os
 * clientes Evolution/Meta/SMTP) e atualiza status + logs. Retry/backoff é feito
 * pelo BullMQ (attempts/backoff definidos ao enfileirar em communication.service).
 */
export function startCommDispatchWorker() {
  const worker = new Worker(
    'commDispatch',
    async (job) => {
      const { messageId } = job.data as { messageId: string }

      const msg = await prisma.commMessage.findUnique({ where: { id: messageId } })
      if (!msg) {
        logger.warn({ messageId }, 'commDispatch: mensagem não encontrada — ignorada')
        return
      }

      // Anexos: os da própria mensagem + os de nível de campanha (compartilhados
      // por todos os destinatários, sem duplicar arquivo no storage).
      const attOr: any[] = [{ commMessageId: msg.id }]
      if (msg.campaignId) attOr.push({ campaignId: msg.campaignId, commMessageId: null })
      const attachments = await prisma.commAttachment.findMany({
        where: { OR: attOr },
        select: { filename: true, mimeType: true, storageKey: true },
      })
      // Cancelada entre o enqueue e o processamento → pula
      if (msg.status === 'CANCELED' || msg.status === 'SENT') {
        return
      }

      const attemptNo = msg.attempts + 1
      await prisma.commMessage.update({
        where: { id: msg.id },
        data: { status: 'PROCESSING', attempts: attemptNo },
      })
      await prisma.commMessageLog.create({
        data: { commMessageId: msg.id, type: 'PROCESSING', detail: { attempt: attemptNo } },
      })

      try {
        const channel = await resolveChannel(msg.workspaceId, msg.channelType, msg.channelId)
        const result = await sendThroughChannel(channel, {
          to: msg.to,
          subject: msg.subject,
          body: msg.body,
          attachments,
        })

        await prisma.commMessage.update({
          where: { id: msg.id },
          data: { status: 'SENT', sentAt: new Date(), externalId: result.externalId ?? null, channelId: channel.id, lastError: null },
        })
        await prisma.commMessageLog.create({
          data: { commMessageId: msg.id, type: 'PROVIDER_OK', detail: { externalId: result.externalId, channelId: channel.id } },
        })
        logger.info({ messageId: msg.id, externalId: result.externalId }, 'CommMessage enviada')
      } catch (err: any) {
        const errMsg = err?.message ?? String(err)
        const willRetry = attemptNo < (job.opts.attempts ?? 1)

        await prisma.commMessage.update({
          where: { id: msg.id },
          data: { status: willRetry ? 'PENDING' : 'FAILED', lastError: errMsg },
        })
        await prisma.commMessageLog.create({
          data: {
            commMessageId: msg.id,
            type: willRetry ? 'RETRY' : 'PROVIDER_ERROR',
            detail: { attempt: attemptNo, error: errMsg },
          },
        })
        logger.warn({ messageId: msg.id, attempt: attemptNo, willRetry, err: errMsg }, 'Falha ao enviar CommMessage')
        // Relança pro BullMQ acionar o backoff/retry
        throw err
      }
    },
    { connection: redis, concurrency: 10 },
  )

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err?.message }, 'commDispatch worker falhou')
  })

  return worker
}

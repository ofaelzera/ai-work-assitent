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

      // Read-after-write: o job costuma chegar antes da linha estar visível pra
      // esta conexão (lag de réplica). Tenta algumas vezes em ~2s antes de devolver
      // ao BullMQ — resolve o lag pequeno (caso comum) quase na hora.
      let msg = await prisma.commMessage.findUnique({ where: { id: messageId } })
      for (let i = 0; i < 4 && !msg; i++) {
        await new Promise((r) => setTimeout(r, 500))
        msg = await prisma.commMessage.findUnique({ where: { id: messageId } })
      }
      if (!msg) {
        // Ainda não visível após ~2s: lança pra re-tentar com backoff (próximo
        // retry quase sempre já enxerga). Se a mensagem realmente não existir,
        // esgota as tentativas e o job é descartado.
        logger.warn({ messageId, attempt: job.attemptsMade + 1 }, 'commDispatch: mensagem ainda não visível (lag de leitura) — vai re-tentar')
        throw new Error(`Mensagem ${messageId} não encontrada (retry por lag de leitura)`)
      }

      // Anexos: os da própria mensagem + os de nível de campanha (compartilhados
      // por todos os destinatários, sem duplicar arquivo no storage).
      const attOr: any[] = [{ commMessageId: msg.id }]
      if (msg.campaignId) attOr.push({ campaignId: msg.campaignId, commMessageId: null })
      const attachments = await prisma.commAttachment.findMany({
        where: { OR: attOr },
        select: { filename: true, mimeType: true, storageKey: true },
      })
      // Claim atômico: só processa se ainda estiver PENDING. Isso impede envio em
      // dobro quando a mesma mensagem é re-enfileirada (retry manual ou rede de
      // segurança do scheduler) — apenas UM job ganha o claim.
      const attemptNo = msg.attempts + 1
      const claim = await prisma.commMessage.updateMany({
        where: { id: msg.id, status: 'PENDING' },
        data: { status: 'PROCESSING', attempts: attemptNo },
      })
      if (claim.count === 0) {
        logger.info({ messageId, status: msg.status }, 'commDispatch: mensagem já processada/cancelada por outro job — pulando')
        return
      }
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

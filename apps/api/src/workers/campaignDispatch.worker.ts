import { Worker } from 'bullmq'
import { redis } from '../lib/redis.js'
import { prisma } from '../lib/prisma.js'
import { logger } from '../lib/logger.js'
import { enqueueMessage } from '../modules/communication/communication.service.js'

/**
 * Dispara uma campanha: materializa os destinatários da lista de transmissão em
 * `CommMessage` individuais (cada uma com seu próprio retry no commDispatch) e as
 * enfileira. Só usa Contatos cadastrados, com telefone (WhatsApp) ou email (Email).
 */
export function startCampaignDispatchWorker() {
  const worker = new Worker(
    'campaignDispatch',
    async (job) => {
      const { campaignId } = job.data as { campaignId: string }

      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        include: {
          list: {
            include: {
              members: { include: { contact: { select: { id: true, name: true, phone: true, email: true } } } },
            },
          },
        },
      })
      if (!campaign) {
        logger.warn({ campaignId }, 'campaignDispatch: campanha não encontrada')
        return
      }
      if (campaign.status === 'CANCELED') {
        logger.info({ campaignId }, 'campaignDispatch: campanha cancelada — ignorada')
        return
      }

      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: 'RUNNING', startedAt: campaign.startedAt ?? new Date() },
      })

      const members = campaign.list?.members ?? []
      let queued = 0
      let skipped = 0

      for (const member of members) {
        const contact = member.contact
        const to = campaign.channelType === 'WHATSAPP' ? contact.phone : contact.email
        if (!to) {
          skipped++
          continue
        }
        try {
          await enqueueMessage({
            workspaceId: campaign.workspaceId,
            channelType: campaign.channelType,
            channelId: campaign.channelId,
            to,
            subject: campaign.subject,
            body: campaign.body,
            contactId: contact.id,
            campaignId: campaign.id,
            source: 'campaign',
          })
          queued++
        } catch (err: any) {
          logger.warn({ campaignId, contactId: contact.id, err: err?.message }, 'Falha ao enfileirar destinatário')
          skipped++
        }
      }

      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      })

      logger.info({ campaignId, queued, skipped }, 'Campanha disparada (destinatários enfileirados)')
    },
    { connection: redis, concurrency: 2 },
  )

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err?.message }, 'campaignDispatch worker falhou')
  })

  return worker
}

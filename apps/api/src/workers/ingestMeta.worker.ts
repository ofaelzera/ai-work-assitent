import { Worker } from 'bullmq'
import { classifyQueue } from './classifyMessage.worker.js'
import { redis } from '../lib/redis.js'
import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'
import { logger } from '../lib/logger.js'
import { routeNewConversation } from '../modules/messages/routing.service.js'
import { sendSystemMessage } from '../lib/systemMessages.js'

export function startIngestMetaWorker() {
  const worker = new Worker(
    'ingestMeta',
    async (job) => {
      const { channelId, workspaceId, message, contactProfile } = job.data as {
        channelId: string
        workspaceId: string
        message: any
        contactProfile: any
      }

      const channelRecord = await prisma.channel.findUnique({
        where: { id: channelId },
        select: { settings: true },
      })
      const channelSettings = (channelRecord?.settings as Record<string, unknown> | null) ?? {}

      const remoteJid = message.from // número do cliente ex: "5511999999999"
      const externalMsgId = message.id
      const sentAt = new Date((parseInt(message.timestamp) || Date.now() / 1000) * 1000)
      const pushName = contactProfile?.name || null

      let body = '[mídia]'
      if (message.type === 'text') {
        body = message.text?.body || ''
      }

      // Upsert contact
      let contact = await prisma.contact.findFirst({
        where: { workspaceId, phone: remoteJid, mergedIntoId: null },
      })

      if (!contact) {
        contact = await prisma.contact.create({
          data: {
            workspaceId,
            phone: remoteJid,
            phoneType: 'PN',
            name: pushName,
          },
        })
      } else if (pushName && !contact.name) {
        contact = await prisma.contact.update({
          where: { id: contact.id },
          data: { name: pushName },
        }) as typeof contact
      }

      // Buscar conversa
      let conversation = await prisma.conversation.findFirst({
        where: {
          channelId,
          externalId: remoteJid,
          workspaceId,
          status: { in: ['OPEN', 'WAITING'] },
        },
        orderBy: { createdAt: 'desc' },
      })

      if (!conversation && externalMsgId) {
        const alreadyExists = await prisma.message.findFirst({
          where: {
            externalId: externalMsgId,
            conversation: { channelId, externalId: remoteJid, workspaceId },
          },
          select: { id: true },
        })
        if (alreadyExists) return
      }

      if (!conversation) {
        const route = await routeNewConversation({
          workspaceId,
          channelId,
          contactId: contact.id,
          autoAssign: false,
        })

        conversation = await prisma.conversation.create({
          data: {
            workspaceId,
            channelId,
            contactId: contact.id,
            externalId: remoteJid,
            lastMessageAt: sentAt,
            status: 'OPEN',
            unreadCount: 1,
            lastQueuedAt: sentAt,
            ...(route.eligibleAssigneeIds && { eligibleAssigneeIds: route.eligibleAssigneeIds }),
          },
        }).catch(async () => {
          const existing = await prisma.conversation.findFirst({
            where: { channelId, externalId: remoteJid, workspaceId, status: { in: ['OPEN', 'WAITING'] } },
            orderBy: { createdAt: 'asc' },
          })
          if (!existing) throw new Error(`Falha ao criar/encontrar conversa para ${remoteJid}`)
          return existing
        })

        const welcomeTpl = typeof channelSettings.welcomeMessage === 'string'
          ? channelSettings.welcomeMessage
          : ''
        if (welcomeTpl) {
          void sendSystemMessage({
            conversationId: conversation.id,
            template: welcomeTpl,
            kind: 'channel-welcome',
            userId: null,
          })
        }
      } else {
        const updateData: Record<string, unknown> = conversation.archived
          ? {}
          : { lastMessageAt: sentAt, unreadCount: { increment: 1 } }

        conversation = await prisma.conversation.update({
          where: { id: conversation.id },
          data: updateData,
        })
      }

      const existing = await prisma.message.findUnique({
        where: { conversationId_externalId: { conversationId: conversation.id, externalId: externalMsgId } },
      })
      if (existing) return

      const msg = await prisma.message.create({
        data: {
          workspaceId,
          conversationId: conversation.id,
          direction: 'INBOUND',
          externalId: externalMsgId,
          fromContactId: contact.id,
          body,
          sentAt,
        },
      })

      await eventBus.emitAndPersist(workspaceId, 'message.received', {
        messageId: msg.id,
        conversationId: conversation.id,
        contactId: contact.id,
        channelId,
        channelType: 'META_WHATSAPP',
        conversationExternalId: conversation.externalId,
        body: msg.body ?? '',
        direction: 'INBOUND',
      })

      if (!conversation.archived) {
        await classifyQueue.add(
          'classify',
          { messageId: msg.id, conversationId: conversation.id, workspaceId },
          { jobId: `classify-${msg.id}`, removeOnComplete: 50, removeOnFail: 20 },
        )
      }
    },
    { connection: redis, concurrency: 5 },
  )

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'ingestMeta worker falhou')
  })

  return worker
}

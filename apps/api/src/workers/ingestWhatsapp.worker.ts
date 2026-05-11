import { Worker } from 'bullmq'
import { redis } from '../lib/redis.js'
import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'
import { logger } from '../lib/logger.js'

function extractText(msg: any): string {
  return (
    msg?.message?.conversation ??
    msg?.message?.extendedTextMessage?.text ??
    msg?.message?.imageMessage?.caption ??
    msg?.message?.videoMessage?.caption ??
    msg?.message?.documentMessage?.title ??
    msg?.message?.audioMessage?.mimetype ??
    '[mídia]'
  )
}

function normalizePhone(jid: string): string {
  // Remove @s.whatsapp.net ou @g.us
  return jid.split('@')[0]
}

export function startIngestWhatsappWorker() {
  const worker = new Worker(
    'ingestWhatsapp',
    async (job) => {
      const { channelId, workspaceId, message } = job.data as {
        channelId: string
        workspaceId: string
        message: any
      }

      const remoteJid: string = message.key?.remoteJid ?? ''
      const externalMsgId: string = message.key?.id ?? ''
      const isGroup = remoteJid.endsWith('@g.us')
      const phoneOrGroup = normalizePhone(remoteJid)
      const senderJid: string = isGroup ? (message.key?.participant ?? '') : remoteJid
      const senderPhone = normalizePhone(senderJid)
      const pushName: string = message.pushName ?? ''
      const body = extractText(message)
      const sentAt = new Date((message.messageTimestamp ?? Date.now() / 1000) * 1000)

      // Upsert contact (pelo número do remetente)
      let contact = await prisma.contact.findFirst({
        where: { workspaceId, phone: senderPhone },
      })
      if (!contact) {
        contact = await prisma.contact.create({
          data: { workspaceId, phone: senderPhone, name: pushName || senderPhone },
        })
      } else if (pushName && !contact.name) {
        contact = await prisma.contact.update({
          where: { id: contact.id },
          data: { name: pushName },
        })
      }

      // Upsert conversation (pelo remoteJid — unique por canal)
      let conversation = await prisma.conversation.findUnique({
        where: { channelId_externalId: { channelId, externalId: remoteJid } },
      })
      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            workspaceId,
            channelId,
            contactId: isGroup ? null : contact.id,
            externalId: remoteJid,
            isGroup,
            subject: isGroup ? pushName : null,
            lastMessageAt: sentAt,
            unreadCount: 1,
          },
        })
      } else {
        conversation = await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            lastMessageAt: sentAt,
            unreadCount: { increment: 1 },
          },
        })
      }

      // Upsert message (idempotente pelo externalId)
      const existing = await prisma.message.findUnique({
        where: { conversationId_externalId: { conversationId: conversation.id, externalId: externalMsgId } },
      })
      if (existing) return // duplicado

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

      logger.info({ messageId: msg.id, conversationId: conversation.id }, 'Mensagem WA ingerida')

      await eventBus.emitAndPersist(workspaceId, 'message.received', {
        messageId: msg.id,
        conversationId: conversation.id,
        channelId,
        type: 'WHATSAPP',
      })
    },
    { connection: redis, concurrency: 5 },
  )

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'ingestWhatsapp worker falhou')
  })

  return worker
}

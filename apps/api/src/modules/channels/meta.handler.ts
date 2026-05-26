import { Queue } from 'bullmq'
import { redis } from '../../lib/redis.js'
import { prisma } from '../../lib/prisma.js'
import { logger } from '../../lib/logger.js'
import { decryptJson } from '../../lib/crypto.js'
import { eventBus } from '../../lib/eventBus.js'

export const ingestMetaQueue = new Queue('ingestMeta', { connection: redis })

const metaInstanceCache = new Map<string, { channelId: string; workspaceId: string }>()

export async function resolveMetaChannel(
  phoneNumberId: string,
): Promise<{ channelId: string; workspaceId: string } | null> {
  if (metaInstanceCache.has(phoneNumberId)) return metaInstanceCache.get(phoneNumberId)!

  const channels = await prisma.channel.findMany({
    where: { type: 'META_WHATSAPP', deletedAt: null },
  })

  for (const ch of channels) {
    try {
      const cfg = ch.config as { ciphertext: string; iv: string; authTag: string }
      const decrypted = decryptJson<{ phoneNumberId: string }>(
        Buffer.from(cfg.ciphertext, 'base64'),
        Buffer.from(cfg.iv, 'base64'),
        Buffer.from(cfg.authTag, 'base64'),
      )
      if (decrypted.phoneNumberId === phoneNumberId) {
        const entry = { channelId: ch.id, workspaceId: ch.workspaceId }
        metaInstanceCache.set(phoneNumberId, entry)
        setTimeout(() => metaInstanceCache.delete(phoneNumberId), 5 * 60 * 1000)
        return entry
      }
    } catch {
      // ignora config inválido
    }
  }

  logger.warn({ phoneNumberId }, 'Evento Meta de número não mapeado')
  return null
}

export async function handleMetaEvent(body: any): Promise<void> {
  if (body.object !== 'whatsapp_business_account') return

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value
      if (!value) continue

      const phoneNumberId = value.metadata?.phone_number_id
      if (!phoneNumberId) continue

      const resolved = await resolveMetaChannel(phoneNumberId)
      if (!resolved) continue
      const { channelId, workspaceId } = resolved

      // Tratar Mensagens Recebidas
      if (value.messages && Array.isArray(value.messages)) {
        const contacts = value.contacts ?? []
        for (const msg of value.messages) {
          const senderContact = contacts.find((c: any) => c.wa_id === msg.from)
          await ingestMetaQueue.add(
            'ingest',
            { channelId, workspaceId, message: msg, contactProfile: senderContact?.profile },
            { jobId: `meta-${msg.id}`, removeOnComplete: 100, removeOnFail: 50 },
          )
        }
      }

      // Tratar Atualizações de Status (Delivery/Read)
      if (value.statuses && Array.isArray(value.statuses)) {
        for (const statusObj of value.statuses) {
          const externalId = statusObj.id
          const rawStatus = statusObj.status // sent, delivered, read, failed

          const statusMap: Record<string, string> = {
            'sent': 'SENT',
            'delivered': 'DELIVERED',
            'read': 'READ',
            'failed': 'ERROR',
          }
          const deliveryStatus = statusMap[rawStatus]
          if (!deliveryStatus) continue

          const updated = await prisma.message.findFirst({
            where: { externalId },
            select: { id: true, conversationId: true, workspaceId: true },
          })

          if (updated) {
            await prisma.message.update({
              where: { id: updated.id },
              data: { deliveryStatus },
            })

            await eventBus.emitAndPersist(updated.workspaceId, 'message.delivery', {
              messageId: updated.id,
              externalId,
              conversationId: updated.conversationId,
              deliveryStatus,
            })
          }
        }
      }
    }
  }
}

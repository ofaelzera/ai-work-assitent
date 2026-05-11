import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { Queue } from 'bullmq'
import { redis } from '../../lib/redis.js'
import { prisma } from '../../lib/prisma.js'
import { logger } from '../../lib/logger.js'
import { decryptJson } from '../../lib/crypto.js'

export const ingestQueue = new Queue('ingestWhatsapp', { connection: redis })

export const webhookRoutes: FastifyPluginAsyncZod = async (app) => {
  // Evolution API envia tudo neste endpoint
  app.post('/webhooks/whatsapp', async (req, reply) => {
    const body = req.body as any

    // Ignorar eventos que não são mensagens
    const event = body?.event as string
    if (!event) return reply.code(200).send({ ok: true })

    if (event === 'messages.upsert') {
      const instanceName = body.instance as string
      if (!instanceName) return reply.code(200).send({ ok: true })

      // Localizar o channel pelo instanceName no config cifrado
      const channels = await prisma.channel.findMany({
        where: { type: 'WHATSAPP', deletedAt: null },
      })

      let channelId: string | null = null
      let workspaceId: string | null = null

      for (const ch of channels) {
        try {
          const cfg = ch.config as { ciphertext: string; iv: string; authTag: string }
          const decrypted = decryptJson<{ instanceName: string }>(
            Buffer.from(cfg.ciphertext, 'base64'),
            Buffer.from(cfg.iv, 'base64'),
            Buffer.from(cfg.authTag, 'base64'),
          )
          if (decrypted.instanceName === instanceName) {
            channelId = ch.id
            workspaceId = ch.workspaceId
            break
          }
        } catch {
          // canal com config inválido — ignorar
        }
      }

      if (!channelId || !workspaceId) {
        logger.warn({ instanceName }, 'Webhook de instância não mapeada')
        return reply.code(200).send({ ok: true })
      }

      const messages = Array.isArray(body.data) ? body.data : [body.data]

      for (const msg of messages) {
        if (!msg?.key?.id) continue
        // Ignorar mensagens enviadas por nós mesmos pelo WA Web
        if (msg.key?.fromMe) continue

        await ingestQueue.add(
          'ingest',
          { channelId, workspaceId, message: msg },
          { jobId: `wa-${msg.key.id}`, removeOnComplete: 100, removeOnFail: 50 },
        )
      }
    }

    if (event === 'connection.update') {
      const instanceName = body.instance as string
      const state = body.data?.state as string

      if (instanceName && state) {
        const channels = await prisma.channel.findMany({ where: { type: 'WHATSAPP', deletedAt: null } })
        for (const ch of channels) {
          try {
            const cfg = ch.config as { ciphertext: string; iv: string; authTag: string }
            const decrypted = decryptJson<{ instanceName: string }>(
              Buffer.from(cfg.ciphertext, 'base64'),
              Buffer.from(cfg.iv, 'base64'),
              Buffer.from(cfg.authTag, 'base64'),
            )
            if (decrypted.instanceName === instanceName) {
              const status = state === 'open' ? 'CONNECTED' : 'DISCONNECTED'
              await prisma.channel.update({ where: { id: ch.id }, data: { status } })
              break
            }
          } catch {
            // ignorar
          }
        }
      }
    }

    return reply.code(200).send({ ok: true })
  })
}

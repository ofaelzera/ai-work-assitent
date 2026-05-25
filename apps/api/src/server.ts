import { buildApp } from './app.js'
import { env } from './config/env.js'
import { prisma } from './lib/prisma.js'
import { redis } from './lib/redis.js'
import { logger } from './lib/logger.js'
import { startWorkers } from './workers/index.js'
import { startEvolutionSocket, stopEvolutionSocket } from './modules/channels/evolution.socket.js'
import { seedDefaultServerFromEnv } from './modules/evolution-servers/evolution-servers.service.js'
import { startImapPollers, stopAllImapPollers } from './modules/channels/imap.poller.js'
import { syncWhatsAppChannel } from './modules/channels/sync.service.js'

/**
 * Sincroniza todos os canais WhatsApp conectados ao subir o backend.
 * Roda em background (fire-and-forget) para não atrasar o boot.
 * Reconcilia contatos, conversas e mensagens recentes com o estado atual do WA.
 */
async function syncAllWhatsAppChannelsOnBoot(): Promise<void> {
  try {
    const channels = await prisma.channel.findMany({
      where: { type: 'WHATSAPP', status: 'CONNECTED', deletedAt: null },
      select: { id: true, label: true },
    })

    if (channels.length === 0) return

    logger.info({ count: channels.length }, '🔄 Iniciando sync de canais WhatsApp...')

    // Roda em série para não sobrecarregar a Evolution API
    for (const ch of channels) {
      try {
        const result = await syncWhatsAppChannel(ch.id)
        logger.info({ channelId: ch.id, label: ch.label, ...result }, '✅ Sync WhatsApp concluído')
      } catch (err: any) {
        // Erro em um canal não interrompe os outros
        logger.warn({ channelId: ch.id, err: err?.message }, '⚠️ Sync WhatsApp falhou para o canal')
      }
    }
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'Sync de boot ignorado (DB pode não estar pronto)')
  }
}

async function main() {
  const app = await buildApp()

  try {
    startWorkers()
    await app.listen({ port: env.PORT, host: env.HOST })
    console.log(`🚀 API rodando em http://${env.HOST}:${env.PORT}`)

    // Migra servidor do .env para o banco se ainda não houver nenhum cadastrado
    await seedDefaultServerFromEnv()

    // Conecta ao Evolution via Socket.IO (um socket por servidor cadastrado)
    startEvolutionSocket()

    // Polling IMAP desativado temporariamente (módulo de email em pausa)
    // await startImapPollers()

    // Sincroniza WhatsApp em background — não bloqueia o boot
    // Aguarda 3s para a conexão Socket.IO estabilizar antes de sincronizar
    setTimeout(() => void syncAllWhatsAppChannelsOnBoot(), 3_000)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }

  const graceful = async () => {
    stopEvolutionSocket()
    stopAllImapPollers()
    await app.close()
    await prisma.$disconnect()
    if (redis.status === 'ready') await redis.quit()
    process.exit(0)
  }

  process.on('SIGTERM', graceful)
  process.on('SIGINT', graceful)
}

main()

/**
 * imap.poller.ts
 *
 * Polling automático de canais IMAP_SMTP.
 * Ao iniciar, consulta todos os canais ativos e dispara um loop por canal.
 * Ao criar/deletar um canal, o caller pode chamar addChannel() / removeChannel().
 *
 * Intervalo padrão: 60 s (ajustável via env IMAP_POLL_INTERVAL_MS).
 */
import { prisma } from '../../lib/prisma.js'
import { logger } from '../../lib/logger.js'
import { syncImapChannel } from './sync.service.js'

const INTERVAL_MS = Number(process.env.IMAP_POLL_INTERVAL_MS ?? 60_000)

// Map de channelId → intervalId
const pollers = new Map<string, ReturnType<typeof setInterval>>()

async function poll(channelId: string): Promise<void> {
  try {
    const result = await syncImapChannel(channelId)
    if (result.messages > 0) {
      logger.info({ channelId, ...result }, 'IMAP poll: novas mensagens')
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    // Erros de conexão IMAP são comuns (timeout, TLS) — log warn, não error
    logger.warn({ channelId, err: msg }, 'IMAP poll: erro ao sincronizar')
  }
}

export function addImapPoller(channelId: string): void {
  if (pollers.has(channelId)) return  // já tem poller ativo

  logger.info({ channelId, intervalMs: INTERVAL_MS }, 'Iniciando IMAP poller')

  // Executa imediatamente na primeira vez, depois a cada INTERVAL_MS
  void poll(channelId)
  const id = setInterval(() => void poll(channelId), INTERVAL_MS)
  pollers.set(channelId, id)
}

export function removeImapPoller(channelId: string): void {
  const id = pollers.get(channelId)
  if (id != null) {
    clearInterval(id)
    pollers.delete(channelId)
    logger.info({ channelId }, 'IMAP poller encerrado')
  }
}

export async function startImapPollers(): Promise<void> {
  const channels = await prisma.channel.findMany({
    where: { type: 'IMAP_SMTP', deletedAt: null, status: 'CONNECTED' },
    select: { id: true },
  })

  if (channels.length === 0) {
    logger.info('Nenhum canal IMAP ativo — pollers não iniciados')
    return
  }

  logger.info({ count: channels.length }, 'Iniciando IMAP pollers')
  for (const ch of channels) {
    addImapPoller(ch.id)
  }
}

export function stopAllImapPollers(): void {
  for (const [channelId, id] of pollers.entries()) {
    clearInterval(id)
    logger.info({ channelId }, 'IMAP poller encerrado')
  }
  pollers.clear()
}

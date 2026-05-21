/**
 * evolution.socket.ts
 *
 * Conecta ao servidor Socket.IO embutido na Evolution API e processa
 * eventos em tempo real — elimina a necessidade de webhook público
 * (ideal para desenvolvimento em localhost).
 *
 * A Evolution API emite eventos Socket.IO no mesmo formato do webhook:
 *   { event: 'messages.upsert' | 'messages.update' | 'connection.update', instance, data }
 *
 * Referência: https://doc.evolution-api.com/v2/pt/integrations/websocket
 */
import { io, Socket } from 'socket.io-client'
import { env } from '../../config/env.js'
import { logger } from '../../lib/logger.js'
import { handleEvolutionEvent } from './evolution.handler.js'

const EVOLUTION_EVENTS = [
  'messages.upsert',
  'messages.update',
  'messages.delete',
  'presence.update',
  'connection.update',
  'send.message',
  'qrcode.updated',
  'contacts.upsert',
  'contacts.update',
] as const

let socket: Socket | null = null

export function startEvolutionSocket(): void {
  if (socket?.connected) {
    logger.info('Evolution Socket.IO já conectado')
    return
  }

  const serverUrl = env.EVOLUTION_SERVER_URL
  if (!serverUrl) {
    logger.warn('EVOLUTION_SERVER_URL não definida — Socket.IO desabilitado')
    return
  }

  logger.info({ serverUrl }, 'Conectando ao Evolution via Socket.IO…')

  socket = io(serverUrl, {
    transports: ['websocket'],
    // Evolution v2 aceita apikey em múltiplos locais dependendo da versão
    auth: { apikey: env.EVOLUTION_API_KEY },
    extraHeaders: { apikey: env.EVOLUTION_API_KEY ?? '' },
    query: { apikey: env.EVOLUTION_API_KEY },
    reconnection: true,
    reconnectionDelay: 3000,
    reconnectionDelayMax: 30_000,
    reconnectionAttempts: Infinity,
  })

  socket.on('connect', () => {
    logger.info({ socketId: socket?.id }, 'Evolution Socket.IO conectado ✓')
    // Algumas versões do Evolution exigem um evento de subscrição após conectar
    socket?.emit('subscribe', { jwt: env.EVOLUTION_API_KEY })
    logger.info('Enviado subscribe ao Evolution Socket.IO')
  })

  socket.on('disconnect', (reason) => {
    logger.warn({ reason }, 'Evolution Socket.IO desconectado')
  })

  socket.on('connect_error', (err) => {
    logger.error({ message: err.message }, 'Evolution Socket.IO erro de conexão')
  })

  // Eventos que nos interessam — mesmo payload do webhook
  for (const event of EVOLUTION_EVENTS) {
    socket.on(event, (data: unknown) => {
      // Normaliza para o formato padrão { event, instance, data }
      const normalized =
        data && typeof data === 'object' && 'event' in data
          ? data                                  // Evolution v2: já vem completo
          : { event, instance: (data as any)?.instance, data }  // fallback

      handleEvolutionEvent(normalized).catch((err) =>
        logger.error({ err, event }, 'Erro ao processar evento Evolution (socket)'),
      )
    })
  }
}

export function stopEvolutionSocket(): void {
  if (socket) {
    socket.disconnect()
    socket = null
    logger.info('Evolution Socket.IO encerrado')
  }
}

/**
 * evolution.socket.ts
 *
 * Gerencia múltiplas conexões Socket.IO com servidores Evolution API.
 * Cada servidor cadastrado no banco recebe sua própria conexão.
 * Fallback: se nenhum servidor estiver no DB, usa EVOLUTION_SERVER_URL do .env.
 *
 * Referência: https://doc.evolution-api.com/v2/pt/integrations/websocket
 */
import { io, Socket } from 'socket.io-client'
import { env } from '../../config/env.js'
import { logger } from '../../lib/logger.js'
import { handleEvolutionEvent } from './evolution.handler.js'
import { prisma } from '../../lib/prisma.js'
import { getServerCredentials } from '../evolution-servers/evolution-servers.service.js'

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

// serverId → Socket (null = env-based fallback, usa key 'env')
const sockets = new Map<string, Socket>()

function buildSocket(serverUrl: string, apiKey: string, serverId: string): Socket {
  const socket = io(serverUrl, {
    transports: ['websocket'],
    auth: { apikey: apiKey },
    extraHeaders: { apikey: apiKey },
    query: { apikey: apiKey },
    reconnection: true,
    reconnectionDelay: 3000,
    reconnectionDelayMax: 30_000,
    reconnectionAttempts: Infinity,
  })

  socket.on('connect', () => {
    logger.info({ serverId, socketId: socket.id }, 'Evolution Socket.IO conectado ✓')
    socket.emit('subscribe', { jwt: apiKey })
  })

  socket.on('disconnect', (reason) => {
    logger.warn({ serverId, reason }, 'Evolution Socket.IO desconectado')
  })

  socket.on('connect_error', (err) => {
    logger.error({ serverId, message: err.message }, 'Evolution Socket.IO erro de conexão')
  })

  for (const event of EVOLUTION_EVENTS) {
    socket.on(event, (data: unknown) => {
      const normalized =
        data && typeof data === 'object' && 'event' in data
          ? data
          : { event, instance: (data as any)?.instance, data }

      handleEvolutionEvent(normalized).catch((err) =>
        logger.error({ err, event, serverId }, 'Erro ao processar evento Evolution (socket)'),
      )
    })
  }

  return socket
}

export async function startEvolutionSockets(): Promise<void> {
  // Busca todos os servidores ativos no banco
  const servers = await prisma.evolutionServer.findMany({
    where: { status: 'ACTIVE' },
  }).catch(() => [])

  if (servers.length === 0) {
    // Fallback: conecta ao servidor do .env se configurado
    const serverUrl = env.EVOLUTION_SERVER_URL
    if (!serverUrl) {
      logger.warn('Nenhum servidor Evolution configurado — Socket.IO desabilitado')
      return
    }
    logger.info({ serverUrl }, 'Sem servidores no DB — conectando via env vars…')
    const socket = buildSocket(serverUrl, env.EVOLUTION_API_KEY ?? '', 'env')
    sockets.set('env', socket)
    return
  }

  logger.info({ count: servers.length }, 'Iniciando conexões Socket.IO com servidores Evolution…')

  for (const server of servers) {
    try {
      const creds = await getServerCredentials(server.id)
      addServerSocket(creds)
    } catch (err: any) {
      logger.warn({ serverId: server.id, err: err?.message }, 'Falha ao criar socket para servidor Evolution')
    }
  }
}

export function addServerSocket(server: { id: string; url: string; apiKey: string }): void {
  if (sockets.has(server.id)) {
    logger.info({ serverId: server.id }, 'Socket já existe — ignorando')
    return
  }
  logger.info({ serverId: server.id, url: server.url }, 'Adicionando socket para servidor Evolution')
  const socket = buildSocket(server.url, server.apiKey, server.id)
  sockets.set(server.id, socket)
}

export function removeServerSocket(serverId: string): void {
  const socket = sockets.get(serverId)
  if (socket) {
    socket.disconnect()
    sockets.delete(serverId)
    logger.info({ serverId }, 'Socket Evolution removido')
  }
}

export function stopEvolutionSockets(): void {
  for (const [serverId, socket] of sockets.entries()) {
    socket.disconnect()
    logger.info({ serverId }, 'Evolution Socket.IO encerrado')
  }
  sockets.clear()
}

// Mantém aliases para compatibilidade com server.ts
export const startEvolutionSocket = startEvolutionSockets
export const stopEvolutionSocket = stopEvolutionSockets

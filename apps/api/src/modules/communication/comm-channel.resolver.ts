import type { CommChannel } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

/**
 * Mapeia o canal lógico da Central (WHATSAPP/EMAIL) para os tipos de `Channel`
 * concretos que podem atendê-lo. Base do Strategy Pattern: para adicionar SMS/
 * Telegram/Push, basta estender este mapa e o `comm-sender.service`.
 */
const CHANNEL_TYPE_MAP: Record<CommChannel, string[]> = {
  WHATSAPP: ['WHATSAPP', 'META_WHATSAPP'],
  EMAIL: ['IMAP_SMTP', 'GMAIL'],
}

export interface ResolvedChannel {
  id: string
  type: string // ChannelType concreto
}

/**
 * Resolve qual `Channel` físico usar para um envio.
 * - Se `channelId` for informado, valida que pertence ao workspace e ao tipo lógico.
 * - Senão, escolhe o primeiro canal CONECTADO do tipo lógico no workspace.
 * Lança erro claro quando nenhum canal elegível existe.
 */
export async function resolveChannel(
  workspaceId: string,
  channelType: CommChannel,
  channelId?: string | null,
): Promise<ResolvedChannel> {
  const allowedTypes = CHANNEL_TYPE_MAP[channelType]

  if (channelId) {
    const ch = await prisma.channel.findFirst({
      where: { id: channelId, workspaceId, deletedAt: null },
      select: { id: true, type: true },
    })
    if (!ch) throw new Error('Canal não encontrado neste workspace')
    if (!allowedTypes.includes(ch.type)) {
      throw new Error(`Canal selecionado não é compatível com ${channelType}`)
    }
    return { id: ch.id, type: ch.type }
  }

  // Auto: primeiro CONECTADO do tipo lógico (preferindo CONNECTED).
  const ch = await prisma.channel.findFirst({
    where: { workspaceId, deletedAt: null, type: { in: allowedTypes as any } },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }], // CONNECTED < DISCONNECTED < ERROR (ordem alfabética)
    select: { id: true, type: true, status: true },
  })
  if (!ch) {
    throw new Error(`Nenhum canal de ${channelType} configurado no workspace`)
  }
  return { id: ch.id, type: ch.type }
}

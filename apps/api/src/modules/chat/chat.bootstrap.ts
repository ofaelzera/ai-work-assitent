import { prisma } from '../../lib/prisma.js'

/**
 * Garante que o workspace tenha 1 Channel do tipo INTERNAL (chat interno).
 * Idempotente: chamado lazy quando o módulo de chat precisa do channelId.
 *
 * Retorna o channelId do INTERNAL.
 */
export async function ensureInternalChannel(workspaceId: string): Promise<string> {
  const existing = await prisma.channel.findFirst({
    where: { workspaceId, type: 'INTERNAL', deletedAt: null },
    select: { id: true },
  })
  if (existing) return existing.id

  const created = await prisma.channel.create({
    data: {
      workspaceId,
      type: 'INTERNAL',
      label: 'Interno',
      status: 'CONNECTED',
      config: {},
    },
    select: { id: true },
  })
  return created.id
}

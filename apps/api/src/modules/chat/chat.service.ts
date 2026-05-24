import { prisma } from '../../lib/prisma.js'
import { eventBus } from '../../lib/eventBus.js'
import { ensureInternalChannel } from './chat.bootstrap.js'

/**
 * Verifica se `userId` participa ativamente da conversa interna (sem leftAt).
 * Lança HTTP 403 via Fastify quando o caller encadeia com httpErrors.
 */
export async function isParticipant(conversationId: string, userId: string): Promise<boolean> {
  const p = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { leftAt: true },
  })
  return !!(p && !p.leftAt)
}

/**
 * Encontra (ou cria) uma sala DIRECT entre 2 usuários do mesmo workspace.
 * Idempotente: se já existe, retorna a existente.
 */
export async function findOrCreateDirectRoom(
  workspaceId: string,
  creatorId: string,
  otherUserId: string,
): Promise<string> {
  // Sanidade: ambos pertencem ao workspace?
  const users = await prisma.user.findMany({
    where: { id: { in: [creatorId, otherUserId] }, workspaceId, deletedAt: null },
    select: { id: true },
  })
  if (users.length !== 2) throw new Error('Usuários inválidos para esta conversa')

  // Procura DIRECT existente
  const existing = await prisma.conversation.findFirst({
    where: {
      workspaceId,
      type: 'DIRECT',
      participants: {
        every: { userId: { in: [creatorId, otherUserId] } },
      },
      AND: [
        { participants: { some: { userId: creatorId, leftAt: null } } },
        { participants: { some: { userId: otherUserId, leftAt: null } } },
      ],
    },
    select: { id: true, participants: { select: { userId: true } } },
  })

  if (existing && existing.participants.length === 2) {
    return existing.id
  }

  const channelId = await ensureInternalChannel(workspaceId)
  const externalId = `internal:direct:${[creatorId, otherUserId].sort().join(':')}`

  const created = await prisma.conversation.create({
    data: {
      workspaceId,
      channelId,
      externalId,
      type: 'DIRECT',
      status: 'OPEN',
      source: 'LIVE',
      lastMessageAt: new Date(),
      participants: {
        create: [
          { userId: creatorId, role: 'OWNER' },
          { userId: otherUserId, role: 'MEMBER' },
        ],
      },
    },
    select: { id: true },
  })

  return created.id
}

export async function createGroupRoom(
  workspaceId: string,
  creatorId: string,
  memberIds: string[],
  name: string,
): Promise<string> {
  const allIds = Array.from(new Set([creatorId, ...memberIds]))
  const users = await prisma.user.findMany({
    where: { id: { in: allIds }, workspaceId, deletedAt: null },
    select: { id: true },
  })
  if (users.length !== allIds.length) throw new Error('Usuários inválidos')

  const channelId = await ensureInternalChannel(workspaceId)
  const externalId = `internal:group:${Date.now()}-${creatorId}`

  const created = await prisma.conversation.create({
    data: {
      workspaceId,
      channelId,
      externalId,
      type: 'GROUP',
      name,
      isGroup: true,
      status: 'OPEN',
      source: 'LIVE',
      lastMessageAt: new Date(),
      participants: {
        create: allIds.map((id) => ({
          userId: id,
          role: id === creatorId ? ('OWNER' as const) : ('MEMBER' as const),
        })),
      },
    },
    select: { id: true },
  })

  return created.id
}

/**
 * Lista salas internas em que `userId` é participante ativo, com last message e unread count.
 */
export async function listRoomsForUser(workspaceId: string, userId: string) {
  const rooms = await prisma.conversation.findMany({
    where: {
      workspaceId,
      type: { in: ['DIRECT', 'GROUP'] },
      archived: false,
      participants: { some: { userId, leftAt: null } },
    },
    orderBy: [{ lastMessageAt: 'desc' }],
    include: {
      channel: { select: { id: true, type: true, label: true } },
      participants: {
        where: { leftAt: null },
        include: { user: { select: { id: true, name: true, email: true, settings: true } } },
      },
      messages: {
        orderBy: { sentAt: 'desc' },
        take: 1,
        select: { id: true, body: true, sentAt: true, fromUserId: true, attachments: true },
      },
    },
  })

  // Calcula unread por sala = mensagens criadas depois do lastReadAt do participante atual.
  const result = await Promise.all(
    rooms.map(async (r) => {
      const me = r.participants.find((p) => p.userId === userId)
      const unread = me?.lastReadAt
        ? await prisma.message.count({
            where: {
              conversationId: r.id,
              sentAt: { gt: me.lastReadAt },
              NOT: { fromUserId: userId },
            },
          })
        : await prisma.message.count({
            where: { conversationId: r.id, NOT: { fromUserId: userId } },
          })
      return { ...r, unreadCount: unread }
    }),
  )

  return result
}

export async function markRoomRead(
  conversationId: string,
  userId: string,
  uptoMessageId?: string,
): Promise<void> {
  const upto = uptoMessageId
    ? (await prisma.message.findUnique({ where: { id: uptoMessageId }, select: { sentAt: true } }))?.sentAt
    : new Date()
  if (!upto) return

  await prisma.conversationParticipant.update({
    where: { conversationId_userId: { conversationId, userId } },
    data: { lastReadAt: upto },
  })

  // MessageRead granular — todas msgs <= upto que ainda não estão marcadas
  const unmarked = await prisma.message.findMany({
    where: {
      conversationId,
      sentAt: { lte: upto },
      NOT: { fromUserId: userId },
      reads: { none: { userId } },
    },
    select: { id: true },
  })
  if (unmarked.length) {
    await prisma.messageRead.createMany({
      data: unmarked.map((m) => ({ messageId: m.id, userId })),
      skipDuplicates: true,
    })
  }
}

/**
 * Conta total de mensagens não lidas em todas salas do usuário (badge global).
 */
export async function countUnreadForUser(workspaceId: string, userId: string): Promise<number> {
  const parts = await prisma.conversationParticipant.findMany({
    where: { userId, leftAt: null, conversation: { workspaceId, archived: false } },
    select: { conversationId: true, lastReadAt: true },
  })
  if (!parts.length) return 0

  let total = 0
  for (const p of parts) {
    total += await prisma.message.count({
      where: {
        conversationId: p.conversationId,
        NOT: { fromUserId: userId },
        ...(p.lastReadAt && { sentAt: { gt: p.lastReadAt } }),
      },
    })
  }
  return total
}

/**
 * Emite "chat.message.new" via eventBus → SSE para todos do workspace.
 * Frontend filtra pelos próprios conversationIds.
 */
export async function broadcastNewMessage(
  workspaceId: string,
  message: { id: string; conversationId: string; fromUserId: string | null; body: string; sentAt: Date },
): Promise<void> {
  await eventBus.emitAndPersist(workspaceId, 'chat.message.new', {
    messageId: message.id,
    conversationId: message.conversationId,
    fromUserId: message.fromUserId,
    bodyPreview: message.body.slice(0, 120),
    sentAt: message.sentAt.toISOString(),
  })
}

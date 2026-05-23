import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  CreateChatRoomSchema,
  SendChatMessageSchema,
  RenameChatRoomSchema,
  AddParticipantSchema,
  MarkReadSchema,
} from '@aiwa/shared'
import { prisma } from '../../lib/prisma.js'
import { eventBus } from '../../lib/eventBus.js'
import {
  isParticipant,
  findOrCreateDirectRoom,
  createGroupRoom,
  listRoomsForUser,
  markRoomRead,
  countUnreadForUser,
  broadcastNewMessage,
} from './chat.service.js'

export const chatRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── GET /chat/rooms ────────────────────────────────────────────────────────
  app.get('/chat/rooms', { onRequest: [app.authenticate] }, async (req) => {
    const { workspaceId, sub: userId } = req.user
    const rooms = await listRoomsForUser(workspaceId, userId)
    return { rooms }
  })

  // ── GET /chat/unread-count ─────────────────────────────────────────────────
  app.get('/chat/unread-count', { onRequest: [app.authenticate] }, async (req) => {
    const { workspaceId, sub: userId } = req.user
    const total = await countUnreadForUser(workspaceId, userId)
    return { total }
  })

  // ── POST /chat/rooms ───────────────────────────────────────────────────────
  app.post(
    '/chat/rooms',
    { onRequest: [app.authenticate], schema: { body: CreateChatRoomSchema } },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const { userIds, name } = req.body

      // Remove self
      const others = userIds.filter((u) => u !== userId)
      if (others.length === 0) return reply.badRequest('Selecione ao menos um outro usuário')

      try {
        const roomId =
          others.length === 1
            ? await findOrCreateDirectRoom(workspaceId, userId, others[0])
            : await createGroupRoom(workspaceId, userId, others, name!)

        // Notifica todos participantes que houve nova sala (para atualizar lista)
        await eventBus.emitAndPersist(workspaceId, 'chat.room.updated', {
          conversationId: roomId,
        })

        const room = await prisma.conversation.findUniqueOrThrow({
          where: { id: roomId },
          include: {
            channel: { select: { id: true, type: true, label: true } },
            participants: {
              where: { leftAt: null },
              include: { user: { select: { id: true, name: true, email: true } } },
            },
          },
        })
        return reply.code(201).send(room)
      } catch (err: any) {
        return reply.badRequest(err?.message ?? 'Erro ao criar sala')
      }
    },
  )

  // ── GET /chat/rooms/:id ────────────────────────────────────────────────────
  app.get(
    '/chat/rooms/:id',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const { id } = req.params

      if (!(await isParticipant(id, userId))) return reply.forbidden()

      const room = await prisma.conversation.findFirst({
        where: { id, workspaceId, type: { in: ['DIRECT', 'GROUP'] } },
        include: {
          channel: { select: { id: true, type: true, label: true } },
          participants: {
            where: { leftAt: null },
            include: { user: { select: { id: true, name: true, email: true } } },
          },
        },
      })
      if (!room) return reply.notFound()
      return room
    },
  )

  // ── GET /chat/rooms/:id/messages ───────────────────────────────────────────
  app.get(
    '/chat/rooms/:id/messages',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        querystring: z.object({
          cursor: z.string().optional(),
          limit: z.coerce.number().min(1).max(100).default(50),
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const { id } = req.params
      const { cursor, limit } = req.query

      if (!(await isParticipant(id, userId))) return reply.forbidden()

      const messages = await prisma.message.findMany({
        where: {
          workspaceId,
          conversationId: id,
          ...(cursor && { sentAt: { lt: new Date(cursor) } }),
        },
        orderBy: { sentAt: 'desc' },
        take: limit,
        include: {
          fromUser: { select: { id: true, name: true, email: true } },
          reads: { select: { userId: true, readAt: true } },
        },
      })

      const nextCursor =
        messages.length === limit ? messages[messages.length - 1].sentAt.toISOString() : null

      // Devolve em ordem cronológica (mais antigo → mais novo) para facilitar render
      return { messages: messages.reverse(), nextCursor }
    },
  )

  // ── POST /chat/rooms/:id/messages ──────────────────────────────────────────
  app.post(
    '/chat/rooms/:id/messages',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: SendChatMessageSchema,
      },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const { id } = req.params
      const { body, attachments, replyToId } = req.body

      if (!(await isParticipant(id, userId))) return reply.forbidden()

      const message = await prisma.message.create({
        data: {
          workspaceId,
          conversationId: id,
          direction: 'OUTBOUND', // chat interno: sempre OUTBOUND, UI bifurca por fromUserId
          fromUserId: userId,
          body,
          attachments: attachments ?? undefined,
          quotedMsgId: replyToId ?? null,
          sentAt: new Date(),
        },
        include: {
          fromUser: { select: { id: true, name: true, email: true } },
        },
      })

      await prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: message.sentAt },
      })

      // Atualiza lastReadAt do remetente (ele já "leu" o que enviou)
      await prisma.conversationParticipant.update({
        where: { conversationId_userId: { conversationId: id, userId } },
        data: { lastReadAt: message.sentAt },
      })

      await broadcastNewMessage(workspaceId, message)
      await eventBus.emitAndPersist(workspaceId, 'chat.room.updated', { conversationId: id })

      return reply.code(201).send(message)
    },
  )

  // ── PATCH /chat/rooms/:id/read ─────────────────────────────────────────────
  app.patch(
    '/chat/rooms/:id/read',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }), body: MarkReadSchema },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const { id } = req.params
      if (!(await isParticipant(id, userId))) return reply.forbidden()

      await markRoomRead(id, userId, req.body.uptoMessageId)
      await eventBus.emitAndPersist(workspaceId, 'chat.room.read', {
        conversationId: id,
        userId,
      })
      return { ok: true }
    },
  )

  // ── POST /chat/rooms/:id/typing ────────────────────────────────────────────
  // Emite evento de digitando (não persiste). action=start|stop.
  app.post(
    '/chat/rooms/:id/typing',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ action: z.enum(['start', 'stop']) }),
      },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const { id } = req.params
      if (!(await isParticipant(id, userId))) return reply.forbidden()

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      })

      // Emite sem persistir EventLog (volátil)
      eventBus.emit('chat.typing', {
        workspaceId,
        type: 'chat.typing',
        payload: { conversationId: id, userId, userName: user?.name ?? '', action: req.body.action },
      })
      eventBus.emit('*', {
        workspaceId,
        type: 'chat.typing',
        payload: { conversationId: id, userId, userName: user?.name ?? '', action: req.body.action },
      })
      return { ok: true }
    },
  )

  // ── PATCH /chat/rooms/:id (renomear grupo) ─────────────────────────────────
  app.patch(
    '/chat/rooms/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }), body: RenameChatRoomSchema },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const { id } = req.params
      const me = await prisma.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId: id, userId } },
      })
      if (!me || me.leftAt) return reply.forbidden()
      if (me.role !== 'OWNER') return reply.forbidden('Apenas o dono do grupo pode renomear')

      const room = await prisma.conversation.findUnique({ where: { id }, select: { type: true } })
      if (room?.type !== 'GROUP') return reply.badRequest('Só grupos podem ser renomeados')

      await prisma.conversation.update({ where: { id }, data: { name: req.body.name } })
      await eventBus.emitAndPersist(workspaceId, 'chat.room.updated', { conversationId: id })
      return { ok: true }
    },
  )

  // ── POST /chat/rooms/:id/participants ──────────────────────────────────────
  app.post(
    '/chat/rooms/:id/participants',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }), body: AddParticipantSchema },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const { id } = req.params
      const { userId: newId, role } = req.body

      const me = await prisma.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId: id, userId } },
      })
      if (!me || me.leftAt) return reply.forbidden()
      if (me.role !== 'OWNER') return reply.forbidden('Apenas o dono pode adicionar membros')

      const room = await prisma.conversation.findUnique({ where: { id }, select: { type: true } })
      if (room?.type !== 'GROUP') return reply.badRequest('Direct messages não aceitam novos membros')

      const u = await prisma.user.findFirst({
        where: { id: newId, workspaceId, deletedAt: null },
        select: { id: true },
      })
      if (!u) return reply.notFound('Usuário não encontrado neste workspace')

      await prisma.conversationParticipant.upsert({
        where: { conversationId_userId: { conversationId: id, userId: newId } },
        create: { conversationId: id, userId: newId, role },
        update: { leftAt: null, role },
      })

      await eventBus.emitAndPersist(workspaceId, 'chat.room.updated', { conversationId: id })
      return { ok: true }
    },
  )

  // ── DELETE /chat/rooms/:id/participants/:userId ────────────────────────────
  app.delete(
    '/chat/rooms/:id/participants/:userId',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string(), userId: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId, sub: meId } = req.user
      const { id, userId: targetId } = req.params

      const me = await prisma.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId: id, userId: meId } },
      })
      if (!me || me.leftAt) return reply.forbidden()

      // Self-leave permitido; remover terceiros só se OWNER
      if (targetId !== meId && me.role !== 'OWNER') {
        return reply.forbidden('Apenas o dono pode remover membros')
      }

      await prisma.conversationParticipant.update({
        where: { conversationId_userId: { conversationId: id, userId: targetId } },
        data: { leftAt: new Date() },
      })

      await eventBus.emitAndPersist(workspaceId, 'chat.room.updated', { conversationId: id })
      return { ok: true }
    },
  )
}

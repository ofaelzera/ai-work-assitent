import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  CreateChatRoomSchema,
  SendChatMessageSchema,
  RenameChatRoomSchema,
  AddParticipantSchema,
  MarkReadSchema,
} from '@aiwa/shared'
import { prisma } from '../../lib/prisma.js'
import { eventBus } from '../../lib/eventBus.js'
import { env } from '../../config/env.js'
import {
  isParticipant,
  findOrCreateDirectRoom,
  createGroupRoom,
  listRoomsForUser,
  markRoomRead,
  countUnreadForUser,
  broadcastNewMessage,
} from './chat.service.js'
import { listOnline, isOnline } from '../../lib/presence.js'

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

  // ── GET /chat/presence ─────────────────────────────────────────────────────
  // Lista usuários do workspace que estão com SSE ativa.
  app.get('/chat/presence', { onRequest: [app.authenticate] }, async (req) => {
    const { workspaceId } = req.user
    const online = listOnline()
    if (!online.length) return { onlineUserIds: [] }
    const users = await prisma.user.findMany({
      where: { id: { in: online }, workspaceId, deletedAt: null },
      select: { id: true },
    })
    return { onlineUserIds: users.map((u) => u.id) }
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
              include: { user: { select: { id: true, name: true, email: true, settings: true } } },
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
            include: { user: { select: { id: true, name: true, email: true, settings: true } } },
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
          fromUser: { select: { id: true, name: true, email: true, settings: true } },
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
          fromUser: { select: { id: true, name: true, email: true, settings: true } },
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

  // ── POST /chat/rooms/:id/messages/media ────────────────────────────────────
  // Upload multipart de anexo (imagem, vídeo, áudio, documento) numa sala.
  // Cria 1 Message com o anexo gravado em disco e devolve a Message já com fromUser populado.
  app.post(
    '/chat/rooms/:id/messages/media',
    { onRequest: [app.authenticate] },
    async (req: any, reply) => {
      const { workspaceId, sub: userId } = req.user
      const { id } = req.params as { id: string }

      if (!(await isParticipant(id, userId))) return reply.forbidden()

      const data = await req.file()
      if (!data) return reply.badRequest('Arquivo obrigatório')

      const chunks: Buffer[] = []
      for await (const chunk of data.file) chunks.push(chunk)
      const buffer = Buffer.concat(chunks)

      if (buffer.length > 64 * 1024 * 1024) {
        return reply.badRequest('Arquivo muito grande (máx 64 MB)')
      }

      const mime: string = data.mimetype
      const originalName: string = data.filename ?? 'arquivo'
      const caption: string = (data.fields?.caption?.value as string | undefined) ?? ''

      let kind: 'image' | 'video' | 'audio' | 'document'
      if (mime.startsWith('image/')) kind = 'image'
      else if (mime.startsWith('video/')) kind = 'video'
      else if (mime.startsWith('audio/')) kind = 'audio'
      else kind = 'document'

      const safeName = originalName.replace(/[^\w.\-]/g, '_')
      const storageKey = path.join(workspaceId, 'chat', id, `${randomUUID()}-${safeName}`)
      const fullPath = path.join(env.STORAGE_PATH, storageKey)
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, buffer)

      const attachment = {
        type: kind,
        mimetype: mime,
        filename: originalName,
        storageKey,
        sizeBytes: buffer.length,
      }

      const message = await prisma.message.create({
        data: {
          workspaceId,
          conversationId: id,
          direction: 'OUTBOUND',
          fromUserId: userId,
          body: caption || `[${kind}]`,
          attachments: [attachment] as any,
          sentAt: new Date(),
        },
        include: {
          fromUser: { select: { id: true, name: true, email: true, settings: true } },
        },
      })

      await prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: message.sentAt },
      })
      await prisma.conversationParticipant.update({
        where: { conversationId_userId: { conversationId: id, userId } },
        data: { lastReadAt: message.sentAt },
      })

      await broadcastNewMessage(workspaceId, message)
      await eventBus.emitAndPersist(workspaceId, 'chat.room.updated', { conversationId: id })

      return reply.code(201).send(message)
    },
  )

  // ── POST /chat/rooms/:id/messages/from-library ─────────────────────────────
  // Envia um arquivo da biblioteca pessoal/workspace (Attachment) pra sala interna.
  // Estratégia: copia o binário do storage da biblioteca para a área de chat
  // (${workspaceId}/chat/${roomId}/), assim a privacidade da sala é mantida pelo
  // próprio endpoint /chat/messages/:id/media (só participantes acessam).
  app.post(
    '/chat/rooms/:id/messages/from-library',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          attachmentId: z.string(),
          caption: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId, role } = req.user
      const { id } = req.params
      const { attachmentId, caption } = req.body

      if (!(await isParticipant(id, userId))) return reply.forbidden()

      // Carrega o arquivo da biblioteca e verifica acesso do usuário
      const file = await prisma.attachment.findFirst({
        where: { id: attachmentId, workspaceId },
        include: {
          shares: { where: { userId } },
          folder: { select: { ownerId: true, visibility: true, id: true } },
        },
      })
      if (!file) return reply.notFound('Arquivo não encontrado')

      let hasAccess = role === 'ADMIN' || file.uploadedBy === userId
      if (!hasAccess && file.folder) {
        const f = file.folder
        if (f.visibility === 'PUBLIC') hasAccess = true
        else if (f.ownerId === userId) hasAccess = true
        else if (f.visibility === 'SHARED' as any) {
          const share = await prisma.storageFolderShare.findUnique({
            where: { folderId_userId: { folderId: f.id, userId } },
          })
          if (share) hasAccess = true
        }
      }
      if (!hasAccess && !file.folder) {
        if (file.visibility === 'PUBLIC') hasAccess = true
        else if (file.visibility === 'SHARED' && file.shares.length > 0) hasAccess = true
      }
      if (!hasAccess) return reply.forbidden('Sem acesso a este arquivo')

      // Lê do disco e copia para a área de chat
      const srcPath = path.join(env.STORAGE_PATH, file.storageKey)
      let buffer: Buffer
      try {
        buffer = await fs.readFile(srcPath)
      } catch {
        return reply.notFound('Arquivo não encontrado no disco')
      }

      const safeName = file.filename.replace(/[^\w.\-]/g, '_')
      const newKey = path.join(workspaceId, 'chat', id, `${randomUUID()}-${safeName}`)
      const newPath = path.join(env.STORAGE_PATH, newKey)
      await fs.mkdir(path.dirname(newPath), { recursive: true })
      await fs.writeFile(newPath, buffer)

      let kind: 'image' | 'video' | 'audio' | 'document'
      if (file.mimeType.startsWith('image/')) kind = 'image'
      else if (file.mimeType.startsWith('video/')) kind = 'video'
      else if (file.mimeType.startsWith('audio/')) kind = 'audio'
      else kind = 'document'

      const attachment = {
        type: kind,
        mimetype: file.mimeType,
        filename: file.filename,
        storageKey: newKey,
        sizeBytes: file.sizeBytes,
        libraryAttachmentId: file.id,  // referência opcional pra rastreio
      }

      const message = await prisma.message.create({
        data: {
          workspaceId,
          conversationId: id,
          direction: 'OUTBOUND',
          fromUserId: userId,
          body: caption?.trim() || `[${kind}]`,
          attachments: [attachment] as any,
          sentAt: new Date(),
        },
        include: {
          fromUser: { select: { id: true, name: true, email: true, settings: true } },
        },
      })

      await prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: message.sentAt },
      })
      await prisma.conversationParticipant.update({
        where: { conversationId_userId: { conversationId: id, userId } },
        data: { lastReadAt: message.sentAt },
      })

      await broadcastNewMessage(workspaceId, message)
      await eventBus.emitAndPersist(workspaceId, 'chat.room.updated', { conversationId: id })

      return reply.code(201).send(message)
    },
  )

  // ── GET /chat/messages/:id/media ───────────────────────────────────────────
  // Serve o binário de um anexo de mensagem de chat interno. Verifica participação.
  app.get(
    '/chat/messages/:id/media',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const { id } = req.params

      const message = await prisma.message.findFirst({
        where: { id, workspaceId },
        select: { conversationId: true, attachments: true, conversation: { select: { type: true } } },
      })
      if (!message) return reply.notFound()
      if (message.conversation.type === 'EXTERNAL') {
        return reply.badRequest('Endpoint apenas para mensagens internas')
      }
      if (!(await isParticipant(message.conversationId, userId))) {
        return reply.forbidden()
      }

      const att = (message.attachments as any[] | null)?.[0]
      if (!att?.storageKey) return reply.notFound('Anexo não encontrado')

      const fullPath = path.join(env.STORAGE_PATH, att.storageKey as string)
      try {
        const buffer = await fs.readFile(fullPath)
        reply.header('Content-Type', att.mimetype ?? 'application/octet-stream')
        reply.header('Content-Disposition', `inline; filename="${att.filename ?? 'arquivo'}"`)
        reply.header('Cache-Control', 'private, max-age=86400')
        return reply.send(buffer)
      } catch {
        return reply.notFound('Arquivo não encontrado no disco')
      }
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

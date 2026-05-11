import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { evolutionClient } from '../channels/evolution.client.js'
import { getChannelConfig } from '../channels/channels.service.js'
import { eventBus } from '../../lib/eventBus.js'

export const conversationsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Listar conversas
  app.get(
    '/conversations',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          channelId: z.string().optional(),
          q: z.string().optional(),
          cursor: z.string().optional(),
          limit: z.coerce.number().default(30),
        }),
      },
    },
    async (req) => {
      const { workspaceId } = req.user
      const { channelId, q, cursor, limit } = req.query

      const conversations = await prisma.conversation.findMany({
        where: {
          workspaceId,
          ...(channelId && { channelId }),
          ...(q && {
            OR: [
              { subject: { contains: q } },
              { contact: { name: { contains: q } } },
              { contact: { phone: { contains: q } } },
            ],
          }),
          ...(cursor && { lastMessageAt: { lt: new Date(cursor) } }),
        },
        orderBy: { lastMessageAt: 'desc' },
        take: limit,
        include: {
          contact: { select: { id: true, name: true, phone: true, email: true } },
          channel: { select: { id: true, type: true, label: true } },
          messages: {
            orderBy: { sentAt: 'desc' },
            take: 1,
            select: { body: true, sentAt: true, direction: true },
          },
        },
      })

      const nextCursor =
        conversations.length === limit
          ? conversations[conversations.length - 1].lastMessageAt?.toISOString()
          : null

      return { conversations, nextCursor }
    },
  )

  // Mensagens de uma conversa
  app.get(
    '/conversations/:id/messages',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        querystring: z.object({
          cursor: z.string().optional(),
          limit: z.coerce.number().default(50),
        }),
      },
    },
    async (req) => {
      const { workspaceId } = req.user
      const { id } = req.params
      const { cursor, limit } = req.query

      // Marcar como lido
      await prisma.conversation.updateMany({
        where: { id, workspaceId },
        data: { unreadCount: 0 },
      })

      const messages = await prisma.message.findMany({
        where: {
          conversationId: id,
          workspaceId,
          ...(cursor && { sentAt: { lt: new Date(cursor) } }),
        },
        orderBy: { sentAt: 'desc' },
        take: limit,
        include: {
          // include contact info via fromContactId
        },
      })

      const conversation = await prisma.conversation.findUnique({
        where: { id },
        include: {
          contact: true,
          channel: { select: { id: true, type: true, label: true } },
        },
      })

      const nextCursor =
        messages.length === limit ? messages[messages.length - 1].sentAt.toISOString() : null

      return { conversation, messages: messages.reverse(), nextCursor }
    },
  )

  // Enviar mensagem
  app.post(
    '/conversations/:id/messages',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ text: z.string().min(1) }),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const { id } = req.params
      const { text } = req.body

      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id, workspaceId },
        include: { channel: true },
      })

      // Enviar via canal correspondente
      let externalId: string | undefined

      if (conversation.channel.type === 'WHATSAPP') {
        const { instanceName } = await getChannelConfig(conversation.channelId)
        const result = await evolutionClient.sendText(instanceName, conversation.externalId, text)
        externalId = result.key?.id
      }

      // Salvar no banco
      const message = await prisma.message.create({
        data: {
          workspaceId,
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          externalId,
          fromUserId: req.user.sub,
          body: text,
          sentAt: new Date(),
        },
      })

      await prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: new Date() },
      })

      await eventBus.emitAndPersist(workspaceId, 'message.sent', {
        messageId: message.id,
        conversationId: conversation.id,
      })

      return reply.code(201).send(message)
    },
  )

  // Resumir conversa (dispara agente)
  app.post(
    '/conversations/:id/summarize',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req) => {
      const { workspaceId } = req.user
      const { id } = req.params

      const messages = await prisma.message.findMany({
        where: { conversationId: id, workspaceId },
        orderBy: { sentAt: 'asc' },
        take: 100,
        select: { body: true, direction: true, sentAt: true },
      })

      // TODO Sprint 3: disparar agente resumidor via queue
      return { message: 'Resumo enfileirado (Sprint 3)', count: messages.length }
    },
  )
}

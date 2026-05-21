import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { eventBus } from '../../lib/eventBus.js'
import { env } from '../../config/env.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { MediaAttachment } from '../channels/media.utils.js'
import { evolutionClient } from '../channels/evolution.client.js'
import { getChannelConfig } from '../channels/channels.service.js'

const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])

export const kanbanRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── Boards ────────────────────────────────────────────────────────────────

  app.get('/kanban/boards', { onRequest: [app.authenticate] }, async (req) => {
    const boards = await prisma.board.findMany({
      where: { workspaceId: req.user.workspaceId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        createdAt: true,
        columns: {
          select: { _count: { select: { cards: { where: { deletedAt: null } } } } },
        },
      },
    })
    return boards.map((b) => ({
      id: b.id,
      name: b.name,
      createdAt: b.createdAt,
      cardCount: b.columns.reduce((sum, col) => sum + col._count.cards, 0),
    }))
  })

  app.post(
    '/kanban/boards',
    {
      onRequest: [app.authenticate],
      schema: { body: z.object({ name: z.string().min(1) }) },
    },
    async (req, reply) => {
      const board = await prisma.board.create({
        data: { workspaceId: req.user.workspaceId, name: req.body.name },
      })
      // Colunas padrão
      const defaultCols = ['Entrada', 'Em andamento', 'Aguardando', 'Concluído', 'Cancelado']
      for (let i = 0; i < defaultCols.length; i++) {
        await prisma.column.create({ data: { boardId: board.id, name: defaultCols[i], position: i } })
      }
      return reply.code(201).send(board)
    },
  )

  // Board completo (colunas + cards ordenados)
  app.get(
    '/kanban/boards/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const board = await prisma.board.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
        include: {
          columns: {
            orderBy: { position: 'asc' },
            include: {
              cards: {
                where: { deletedAt: null },
                orderBy: { position: 'asc' },
                include: {
                  contact: { select: { id: true, name: true, phone: true } },
                  conversation: { select: { id: true, externalId: true } },
                },
              },
            },
          },
        },
      })
      if (!board) return reply.notFound()
      return board
    },
  )

  app.patch(
    '/kanban/boards/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ name: z.string().min(1) }),
      },
    },
    async (req, reply) => {
      const board = await prisma.board.updateMany({
        where: { id: req.params.id, workspaceId: req.user.workspaceId },
        data: { name: req.body.name },
      })
      if (!board.count) return reply.notFound()
      return { ok: true }
    },
  )

  // GET /kanban/boards/:id/deletion-impact — preview do que será removido (cards, anexos, etc.)
  app.get(
    '/kanban/boards/:id/deletion-impact',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const board = await prisma.board.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
        select: { id: true, name: true },
      })
      if (!board) return reply.notFound()

      const [columnsCount, cardsCount, attachmentsCount, commentsCount, tasksCount] = await Promise.all([
        prisma.column.count({ where: { boardId: board.id } }),
        prisma.card.count({ where: { column: { boardId: board.id }, deletedAt: null } }),
        prisma.attachment.count({ where: { card: { column: { boardId: board.id } } } }),
        prisma.cardComment.count({ where: { card: { column: { boardId: board.id } } } }),
        prisma.task.count({ where: { card: { column: { boardId: board.id } } } }),
      ])

      return {
        boardName: board.name,
        columns: columnsCount,
        cards: cardsCount,
        attachments: attachmentsCount,
        comments: commentsCount,
        tasks: tasksCount,
      }
    },
  )

  app.delete(
    '/kanban/boards/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      await prisma.board.updateMany({
        where: { id: req.params.id, workspaceId: req.user.workspaceId },
        data: { deletedAt: new Date() },
      })
      return reply.code(204).send()
    },
  )

  // ── Columns ───────────────────────────────────────────────────────────────

  app.post(
    '/kanban/columns',
    {
      onRequest: [app.authenticate],
      schema: { body: z.object({ boardId: z.string(), name: z.string().min(1) }) },
    },
    async (req, reply) => {
      const { boardId, name } = req.body
      const board = await prisma.board.findFirst({
        where: { id: boardId, workspaceId: req.user.workspaceId },
      })
      if (!board) return reply.notFound()
      const last = await prisma.column.findFirst({ where: { boardId }, orderBy: { position: 'desc' } })
      const col = await prisma.column.create({ data: { boardId, name, position: (last?.position ?? -1) + 1 } })
      return reply.code(201).send(col)
    },
  )

  // PATCH: renomear coluna (não usa pra reorder — ver /move)
  app.patch(
    '/kanban/columns/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ name: z.string().min(1) }),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const col = await prisma.column.findFirst({
        where: { id: req.params.id, board: { workspaceId } },
        select: { id: true },
      })
      if (!col) return reply.notFound()
      const updated = await prisma.column.update({
        where: { id: req.params.id },
        data: { name: req.body.name.trim() },
      })
      return updated
    },
  )

  // POST: reordenar colunas do board (envia array com IDs na nova ordem)
  app.post(
    '/kanban/boards/:id/columns/reorder',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ columnIds: z.array(z.string()).min(1) }),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const board = await prisma.board.findFirst({
        where: { id: req.params.id, workspaceId },
        select: { id: true },
      })
      if (!board) return reply.notFound()

      // Verifica que todas as colunas pertencem ao board
      const cols = await prisma.column.findMany({
        where: { boardId: board.id, id: { in: req.body.columnIds } },
        select: { id: true },
      })
      if (cols.length !== req.body.columnIds.length) {
        return reply.badRequest('Algumas colunas não pertencem a este board')
      }

      // Aplica nova posição em transação
      await prisma.$transaction(
        req.body.columnIds.map((id, idx) =>
          prisma.column.update({ where: { id }, data: { position: idx } }),
        ),
      )
      return { ok: true }
    },
  )

  app.delete(
    '/kanban/columns/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        querystring: z.object({
          // Pra onde mover os cards. Se omitido, falha se a coluna não estiver vazia.
          moveCardsTo: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const col = await prisma.column.findFirst({
        where: { id: req.params.id, board: { workspaceId } },
        include: { _count: { select: { cards: { where: { deletedAt: null } } } } },
      })
      if (!col) return reply.notFound()

      if (col._count.cards > 0) {
        if (!req.query.moveCardsTo) {
          return reply.status(409).send({
            error: 'columnNotEmpty',
            message: `Coluna tem ${col._count.cards} card(s). Passe ?moveCardsTo=<columnId> ou esvazie antes.`,
            cards: col._count.cards,
          })
        }
        // Valida coluna destino (mesmo board)
        const target = await prisma.column.findFirst({
          where: { id: req.query.moveCardsTo, boardId: col.boardId },
          select: { id: true },
        })
        if (!target) return reply.badRequest('Coluna destino inválida')

        // Move todos os cards pra coluna destino (no fim)
        const lastInTarget = await prisma.card.findFirst({
          where: { columnId: target.id, deletedAt: null },
          orderBy: { position: 'desc' },
          select: { position: true },
        })
        const startPos = (lastInTarget?.position ?? -1) + 1
        const cardsToMove = await prisma.card.findMany({
          where: { columnId: col.id, deletedAt: null },
          orderBy: { position: 'asc' },
          select: { id: true },
        })
        await prisma.$transaction(
          cardsToMove.map((c, idx) =>
            prisma.card.update({ where: { id: c.id }, data: { columnId: target.id, position: startPos + idx } }),
          ),
        )
      }

      await prisma.column.delete({ where: { id: col.id } })
      return reply.code(204).send()
    },
  )

  // ── Cards ─────────────────────────────────────────────────────────────────

  app.post(
    '/kanban/cards',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          columnId: z.string(),
          title: z.string().min(1),
          description: z.string().optional(),
          priority: priorityEnum.optional(),
          dueDate: z.string().optional(),
          contactId: z.string().optional(),
          conversationId: z.string().optional(),
          checklist: z.array(z.object({ text: z.string(), done: z.boolean() })).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const { columnId, title, description, priority, dueDate, contactId, conversationId, checklist } = req.body
      const last = await prisma.card.findFirst({ where: { columnId, deletedAt: null }, orderBy: { position: 'desc' } })
      const card = await prisma.card.create({
        data: {
          workspaceId,
          columnId,
          title,
          description,
          priority: priority ?? 'MEDIUM',
          dueDate: dueDate ? new Date(dueDate) : undefined,
          contactId,
          conversationId,
          checklist: checklist ?? [],
          position: (last?.position ?? -1) + 1,
        },
        include: { contact: { select: { id: true, name: true, phone: true } } },
      })
      await eventBus.emitAndPersist(workspaceId, 'card.created', { cardId: card.id, origin: 'USER' })
      return reply.code(201).send(card)
    },
  )

  app.get(
    '/kanban/cards/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const card = await prisma.card.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
        include: {
          contact: { select: { id: true, name: true, phone: true } },
          conversation: { select: { id: true, externalId: true } },
          comments: { orderBy: { createdAt: 'asc' } },
          column: { select: { id: true, name: true, boardId: true } },
        },
      })
      if (!card) return reply.notFound()
      return card
    },
  )

  app.patch(
    '/kanban/cards/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          title: z.string().min(1).optional(),
          description: z.string().nullable().optional(),
          priority: priorityEnum.optional(),
          dueDate: z.string().nullable().optional(),
          checklist: z.array(z.object({ text: z.string(), done: z.boolean() })).optional(),
          contactId: z.string().nullable().optional(),
          labels: z.array(z.string()).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { title, description, priority, dueDate, checklist, contactId, labels } = req.body
      const card = await prisma.card.updateMany({
        where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
        data: {
          ...(title !== undefined && { title }),
          ...(description !== undefined && { description }),
          ...(priority !== undefined && { priority }),
          ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
          ...(checklist !== undefined && { checklist }),
          ...(contactId !== undefined && { contactId }),
          ...(labels !== undefined && { labels }),
        },
      })
      if (!card.count) return reply.notFound()
      return { ok: true }
    },
  )

  // Mover card entre colunas ou reordenar dentro da coluna
  app.post(
    '/kanban/cards/:id/move',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ columnId: z.string(), position: z.number().int().min(0) }),
      },
    },
    async (req, reply) => {
      const { columnId, position } = req.body
      const { workspaceId } = req.user
      const cardId = req.params.id

      // Valida que o card existe + pertence ao workspace
      const card = await prisma.card.findFirst({
        where: { id: cardId, workspaceId, deletedAt: null },
        include: { column: { select: { boardId: true } } },
      })
      if (!card) return reply.notFound('Card não encontrado')

      // Valida que a coluna destino existe + pertence ao mesmo board
      const targetColumn = await prisma.column.findFirst({
        where: { id: columnId, board: { workspaceId } },
        select: { id: true, boardId: true },
      })
      if (!targetColumn) return reply.notFound('Coluna destino não encontrada')
      if (targetColumn.boardId !== card.column.boardId) {
        return reply.badRequest('Não é possível mover card entre boards diferentes')
      }

      // Shift cards na coluna destino pra abrir espaço (não shifta o próprio card)
      await prisma.card.updateMany({
        where: { columnId, position: { gte: position }, deletedAt: null, id: { not: cardId } },
        data: { position: { increment: 1 } },
      })

      // Update real do card — usa `update` (não updateMany) pra garantir que rodou
      const updated = await prisma.card.update({
        where: { id: cardId },
        data: { columnId, position },
        select: { id: true, columnId: true, position: true },
      })

      await eventBus.emitAndPersist(workspaceId, 'card.moved', { cardId, columnId, position })
      return { ok: true, card: updated }
    },
  )

  app.delete(
    '/kanban/cards/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      await prisma.card.updateMany({
        where: { id: req.params.id, workspaceId: req.user.workspaceId },
        data: { deletedAt: new Date() },
      })
      return reply.code(204).send()
    },
  )

  // ── Comentários ───────────────────────────────────────────────────────────

  app.post(
    '/kanban/cards/:id/comments',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ body: z.string().min(1) }),
      },
    },
    async (req, reply) => {
      const comment = await prisma.cardComment.create({
        data: { cardId: req.params.id, userId: req.user.sub, body: req.body.body },
      })
      return reply.code(201).send(comment)
    },
  )

  // ── Anexos de mensagem → Card ────────────────────────────────────────────
  // Salva localmente o arquivo de mídia de uma mensagem e vincula ao card.

  app.get(
    '/kanban/cards/:id/attachments',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const card = await prisma.card.findFirst({
        where: { id: req.params.id, workspaceId, deletedAt: null },
      })
      if (!card) return reply.notFound()

      const attachments = await prisma.attachment.findMany({
        where: { cardId: req.params.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, filename: true, mimeType: true, sizeBytes: true, storageKey: true, createdAt: true },
      })
      return attachments
    },
  )

  app.post(
    '/kanban/cards/:id/attachments/from-message',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ messageId: z.string() }),
      },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const cardId = req.params.id
      const { messageId } = req.body

      // Valida card
      const card = await prisma.card.findFirst({
        where: { id: cardId, workspaceId, deletedAt: null },
      })
      if (!card) return reply.notFound('Card não encontrado')

      // Busca mensagem + canal
      const message = await prisma.message.findUniqueOrThrow({
        where: { id: messageId },
        include: { conversation: { include: { channel: true } } },
      })
      if (message.workspaceId !== workspaceId) return reply.forbidden()

      const attachments = message.attachments as MediaAttachment[] | null
      if (!attachments?.length) return reply.badRequest('Mensagem sem anexo')

      const att = attachments[0]

      // Baixa da Evolution API
      const { instanceName } = await getChannelConfig(message.conversation.channelId)
      let base64: string
      let mimetype: string
      try {
        const result = await evolutionClient.getMediaBase64(instanceName, att.key)
        base64 = result.base64
        mimetype = result.mimetype ?? att.mimetype
      } catch (err: any) {
        const msg = String(err?.message ?? '')
        if (msg.includes('400') || msg.includes('expired') || msg.includes('Failed to fetch')) {
          return reply.status(410).send({ error: 'Mídia expirada no WhatsApp' })
        }
        throw err
      }

      // Salva no sistema de arquivos
      const ext = mimetype.split('/')[1]?.split(';')[0] ?? 'bin'
      const filename = att.filename ?? `${att.type}-${Date.now()}.${ext}`
      const storageDir = path.join(env.STORAGE_PATH, workspaceId, 'attachments')
      await fs.mkdir(storageDir, { recursive: true })
      const storageKey = path.join(workspaceId, 'attachments', `${randomUUID()}-${filename}`)
      const fullPath = path.join(env.STORAGE_PATH, storageKey)
      const buffer = Buffer.from(base64, 'base64')
      await fs.writeFile(fullPath, buffer)

      // Cria registro na DB
      const record = await prisma.attachment.create({
        data: {
          workspaceId,
          uploadedBy: userId,
          filename,
          mimeType: mimetype,
          sizeBytes: buffer.length,
          storageKey,
          cardId,
        },
      })

      return reply.code(201).send({
        id: record.id,
        filename: record.filename,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        storageKey: record.storageKey,
        createdAt: record.createdAt,
      })
    },
  )

  app.get(
    '/storage/attachments/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId, role } = req.user
      const attachment = await prisma.attachment.findFirst({
        where: { id: req.params.id, workspaceId },
        include: { shares: { where: { userId } } },
      })
      if (!attachment) return reply.notFound()

      // Guard de acesso: anexo de Card herda permissão de quem vê o card (assumido OK aqui).
      // Já anexo da biblioteca (sem cardId) tem visibility própria.
      if (!attachment.cardId) {
        const hasAccess = role === 'ADMIN'
          || attachment.uploadedBy === userId
          || attachment.visibility === 'PUBLIC'
          || (attachment.visibility === 'SHARED' && attachment.shares.length > 0)
        if (!hasAccess) return reply.forbidden('Sem acesso a este arquivo')
      }

      const fullPath = path.join(env.STORAGE_PATH, attachment.storageKey)
      try {
        const buffer = await fs.readFile(fullPath)
        reply.header('Content-Type', attachment.mimeType)
        reply.header('Content-Disposition', `inline; filename="${attachment.filename}"`)
        reply.header('Cache-Control', 'private, max-age=86400')
        return reply.send(buffer)
      } catch {
        return reply.notFound('Arquivo não encontrado no disco')
      }
    },
  )
}

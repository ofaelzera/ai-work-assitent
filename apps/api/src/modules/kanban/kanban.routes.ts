import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { eventBus } from '../../lib/eventBus.js'
import { hasPermission, requirePerm } from '../../lib/acl.js'
import { env } from '../../config/env.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { MediaAttachment } from '../channels/media.utils.js'
import { getChannelConfig } from '../channels/channels.service.js'
import { getClientForChannel } from '../evolution-servers/evolution-servers.service.js'
import { getBoardEligibleUserIds, canManageBoard } from './board-access.js'

const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])

export const kanbanRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── Boards ────────────────────────────────────────────────────────────────

  // GET: lista boards visíveis ao user.
  //   visibility PRIVATE → só dono
  //   visibility SHARED  → dono + users em BoardShare
  //   visibility PUBLIC  → todos do workspace
  //   `boards.manage`    → vê todos os boards do workspace
  app.get('/kanban/boards', { onRequest: [app.authenticate] }, async (req) => {
    const canSeeAll = await hasPermission(req.user, 'boards.manage')
    const userId = req.user.sub
    // Times dos quais o usuário é membro ativo → boards compartilhados com esses setores
    const myTeamIds = canSeeAll
      ? []
      : (await prisma.teamMembership.findMany({
          where: { userId, isActive: true },
          select: { teamId: true },
        })).map(t => t.teamId)
    const visibilityFilter = canSeeAll
      ? {}
      : {
          OR: [
            { visibility: 'PUBLIC' as const },
            { ownerId: userId },
            { visibility: 'SHARED' as const, shares: { some: { userId } } },
            ...(myTeamIds.length > 0
              ? [{ visibility: 'SHARED' as const, teamShares: { some: { teamId: { in: myTeamIds } } } }]
              : []),
          ],
        }

    const boards = await prisma.board.findMany({
      where: { workspaceId: req.user.workspaceId, deletedAt: null, ...visibilityFilter },
      orderBy: [{ visibility: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        ownerId: true,
        visibility: true,
        createdAt: true,
        columns: {
          select: { _count: { select: { cards: { where: { deletedAt: null } } } } },
        },
        _count: { select: { shares: true } },
      },
    })
    return boards.map((b) => ({
      id: b.id,
      name: b.name,
      ownerId: b.ownerId,
      visibility: b.visibility,
      isGlobal: b.visibility === 'PUBLIC',
      isShared: b.visibility === 'SHARED',
      isMine: b.ownerId === userId,
      sharesCount: b._count.shares,
      createdAt: b.createdAt,
      cardCount: b.columns.reduce((sum, col) => sum + col._count.cards, 0),
    }))
  })

  app.post(
    '/kanban/boards',
    {
      onRequest: [app.authenticate, requirePerm('boards.manage')],
      schema: {
        body: z.object({
          name: z.string().min(1),
          visibility: z.enum(['PRIVATE', 'SHARED', 'PUBLIC']).default('PRIVATE'),
          // IDs de users com quem compartilhar (auto-vira SHARED se array não-vazio)
          shareWith: z.array(z.string()).optional(),
        }),
      },
    },
    async (req, reply) => {
      // Criação requer boards.manage (gate no onRequest). PUBLIC já está coberto.
      const wantsPublic = req.body.visibility === 'PUBLIC'
      if (wantsPublic && !(await hasPermission(req.user, 'boards.manage'))) {
        return reply.forbidden('Sem permissão pra criar board público')
      }

      // Se mandou shareWith não-vazio, força visibility SHARED
      const finalVisibility = (req.body.shareWith?.length ?? 0) > 0 ? 'SHARED' : req.body.visibility

      const board = await prisma.board.create({
        data: {
          workspaceId: req.user.workspaceId,
          name: req.body.name,
          ownerId: req.user.sub,
          visibility: finalVisibility,
        },
      })

      // Cria shares se aplicável
      if (req.body.shareWith?.length) {
        const validUsers = await prisma.user.findMany({
          where: { id: { in: req.body.shareWith }, workspaceId: req.user.workspaceId, deletedAt: null },
          select: { id: true },
        })
        for (const u of validUsers) {
          if (u.id !== req.user.sub) {
            await prisma.boardShare.create({ data: { boardId: board.id, userId: u.id } })
          }
        }
      }

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
        select: { ownerId: true, visibility: true },
      })
      if (!board) return reply.notFound()

      // Acesso: PUBLIC, ou dono, ou SHARED com share pro user, ou boards.manage
      const userId = req.user.sub
      const isOwner = board.ownerId === userId
      const isPublic = board.visibility === 'PUBLIC'
      let isShared = false
      if (!isOwner && !isPublic && board.visibility === 'SHARED') {
        const share = await prisma.boardShare.findUnique({
          where: { boardId_userId: { boardId: req.params.id, userId } },
        })
        isShared = !!share
      }
      if (!isOwner && !isPublic && !isShared) {
        const canSeeAll = await hasPermission(req.user, 'boards.manage')
        if (!canSeeAll) return reply.notFound()
      }

      const fullBoard = await prisma.board.findFirst({
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
      if (!fullBoard) return reply.notFound()
      return fullBoard
    },
  )

  app.patch(
    '/kanban/boards/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().min(1).optional(),
          visibility: z.enum(['PRIVATE', 'SHARED', 'PUBLIC']).optional(),
        }),
      },
    },
    async (req, reply) => {
      const userId = req.user.sub
      const existing = await prisma.board.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId },
        select: { ownerId: true },
      })
      if (!existing) return reply.notFound()

      // Só dono ou quem tem boards.manage pode editar metadados
      const canManage = await hasPermission(req.user, 'boards.manage')
      if (existing.ownerId !== userId && !canManage) {
        return reply.forbidden('Só o dono ou admin pode editar este board')
      }

      // Pra mudar pra PUBLIC, precisa de boards.manage
      if (req.body.visibility === 'PUBLIC' && !canManage) {
        return reply.forbidden('Sem permissão pra tornar board público')
      }

      await prisma.board.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.name && { name: req.body.name }),
          ...(req.body.visibility && { visibility: req.body.visibility }),
        },
      })
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
      const existing = await prisma.board.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId },
        select: { ownerId: true },
      })
      if (!existing) return reply.notFound()

      // Só dono ou quem tem boards.manage pode deletar
      const canManage = await hasPermission(req.user, 'boards.manage')
      if (existing.ownerId !== req.user.sub && !canManage) {
        return reply.forbidden('Só o dono ou quem tem boards.manage pode deletar')
      }

      await prisma.board.updateMany({
        where: { id: req.params.id, workspaceId: req.user.workspaceId },
        data: { deletedAt: new Date() },
      })
      return reply.code(204).send()
    },
  )

  // ── Board shares (compartilhar com users específicos) ─────────────────────
  // GET: lista users com acesso ao board (só dono ou admin)
  app.get(
    '/kanban/boards/:id/shares',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const board = await prisma.board.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
        select: { ownerId: true },
      })
      if (!board) return reply.notFound()
      const canManage = await hasPermission(req.user, 'boards.manage')
      if (board.ownerId !== req.user.sub && !canManage) return reply.forbidden('Só dono ou admin')

      const shares = await prisma.boardShare.findMany({
        where: { boardId: req.params.id },
        orderBy: { createdAt: 'asc' },
      })
      const userIds = shares.map(s => s.userId)
      const users = userIds.length
        ? await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true },
          })
        : []
      const usersMap = new Map(users.map(u => [u.id, u]))
      return shares.map(s => ({
        id: s.id, userId: s.userId,
        user: usersMap.get(s.userId) ?? null,
        createdAt: s.createdAt,
      }))
    },
  )

  // POST: adiciona share
  app.post(
    '/kanban/boards/:id/shares',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ userId: z.string() }),
      },
    },
    async (req, reply) => {
      const board = await prisma.board.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
        select: { ownerId: true, visibility: true },
      })
      if (!board) return reply.notFound()
      const canManage = await hasPermission(req.user, 'boards.manage')
      if (board.ownerId !== req.user.sub && !canManage) return reply.forbidden('Só dono ou admin')

      if (req.body.userId === board.ownerId) {
        return reply.badRequest('Dono do board já tem acesso')
      }
      const target = await prisma.user.findFirst({
        where: { id: req.body.userId, workspaceId: req.user.workspaceId, deletedAt: null },
        select: { id: true },
      })
      if (!target) return reply.notFound('Usuário não encontrado neste workspace')

      const share = await prisma.boardShare.upsert({
        where: { boardId_userId: { boardId: req.params.id, userId: req.body.userId } },
        create: { boardId: req.params.id, userId: req.body.userId },
        update: {},
      })

      // Auto-promove PRIVATE → SHARED se o primeiro compartilhamento for adicionado
      if (board.visibility === 'PRIVATE') {
        await prisma.board.update({
          where: { id: req.params.id },
          data: { visibility: 'SHARED' },
        })
      }
      return reply.code(201).send(share)
    },
  )

  // DELETE: remove share
  app.delete(
    '/kanban/boards/:id/shares/:userId',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string(), userId: z.string() }) },
    },
    async (req, reply) => {
      const board = await prisma.board.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
        select: { ownerId: true },
      })
      if (!board) return reply.notFound()
      const canManage = await hasPermission(req.user, 'boards.manage')
      if (board.ownerId !== req.user.sub && !canManage) return reply.forbidden('Só dono ou admin')

      await prisma.boardShare.deleteMany({
        where: { boardId: req.params.id, userId: req.params.userId },
      })
      return reply.code(204).send()
    },
  )

  // ── Board team shares (compartilhar board com setores inteiros) ────────────
  app.get(
    '/kanban/boards/:id/team-shares',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      const board = await prisma.board.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
        select: { ownerId: true },
      })
      if (!board) return reply.notFound()
      const canManage = await hasPermission(req.user, 'boards.manage')
      const canManageThis = canManage || board.ownerId === req.user.sub || await canManageBoard(req.params.id, req.user.sub)
      if (!canManageThis) return reply.forbidden('Sem permissão')

      const shares = await prisma.boardTeamShare.findMany({
        where: { boardId: req.params.id },
        orderBy: { createdAt: 'asc' },
        include: {
          team: { select: { id: true, name: true, slug: true, color: true, icon: true } },
        },
      })
      return shares
    },
  )

  app.post(
    '/kanban/boards/:id/team-shares',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ teamId: z.string() }),
      },
    },
    async (req, reply) => {
      const board = await prisma.board.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
        select: { ownerId: true, visibility: true },
      })
      if (!board) return reply.notFound()
      const canManage = await hasPermission(req.user, 'boards.manage')
      const canManageThis = canManage || board.ownerId === req.user.sub || await canManageBoard(req.params.id, req.user.sub)
      if (!canManageThis) return reply.forbidden('Sem permissão')

      const team = await prisma.team.findFirst({
        where: { id: req.body.teamId, workspaceId: req.user.workspaceId, deletedAt: null },
        select: { id: true },
      })
      if (!team) return reply.notFound('Setor não encontrado')

      const share = await prisma.boardTeamShare.upsert({
        where: { boardId_teamId: { boardId: req.params.id, teamId: req.body.teamId } },
        create: { boardId: req.params.id, teamId: req.body.teamId },
        update: {},
      })

      // Auto-promove PRIVATE → SHARED (igual ao share por usuário)
      if (board.visibility === 'PRIVATE') {
        await prisma.board.update({
          where: { id: req.params.id },
          data: { visibility: 'SHARED' },
        })
      }
      return reply.code(201).send(share)
    },
  )

  app.delete(
    '/kanban/boards/:id/team-shares/:teamId',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string(), teamId: z.string() }) },
    },
    async (req, reply) => {
      const board = await prisma.board.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
        select: { ownerId: true },
      })
      if (!board) return reply.notFound()
      const canManage = await hasPermission(req.user, 'boards.manage')
      const canManageThis = canManage || board.ownerId === req.user.sub || await canManageBoard(req.params.id, req.user.sub)
      if (!canManageThis) return reply.forbidden('Sem permissão')

      await prisma.boardTeamShare.deleteMany({
        where: { boardId: req.params.id, teamId: req.params.teamId },
      })
      return reply.code(204).send()
    },
  )

  // ── Usuários elegíveis a virar responsável de um card neste board ──────────
  // Respeita visibility (público=todos, shared=dono+users+team-members, private=dono).
  app.get(
    '/kanban/boards/:id/eligible-users',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      const board = await prisma.board.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
        select: { id: true },
      })
      if (!board) return reply.notFound()
      const ids = await getBoardEligibleUserIds(req.params.id)
      if (ids.length === 0) return []
      const users = await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, email: true, settings: true },
        orderBy: { name: 'asc' },
      })
      return users
    },
  )

  // ── Columns ───────────────────────────────────────────────────────────────

  app.post(
    '/kanban/columns',
    {
      onRequest: [app.authenticate, requirePerm('boards.manage')],
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
      onRequest: [app.authenticate, requirePerm('boards.manage')],
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
      onRequest: [app.authenticate, requirePerm('boards.manage')],
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
      onRequest: [app.authenticate, requirePerm('boards.manage')],
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
      onRequest: [app.authenticate, requirePerm('cards.create')],
      schema: {
        body: z.object({
          columnId: z.string(),
          title: z.string().min(1),
          description: z.string().optional(),
          priority: priorityEnum.optional(),
          dueDate: z.string().optional(),
          contactId: z.string().optional(),
          companyId: z.string().optional(),
          conversationId: z.string().optional(),
          checklist: z.array(z.object({ text: z.string(), done: z.boolean() })).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const { columnId, title, description, priority, dueDate, contactId, companyId, conversationId, checklist } = req.body
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
          companyId,
          conversationId,
          createdByUserId: req.user.sub,
          checklist: checklist ?? [],
          position: (last?.position ?? -1) + 1,
        },
        include: {
          contact: { select: { id: true, name: true, phone: true } },
          company: { select: { id: true, name: true, color: true } },
          creator: { select: { id: true, name: true, email: true } },
        },
      })
      await eventBus.audit(workspaceId, 'card.created', {
        actorUserId: req.user.sub,
        targetType: 'card', targetId: card.id,
        payload: { origin: 'USER', columnId, title: card.title },
      })
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
          company: { select: { id: true, name: true, color: true } },
          conversation: { select: { id: true, externalId: true } },
          creator: { select: { id: true, name: true, email: true } },
          comments: { orderBy: { createdAt: 'asc' } },
          column: { select: { id: true, name: true, boardId: true } },
          contacts: {
            include: { contact: { select: { id: true, name: true, phone: true } } },
          },
          assignees: {
            include: { user: { select: { id: true, name: true, email: true, settings: true } } },
          },
        },
      })
      if (!card) return reply.notFound()
      // Achata p/ a UI: contacts[].contact → contacts[], assignees[].user → assignees[]
      return {
        ...card,
        contacts: card.contacts.map(c => c.contact),
        assignees: card.assignees.map(a => a.user),
      }
    },
  )

  // ── Card ↔ Contact (multi) ─────────────────────────────────────────────────
  app.post(
    '/kanban/cards/:id/contacts',
    {
      onRequest: [app.authenticate, requirePerm('cards.edit')],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ contactId: z.string() }),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const card = await prisma.card.findFirst({
        where: { id: req.params.id, workspaceId, deletedAt: null },
        select: { id: true },
      })
      if (!card) return reply.notFound()
      const contact = await prisma.contact.findFirst({
        where: { id: req.body.contactId, workspaceId },
        select: { id: true },
      })
      if (!contact) return reply.notFound('Contato não encontrado')

      await prisma.cardContact.upsert({
        where: { cardId_contactId: { cardId: req.params.id, contactId: req.body.contactId } },
        create: { cardId: req.params.id, contactId: req.body.contactId },
        update: {},
      })
      return reply.code(204).send()
    },
  )

  app.delete(
    '/kanban/cards/:id/contacts/:contactId',
    {
      onRequest: [app.authenticate, requirePerm('cards.edit')],
      schema: { params: z.object({ id: z.string(), contactId: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const card = await prisma.card.findFirst({
        where: { id: req.params.id, workspaceId, deletedAt: null },
        select: { id: true },
      })
      if (!card) return reply.notFound()

      await prisma.cardContact.deleteMany({
        where: { cardId: req.params.id, contactId: req.params.contactId },
      })
      return reply.code(204).send()
    },
  )

  // ── Card ↔ User assignee (multi) ───────────────────────────────────────────
  app.post(
    '/kanban/cards/:id/assignees',
    {
      onRequest: [app.authenticate, requirePerm('cards.edit')],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ userId: z.string() }),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const card = await prisma.card.findFirst({
        where: { id: req.params.id, workspaceId, deletedAt: null },
        select: { id: true, column: { select: { boardId: true } } },
      })
      if (!card) return reply.notFound()

      // Só permite vincular usuários elegíveis ao board (público=todos,
      // shared=dono+users+team-members, private=dono)
      const eligibleIds = await getBoardEligibleUserIds(card.column.boardId)
      if (!eligibleIds.includes(req.body.userId)) {
        return reply.badRequest('Usuário não tem acesso a este board')
      }

      await prisma.cardAssignee.upsert({
        where: { cardId_userId: { cardId: req.params.id, userId: req.body.userId } },
        create: { cardId: req.params.id, userId: req.body.userId },
        update: {},
      })
      return reply.code(204).send()
    },
  )

  app.delete(
    '/kanban/cards/:id/assignees/:userId',
    {
      onRequest: [app.authenticate, requirePerm('cards.edit')],
      schema: { params: z.object({ id: z.string(), userId: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const card = await prisma.card.findFirst({
        where: { id: req.params.id, workspaceId, deletedAt: null },
        select: { id: true },
      })
      if (!card) return reply.notFound()

      await prisma.cardAssignee.deleteMany({
        where: { cardId: req.params.id, userId: req.params.userId },
      })
      return reply.code(204).send()
    },
  )

  app.patch(
    '/kanban/cards/:id',
    {
      onRequest: [app.authenticate, requirePerm('cards.edit')],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          title: z.string().min(1).optional(),
          description: z.string().nullable().optional(),
          priority: priorityEnum.optional(),
          dueDate: z.string().nullable().optional(),
          checklist: z.array(z.object({ text: z.string(), done: z.boolean() })).optional(),
          contactId: z.string().nullable().optional(),
          companyId: z.string().nullable().optional(),
          labels: z.array(z.string()).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { title, description, priority, dueDate, checklist, contactId, companyId, labels } = req.body
      const card = await prisma.card.updateMany({
        where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
        data: {
          ...(title !== undefined && { title }),
          ...(description !== undefined && { description }),
          ...(priority !== undefined && { priority }),
          ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
          ...(checklist !== undefined && { checklist }),
          ...(contactId !== undefined && { contactId }),
          ...(companyId !== undefined && { companyId }),
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
      onRequest: [app.authenticate, requirePerm('cards.edit')],
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

      if (card.columnId === columnId) {
        // Same column move
        const colCards = await prisma.card.findMany({
          where: { columnId, deletedAt: null, id: { not: cardId } },
          orderBy: { position: 'asc' },
          select: { id: true },
        })
        
        // Insert at new index
        colCards.splice(position, 0, { id: cardId })
        
        await prisma.$transaction(
          colCards.map((c, idx) => 
            prisma.card.update({
              where: { id: c.id },
              data: { position: idx, columnId },
            })
          )
        )
      } else {
        // Cross column move
        const targetCards = await prisma.card.findMany({
          where: { columnId, deletedAt: null, id: { not: cardId } },
          orderBy: { position: 'asc' },
          select: { id: true },
        })
        
        targetCards.splice(position, 0, { id: cardId })
        
        const originCards = await prisma.card.findMany({
          where: { columnId: card.columnId, deletedAt: null, id: { not: cardId } },
          orderBy: { position: 'asc' },
          select: { id: true },
        })
        
        await prisma.$transaction([
          ...targetCards.map((c, idx) => 
            prisma.card.update({
              where: { id: c.id },
              data: { position: idx, columnId },
            })
          ),
          ...originCards.map((c, idx) => 
            prisma.card.update({
              where: { id: c.id },
              data: { position: idx, columnId: card.columnId },
            })
          )
        ])
      }

      // Fetch the updated card to return
      const updated = await prisma.card.findUnique({
        where: { id: cardId },
        select: { id: true, columnId: true, position: true },
      })

      await eventBus.audit(workspaceId, 'card.moved', {
        actorUserId: req.user.sub,
        targetType: 'card', targetId: cardId,
        payload: { columnId, position },
      })
      return { ok: true, card: updated }
    },
  )

  app.delete(
    '/kanban/cards/:id',
    {
      onRequest: [app.authenticate, requirePerm('cards.delete')],
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
      onRequest: [app.authenticate, requirePerm('cards.edit')],
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
      onRequest: [app.authenticate, requirePerm('cards.edit')],
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
      const waClient = await getClientForChannel(message.conversation.channelId)
      let base64: string
      let mimetype: string
      try {
        const result = await waClient.getMediaBase64(instanceName, att.key)
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

  // Upload direto de arquivo para o card (sem vir de mensagem).
  app.post(
    '/kanban/cards/:id/attachments',
    {
      onRequest: [app.authenticate, requirePerm('cards.edit')],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req: any, reply) => {
      const { workspaceId, sub: userId } = req.user
      const cardId = req.params.id

      const card = await prisma.card.findFirst({
        where: { id: cardId, workspaceId, deletedAt: null },
      })
      if (!card) return reply.notFound('Card não encontrado')

      const data = await req.file()
      if (!data) return reply.badRequest('Arquivo obrigatório')

      const chunks: Buffer[] = []
      for await (const chunk of data.file) chunks.push(chunk)
      const buffer = Buffer.concat(chunks)
      if (buffer.length > 64 * 1024 * 1024) {
        return reply.badRequest('Arquivo muito grande (máx 64 MB)')
      }

      const ext = data.mimetype.split('/')[1]?.split(';')[0] ?? 'bin'
      const safeName = (data.filename ?? `file.${ext}`).replace(/[^\w.\-]/g, '_')
      const storageKey = path.join(workspaceId, 'attachments', `${randomUUID()}-${safeName}`)
      const fullPath = path.join(env.STORAGE_PATH, storageKey)
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, buffer)

      const record = await prisma.attachment.create({
        data: {
          workspaceId,
          uploadedBy: userId,
          filename: data.filename ?? safeName,
          mimeType: data.mimetype,
          sizeBytes: buffer.length,
          storageKey,
          cardId,
        },
        select: { id: true, filename: true, mimeType: true, sizeBytes: true, storageKey: true, createdAt: true },
      })

      return reply.code(201).send(record)
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
        include: {
          shares: { where: { userId } },
          folder: { select: { ownerId: true, visibility: true } },
        },
      })
      if (!attachment) return reply.notFound()

      if (!attachment.cardId) {
        // Anexo da biblioteca — checa visibilidade
        let hasAccess = role === 'ADMIN' || attachment.uploadedBy === userId

        // Dentro de pasta: herda acesso da pasta (PUBLIC/SHARED/dono)
        if (!hasAccess && attachment.folder) {
          const f = attachment.folder
          if (f.visibility === 'PUBLIC') hasAccess = true
          else if (f.ownerId === userId) hasAccess = true
          else if (f.visibility === 'SHARED') {
            const share = await prisma.storageFolderShare.findUnique({
              where: { folderId_userId: { folderId: attachment.folderId!, userId } },
            })
            if (share) hasAccess = true
          }
        }

        // Arquivo solto (sem pasta) — usa visibility individual
        if (!hasAccess && !attachment.folder) {
          if (attachment.visibility === 'PUBLIC') hasAccess = true
          else if (attachment.visibility === 'SHARED' && attachment.shares.length > 0) hasAccess = true
        }

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

  // DELETE /storage/attachments/:id — remove o anexo (apenas de cards por enquanto).
  app.delete(
    '/storage/attachments/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId, role } = req.user
      const attachment = await prisma.attachment.findFirst({
        where: { id: req.params.id, workspaceId },
      })
      if (!attachment) return reply.notFound()

      // Quem pode remover: quem subiu, admin, ou quem tem cards.edit em anexos de card
      const isUploader = attachment.uploadedBy === userId
      const isAdmin = role === 'ADMIN'
      let canDelete = isUploader || isAdmin
      if (!canDelete && attachment.cardId) {
        canDelete = await hasPermission(req.user, 'cards.edit')
      }
      if (!canDelete) return reply.forbidden('Sem permissão para remover este anexo')

      // Apaga o arquivo do disco (best-effort)
      const fullPath = path.join(env.STORAGE_PATH, attachment.storageKey)
      await fs.unlink(fullPath).catch(() => {})

      await prisma.attachment.delete({ where: { id: attachment.id } })
      return reply.code(204).send()
    },
  )
}

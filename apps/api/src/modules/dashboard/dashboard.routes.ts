import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { hasPermission, requirePerm } from '../../lib/acl.js'
import { getTeamStats, getUserTeamIds } from '../teams/teams.service.js'

/**
 * Dashboard role-aware:
 *  - ADMIN  → KPIs do workspace inteiro (msgs hoje, contatos totais, execuções IA, etc.)
 *  - MEMBER → KPIs pessoais: minhas convs abertas, fila, próximos eventos, tarefas pendentes
 *
 * O frontend usa o flag `scope` no payload para decidir quais widgets renderizar.
 */
export const dashboardRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/dashboard/summary',
    { onRequest: [app.authenticate] },
    async (req) => {
      const { workspaceId, sub: userId, role } = req.user
      const isAdmin = role === 'ADMIN'
      const now = new Date()
      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
      const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999)
      const weekEnd    = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      const yesterday  = new Date(now.getTime() - 24 * 60 * 60 * 1000)

      if (isAdmin) {
        // ── ADMIN: visão de workspace ────────────────────────────────────────
        const [
          unreadAgg,
          openCards,
          todayEvents,
          aiExecutions,
          messagesToday,
          messagesYesterday,
          recentConversations,
          recentCards,
          channelBreakdown,
          contactsTotal,
          todayEventsList,
          reminders,
        ] = await Promise.all([
          // Não lidas do ponto de vista DESTE usuário: só conversas que ele ainda
          // não abriu (reads none). Ao ler, o ConversationRead some daqui mesmo que
          // o unreadCount global siga >0 (conversa de outro atendente / fila).
          prisma.conversation.aggregate({
            where: {
              workspaceId, archived: false,
              unreadCount: { gt: 0 },
              reads: { none: { userId } },
            },
            _sum: { unreadCount: true },
          }),
          // Demandas abertas: cards que NÃO estão numa coluna de conclusão (isDone)
          // e cujo board não foi deletado (board soft-deleted não some os cards).
          prisma.card.count({
            where: {
              workspaceId, deletedAt: null,
              column: { isDone: false, board: { deletedAt: null } },
            },
          }),
          prisma.calendarEvent.count({
            where: { workspaceId, startAt: { gte: todayStart, lte: todayEnd } },
          }),
          prisma.aIExecutionLog.count({
            where: { workspaceId, createdAt: { gte: yesterday } },
          }),
          prisma.message.count({
            where: { workspaceId, direction: 'INBOUND', sentAt: { gte: todayStart } },
          }),
          prisma.message.count({
            where: {
              workspaceId, direction: 'INBOUND',
              sentAt: { gte: new Date(todayStart.getTime() - 24 * 60 * 60 * 1000), lt: todayStart },
            },
          }),
          prisma.conversation.findMany({
            where: { workspaceId, archived: false, source: 'LIVE', NOT: { externalId: 'status@broadcast' } },
            orderBy: { lastMessageAt: 'desc' },
            take: 6,
            select: {
              id: true, externalId: true, isGroup: true, subject: true,
              unreadCount: true, lastMessageAt: true, status: true,
              contact: { select: { id: true, name: true, phone: true, email: true } },
              channel: { select: { id: true, type: true, label: true } },
              assignee: { select: { id: true, name: true, email: true, settings: true } },
              messages: { orderBy: { sentAt: 'desc' }, take: 1, select: { body: true, direction: true, sentAt: true } },
            },
          }),
          prisma.card.findMany({
            where: { workspaceId, deletedAt: null, column: { board: { deletedAt: null } } },
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: {
              id: true, title: true, priority: true, createdAt: true, createdBy: true,
              column: { select: { name: true } },
              contact: { select: { name: true, phone: true } },
            },
          }),
          prisma.$queryRaw<Array<{ type: string; total: bigint }>>`
            SELECT c.type, COUNT(m.id) as total
            FROM Message m
            JOIN Conversation cv ON cv.id = m.conversationId
            JOIN Channel c ON c.id = cv.channelId
            WHERE m.workspaceId = ${workspaceId}
              AND m.sentAt >= ${todayStart}
            GROUP BY c.type
          `,
          prisma.contact.count({ where: { workspaceId, mergedIntoId: null } }),
          // Eventos de hoje (agenda do dia) — para o painel pessoal do dashboard
          prisma.calendarEvent.findMany({
            where: { workspaceId, startAt: { gte: todayStart, lte: todayEnd } },
            orderBy: { startAt: 'asc' },
            take: 6,
            select: {
              id: true, title: true, startAt: true, endAt: true,
              contact: { select: { id: true, name: true, phone: true } },
              conversation: { select: { id: true } },
            },
          }),
          // Lembretes: tarefas pendentes atribuídas a este usuário
          prisma.task.findMany({
            where: { workspaceId, assigneeId: userId, done: false },
            orderBy: [{ remindAt: 'asc' }, { createdAt: 'desc' }],
            take: 5,
            select: {
              id: true, title: true, remindAt: true, conversationId: true,
              contact: { select: { id: true, name: true, phone: true } },
            },
          }),
        ])

        return {
          scope: 'admin' as const,
          kpis: {
            unreadMessages: unreadAgg._sum.unreadCount ?? 0,
            openCards,
            todayEvents,
            aiExecutionsLast24h: aiExecutions,
            messagesToday,
            messagesYesterday,
            contactsTotal,
          },
          recentConversations,
          recentCards,
          channelBreakdown: channelBreakdown.map(r => ({ type: r.type, total: Number(r.total) })),
          todayEventsList,
          reminders,
        }
      }

      // ── MEMBER: visão pessoal ──────────────────────────────────────────────
      const [
        myOpenConvs,
        queueCount,
        unreadMine,
        pendingTasks,
        upcomingEvents,
        recentConversations,
        recentTasks,
      ] = await Promise.all([
        // Conversas atribuídas a mim e ativas
        prisma.conversation.count({
          where: { workspaceId, assigneeId: userId, archived: false, status: { in: ['OPEN', 'WAITING'] } },
        }),

        // Conversas na fila do usuário: respeita eligibleAssigneeIds (fila restrita)
        prisma.conversation.count({
          where: {
            workspaceId,
            assigneeId: null,
            archived: false,
            status: { in: ['OPEN', 'WAITING'] },
            source: 'LIVE',
            type: 'EXTERNAL',
            unreadCount: { gt: 0 },
            NOT: { externalId: 'status@broadcast' },
            OR: [
              { eligibleAssigneeIds: { equals: Prisma.DbNull } },
              { eligibleAssigneeIds: { array_contains: userId } as any },
            ],
          },
        }),

        // Total de mensagens não lidas APENAS nas conversas atribuídas a mim
        // (mensagens em conversas na fila ficam zeradas pra esse usuário até ele assumir)
        prisma.conversation.aggregate({
          where: { workspaceId, archived: false, assigneeId: userId },
          _sum: { unreadCount: true },
        }),

        // Tarefas pendentes atribuídas a mim
        prisma.task.count({
          where: { workspaceId, assigneeId: userId, done: false },
        }),

        // Próximos eventos (7 dias)
        prisma.calendarEvent.findMany({
          where: { workspaceId, startAt: { gte: now, lte: weekEnd } },
          orderBy: { startAt: 'asc' },
          take: 5,
          select: {
            id: true, title: true, startAt: true, endAt: true,
            contact: { select: { id: true, name: true, phone: true } },
            conversation: { select: { id: true } },
          },
        }),

        // Conversas recentes — APENAS as que o usuário está atendendo
        // (a fila pública já tem KPI próprio "Na fila pública" — não duplica aqui)
        prisma.conversation.findMany({
          where: {
            workspaceId, archived: false, source: 'LIVE',
            assigneeId: userId,
            NOT: { externalId: 'status@broadcast' },
          },
          orderBy: { lastMessageAt: 'desc' },
          take: 6,
          select: {
            id: true, externalId: true, isGroup: true, subject: true,
            unreadCount: true, lastMessageAt: true, status: true, assigneeId: true,
            contact: { select: { id: true, name: true, phone: true, email: true } },
            channel: { select: { id: true, type: true, label: true } },
            assignee: { select: { id: true, name: true, email: true, settings: true } },
            messages: { orderBy: { sentAt: 'desc' }, take: 1, select: { body: true, direction: true, sentAt: true } },
          },
        }),

        // Minhas tarefas pendentes (preview)
        prisma.task.findMany({
          where: { workspaceId, assigneeId: userId, done: false },
          orderBy: [{ remindAt: 'asc' }, { createdAt: 'desc' }],
          take: 5,
          select: {
            id: true, title: true, remindAt: true, conversationId: true,
            contact: { select: { id: true, name: true, phone: true } },
          },
        }),
      ])

      return {
        scope: 'member' as const,
        kpis: {
          myOpenConversations: myOpenConvs,
          queueCount,
          unreadMessages: unreadMine._sum.unreadCount ?? 0,
          pendingTasks,
        },
        upcomingEvents,
        recentConversations,
        recentTasks,
      }
    },
  )

  // ─── Dashboard de setores (times) ──────────────────────────────────────────
  // Lista stats por team. Quem não tem teams.viewAll vê só os seus.
  app.get(
    '/dashboard/teams',
    { onRequest: [app.authenticate, requirePerm('teams.view')] },
    async (req) => {
      const { workspaceId, sub: userId } = req.user
      const canViewAll = await hasPermission(req.user, 'teams.viewAll')
      const teams = await prisma.team.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          ...(!canViewAll && { members: { some: { userId, isActive: true } } }),
        },
        select: {
          id: true, name: true, slug: true, color: true, icon: true,
          distributionMode: true, isActive: true,
          slaFirstResponseMin: true, slaResolutionMin: true,
          _count: { select: { members: true } },
        },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      })
      const stats = await Promise.all(teams.map((t) => getTeamStats(workspaceId, t.id)))
      return teams.map((t, i) => ({ ...t, stats: stats[i] }))
    },
  )

  // ─── Carga por agente dentro de um team ────────────────────────────────────
  app.get(
    '/dashboard/teams/:id/agents',
    {
      onRequest: [app.authenticate, requirePerm('teams.view')],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const canViewAll = await hasPermission(req.user, 'teams.viewAll')
      const team = await prisma.team.findFirst({
        where: { id: req.params.id, workspaceId, deletedAt: null },
        select: { id: true },
      })
      if (!team) return reply.notFound('Time não encontrado')
      if (!canViewAll) {
        const ids = await getUserTeamIds(userId)
        if (!ids.includes(team.id)) return reply.forbidden('Sem acesso a este setor')
      }

      const memberships = await prisma.teamMembership.findMany({
        where: { teamId: team.id, isActive: true, user: { deletedAt: null } },
        include: { user: { select: { id: true, name: true, email: true } } },
      })
      const userIds = memberships.map((m) => m.userId)
      if (userIds.length === 0) return []

      const [openCounts, recent] = await Promise.all([
        prisma.conversation.groupBy({
          by: ['assigneeId'],
          where: { workspaceId, teamId: team.id, status: 'OPEN', assigneeId: { in: userIds } },
          _count: { _all: true },
        }),
        prisma.conversation.findMany({
          where: {
            workspaceId,
            teamId: team.id,
            assigneeId: { in: userIds },
            firstResponseAt: { not: null },
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
          select: { assigneeId: true, createdAt: true, firstResponseAt: true },
          take: 500,
        }),
      ])

      const openByUser = new Map(openCounts.map((c) => [c.assigneeId, c._count._all]))
      const sumByUser = new Map<string, { sum: number; n: number }>()
      for (const r of recent) {
        if (!r.assigneeId) continue
        const cur = sumByUser.get(r.assigneeId) ?? { sum: 0, n: 0 }
        cur.sum += (r.firstResponseAt!.getTime() - r.createdAt.getTime())
        cur.n += 1
        sumByUser.set(r.assigneeId, cur)
      }

      return memberships.map((m) => {
        const avg = sumByUser.get(m.userId)
        return {
          user: m.user,
          role: m.role,
          capacity: m.capacity,
          openConversations: openByUser.get(m.userId) ?? 0,
          avgFirstResponseMin: avg && avg.n > 0 ? Math.round(avg.sum / avg.n / 60_000) : null,
        }
      })
    },
  )
}

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { prisma } from '../../lib/prisma.js'

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
        ] = await Promise.all([
          prisma.conversation.aggregate({
            where: { workspaceId, archived: false },
            _sum: { unreadCount: true },
          }),
          prisma.card.count({
            where: {
              workspaceId, deletedAt: null,
              column: { name: { notIn: ['Concluído', 'Done', 'Finalizado'] } },
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
            where: { workspaceId, deletedAt: null },
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

        // Conversas na fila pública (sem atribuição)
        prisma.conversation.count({
          where: { workspaceId, assigneeId: null, archived: false, status: { in: ['OPEN', 'WAITING'] }, source: 'LIVE' },
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
}

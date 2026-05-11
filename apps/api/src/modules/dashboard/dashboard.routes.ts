import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { prisma } from '../../lib/prisma.js'

export const dashboardRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/dashboard/summary',
    { onRequest: [app.authenticate] },
    async (req) => {
      const { workspaceId } = req.user

      const [unreadMessages, openCards, todayEvents, aiExecutions] = await Promise.all([
        prisma.conversation.aggregate({
          where: { workspaceId },
          _sum: { unreadCount: true },
        }),
        prisma.card.count({
          where: {
            workspaceId,
            deletedAt: null,
            column: { name: { notIn: ['Concluído'] } },
          },
        }),
        prisma.calendarEvent.count({
          where: {
            workspaceId,
            startAt: {
              gte: new Date(new Date().setHours(0, 0, 0, 0)),
              lt: new Date(new Date().setHours(23, 59, 59, 999)),
            },
          },
        }),
        prisma.aIExecutionLog.count({
          where: {
            workspaceId,
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        }),
      ])

      return {
        unreadMessages: unreadMessages._sum.unreadCount ?? 0,
        openCards,
        todayEvents,
        aiExecutionsLast24h: aiExecutions,
      }
    },
  )
}

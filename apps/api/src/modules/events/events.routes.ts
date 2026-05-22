import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'

export const eventsRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /events — listagem com filtros + paginação por cursor
  app.get(
    '/events',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          type: z.string().optional(),
          actorUserId: z.string().optional(),
          targetType: z.string().optional(),
          targetId: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          cursor: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
    },
    async (req) => {
      const { workspaceId } = req.user
      const { type, actorUserId, targetType, targetId, from, to, cursor, limit } = req.query

      const events = await prisma.eventLog.findMany({
        where: {
          workspaceId,
          ...(type && { type }),
          ...(actorUserId && { actorUserId }),
          ...(targetType && { targetType }),
          ...(targetId && { targetId }),
          ...((from || to) && {
            createdAt: {
              ...(from && { gte: new Date(from) }),
              ...(to && { lte: new Date(to) }),
            },
          }),
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        include: {
          actor: { select: { id: true, name: true, email: true } },
        },
      })

      const hasMore = events.length > limit
      const items = hasMore ? events.slice(0, limit) : events
      return {
        events: items,
        nextCursor: hasMore ? items[items.length - 1].id : null,
      }
    },
  )

  // GET /events/types — lista de tipos distintos pra alimentar o filtro
  app.get(
    '/events/types',
    { onRequest: [app.authenticate] },
    async (req) => {
      const rows = await prisma.eventLog.findMany({
        where: { workspaceId: req.user.workspaceId },
        distinct: ['type'],
        select: { type: true },
        orderBy: { type: 'asc' },
      })
      return rows.map((r) => r.type)
    },
  )

  // GET /conversations/:id/timeline — eventos relacionados a uma conversa, crono ASC
  app.get(
    '/conversations/:id/timeline',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const conv = await prisma.conversation.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId },
        select: { id: true, createdAt: true },
      })
      if (!conv) return reply.notFound()

      const events = await prisma.eventLog.findMany({
        where: {
          workspaceId: req.user.workspaceId,
          OR: [
            { targetType: 'conversation', targetId: req.params.id },
            // legacy: alguns events guardam conversationId no payload (JSON path no MySQL)
            { type: { in: ['conversation.claimed', 'conversation.released', 'conversation.status_changed', 'conversation.moved', 'conversation.deleted', 'conversation.first_response', 'conversation.resolved'] } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        include: { actor: { select: { id: true, name: true, email: true } } },
      })

      // Filtra eventos legacy pelo payload.conversationId em código (pra MySQL agnóstico)
      const filtered = events.filter((e) => {
        if (e.targetType === 'conversation' && e.targetId === req.params.id) return true
        const p = e.payload as Record<string, unknown> | null
        return p?.conversationId === req.params.id
      })

      return { conversationId: conv.id, events: filtered }
    },
  )
}

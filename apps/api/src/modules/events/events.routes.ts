import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'

export const eventsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/events',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          type: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
    },
    async (req) => {
      const { workspaceId } = req.user
      const { type, from, to, limit } = req.query

      const events = await prisma.eventLog.findMany({
        where: {
          workspaceId,
          ...(type && { type }),
          ...((from || to) && {
            createdAt: {
              ...(from && { gte: new Date(from) }),
              ...(to && { lte: new Date(to) }),
            },
          }),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      })

      return events
    },
  )
}

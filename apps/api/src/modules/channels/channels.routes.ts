import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  listChannels,
  createWhatsAppChannel,
  getChannelQr,
  syncChannelStatus,
  deleteChannel,
} from './channels.service.js'

export const channelsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/channels', { onRequest: [app.authenticate] }, async (req) => {
    return listChannels(req.user.workspaceId)
  })

  app.post(
    '/channels/whatsapp',
    {
      onRequest: [app.authenticate],
      schema: { body: z.object({ label: z.string().min(1) }) },
    },
    async (req, reply) => {
      const channel = await createWhatsAppChannel(req.user.workspaceId, req.body.label)
      return reply.code(201).send(channel)
    },
  )

  app.get('/channels/:id/qr', { onRequest: [app.authenticate] }, async (req: any) => {
    return getChannelQr(req.params.id)
  })

  app.get('/channels/:id/status', { onRequest: [app.authenticate] }, async (req: any) => {
    return syncChannelStatus(req.params.id)
  })

  app.delete('/channels/:id', { onRequest: [app.authenticate] }, async (req: any, reply) => {
    await deleteChannel(req.params.id)
    return reply.code(204).send()
  })
}

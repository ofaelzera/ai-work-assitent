import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  listEvolutionServers,
  createEvolutionServer,
  updateEvolutionServer,
  deleteEvolutionServer,
  healthcheckServer,
  getServerCredentials,
  listServerInstances,
} from './evolution-servers.service.js'
import { addServerSocket, removeServerSocket } from '../channels/evolution.socket.js'

export const evolutionServersRoutes: FastifyPluginAsyncZod = async (app) => {
  // Listar servidores
  app.get(
    '/evolution-servers',
    { onRequest: [app.authenticate] },
    async (req) => {
      return listEvolutionServers()
    },
  )

  // Criar servidor
  app.post(
    '/evolution-servers',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          name: z.string().min(1),
          url: z.string().url(),
          apiKey: z.string().min(1),
          maxInstances: z.number().int().positive().optional(),
          priority: z.number().int().optional(),
        }),
      },
    },
    async (req, reply) => {
      const server = await createEvolutionServer(req.body)

      // Inicia socket para o novo servidor imediatamente
      try {
        const creds = await getServerCredentials(server.id)
        addServerSocket(creds)
      } catch {
        // Não falha se o socket não iniciar
      }

      return reply.code(201).send(server)
    },
  )

  // Atualizar servidor
  app.patch(
    '/evolution-servers/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().min(1).optional(),
          url: z.string().url().optional(),
          apiKey: z.string().min(1).optional(),
          maxInstances: z.number().int().positive().optional(),
          priority: z.number().int().optional(),
          status: z.enum(['ACTIVE', 'INACTIVE', 'MAINTENANCE']).optional(),
        }),
      },
    },
    async (req, reply) => {
      const server = await updateEvolutionServer(req.params.id, req.body)

      // Se URL/apiKey mudou ou status mudou, reinicia o socket
      if (req.body.url || req.body.apiKey || req.body.status) {
        removeServerSocket(req.params.id)
        if (server.status === 'ACTIVE') {
          try {
            const creds = await getServerCredentials(req.params.id)
            addServerSocket(creds)
          } catch {
            // Silencioso
          }
        }
      }

      return server
    },
  )

  // Deletar servidor
  app.delete(
    '/evolution-servers/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      removeServerSocket(req.params.id)
      await deleteEvolutionServer(req.params.id)
      return reply.code(204).send()
    },
  )

  // Listar instâncias de um servidor (para reaproveitamento)
  app.get(
    '/evolution-servers/:id/instances',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req) => {
      return listServerInstances(req.params.id, req.user.workspaceId)
    },
  )

  // Healthcheck manual
  app.post(
    '/evolution-servers/:id/healthcheck',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req) => {
      return healthcheckServer(req.params.id)
    },
  )
}

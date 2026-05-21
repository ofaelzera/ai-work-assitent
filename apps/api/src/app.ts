import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyCookie from '@fastify/cookie'
import fastifyHelmet from '@fastify/helmet'
import fastifyCors from '@fastify/cors'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifySensible from '@fastify/sensible'
import fastifyMultipart from '@fastify/multipart'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { env } from './config/env.js'
import { logger } from './lib/logger.js'
import { redis } from './lib/redis.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js'
import { channelsRoutes } from './modules/channels/channels.routes.js'
import { webhookRoutes } from './modules/channels/webhook.routes.js'
import { conversationsRoutes } from './modules/messages/conversations.routes.js'
import { kanbanRoutes } from './modules/kanban/kanban.routes.js'
import { contactsRoutes } from './modules/contacts/contacts.routes.js'
import { companiesRoutes } from './modules/contacts/companies.routes.js'
import { aiRoutes } from './modules/ai/ai.routes.js'
import { tasksRoutes } from './modules/tasks/tasks.routes.js'
import { vaultRoutes } from './modules/vault/vault.routes.js'
import { calendarRoutes } from './modules/calendar/calendar.routes.js'
import { eventsRoutes } from './modules/events/events.routes.js'
import { usersRoutes } from './modules/users/users.routes.js'
import { workspaceRoutes } from './modules/workspaces/workspace.routes.js'
import { storageRoutes } from './modules/storage/storage.routes.js'
import type { JwtPayload } from '@aiwa/shared'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload
    user: JwtPayload
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

import type { FastifyRequest, FastifyReply } from 'fastify'

export async function buildApp() {
  const app = Fastify({ logger })

  // Serialization / Validation com Zod
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  // Sensible (httpErrors helpers)
  await app.register(fastifySensible)

  // Multipart (upload de arquivos)
  await app.register(fastifyMultipart, { limits: { fileSize: 64 * 1024 * 1024 } }) // 64 MB

  // Plugins de segurança
  await app.register(fastifyHelmet, { contentSecurityPolicy: false })
  await app.register(fastifyCors, {
    origin: env.NODE_ENV === 'production' ? false : true,
    credentials: true,
  })
  await app.register(fastifyRateLimit, {
    max: 200,
    timeWindow: '1 minute',
    redis,
  })

  // Auth
  await app.register(fastifyCookie)
  await app.register(fastifyJwt, { secret: env.JWT_ACCESS_SECRET })

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify()
    } catch {
      reply.unauthorized('Token inválido ou expirado')
    }
  })

  // Healthcheck
  app.get('/health', async () => ({ status: 'ok', ts: Date.now() }))

  // SSE — aceita token via query string (EventSource não suporta headers)
  app.get('/sse', async (req: FastifyRequest<{ Querystring: { token?: string } }>, reply) => {
    const token = (req.query as any).token as string | undefined
    if (!token) return reply.unauthorized('Token obrigatório')

    try {
      app.jwt.verify(token)
    } catch {
      return reply.unauthorized('Token inválido')
    }

    // CORS manual — reply.raw bypassa os hooks do @fastify/cors
    const origin = req.headers.origin
    if (origin) {
      reply.raw.setHeader('Access-Control-Allow-Origin', origin)
      reply.raw.setHeader('Access-Control-Allow-Credentials', 'true')
    }
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no') // evita buffer em proxies (nginx)
    reply.raw.flushHeaders()

    const { eventBus } = await import('./lib/eventBus.js')
    const handler = (event: { type: string; payload: unknown }) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    eventBus.on('*', handler)
    req.raw.on('close', () => eventBus.off('*', handler))

    await new Promise<void>((resolve) => req.raw.on('close', resolve))
  })

  // Rotas
  await app.register(authRoutes)
  await app.register(dashboardRoutes)
  await app.register(channelsRoutes)
  await app.register(webhookRoutes)
  await app.register(conversationsRoutes)
  await app.register(kanbanRoutes)
  await app.register(contactsRoutes)
  await app.register(companiesRoutes)
  await app.register(aiRoutes)
  await app.register(tasksRoutes)
  await app.register(vaultRoutes)
  await app.register(calendarRoutes)
  await app.register(eventsRoutes)
  await app.register(usersRoutes)
  await app.register(workspaceRoutes)
  await app.register(storageRoutes)

  return app
}

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
import { isSetupCompleted } from './lib/setup-status.js'
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
import { rolesRoutes } from './modules/workspaces/roles.routes.js'
import { storageRoutes } from './modules/storage/storage.routes.js'
import { reportsRoutes } from './modules/reports/reports.routes.js'
import { chatRoutes } from './modules/chat/chat.routes.js'
import { quickRepliesRoutes } from './modules/quick-replies/quick-replies.routes.js'
import { evolutionServersRoutes } from './modules/evolution-servers/evolution-servers.routes.js'
import { teamsRoutes } from './modules/teams/teams.routes.js'
import { routingRulesRoutes } from './modules/routing/rules.routes.js'
import { flowsRoutes } from './modules/flows/flows.routes.js'
import { setupRoutes } from './modules/setup/setup.routes.js'
import { systemSettingsRoutes } from './modules/system-settings/system-settings.routes.js'
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

  const IS_SETUP_COMPLETED = await isSetupCompleted()

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
  
  // Condicional para Redis no Rate Limit
  const rateLimitOptions: any = {
    max: 200,
    timeWindow: '1 minute',
  }
  if (IS_SETUP_COMPLETED) {
    rateLimitOptions.redis = redis
  }
  await app.register(fastifyRateLimit, rateLimitOptions)

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
  app.get('/health', async () => ({ status: 'ok', ts: Date.now(), setup_completed: IS_SETUP_COMPLETED }))

  // Interceptor de Setup
  app.addHook('onRequest', async (req, reply) => {
    if (IS_SETUP_COMPLETED) return

    if (req.method === 'OPTIONS') return

    const url = req.url
    // Permite rotas necessárias para o setup funcionar
    if (url.startsWith('/setup') || url.startsWith('/system-settings/public') || url === '/health') {
      return
    }

    // Bloqueia todo o resto
    return reply.status(503).send({
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'Sistema aguardando instalação inicial',
      setup_required: true
    })
  })

  // Rotas de Setup e Config
  await app.register(setupRoutes, { prefix: '/setup' })
  
  if (IS_SETUP_COMPLETED) {
    await app.register(systemSettingsRoutes, { prefix: '/system-settings' })
    
    // SSE — aceita token via query string
    app.get('/sse', async (req: FastifyRequest<{ Querystring: { token?: string } }>, reply) => {
      const token = (req.query as any).token as string | undefined
      if (!token) return reply.unauthorized('Token obrigatório')

      let decoded: { sub: string; workspaceId: string } | null = null
      try {
        decoded = app.jwt.verify(token) as any
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
      const { trackOnline, trackOffline, isOnline } = await import('./lib/presence.js')
      const handler = (event: { type: string; payload: unknown }) => {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
      }

      eventBus.on('*', handler)

      // Marca usuário como online enquanto a conexão SSE estiver ativa
      const userId = decoded?.sub ?? null
      const workspaceId = decoded?.workspaceId ?? null
      if (userId) {
        trackOnline(userId)
        if (workspaceId) {
          eventBus.emit('*', {
            workspaceId,
            type: 'chat.presence',
            payload: { userId, status: 'online' },
          })
        }
      }

      req.raw.on('close', () => {
        eventBus.off('*', handler)
        if (userId) {
          trackOffline(userId)
          if (workspaceId) {
            setTimeout(() => {
              if (!isOnline(userId)) {
                eventBus.emit('*', {
                  workspaceId,
                  type: 'chat.presence',
                  payload: { userId, status: 'offline' },
                })
              }
            }, 2_000)
          }
        }
      })

      await new Promise<void>((resolve) => req.raw.on('close', resolve))
    })

    // Rotas do Domínio
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
    await app.register(rolesRoutes)
    await app.register(storageRoutes)
    await app.register(reportsRoutes)
    await app.register(chatRoutes)
    await app.register(quickRepliesRoutes)
    await app.register(evolutionServersRoutes)
    await app.register(teamsRoutes)
    await app.register(routingRulesRoutes)
    await app.register(flowsRoutes)
  } else {
    // Registra public configs mesmo em setup mode para a UI
    await app.register(systemSettingsRoutes, { prefix: '/system-settings' })
  }

  return app
}

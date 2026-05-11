import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyCookie from '@fastify/cookie'
import fastifyHelmet from '@fastify/helmet'
import fastifyCors from '@fastify/cors'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifySensible from '@fastify/sensible'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { env } from './config/env.js'
import { logger } from './lib/logger.js'
import { redis } from './lib/redis.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js'
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

  // SSE — stream de eventos para o front
  app.get('/sse', { onRequest: [app.authenticate] }, async (req, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
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

  return app
}

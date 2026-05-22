import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { LoginSchema, RegisterSchema } from '@aiwa/shared'
import { loginUser, refreshAccessToken, revokeRefreshToken } from './auth.service.js'

const REFRESH_COOKIE = 'refresh_token'
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/auth',
  maxAge: 7 * 24 * 60 * 60,
}

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/auth/login',
    {
      schema: {
        body: LoginSchema,
        response: { 200: z.object({ accessToken: z.string() }) },
      },
    },
    async (req, reply) => {
      const { accessToken, refreshToken } = await loginUser(app, req.body)
      reply.setCookie(REFRESH_COOKIE, refreshToken, COOKIE_OPTS)
      return { accessToken }
    },
  )

  app.post(
    '/auth/refresh',
    {
      schema: {
        response: { 200: z.object({ accessToken: z.string() }) },
      },
    },
    async (req, reply) => {
      const token = req.cookies[REFRESH_COOKIE]
      if (!token) throw app.httpErrors.unauthorized('Sem refresh token')
      const { accessToken } = await refreshAccessToken(app, token)
      return { accessToken }
    },
  )

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE]
    if (token) await revokeRefreshToken(token)
    reply.clearCookie(REFRESH_COOKIE, { path: '/auth' })
    return { ok: true }
  })

  app.get(
    '/auth/me',
    { onRequest: [app.authenticate] },
    async (req) => {
      const { listPermissions } = await import('../../lib/acl.js')
      const permissions = await listPermissions(req.user)
      return { ...req.user, permissions }
    },
  )
}

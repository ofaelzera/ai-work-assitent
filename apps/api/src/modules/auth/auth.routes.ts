import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { LoginSchema, RegisterSchema } from '@aiwa/shared'
import {
  loginUser,
  loginOrLinkWithGoogle,
  refreshAccessToken,
  revokeRefreshToken,
} from './auth.service.js'
import { env } from '../../config/env.js'

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

  // ── Google OAuth ────────────────────────────────────────────────────────────

  app.get('/auth/google', async () => {
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID ?? '',
      redirect_uri: env.GOOGLE_AUTH_REDIRECT_URI ?? '',
      response_type: 'code',
      scope: [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/calendar',
      ].join(' '),
      access_type: 'offline',
      prompt: 'consent',
    })
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` }
  })

  app.get(
    '/auth/google/callback',
    {
      schema: {
        querystring: z.object({
          code: z.string().optional(),
          error: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const webUrl = env.WEB_URL ?? 'http://localhost:3000'

      if (req.query.error || !req.query.code) {
        return reply.redirect(`${webUrl}/login?error=google_denied`)
      }

      // Exchange authorization code for tokens
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID ?? '',
          client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
          redirect_uri: env.GOOGLE_AUTH_REDIRECT_URI ?? '',
          code: req.query.code,
          grant_type: 'authorization_code',
        }),
      })

      if (!tokenRes.ok) {
        req.log.error({ status: tokenRes.status }, 'Google token exchange failed')
        return reply.redirect(`${webUrl}/login?error=google_token`)
      }

      const tokenData = (await tokenRes.json()) as any

      // Fetch Google user info
      const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      })

      if (!userRes.ok) {
        return reply.redirect(`${webUrl}/login?error=google_userinfo`)
      }

      const googleUser = (await userRes.json()) as {
        sub: string
        email: string
        name: string
      }

      const googleTokens = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expiry_date: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
        token_type: tokenData.token_type ?? 'Bearer',
      }

      try {
        const { accessToken, refreshToken } = await loginOrLinkWithGoogle(
          app,
          googleUser,
          googleTokens,
        )
        reply.setCookie(REFRESH_COOKIE, refreshToken, COOKIE_OPTS)
        return reply.redirect(
          `${webUrl}/google-callback?access_token=${accessToken}`,
        )
      } catch (err: any) {
        req.log.warn({ err }, 'Google login failed')
        const msg = encodeURIComponent(err?.message ?? 'Erro ao fazer login com Google')
        return reply.redirect(`${webUrl}/login?error=${msg}`)
      }
    },
  )
}

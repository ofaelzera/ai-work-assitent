import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import { prisma } from '../../lib/prisma.js'
import { encryptJson } from '../../lib/crypto.js'
import { eventBus } from '../../lib/eventBus.js'
import { env } from '../../config/env.js'
import {
  getValidGoogleToken as getValidToken,
  googleCalendarFetch,
  type GoogleTokens,
} from './google.service.js'
import { syncCalendarAccount } from '../../workers/calendarSync.worker.js'

// ─── Types locais ─────────────────────────────────────────────────────────────

interface CalendarStatePayload {
  sub: string
  workspaceId: string
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export const calendarRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /calendar/accounts — list connected Google accounts
  app.get('/calendar/accounts', { onRequest: [app.authenticate] }, async (req) => {
    const accounts = await prisma.calendarAccount.findMany({
      where: { workspaceId: req.user.workspaceId, userId: req.user.sub },
      select: { id: true, provider: true, email: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: 'asc' },
    })
    return accounts
  })

  // GET /calendar/auth — returns OAuth consent screen URL with a state token
  app.get('/calendar/auth', { onRequest: [app.authenticate] }, async (req) => {
    const state = jwt.sign(
      { sub: req.user.sub, workspaceId: req.user.workspaceId },
      env.JWT_ACCESS_SECRET,
      { expiresIn: '10m' },
    )

    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID ?? '',
      redirect_uri: env.GOOGLE_REDIRECT_URI ?? '',
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar email profile',
      access_type: 'offline',
      prompt: 'consent',
      state,
    })
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
    return { url }
  })

  // GET /calendar/callback — handles OAuth redirect from Google (NO auth middleware)
  app.get(
    '/calendar/callback',
    {
      schema: {
        querystring: z.object({
          code: z.string().optional(),
          state: z.string().optional(),
          error: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const webUrl = env.WEB_URL ?? 'http://localhost:3000'

      if (req.query.error || !req.query.code || !req.query.state) {
        return reply.redirect(`${webUrl}/profile?google_error=denied`)
      }

      let userId: string
      let workspaceId: string
      try {
        const payload = jwt.verify(req.query.state, env.JWT_ACCESS_SECRET) as CalendarStatePayload
        userId = payload.sub
        workspaceId = payload.workspaceId
      } catch {
        return reply.redirect(`${webUrl}/profile?google_error=state_invalid`)
      }

      // Exchange authorization code for tokens
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID ?? '',
          client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
          redirect_uri: env.GOOGLE_REDIRECT_URI ?? '',
          code: req.query.code,
          grant_type: 'authorization_code',
        }),
      })

      if (!tokenRes.ok) {
        req.log.error({ status: tokenRes.status }, 'Google Calendar token exchange failed')
        return reply.redirect(`${webUrl}/profile?google_error=token`)
      }

      const data = (await tokenRes.json()) as any

      const tokens: GoogleTokens = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expiry_date: Date.now() + (data.expires_in ?? 3600) * 1000,
        token_type: data.token_type ?? 'Bearer',
      }

      // Fetch email for the CalendarAccount label
      let calendarEmail: string | null = null
      try {
        const uiRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${data.access_token}` },
        })
        if (uiRes.ok) {
          const ui = (await uiRes.json()) as any
          calendarEmail = ui.email ?? null
        }
      } catch {}

      const encrypted = encryptJson(tokens)

      await prisma.calendarAccount.upsert({
        where: {
          workspaceId_userId_provider: { workspaceId, userId, provider: 'google' },
        },
        create: {
          workspaceId,
          userId,
          provider: 'google',
          email: calendarEmail,
          tokens: {
            ciphertext: Array.from(encrypted.ciphertext),
            iv: Array.from(encrypted.iv),
            authTag: Array.from(encrypted.authTag),
          },
        },
        update: {
          email: calendarEmail,
          tokens: {
            ciphertext: Array.from(encrypted.ciphertext),
            iv: Array.from(encrypted.iv),
            authTag: Array.from(encrypted.authTag),
          },
        },
      })

      eventBus.emit('calendar:connected', { userId, workspaceId })

      return reply.redirect(`${webUrl}/profile?google=connected`)
    },
  )

  // DELETE /calendar/accounts/:id — disconnect account
  app.delete(
    '/calendar/accounts/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const existing = await prisma.calendarAccount.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId, userId: req.user.sub },
      })

      if (!existing) return reply.notFound('Calendar account not found')

      await prisma.calendarEvent.deleteMany({ where: { calendarAccountId: req.params.id } })
      await prisma.calendarAccount.delete({ where: { id: req.params.id } })

      return reply.code(204).send()
    },
  )

  // GET /calendar/events?from=&to=&accountId= — list events from DB
  app.get(
    '/calendar/events',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          from: z.string().datetime().optional(),
          to: z.string().datetime().optional(),
          accountId: z.string().optional(),
          contactId: z.string().optional(),
          conversationId: z.string().optional(),
        }),
      },
    },
    async (req) => {
      const { from, to, accountId, contactId, conversationId } = req.query
      const ownerId = req.user.sub

      const accounts = await prisma.calendarAccount.findMany({
        where: {
          workspaceId: req.user.workspaceId,
          userId: ownerId,
          ...(accountId ? { id: accountId } : {}),
        },
        select: { id: true },
      })
      const accountIds = accounts.map((a) => a.id)

      const visibilityFilter = accountId
        ? { calendarAccountId: accountId }
        : { OR: [
            { ownerId, calendarAccountId: null },
            ...(accountIds.length > 0 ? [{ calendarAccountId: { in: accountIds } }] : []),
          ] }

      const events = await prisma.calendarEvent.findMany({
        where: {
          workspaceId: req.user.workspaceId,
          ...visibilityFilter,
          ...(from ? { startAt: { gte: new Date(from) } } : {}),
          ...(to ? { endAt: { lte: new Date(to) } } : {}),
          ...(contactId ? { contactId } : {}),
          ...(conversationId ? { conversationId } : {}),
        },
        orderBy: { startAt: 'asc' },
        include: {
          contact: { select: { id: true, name: true, phone: true } },
          conversation: { select: { id: true, subject: true, isGroup: true } },
        },
      })

      return events
    },
  )

  // POST /calendar/sync — manual trigger (auto-sync runs via worker every 15 min)
  app.post(
    '/calendar/sync',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({ accountId: z.string().optional() }),
      },
    },
    async (req, reply) => {
      const { accountId } = req.body

      const accounts = await prisma.calendarAccount.findMany({
        where: {
          workspaceId: req.user.workspaceId,
          userId: req.user.sub,
          ...(accountId ? { id: accountId } : {}),
        },
      })

      if (accounts.length === 0) return reply.notFound('No calendar accounts found')

      let total = 0
      for (const account of accounts) {
        try {
          const count = await syncCalendarAccount(account)
          total += count
        } catch (err) {
          req.log.error({ err, accountId: account.id }, 'Manual sync error')
          throw err
        }
      }

      eventBus.emit('calendar:synced', { count: total })

      return { synced: total }
    },
  )

  // POST /calendar/events — create local event; optionally sync with Google
  app.post(
    '/calendar/events',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          accountId: z.string().optional(),
          title: z.string().min(1),
          startAt: z.string().datetime(),
          endAt: z.string().datetime(),
          description: z.string().optional(),
          location: z.string().optional(),
          attendees: z.array(z.object({
            email: z.string().email(),
            name: z.string().optional(),
          })).optional(),
          createMeetLink: z.boolean().optional(),
          allDay: z.boolean().optional(),
          cardId: z.string().optional(),
          contactId: z.string().optional(),
          conversationId: z.string().optional(),
          messageId: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const {
        accountId, title, startAt, endAt, description, location,
        attendees, createMeetLink, allDay,
        cardId, contactId, conversationId, messageId,
      } = req.body
      const ownerId = req.user.sub

      let externalId: string | null = null
      let validAccountId: string | null = null
      let resolvedMeetLink: string | null = null

      if (accountId) {
        const account = await prisma.calendarAccount.findFirst({
          where: { id: accountId, workspaceId: req.user.workspaceId, userId: ownerId },
        })
        if (!account) return reply.notFound('Conta de calendário não encontrada')

        const accessToken = await getValidToken(account)

        const fullDescription = conversationId
          ? `${description ?? ''}\n\n— Origem: ${req.protocol}://${req.hostname}/inbox/${conversationId}`.trim()
          : description

        const googleBody: Record<string, unknown> = {
          summary: title,
          description: fullDescription,
          location: location ?? undefined,
          start: allDay ? { date: startAt.split('T')[0] } : { dateTime: startAt },
          end: allDay ? { date: endAt.split('T')[0] } : { dateTime: endAt },
        }

        if (attendees && attendees.length > 0) {
          googleBody.attendees = attendees.map((a) => ({ email: a.email, displayName: a.name }))
        }

        if (createMeetLink) {
          googleBody.conferenceData = {
            createRequest: {
              requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          }
        }

        const qs = createMeetLink ? '?conferenceDataVersion=1' : ''
        const res = await googleCalendarFetch(accessToken, `/calendars/primary/events${qs}`, {
          method: 'POST',
          body: JSON.stringify(googleBody),
        })

        if (!res.ok) {
          const err = await res.text()
          return reply.internalServerError(`Google Calendar create error: ${err}`)
        }

        const created = (await res.json()) as any
        externalId = created.id
        validAccountId = account.id
        resolvedMeetLink = created.hangoutLink
          ?? created.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri
          ?? null
      }

      const event = await prisma.calendarEvent.create({
        data: {
          workspaceId: req.user.workspaceId,
          ownerId,
          calendarAccountId: validAccountId,
          externalId,
          title,
          description: description ?? null,
          location: location ?? null,
          meetLink: resolvedMeetLink,
          attendees: attendees ?? undefined,
          allDay: allDay ?? false,
          startAt: new Date(startAt),
          endAt: new Date(endAt),
          ...(cardId && { cardId }),
          ...(contactId && { contactId }),
          ...(conversationId && { conversationId }),
          ...(messageId && { messageId }),
        },
      })

      eventBus.emit('calendar:event:created', { eventId: event.id })

      return reply.code(201).send(event)
    },
  )

  // DELETE /calendar/events/:id — delete from Google + from DB
  app.delete(
    '/calendar/events/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const event = await prisma.calendarEvent.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId },
        include: { calendarAccount: true },
      })

      if (!event) return reply.notFound('Calendar event not found')

      const isOwner = event.ownerId === req.user.sub
        || (event.calendarAccount && event.calendarAccount.userId === req.user.sub)
      if (!isOwner) return reply.forbidden('Not authorized')

      if (event.calendarAccount && event.externalId) {
        try {
          const accessToken = await getValidToken(event.calendarAccount)
          const res = await googleCalendarFetch(
            accessToken,
            `/calendars/primary/events/${event.externalId}`,
            { method: 'DELETE' },
          )
          if (!res.ok && res.status !== 404 && res.status !== 410) {
            const err = await res.text()
            return reply.internalServerError(`Google Calendar delete error: ${err}`)
          }
        } catch (err) {
          req.log.warn({ err, eventId: event.id }, 'Falha ao deletar evento no Google, removendo só local')
        }
      }

      await prisma.calendarEvent.delete({ where: { id: event.id } })
      eventBus.emit('calendar:event:deleted', { eventId: event.id })
      return reply.code(204).send()
    },
  )
}

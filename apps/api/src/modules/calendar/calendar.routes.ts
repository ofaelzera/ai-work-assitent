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
import { hasPermission } from '../../lib/acl.js'
import {
  createCalendarEvent,
  updateCalendarEvent,
  CalendarConflictError,
} from './calendar.service.js'
import { isWithinCompanyHours, isWithinWorkingHours } from './availability.service.js'

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
      env.JWT_ACCESS_SECRET || 'dummy',
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
        const payload = jwt.verify(req.query.state, env.JWT_ACCESS_SECRET || 'dummy') as CalendarStatePayload
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
          // Agenda compartilhada: ver a agenda de outro(s) usuário(s).
          ownerId: z.string().optional(),
          ownerIds: z.union([z.string(), z.array(z.string())]).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { from, to, accountId, contactId, conversationId } = req.query

      // Resolve os donos pedidos (default: só o próprio).
      const requested = req.query.ownerId
        ? [req.query.ownerId]
        : Array.isArray(req.query.ownerIds)
          ? req.query.ownerIds
          : req.query.ownerIds
            ? [req.query.ownerIds]
            : []
      const ownerIds = requested.length > 0 ? Array.from(new Set(requested)) : [req.user.sub]

      const viewingOthers = ownerIds.some((id) => id !== req.user.sub)
      if (viewingOthers) {
        const ok = await hasPermission(req.user, 'calendar.viewOthers')
        if (!ok) return reply.forbidden('Sem permissão para ver a agenda de terceiros')
      }

      const events = await prisma.calendarEvent.findMany({
        where: {
          workspaceId: req.user.workspaceId,
          ownerId: { in: ownerIds },
          ...(accountId ? { calendarAccountId: accountId } : {}),
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
          // Agenda compartilhada: criar na agenda de outro usuário.
          ownerId: z.string().optional(),
          force: z.boolean().optional(),
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
      const ownerId = req.body.ownerId ?? req.user.sub

      // Criar para terceiros exige permissão; nesse caso sincroniza no Google do dono.
      if (ownerId !== req.user.sub) {
        const ok = await hasPermission(req.user, 'calendar.createForOthers')
        if (!ok) return reply.forbidden('Sem permissão para criar compromissos para terceiros')
      }

      // Bloqueia agendamento fora do horário de funcionamento / de trabalho
      // (a menos que force). Conflito é tratado pelo service (409).
      if (!req.body.force && !allDay) {
        const start = new Date(startAt)
        const [companyOpen, userAvailable] = await Promise.all([
          isWithinCompanyHours(req.user.workspaceId, start),
          isWithinWorkingHours(req.user.workspaceId, ownerId, start),
        ])
        if (!companyOpen) return reply.code(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: 'Fora do horário de funcionamento da empresa' })
        if (!userAvailable) return reply.code(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: 'Fora do horário de trabalho do usuário' })
      }

      // Para o próprio: respeita accountId do body (omitido = local).
      // Para terceiros: resolve a conta Google do dono automaticamente.
      const accountParam = ownerId === req.user.sub ? (accountId ?? null) : 'auto'

      try {
        const event = await createCalendarEvent({
          workspaceId: req.user.workspaceId,
          ownerId,
          createdById: req.user.sub,
          accountId: accountParam,
          title,
          startAt: new Date(startAt),
          endAt: new Date(endAt),
          description,
          location,
          attendees,
          createMeetLink,
          allDay,
          cardId,
          contactId,
          conversationId,
          messageId,
          force: req.body.force,
        })
        return reply.code(201).send(event)
      } catch (err) {
        if (err instanceof CalendarConflictError) {
          return reply.conflict('Conflito de horário na agenda do usuário')
        }
        throw err
      }
    },
  )

  // PATCH /calendar/events/:id — editar / remarcar (revalida conflito + propaga ao Google)
  app.patch(
    '/calendar/events/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          title: z.string().min(1).optional(),
          description: z.string().nullable().optional(),
          location: z.string().nullable().optional(),
          startAt: z.string().datetime().optional(),
          endAt: z.string().datetime().optional(),
          allDay: z.boolean().optional(),
          force: z.boolean().optional(),
        }),
      },
    },
    async (req, reply) => {
      const event = await prisma.calendarEvent.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId },
        include: { calendarAccount: true },
      })
      if (!event) return reply.notFound('Calendar event not found')

      const isOwner = event.ownerId === req.user.sub
      if (!isOwner) {
        const ok = await hasPermission(req.user, 'calendar.editOthers')
        if (!ok) return reply.forbidden('Sem permissão para editar compromissos de terceiros')
      }

      try {
        const updated = await updateCalendarEvent(event, {
          title: req.body.title,
          description: req.body.description,
          location: req.body.location,
          startAt: req.body.startAt ? new Date(req.body.startAt) : undefined,
          endAt: req.body.endAt ? new Date(req.body.endAt) : undefined,
          allDay: req.body.allDay,
          force: req.body.force,
        })
        return updated
      } catch (err) {
        if (err instanceof CalendarConflictError) {
          return reply.conflict('Conflito de horário na agenda do usuário')
        }
        throw err
      }
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

      // Só pode remover: o dono da agenda ou quem criou o evento.
      const isOwnerOrCreator = event.ownerId === req.user.sub
        || event.createdById === req.user.sub
      if (!isOwnerOrCreator) {
        return reply.forbidden('Você só pode remover eventos da sua agenda ou que você criou')
      }

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

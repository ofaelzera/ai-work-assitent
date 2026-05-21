import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { encryptJson, decryptJson } from '../../lib/crypto.js'
import { eventBus } from '../../lib/eventBus.js'
import { env } from '../../config/env.js'

// ─── Types ────────────────────────────────────────────────────────────────────

interface GoogleTokens {
  access_token: string
  refresh_token: string
  expiry_date: number
  token_type: string
}

interface EncryptedBlob {
  ciphertext: { type: 'Buffer'; data: number[] } | number[]
  iv: { type: 'Buffer'; data: number[] } | number[]
  authTag: { type: 'Buffer'; data: number[] } | number[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toBuffer(val: EncryptedBlob['ciphertext']): Buffer {
  if (Array.isArray(val)) return Buffer.from(val)
  return Buffer.from((val as { type: 'Buffer'; data: number[] }).data)
}

async function getValidToken(account: { id: string; tokens: unknown }): Promise<string> {
  const raw = account.tokens as EncryptedBlob
  const tokens = decryptJson<GoogleTokens>(
    toBuffer(raw.ciphertext),
    toBuffer(raw.iv),
    toBuffer(raw.authTag),
  )

  // Token still valid for at least 1 minute
  if (tokens.expiry_date > Date.now() + 60_000) {
    return tokens.access_token
  }

  // Refresh
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${res.status}`)
  }

  const refreshed = (await res.json()) as Partial<GoogleTokens>

  const newTokens: GoogleTokens = {
    access_token: refreshed.access_token ?? tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: Date.now() + ((refreshed as any).expires_in ?? 3600) * 1000,
    token_type: refreshed.token_type ?? tokens.token_type,
  }

  const encrypted = encryptJson(newTokens)

  await prisma.calendarAccount.update({
    where: { id: account.id },
    data: {
      tokens: {
        ciphertext: Array.from(encrypted.ciphertext),
        iv: Array.from(encrypted.iv),
        authTag: Array.from(encrypted.authTag),
      },
    },
  })

  return newTokens.access_token
}

async function googleCalendarFetch(
  accessToken: string,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export const calendarRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /calendar/accounts — list connected Google accounts
  app.get('/calendar/accounts', { onRequest: [app.authenticate] }, async (req) => {
    const accounts = await prisma.calendarAccount.findMany({
      where: { workspaceId: req.user.workspaceId, userId: req.user.sub },
      select: { id: true, provider: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: 'asc' },
    })
    return accounts
  })

  // GET /calendar/auth — returns OAuth consent screen URL
  app.get('/calendar/auth', { onRequest: [app.authenticate] }, async () => {
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID ?? '',
      redirect_uri: env.GOOGLE_REDIRECT_URI ?? '',
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar',
      access_type: 'offline',
      prompt: 'consent',
    })
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
    return { url }
  })

  // GET /calendar/callback?code= — handles OAuth callback, saves encrypted tokens
  app.get(
    '/calendar/callback',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({ code: z.string() }),
      },
    },
    async (req, reply) => {
      const { code } = req.query

      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID ?? '',
          client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
          redirect_uri: env.GOOGLE_REDIRECT_URI ?? '',
          code,
          grant_type: 'authorization_code',
        }),
      })

      if (!res.ok) {
        const err = await res.text()
        return reply.badRequest(`Google OAuth error: ${err}`)
      }

      const data = (await res.json()) as any

      const tokens: GoogleTokens = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expiry_date: Date.now() + (data.expires_in ?? 3600) * 1000,
        token_type: data.token_type ?? 'Bearer',
      }

      const encrypted = encryptJson(tokens)

      const account = await prisma.calendarAccount.upsert({
        where: {
          workspaceId_userId_provider: {
            workspaceId: req.user.workspaceId,
            userId: req.user.sub,
            provider: 'google',
          },
        },
        create: {
          workspaceId: req.user.workspaceId,
          userId: req.user.sub,
          provider: 'google',
          tokens: {
            ciphertext: Array.from(encrypted.ciphertext),
            iv: Array.from(encrypted.iv),
            authTag: Array.from(encrypted.authTag),
          },
        },
        update: {
          tokens: {
            ciphertext: Array.from(encrypted.ciphertext),
            iv: Array.from(encrypted.iv),
            authTag: Array.from(encrypted.authTag),
          },
        },
        select: { id: true, provider: true, createdAt: true },
      })

      eventBus.emit('calendar:connected', { accountId: account.id })

      return reply.code(201).send(account)
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

      // Eventos do usuário: locais (sem conta) + sincronizados das suas contas
      const accounts = await prisma.calendarAccount.findMany({
        where: {
          workspaceId: req.user.workspaceId,
          userId: ownerId,
          ...(accountId ? { id: accountId } : {}),
        },
        select: { id: true },
      })
      const accountIds = accounts.map((a) => a.id)

      // Visibilidade: eventos do próprio usuário (locais ou sincronizados pelas suas contas)
      // Se filtro accountId foi passado, restringe a essa conta (não inclui locais)
      const visibilityFilter = accountId
        ? { calendarAccountId: accountId }
        : { OR: [
            { ownerId, calendarAccountId: null },                          // locais do usuário
            ...(accountIds.length > 0 ? [{ calendarAccountId: { in: accountIds } }] : []), // do Google
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

  // POST /calendar/sync — fetch next 30 days from Google and upsert into DB
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

      const now = new Date()
      const timeMin = now.toISOString()
      const timeMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()

      let total = 0

      for (const account of accounts) {
        const accessToken = await getValidToken(account)

        const params = new URLSearchParams({
          timeMin,
          timeMax,
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '250',
        })

        const res = await googleCalendarFetch(
          accessToken,
          `/calendars/primary/events?${params.toString()}`,
        )

        if (!res.ok) {
          const err = await res.text()
          throw new Error(`Google Calendar list error: ${err}`)
        }

        const data = (await res.json()) as any
        const items: any[] = data.items ?? []

        for (const item of items) {
          if (!item.id || !item.summary) continue

          const startAt = item.start?.dateTime ?? item.start?.date
          const endAt = item.end?.dateTime ?? item.end?.date

          if (!startAt || !endAt) continue

          await prisma.calendarEvent.upsert({
            where: {
              calendarAccountId_externalId: {
                calendarAccountId: account.id,
                externalId: item.id,
              },
            },
            create: {
              workspaceId: req.user.workspaceId,
              ownerId: account.userId,           // dono = dono da conta Google
              calendarAccountId: account.id,
              externalId: item.id,
              title: item.summary ?? '(sem título)',
              description: item.description ?? null,
              startAt: new Date(startAt),
              endAt: new Date(endAt),
            },
            update: {
              title: item.summary ?? '(sem título)',
              description: item.description ?? null,
              startAt: new Date(startAt),
              endAt: new Date(endAt),
            },
          })

          total++
        }
      }

      eventBus.emit('calendar:synced', { count: total })

      return { synced: total }
    },
  )

  // POST /calendar/events — cria evento local; se accountId vier, sincroniza com Google
  app.post(
    '/calendar/events',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          accountId: z.string().optional(),  // opcional: sem ela, fica só local
          title: z.string().min(1),
          startAt: z.string().datetime(),
          endAt: z.string().datetime(),
          description: z.string().optional(),
          cardId: z.string().optional(),
          contactId: z.string().optional(),
          conversationId: z.string().optional(),
          messageId: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { accountId, title, startAt, endAt, description, cardId, contactId, conversationId, messageId } = req.body
      const ownerId = req.user.sub

      // Se foi pedido sync com Google, valida conta e dispara
      let externalId: string | null = null
      let validAccountId: string | null = null
      if (accountId) {
        const account = await prisma.calendarAccount.findFirst({
          where: { id: accountId, workspaceId: req.user.workspaceId, userId: ownerId },
        })
        if (!account) return reply.notFound('Conta de calendário não encontrada')

        const accessToken = await getValidToken(account)
        const fullDescription = conversationId
          ? `${description ?? ''}\n\n— Origem: ${req.protocol}://${req.hostname}/inbox/${conversationId}`.trim()
          : description

        const res = await googleCalendarFetch(accessToken, '/calendars/primary/events', {
          method: 'POST',
          body: JSON.stringify({
            summary: title,
            description: fullDescription,
            start: { dateTime: startAt },
            end: { dateTime: endAt },
          }),
        })

        if (!res.ok) {
          const err = await res.text()
          return reply.internalServerError(`Google Calendar create error: ${err}`)
        }
        const created = (await res.json()) as any
        externalId = created.id
        validAccountId = account.id
      }

      // Salva no banco (local sempre, com ou sem Google)
      const event = await prisma.calendarEvent.create({
        data: {
          workspaceId: req.user.workspaceId,
          ownerId,
          calendarAccountId: validAccountId,
          externalId,
          title,
          description: description ?? null,
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

      // Verifica ownership: dono do evento OU dono da conta Google sincronizada
      const isOwner = event.ownerId === req.user.sub
        || (event.calendarAccount && event.calendarAccount.userId === req.user.sub)
      if (!isOwner) return reply.forbidden('Not authorized')

      // Se está sincronizado com Google, tenta deletar de lá também
      if (event.calendarAccount && event.externalId) {
        try {
          const accessToken = await getValidToken(event.calendarAccount)
          const res = await googleCalendarFetch(
            accessToken,
            `/calendars/primary/events/${event.externalId}`,
            { method: 'DELETE' },
          )
          // 404/410 = já removido remotamente — ok
          if (!res.ok && res.status !== 404 && res.status !== 410) {
            const err = await res.text()
            return reply.internalServerError(`Google Calendar delete error: ${err}`)
          }
        } catch (err) {
          // Se falhar no Google, ainda assim deletamos localmente — log e segue
          req.log.warn({ err, eventId: event.id }, 'Falha ao deletar evento no Google, removendo só local')
        }
      }

      await prisma.calendarEvent.delete({ where: { id: event.id } })
      eventBus.emit('calendar:event:deleted', { eventId: event.id })
      return reply.code(204).send()
    },
  )
}

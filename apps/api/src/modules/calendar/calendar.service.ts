/**
 * Serviço de criação/edição de eventos de agenda.
 *
 * Centraliza a lógica antes acoplada à rota POST /calendar/events para que
 * fluxos, tools de IA e a própria rota compartilhem o mesmo comportamento:
 *   • validação de conflito (availability.service)
 *   • sincronização com o Google Calendar do DONO do evento (não do requester)
 *
 * Convenção de `accountId`:
 *   • 'auto'        → resolve a primeira conta Google do dono (local se não houver)
 *   • null/undefined→ evento local (sem Google)
 *   • '<id>'        → conta específica (precisa pertencer ao dono)
 */
import type { CalendarEvent } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { env } from '../../config/env.js'
import { eventBus } from '../../lib/eventBus.js'
import { getValidGoogleToken, googleCalendarFetch } from './google.service.js'
import { hasConflict } from './availability.service.js'

export interface AttendeeInput {
  email: string
  name?: string
}

export interface CreateEventInput {
  workspaceId: string
  ownerId: string
  accountId?: string | null | 'auto'
  title: string
  startAt: Date
  endAt: Date
  description?: string | null
  location?: string | null
  attendees?: AttendeeInput[]
  createMeetLink?: boolean
  allDay?: boolean
  cardId?: string
  contactId?: string
  conversationId?: string
  messageId?: string
  /** Quem está criando (para auditoria/permissão de remoção em agenda compartilhada). */
  createdById?: string | null
  /** Quando true, ignora conflito de horário. */
  force?: boolean
}

export class CalendarConflictError extends Error {
  constructor(public readonly ownerId: string) {
    super('Conflito de horário na agenda do usuário')
    this.name = 'CalendarConflictError'
  }
}

/** Resolve a conta Google a usar dado o param `accountId` e o dono. */
async function resolveAccount(
  workspaceId: string,
  ownerId: string,
  accountId: string | null | undefined | 'auto',
) {
  if (accountId === null || accountId === undefined) return null
  if (accountId === 'auto') {
    return prisma.calendarAccount.findFirst({
      where: { workspaceId, userId: ownerId, provider: 'google' },
    })
  }
  return prisma.calendarAccount.findFirst({
    where: { id: accountId, workspaceId, userId: ownerId },
  })
}

/**
 * Cria um evento, opcionalmente sincronizado no Google Calendar do dono.
 * Lança CalendarConflictError se houver conflito e `force` não estiver setado.
 */
export async function createCalendarEvent(input: CreateEventInput): Promise<CalendarEvent> {
  const {
    workspaceId, ownerId, title, startAt, endAt, description, location,
    attendees, createMeetLink, allDay, cardId, contactId, conversationId, messageId,
  } = input

  if (endAt <= startAt) throw new Error('endAt deve ser maior que startAt')

  if (!input.force) {
    const conflict = await hasConflict(workspaceId, ownerId, startAt, endAt)
    if (conflict) throw new CalendarConflictError(ownerId)
  }

  const account = await resolveAccount(workspaceId, ownerId, input.accountId)

  let externalId: string | null = null
  let validAccountId: string | null = null
  let resolvedMeetLink: string | null = null

  if (account) {
    const accessToken = await getValidGoogleToken(account)

    const baseUrl = env.WEB_URL ?? 'http://localhost:3000'
    const fullDescription = conversationId
      ? `${description ?? ''}\n\n— Origem: ${baseUrl}/inbox/${conversationId}`.trim()
      : description

    const startIso = startAt.toISOString()
    const endIso = endAt.toISOString()
    const googleBody: Record<string, unknown> = {
      summary: title,
      description: fullDescription ?? undefined,
      location: location ?? undefined,
      start: allDay ? { date: startIso.split('T')[0] } : { dateTime: startIso },
      end: allDay ? { date: endIso.split('T')[0] } : { dateTime: endIso },
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
      throw new Error(`Google Calendar create error: ${err}`)
    }
    const created = (await res.json()) as any
    externalId = created.id
    validAccountId = account.id
    resolvedMeetLink =
      created.hangoutLink ??
      created.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri ??
      null
  }

  const event = await prisma.calendarEvent.create({
    data: {
      workspaceId,
      ownerId,
      createdById: input.createdById ?? null,
      calendarAccountId: validAccountId,
      externalId,
      title,
      description: description ?? null,
      location: location ?? null,
      meetLink: resolvedMeetLink,
      attendees: (attendees ?? undefined) as any,
      allDay: allDay ?? false,
      startAt,
      endAt,
      ...(cardId && { cardId }),
      ...(contactId && { contactId }),
      ...(conversationId && { conversationId }),
      ...(messageId && { messageId }),
    },
  })

  eventBus.emit('calendar:event:created', { eventId: event.id })
  return event
}

export interface UpdateEventInput {
  title?: string
  description?: string | null
  location?: string | null
  startAt?: Date
  endAt?: Date
  allDay?: boolean
  force?: boolean
}

/**
 * Edita/remarca um evento existente. Revalida conflito quando o horário muda e
 * propaga a alteração para o Google Calendar se o evento estiver sincronizado.
 */
export async function updateCalendarEvent(
  event: CalendarEvent & { calendarAccount?: { id: string; tokens: unknown } | null },
  patch: UpdateEventInput,
): Promise<CalendarEvent> {
  const startAt = patch.startAt ?? event.startAt
  const endAt = patch.endAt ?? event.endAt
  if (endAt <= startAt) throw new Error('endAt deve ser maior que startAt')

  const timeChanged = patch.startAt != null || patch.endAt != null
  if (timeChanged && !patch.force) {
    const conflict = await hasConflict(event.workspaceId, event.ownerId, startAt, endAt, event.id)
    if (conflict) throw new CalendarConflictError(event.ownerId)
  }

  // Propaga ao Google se sincronizado.
  if (event.calendarAccount && event.externalId) {
    try {
      const accessToken = await getValidGoogleToken(event.calendarAccount)
      const allDay = patch.allDay ?? event.allDay
      const googleBody: Record<string, unknown> = {
        ...(patch.title !== undefined ? { summary: patch.title } : {}),
        ...(patch.description !== undefined ? { description: patch.description ?? undefined } : {}),
        ...(patch.location !== undefined ? { location: patch.location ?? undefined } : {}),
        ...(timeChanged || patch.allDay !== undefined
          ? {
              start: allDay ? { date: startAt.toISOString().split('T')[0] } : { dateTime: startAt.toISOString() },
              end: allDay ? { date: endAt.toISOString().split('T')[0] } : { dateTime: endAt.toISOString() },
            }
          : {}),
      }
      const res = await googleCalendarFetch(
        accessToken,
        `/calendars/primary/events/${event.externalId}`,
        { method: 'PATCH', body: JSON.stringify(googleBody) },
      )
      if (!res.ok && res.status !== 404 && res.status !== 410) {
        const err = await res.text()
        throw new Error(`Google Calendar update error: ${err}`)
      }
    } catch (err) {
      // Falha no Google não impede o update local; o sync periódico reconcilia.
      eventBus.emit('calendar:event:google_update_failed', { eventId: event.id })
    }
  }

  const updated = await prisma.calendarEvent.update({
    where: { id: event.id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.location !== undefined ? { location: patch.location } : {}),
      ...(patch.allDay !== undefined ? { allDay: patch.allDay } : {}),
      ...(patch.startAt !== undefined ? { startAt: patch.startAt } : {}),
      ...(patch.endAt !== undefined ? { endAt: patch.endAt } : {}),
    },
  })
  eventBus.emit('calendar:event:updated', { eventId: updated.id })
  return updated
}

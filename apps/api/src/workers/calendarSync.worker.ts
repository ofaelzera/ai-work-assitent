import { Worker, Queue } from 'bullmq'
import { Prisma } from '@prisma/client'
import { redis } from '../lib/redis.js'
import { prisma } from '../lib/prisma.js'
import { logger } from '../lib/logger.js'
import { getValidGoogleToken, googleCalendarFetch } from '../modules/calendar/google.service.js'

export const calendarSyncQueue = new Queue('calendarSync', { connection: redis })

function extractMeetLink(item: any): string | null {
  if (item.hangoutLink) return item.hangoutLink
  const videoEntry = item.conferenceData?.entryPoints?.find(
    (e: any) => e.entryPointType === 'video',
  )
  return videoEntry?.uri ?? null
}

function mapAttendees(item: any): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (!Array.isArray(item.attendees) || item.attendees.length === 0) return Prisma.DbNull
  return item.attendees.map((a: any) => ({
    email: a.email,
    name: a.displayName ?? null,
    status: a.responseStatus ?? null,
  }))
}

export async function syncCalendarAccount(account: {
  id: string
  workspaceId: string
  userId: string
  tokens: unknown
}): Promise<number> {
  const now = new Date()
  const timeMin = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const timeMax = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString()

  const accessToken = await getValidGoogleToken(account)

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '500',
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
  let count = 0

  for (const item of items) {
    if (!item.id) continue

    const startRaw = item.start?.dateTime ?? item.start?.date
    const endRaw = item.end?.dateTime ?? item.end?.date
    if (!startRaw || !endRaw) continue

    const allDay = !item.start?.dateTime
    const fields = {
      title: item.summary ?? '(sem título)',
      description: item.description ?? null,
      location: item.location ?? null,
      meetLink: extractMeetLink(item),
      attendees: mapAttendees(item),
      allDay,
      status: item.status ?? null,
      organizer: item.organizer?.email ?? null,
      color: item.colorId ?? null,
      startAt: new Date(startRaw),
      endAt: new Date(endRaw),
    }

    await prisma.calendarEvent.upsert({
      where: {
        calendarAccountId_externalId: {
          calendarAccountId: account.id,
          externalId: item.id,
        },
      },
      create: {
        workspaceId: account.workspaceId,
        ownerId: account.userId,
        calendarAccountId: account.id,
        externalId: item.id,
        ...fields,
      },
      update: fields,
    })

    count++
  }

  return count
}

export function startCalendarSyncWorker() {
  const worker = new Worker(
    'calendarSync',
    async (job) => {
      logger.info({ jobId: job.id }, 'Calendar auto-sync: iniciando')

      const accounts = await prisma.calendarAccount.findMany({
        where: { provider: 'google' },
      })

      let total = 0

      for (const account of accounts) {
        try {
          const count = await syncCalendarAccount(account)
          total += count
          logger.info({ accountId: account.id, count }, 'Calendar sync: conta sincronizada')
        } catch (err) {
          logger.error({ err, accountId: account.id }, 'Calendar sync: erro na conta')
        }
      }

      logger.info({ jobId: job.id, total }, 'Calendar auto-sync: concluído')
      return { synced: total }
    },
    { connection: redis, concurrency: 1 },
  )

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'calendarSync worker falhou')
  })

  calendarSyncQueue
    .add('sync', {}, {
      repeat: { pattern: '*/15 * * * *' },
      jobId: 'calendar-sync-repeat',
    })
    .catch((err) => logger.error({ err }, 'Falha ao registrar job repetível de calendar sync'))

  logger.info('Calendar sync worker iniciado (cron: */15 * * * *)')

  return worker
}

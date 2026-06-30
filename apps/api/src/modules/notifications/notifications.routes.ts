import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { NOTIFICATION_EVENTS } from '@aiwa/shared'
import { prisma } from '../../lib/prisma.js'
import { hasPermission } from '../../lib/acl.js'
import * as service from './notification.service.js'
import { listProviderKeys } from './channel-providers/index.js'
import { createSound, deleteSound, getSoundFile, isAllowedSoundMime, listSounds } from './sounds.service.js'

const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
const channelEnum = z.enum(['in_app', 'email', 'whatsapp'])

export const notificationsRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── Catálogo de tipos de evento + canais disponíveis (para a UI) ──────────
  app.get('/notifications/catalog', { onRequest: [app.authenticate] }, async () => ({
    events: Object.values(NOTIFICATION_EVENTS),
    channels: listProviderKeys(),
  }))

  // ── Lista de notificações do usuário logado ───────────────────────────────
  app.get(
    '/notifications',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          onlyUnread: z.string().optional().transform((v) => v === 'true'),
          includeDismissed: z.string().optional().transform((v) => v === 'true'),
          limit: z.coerce.number().int().positive().max(200).optional(),
        }),
      },
    },
    async (req) => {
      const { workspaceId, sub: userId } = req.user
      return service.listForUser(workspaceId, userId, {
        onlyUnread: req.query.onlyUnread,
        includeDismissed: req.query.includeDismissed,
        limit: req.query.limit,
      })
    },
  )

  app.get('/notifications/unread-count', { onRequest: [app.authenticate] }, async (req) => {
    const { workspaceId, sub: userId } = req.user
    return { count: await service.unreadCount(workspaceId, userId) }
  })

  app.post(
    '/notifications/:id/read',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const ok = await service.markRead(workspaceId, userId, req.params.id)
      if (!ok) return reply.notFound()
      return { ok: true }
    },
  )

  app.post('/notifications/read-all', { onRequest: [app.authenticate] }, async (req) => {
    const { workspaceId, sub: userId } = req.user
    return { count: await service.markAllRead(workspaceId, userId) }
  })

  app.post(
    '/notifications/:id/dismiss',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const ok = await service.dismiss(workspaceId, userId, req.params.id)
      if (!ok) return reply.notFound()
      return { ok: true }
    },
  )

  // ── Preferências do usuário logado ─────────────────────────────────────────
  app.get('/notifications/settings/me', { onRequest: [app.authenticate] }, async (req) => {
    const { workspaceId, sub: userId } = req.user
    const existing = await prisma.userNotificationSettings.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    })
    return (
      existing ?? {
        inAppEnabled: true,
        emailEnabled: false,
        whatsappEnabled: false,
        soundEnabled: true,
        dndEnabled: false,
        dndStart: null,
        dndEnd: null,
        dndWeekdays: null,
        perCategory: null,
      }
    )
  })

  app.put(
    '/notifications/settings/me',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          inAppEnabled: z.boolean().optional(),
          emailEnabled: z.boolean().optional(),
          whatsappEnabled: z.boolean().optional(),
          soundEnabled: z.boolean().optional(),
          dndEnabled: z.boolean().optional(),
          dndStart: z.string().regex(/^\d{1,2}:\d{2}$/).nullable().optional(),
          dndEnd: z.string().regex(/^\d{1,2}:\d{2}$/).nullable().optional(),
          dndWeekdays: z.array(z.number().int().min(0).max(6)).nullable().optional(),
          perCategory: z.record(z.string(), z.record(z.string(), z.boolean())).nullable().optional(),
        }),
      },
    },
    async (req) => {
      const { workspaceId, sub: userId } = req.user
      const b = req.body
      return prisma.userNotificationSettings.upsert({
        where: { workspaceId_userId: { workspaceId, userId } },
        create: { workspaceId, userId, ...b, perCategory: b.perCategory ?? undefined, dndWeekdays: b.dndWeekdays ?? undefined },
        update: { ...b, perCategory: b.perCategory ?? undefined, dndWeekdays: b.dndWeekdays ?? undefined },
      })
    },
  )

  // ── Regras de disparo (workspace) — requer notifications.manage ────────────
  app.get('/notifications/rules', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!(await hasPermission(req.user, 'notifications.manage'))) return reply.forbidden()
    return prisma.notificationTriggerRule.findMany({ where: { workspaceId: req.user.workspaceId } })
  })

  app.put(
    '/notifications/rules/:eventType',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ eventType: z.string() }),
        body: z.object({
          enabled: z.boolean().optional(),
          leadTimeMinutes: z.number().int().min(0).nullable().optional(),
          channels: z.array(channelEnum).optional(),
          recipientContactIds: z.array(z.string()).nullable().optional(),
          externalChannelId: z.string().nullable().optional(),
          soundId: z.string().nullable().optional(),
          priority: priorityEnum.optional(),
          dndStart: z.string().regex(/^\d{1,2}:\d{2}$/).nullable().optional(),
          dndEnd: z.string().regex(/^\d{1,2}:\d{2}$/).nullable().optional(),
          dndWeekdays: z.array(z.number().int().min(0).max(6)).nullable().optional(),
        }),
      },
    },
    async (req, reply) => {
      if (!(await hasPermission(req.user, 'notifications.manage'))) return reply.forbidden()
      const { workspaceId } = req.user
      const { eventType } = req.params
      if (!(eventType in NOTIFICATION_EVENTS)) return reply.badRequest('eventType desconhecido')
      const b = req.body
      const data = {
        ...(b.enabled !== undefined && { enabled: b.enabled }),
        ...(b.leadTimeMinutes !== undefined && { leadTimeMinutes: b.leadTimeMinutes }),
        ...(b.channels !== undefined && { channels: b.channels }),
        ...(b.recipientContactIds !== undefined && { recipientContactIds: b.recipientContactIds ?? undefined }),
        ...(b.externalChannelId !== undefined && { externalChannelId: b.externalChannelId }),
        ...(b.soundId !== undefined && { soundId: b.soundId }),
        ...(b.priority !== undefined && { priority: b.priority }),
        ...(b.dndStart !== undefined && { dndStart: b.dndStart }),
        ...(b.dndEnd !== undefined && { dndEnd: b.dndEnd }),
        ...(b.dndWeekdays !== undefined && { dndWeekdays: b.dndWeekdays ?? undefined }),
      }
      return prisma.notificationTriggerRule.upsert({
        where: { workspaceId_eventType: { workspaceId, eventType } },
        create: { workspaceId, eventType, channels: b.channels ?? ['in_app'], ...data },
        update: data,
      })
    },
  )

  // ── Galeria de sons ────────────────────────────────────────────────────────
  app.get('/notifications/sounds', { onRequest: [app.authenticate] }, async (req) => {
    return listSounds(req.user.workspaceId)
  })

  app.post('/notifications/sounds', { onRequest: [app.authenticate] }, async (req: any, reply) => {
    if (!(await hasPermission(req.user, 'notifications.manage'))) return reply.forbidden()
    const { workspaceId, sub: userId } = req.user
    const data = await req.file()
    if (!data) return reply.badRequest('Arquivo obrigatório')
    if (!isAllowedSoundMime(data.mimetype)) return reply.badRequest('Formato de áudio não suportado (use mp3/wav/ogg)')

    const label: string = data.fields?.label?.value?.trim() || (data.filename ?? 'Som')
    const category: string | null = data.fields?.category?.value || null

    const chunks: Buffer[] = []
    for await (const chunk of data.file) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)

    try {
      const sound = await createSound({
        workspaceId,
        userId,
        label,
        category,
        mimeType: data.mimetype,
        buffer,
        originalName: data.filename ?? 'som.mp3',
      })
      return reply.code(201).send(sound)
    } catch (err: any) {
      return reply.badRequest(err?.message ?? 'Falha ao salvar som')
    }
  })

  app.get(
    '/notifications/sounds/:id/audio',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      const file = await getSoundFile(req.user.workspaceId, req.params.id)
      if (!file) return reply.notFound()
      return reply.type(file.mimeType).send(file.buffer)
    },
  )

  app.delete(
    '/notifications/sounds/:id',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      if (!(await hasPermission(req.user, 'notifications.manage'))) return reply.forbidden()
      const ok = await deleteSound(req.user.workspaceId, req.params.id)
      if (!ok) return reply.notFound()
      return reply.code(204).send()
    },
  )
}

import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_SSE,
  type NotificationEventType,
  type NotificationPriority,
} from '@aiwa/shared'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { eventBus } from '../../lib/eventBus.js'
import { logger } from '../../lib/logger.js'
import { registerBuiltinProviders, getProvider } from './channel-providers/index.js'
import type { ChannelSendContext } from './channel-providers/provider.types.js'
import { isWithinDnd } from './dnd.util.js'

registerBuiltinProviders()

/** Evento de notificação entregue ao service central. */
export interface NotificationEvent {
  workspaceId: string
  eventType: NotificationEventType | string
  /** 'user' = só os recipientUserIds; 'workspace' = todos os usuários. */
  scope: 'user' | 'workspace'
  recipientUserIds?: string[]
  title: string
  body?: string | null
  link?: string | null
  metadata?: Record<string, unknown>
  /** Overrides opcionais (senão usa catálogo/regra). */
  priority?: NotificationPriority
  soundId?: string | null
}

function catalogDefaults(eventType: string) {
  const def = (NOTIFICATION_EVENTS as Record<string, (typeof NOTIFICATION_EVENTS)[NotificationEventType]>)[eventType]
  return {
    category: def?.category ?? 'system',
    priority: def?.defaultPriority ?? 'MEDIUM',
  }
}

interface ResolvedRule {
  enabled: boolean
  channels: string[]
  recipientContactIds: string[]
  externalChannelId: string | null
  soundId: string | null
  priority: NotificationPriority
  dnd: { enabled: boolean; start: string | null; end: string | null; weekdays: number[] | null }
}

async function resolveRule(workspaceId: string, eventType: string): Promise<ResolvedRule> {
  const rule = await prisma.notificationTriggerRule.findUnique({
    where: { workspaceId_eventType: { workspaceId, eventType } },
  })
  const defaults = catalogDefaults(eventType)
  if (!rule) {
    return {
      enabled: true,
      channels: ['in_app'],
      recipientContactIds: [],
      externalChannelId: null,
      soundId: null,
      priority: defaults.priority,
      dnd: { enabled: false, start: null, end: null, weekdays: null },
    }
  }
  return {
    enabled: rule.enabled,
    channels: Array.isArray(rule.channels) ? (rule.channels as string[]) : ['in_app'],
    recipientContactIds: Array.isArray(rule.recipientContactIds) ? (rule.recipientContactIds as string[]) : [],
    externalChannelId: rule.externalChannelId,
    soundId: rule.soundId,
    priority: rule.priority,
    dnd: {
      enabled: !!(rule.dndStart && rule.dndEnd),
      start: rule.dndStart,
      end: rule.dndEnd,
      weekdays: Array.isArray(rule.dndWeekdays) ? (rule.dndWeekdays as number[]) : null,
    },
  }
}

function perCategoryEnabled(perCategory: unknown, category: string, channel: 'inApp'): boolean {
  if (!perCategory || typeof perCategory !== 'object') return true
  const cat = (perCategory as Record<string, Record<string, boolean>>)[category]
  if (!cat || typeof cat !== 'object') return true
  return cat[channel] !== false
}

/**
 * Ponto central de disparo. Resolve regra + preferências, aplica DND, persiste a
 * Notification in-app (1 por destinatário) e aciona os canais plugáveis.
 */
export async function dispatch(event: NotificationEvent): Promise<void> {
  const { workspaceId, eventType } = event
  const rule = await resolveRule(workspaceId, eventType)
  if (!rule.enabled) {
    logger.debug({ eventType }, 'notification: regra desabilitada, ignorando')
    return
  }

  const defaults = catalogDefaults(eventType)
  const priority = event.priority ?? rule.priority ?? defaults.priority
  const soundId = event.soundId ?? rule.soundId ?? null
  const metadata = event.metadata ?? {}
  const now = new Date()

  // ── Canais externos (e-mail/whatsapp): governados pela regra do workspace ──
  // Disparam uma vez por evento, para os contatos configurados na regra.
  const ruleDnd = isWithinDnd(rule.dnd, now)
  const externalChannels = rule.channels.filter((c) => c !== 'in_app')
  if (!ruleDnd && externalChannels.length > 0) {
    const externalCtxBase: Omit<ChannelSendContext, 'userId'> = {
      workspaceId,
      eventType,
      category: defaults.category,
      priority,
      title: event.title,
      body: event.body ?? null,
      link: event.link ?? null,
      soundId,
      silent: false,
      metadata,
      externalChannelId: rule.externalChannelId,
      recipientContactIds: rule.recipientContactIds,
    }
    for (const key of externalChannels) {
      const provider = getProvider(key)
      if (!provider) {
        logger.warn({ key }, 'notification: canal sem provider registrado')
        continue
      }
      try {
        await provider.send({ ...externalCtxBase, userId: null })
      } catch (err: any) {
        logger.error({ err: err?.message, key, eventType }, 'notification: falha no canal externo')
      }
    }
  }

  // ── Canal in-app: 1 notificação por usuário destinatário ──
  if (!rule.channels.includes('in_app')) return

  const recipientIds = await resolveRecipientUsers(workspaceId, event)
  if (recipientIds.length === 0) return

  const settingsList = await prisma.userNotificationSettings.findMany({
    where: { workspaceId, userId: { in: recipientIds } },
  })
  const settingsByUser = new Map(settingsList.map((s) => [s.userId, s]))

  const inApp = getProvider('in_app')
  if (!inApp) return

  for (const userId of recipientIds) {
    const s = settingsByUser.get(userId)
    if (s && !s.inAppEnabled) continue
    if (s && !perCategoryEnabled(s.perCategory, defaults.category, 'inApp')) continue

    const userDnd = s
      ? isWithinDnd(
          {
            enabled: s.dndEnabled,
            start: s.dndStart,
            end: s.dndEnd,
            weekdays: Array.isArray(s.dndWeekdays) ? (s.dndWeekdays as number[]) : null,
          },
          now,
        )
      : false
    const soundEnabled = s ? s.soundEnabled : true
    const silent = userDnd || ruleDnd || !soundEnabled

    try {
      await inApp.send({
        workspaceId,
        userId,
        eventType,
        category: defaults.category,
        priority,
        title: event.title,
        body: event.body ?? null,
        link: event.link ?? null,
        soundId,
        silent,
        metadata,
        externalChannelId: null,
        recipientContactIds: [],
      })
    } catch (err: any) {
      logger.error({ err: err?.message, userId, eventType }, 'notification: falha no canal in-app')
    }
  }
}

async function resolveRecipientUsers(workspaceId: string, event: NotificationEvent): Promise<string[]> {
  if (event.scope === 'workspace') {
    const users = await prisma.user.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true },
    })
    return users.map((u) => u.id)
  }
  // scope 'user'
  return [...new Set((event.recipientUserIds ?? []).filter(Boolean))]
}

// ─────────────────────────────────────────────────────────────────────────────
// Leitura e ações (consumidas pelas rotas)
// ─────────────────────────────────────────────────────────────────────────────

export interface ListOptions {
  includeDismissed?: boolean
  onlyUnread?: boolean
  limit?: number
}

export async function listForUser(workspaceId: string, userId: string, opts: ListOptions = {}) {
  const where: Prisma.NotificationWhereInput = { workspaceId, userId }
  if (!opts.includeDismissed) where.dismissedAt = null
  if (opts.onlyUnread) where.readAt = null
  return prisma.notification.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(opts.limit ?? 50, 200),
  })
}

export async function unreadCount(workspaceId: string, userId: string): Promise<number> {
  return prisma.notification.count({
    where: { workspaceId, userId, readAt: null, dismissedAt: null },
  })
}

export async function markRead(workspaceId: string, userId: string, id: string): Promise<boolean> {
  const res = await prisma.notification.updateMany({
    where: { id, workspaceId, userId, readAt: null },
    data: { readAt: new Date() },
  })
  if (res.count > 0) eventBus.emitSSE(workspaceId, NOTIFICATION_SSE.READ, { id, userId })
  return res.count > 0
}

export async function markAllRead(workspaceId: string, userId: string): Promise<number> {
  const res = await prisma.notification.updateMany({
    where: { workspaceId, userId, readAt: null, dismissedAt: null },
    data: { readAt: new Date() },
  })
  if (res.count > 0) eventBus.emitSSE(workspaceId, NOTIFICATION_SSE.READ, { userId, all: true })
  return res.count
}

export async function dismiss(workspaceId: string, userId: string, id: string): Promise<boolean> {
  const now = new Date()
  const res = await prisma.notification.updateMany({
    where: { id, workspaceId, userId, dismissedAt: null },
    data: { dismissedAt: now, readAt: now },
  })
  if (res.count > 0) eventBus.emitSSE(workspaceId, NOTIFICATION_SSE.DISMISSED, { id, userId })
  return res.count > 0
}

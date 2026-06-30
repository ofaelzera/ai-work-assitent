import { NOTIFICATION_SSE, type NotificationNewPayload } from '@aiwa/shared'
import { prisma } from '../../../lib/prisma.js'
import { eventBus } from '../../../lib/eventBus.js'
import type { NotificationChannelProvider, ChannelSendContext } from './provider.types.js'

/**
 * Canal interno: persiste a Notification (visível até lida/dispensada) e emite
 * SSE `notification.new` para atualização instantânea do sino/painel no frontend.
 * Exige um usuário destinatário; envios puramente externos não persistem in-app.
 */
export const inAppProvider: NotificationChannelProvider = {
  key: 'in_app',
  async send(ctx: ChannelSendContext): Promise<void> {
    if (!ctx.userId) return

    const notif = await prisma.notification.create({
      data: {
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        eventType: ctx.eventType,
        category: ctx.category,
        priority: ctx.priority,
        title: ctx.title,
        body: ctx.body,
        link: ctx.link,
        soundId: ctx.soundId,
        metadata: ctx.metadata as object,
      },
    })

    const payload: NotificationNewPayload = {
      id: notif.id,
      userId: notif.userId,
      eventType: notif.eventType,
      category: notif.category,
      priority: notif.priority,
      title: notif.title,
      body: notif.body,
      link: notif.link,
      soundId: notif.soundId,
      createdAt: notif.createdAt.toISOString(),
      silent: ctx.silent,
    }

    // SSE para todos os clientes do workspace; o frontend filtra por userId.
    // emitSSE (não emitAndPersist): a Notification já é a fonte da verdade.
    eventBus.emitSSE(ctx.workspaceId, NOTIFICATION_SSE.NEW, payload)
  },
}

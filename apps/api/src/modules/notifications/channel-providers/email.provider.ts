import { prisma } from '../../../lib/prisma.js'
import { logger } from '../../../lib/logger.js'
import { enqueueMessage } from '../../communication/communication.service.js'
import type { NotificationChannelProvider, ChannelSendContext } from './provider.types.js'

/**
 * Canal e-mail: enfileira via Central de Comunicação (enqueueMessage).
 * Destinatários:
 *   • contatos selecionados na regra (recipientContactIds) com e-mail, e
 *   • o usuário do sistema destinatário (assignee), se tiver e-mail.
 */
export const emailProvider: NotificationChannelProvider = {
  key: 'email',
  async send(ctx: ChannelSendContext): Promise<void> {
    const recipients: Array<{ to: string; contactId: string | null }> = []

    if (ctx.recipientContactIds.length > 0) {
      const contacts = await prisma.contact.findMany({
        where: { workspaceId: ctx.workspaceId, id: { in: ctx.recipientContactIds } },
        select: { id: true, email: true },
      })
      for (const c of contacts) {
        if (c.email) recipients.push({ to: c.email, contactId: c.id })
      }
    }

    if (ctx.userId) {
      const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { email: true } })
      if (user?.email) recipients.push({ to: user.email, contactId: null })
    }

    if (recipients.length === 0) {
      logger.warn({ eventType: ctx.eventType }, 'notification email: nenhum destinatário com e-mail')
      return
    }

    const body = ctx.body ? `${ctx.title}\n\n${ctx.body}` : ctx.title
    for (const r of recipients) {
      await enqueueMessage({
        workspaceId: ctx.workspaceId,
        channelType: 'EMAIL',
        channelId: ctx.externalChannelId,
        to: r.to,
        subject: ctx.title,
        body,
        contactId: r.contactId,
        source: 'notification',
      })
    }
  },
}

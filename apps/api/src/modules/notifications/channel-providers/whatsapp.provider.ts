import { prisma } from '../../../lib/prisma.js'
import { logger } from '../../../lib/logger.js'
import { enqueueMessage } from '../../communication/communication.service.js'
import type { NotificationChannelProvider, ChannelSendContext } from './provider.types.js'

/**
 * Canal WhatsApp: enfileira via Central de Comunicação (enqueueMessage).
 * Só contatos com telefone real (phoneType PN) são notificados — IDs opacos
 * (LID) não recebem disparo proativo.
 */
export const whatsappProvider: NotificationChannelProvider = {
  key: 'whatsapp',
  async send(ctx: ChannelSendContext): Promise<void> {
    if (ctx.recipientContactIds.length === 0) {
      logger.warn({ eventType: ctx.eventType }, 'notification whatsapp: nenhum contato destinatário')
      return
    }

    const contacts = await prisma.contact.findMany({
      where: { workspaceId: ctx.workspaceId, id: { in: ctx.recipientContactIds } },
      select: { id: true, phone: true, phoneType: true },
    })

    const body = ctx.body ? `*${ctx.title}*\n\n${ctx.body}` : ctx.title
    for (const c of contacts) {
      if (!c.phone || c.phoneType !== 'PN') continue
      await enqueueMessage({
        workspaceId: ctx.workspaceId,
        channelType: 'WHATSAPP',
        channelId: ctx.externalChannelId,
        to: c.phone,
        body,
        contactId: c.id,
        source: 'notification',
      })
    }
  },
}

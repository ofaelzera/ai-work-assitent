import { z } from 'zod'
import { prisma } from '../../../lib/prisma.js'
import { eventBus } from '../../../lib/eventBus.js'
import { getSmtpConfig } from '../../channels/channels.service.js'
import { moveImapMessage } from '../../channels/email.client.js'
import type { ToolDef } from './types.js'

const paramsSchema = z.object({
  toFolder: z.string().min(1).describe('Nome exato da pasta IMAP destino (ex: "Spam", "Junk", "INBOX.Lixeira")'),
  messageId: z.string().optional().describe('ID da Message no banco. Se omitido, usa triggerEvent.messageId.'),
  conversationId: z.string().optional().describe('Se informado, move TODAS as mensagens da conversa (com UID). Sobrescreve messageId.'),
})

export const moveEmailTool: ToolDef<typeof paramsSchema> = {
  name: 'moveEmail',
  description:
    'Move email(s) entre pastas IMAP no servidor. Use pra arquivar spam, organizar emails por assunto, ' +
    'ou mover pra lixeira. Funciona apenas em canais IMAP/Gmail conectados. ' +
    'Se messageId/conversationId não forem informados, usa o messageId do evento que disparou o agente.',
  parameters: paramsSchema,
  parametersJsonSchema: {
    type: 'object',
    required: ['toFolder'],
    properties: {
      toFolder: { type: 'string', description: 'Pasta destino. Use o nome exato (case-sensitive) que aparece no servidor.' },
      messageId: { type: 'string' },
      conversationId: { type: 'string' },
    },
  },
  async execute(ctx, params) {
    const conversationId = params.conversationId ?? ctx.triggerEvent?.conversationId
    const singleMessageId = params.messageId ?? ctx.triggerEvent?.messageId

    if (!conversationId && !singleMessageId) {
      return { ok: false, error: 'Informe messageId ou conversationId (ou rode via trigger message.received)' }
    }

    // Resolve channelId e valida tipo
    let channelId: string | null = null
    let resolvedConversationId: string | null = conversationId ?? null
    if (conversationId) {
      const conv = await prisma.conversation.findFirst({
        where: { id: conversationId, workspaceId: ctx.workspaceId },
        select: { channelId: true, channel: { select: { type: true } } },
      })
      if (!conv) return { ok: false, error: 'Conversa não encontrada' }
      if (conv.channel.type !== 'IMAP_SMTP' && conv.channel.type !== 'GMAIL') {
        return { ok: false, error: `Canal tipo ${conv.channel.type} não suporta moveEmail` }
      }
      channelId = conv.channelId
    } else if (singleMessageId) {
      const msg = await prisma.message.findFirst({
        where: { id: singleMessageId, workspaceId: ctx.workspaceId },
        select: { conversationId: true, conversation: { select: { channelId: true, channel: { select: { type: true } } } } },
      })
      if (!msg) return { ok: false, error: 'Mensagem não encontrada' }
      if (msg.conversation.channel.type !== 'IMAP_SMTP' && msg.conversation.channel.type !== 'GMAIL') {
        return { ok: false, error: `Canal tipo ${msg.conversation.channel.type} não suporta moveEmail` }
      }
      channelId = msg.conversation.channelId
      resolvedConversationId = msg.conversationId
    }

    if (!channelId) return { ok: false, error: 'Não foi possível resolver o canal' }

    const smtpCfg = await getSmtpConfig(channelId)
    if (!smtpCfg) return { ok: false, error: 'Canal sem credenciais IMAP/SMTP' }

    // Carrega mensagens-alvo com seus UIDs
    const targetMessages = await prisma.message.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...(params.conversationId
          ? { conversationId: params.conversationId }
          : { id: singleMessageId! }),
      },
      select: { id: true, metadata: true },
    })

    let moved = 0
    let failed = 0
    const skipped: string[] = []
    for (const m of targetMessages) {
      const meta = (m.metadata as { imapUid?: number; imapFolder?: string } | null) ?? null
      if (!meta?.imapUid || !meta.imapFolder) { skipped.push(m.id); continue }
      if (meta.imapFolder === params.toFolder) { moved++; continue }
      try {
        await moveImapMessage(smtpCfg, meta.imapUid, meta.imapFolder, params.toFolder)
        await prisma.message.update({
          where: { id: m.id },
          data: { metadata: { ...meta, imapFolder: params.toFolder } },
        })
        moved++
      } catch (err) {
        failed++
      }
    }

    // Atualiza a pasta da conversa se moveu tudo
    if (resolvedConversationId && moved > 0 && failed === 0) {
      await prisma.conversation.update({
        where: { id: resolvedConversationId },
        data: { folder: params.toFolder },
      }).catch(() => {})
    }

    await eventBus.audit(ctx.workspaceId, 'email.moved', {
      actorUserId: null,
      targetType: resolvedConversationId ? 'conversation' : 'message',
      targetId: resolvedConversationId ?? singleMessageId ?? null,
      payload: { origin: 'AI', agentId: ctx.agentId, toFolder: params.toFolder, moved, failed, skipped: skipped.length },
    })

    if (moved === 0) {
      return { ok: false, error: `Nada foi movido (failed=${failed}, sem UID=${skipped.length})` }
    }
    return { ok: true, result: { moved, failed, skippedNoUid: skipped.length, toFolder: params.toFolder } }
  },
}

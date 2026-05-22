/**
 * Helpers de envio de mensagens automáticas/sistema (welcome, closing).
 *
 * Centraliza:
 *   • Resolução de template (canal vs user, com override)
 *   • Interpolação de variáveis com contexto completo (contato + canal + empresa + protocolo)
 *   • Envio via Evolution e persistência da Message marcada com `attachments.kind`
 *   • Tratamento defensivo: erros aqui NÃO podem quebrar o fluxo principal
 */
import { prisma } from './prisma.js'
import { logger } from './logger.js'
import { evolutionClient } from '../modules/channels/evolution.client.js'
import { getChannelConfig } from '../modules/channels/channels.service.js'
import { interpolateMessage, shortProtocol } from './templates.js'

export type SystemMessageKind = 'channel-welcome' | 'agent-welcome' | 'closing'

interface SendSystemMessageArgs {
  conversationId: string
  /** Texto do template (já com variáveis); helper interpola e envia */
  template: string
  /** Kind pra marcar no Message.attachments e estilizar diferente na UI */
  kind: SystemMessageKind
  /** Usuário relacionado (atendente atual / quem disparou). null para mensagens de canal sem dono. */
  userId?: string | null
}

/**
 * Envia uma mensagem de sistema (welcome/closing) na conversa.
 * Resiliente: nunca lança — loga warning e segue.
 * Retorna a Message criada ou null se não enviou.
 */
export async function sendSystemMessage({
  conversationId, template, kind, userId,
}: SendSystemMessageArgs) {
  if (!template?.trim()) return null

  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        channel: { select: { id: true, type: true, label: true } },
        contact: { select: { id: true, name: true, company: { select: { name: true } } } },
      },
    })
    if (!conv) return null
    if (conv.channel.type !== 'WHATSAPP') return null  // por ora só WhatsApp suporta isso

    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } })
      : null

    const text = interpolateMessage(template, {
      cliente:   conv.contact?.name ?? '',
      atendente: user?.name ?? user?.email?.split('@')[0] ?? '',
      canal:     conv.channel.label,
      empresa:   conv.contact?.company?.name ?? '',
      protocolo: shortProtocol(conv.id),
    }).trim()

    if (!text) return null

    const { instanceName } = await getChannelConfig(conv.channel.id)
    const result = await evolutionClient.sendText(instanceName, conv.externalId, text)

    const msg = await prisma.message.create({
      data: {
        workspaceId: conv.workspaceId,
        conversationId: conv.id,
        direction: 'OUTBOUND',
        externalId: result.key?.id,
        fromUserId: userId ?? null,
        body: text,
        sentAt: new Date(),
        deliveryStatus: 'PENDING',
        attachments: [{ kind }] as any,
      },
    })
    logger.info({ conversationId, kind, userId }, 'Mensagem de sistema enviada')
    return msg
  } catch (err) {
    logger.warn({ err, conversationId, kind }, 'Falha ao enviar mensagem de sistema (ignorada)')
    return null
  }
}

/** Lê user.settings.<key> com tipo string, retorna '' se vazio/ausente. */
export async function getUserMessageTemplate(
  userId: string,
  key: 'welcomeMessage' | 'closingMessage',
): Promise<string> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { settings: true },
  })
  const s = (u?.settings as Record<string, unknown> | null) ?? {}
  const t = s[key]
  return typeof t === 'string' ? t : ''
}

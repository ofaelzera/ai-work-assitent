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
import { getChannelConfig } from '../modules/channels/channels.service.js'
import { getClientForChannel } from '../modules/evolution-servers/evolution-servers.service.js'
import { interpolateMessage, shortProtocol } from './templates.js'

export type SystemMessageKind = 'channel-welcome' | 'agent-welcome' | 'closing'

/**
 * Tipos de evento interno (NÃO enviam pro cliente — só ficam no timeline).
 * Renderizados com estilo de "system note" na UI.
 */
export type InternalEventKind = 'transfer' | 'note' | 'claim' | 'release'

interface CreateInternalEventArgs {
  workspaceId: string
  conversationId: string
  kind: InternalEventKind
  /** Texto descritivo do evento (ex: "Transferido para João: cliente aguarda retorno"). */
  body: string
  /** Usuário que disparou. null = sistema. */
  fromUserId?: string | null
  /** Metadados livres (ex: { fromName, toName, noteText }). */
  meta?: Record<string, unknown>
}

/**
 * Cria uma mensagem-evento INTERNA na conversa.
 * NÃO envia para o cliente via WhatsApp/Email — só fica no DB para o timeline.
 */
export async function createInternalEvent({
  workspaceId, conversationId, kind, body, fromUserId, meta,
}: CreateInternalEventArgs) {
  try {
    return await prisma.message.create({
      data: {
        workspaceId,
        conversationId,
        direction: 'OUTBOUND',
        fromUserId: fromUserId ?? null,
        body,
        sentAt: new Date(),
        deliveryStatus: 'PENDING',
        attachments: [{ kind: `internal-${kind}`, ...(meta ?? {}) }] as any,
      },
    })
  } catch (err) {
    logger.warn({ err, conversationId, kind }, 'Falha ao criar evento interno (ignorado)')
    return null
  }
}

interface SendSystemMessageArgs {
  conversationId: string
  /** Texto do template (já com variáveis); helper interpola e envia */
  template: string
  /** Kind pra marcar no Message.attachments e estilizar diferente na UI */
  kind: SystemMessageKind
  /** Usuário relacionado (atendente atual / quem disparou). null para mensagens de canal sem dono. */
  userId?: string | null
  /** Quando true, aborta o envio silenciosamente se a conversa for de grupo */
  skipIfGroup?: boolean
}

/**
 * Envia uma mensagem de sistema (welcome/closing) na conversa.
 * Resiliente: nunca lança — loga warning e segue.
 * Retorna a Message criada ou null se não enviou.
 */
export async function sendSystemMessage({
  conversationId, template, kind, userId, skipIfGroup,
}: SendSystemMessageArgs) {
  if (!template?.trim()) return null

  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        channel: { select: { id: true, type: true, label: true } },
        contact: { select: { id: true, name: true, company: { select: { name: true } } } },
        workspace: { select: { settings: true } },
      },
    })
    if (!conv) return null
    if (conv.channel.type !== 'WHATSAPP') return null  // por ora só WhatsApp suporta isso
    if (skipIfGroup && conv.type === 'GROUP') return null

    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } })
      : null

    const wsSettings = (conv.workspace.settings as Record<string, unknown> | null) ?? {}

    const text = interpolateMessage(template, {
      cliente:     conv.contact?.name ?? '',
      atendente:   user?.name ?? user?.email?.split('@')[0] ?? '',
      canal:       conv.channel.label,
      empresa:     conv.contact?.company?.name ?? '',
      protocolo:   shortProtocol(conv.id),
      cnpj:        typeof wsSettings.cnpj === 'string' ? wsSettings.cnpj : '',
      razaoSocial: typeof wsSettings.razaoSocial === 'string' ? wsSettings.razaoSocial : '',
    }).trim()

    if (!text) return null

    const { instanceName } = await getChannelConfig(conv.channel.id)
    const client = await getClientForChannel(conv.channel.id)
    const result = await client.sendText(instanceName, conv.externalId, text)

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

/** Lê a flag booleana de ignorar grupos para welcome ou closing. */
export async function getUserIgnoreGroups(
  userId: string,
  key: 'ignoreGroupsWelcome' | 'ignoreGroupsClosing',
): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { settings: true },
  })
  const s = (u?.settings as Record<string, unknown> | null) ?? {}
  return s[key] === true
}

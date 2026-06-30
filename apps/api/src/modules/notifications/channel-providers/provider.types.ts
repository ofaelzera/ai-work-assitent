import type { NotificationChannelKey, NotificationPriority } from '@aiwa/shared'

/**
 * Contexto entregue a um provider de canal no momento do envio.
 * O service já resolveu destinatário, regra e preferências — o provider só
 * traduz isso pro meio de comunicação concreto (in-app, e-mail, whatsapp, …).
 */
export interface ChannelSendContext {
  workspaceId: string
  /** Usuário do sistema destinatário (assignee/owner). Pode ser null em envios externos puros. */
  userId: string | null
  eventType: string
  category: string
  priority: NotificationPriority
  title: string
  body: string | null
  link: string | null
  soundId: string | null
  /** Não-perturbe: persiste in-app mas sem som/toast e sem canais externos. */
  silent: boolean
  metadata: Record<string, unknown>
  /** Channel.id a usar em canais externos (null = resolver padrão do workspace). */
  externalChannelId: string | null
  /** Contatos a notificar via canais externos (phone/email resolvidos pelo provider). */
  recipientContactIds: string[]
}

/**
 * Provider de canal de notificação plugável.
 * Adicionar SMS/Push/Slack = implementar esta interface e registerProvider().
 * Nenhuma regra de negócio do NotificationService precisa mudar.
 */
export interface NotificationChannelProvider {
  key: NotificationChannelKey | string
  /** Envia a notificação por este canal. Deve ser idempotente/tolerante a falhas. */
  send(ctx: ChannelSendContext): Promise<void>
}

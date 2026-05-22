/**
 * Sistema de triggers de Agent v2.
 *
 * Trigger = JSON salvo em Agent.trigger. Determina QUANDO um agente é executado.
 *
 * Tipos suportados:
 *   - "message.received"      → toda mensagem inbound nova
 *   - "conversation.created"  → toda conversa nova
 *   - "cron"                  → recorrente (schedule cron-like)
 *   - "manual"                → só executado por chamada explícita / botão "Testar"
 */

export type TriggerType = 'message.received' | 'conversation.created' | 'cron' | 'manual'

export interface MessageTriggerFilters {
  channelId?: string
  channelType?: 'WHATSAPP' | 'IMAP_SMTP' | 'GMAIL' | 'TELEGRAM' | 'INSTAGRAM'
  conversationExternalId?: string // ex: id de grupo do WhatsApp
  bodyContains?: string           // case-insensitive
  direction?: 'INBOUND' | 'OUTBOUND'
}

export interface ConversationTriggerFilters {
  channelId?: string
  channelType?: 'WHATSAPP' | 'IMAP_SMTP' | 'GMAIL' | 'TELEGRAM' | 'INSTAGRAM'
}

export interface CronTriggerConfig {
  schedule: string // sintaxe cron: "0 8 * * *"
}

export interface TriggerConfig {
  type: TriggerType
  filters?: MessageTriggerFilters | ConversationTriggerFilters
  schedule?: string
}

export interface TriggerEvent {
  type: 'message.received' | 'conversation.created' | 'cron' | 'manual'
  workspaceId: string
  // Contexto adicional dependendo do tipo
  conversationId?: string
  messageId?: string
  contactId?: string
  channelId?: string
  channelType?: string
  body?: string
  direction?: string
  conversationExternalId?: string
  payload?: Record<string, unknown>
}

/**
 * Verifica se um trigger config casa com um evento.
 * Retorna false rapidamente se algum filtro não bater.
 */
export function matchesTrigger(trigger: TriggerConfig | null | undefined, event: TriggerEvent): boolean {
  if (!trigger) return false
  if (trigger.type !== event.type) return false

  const filters = trigger.filters as MessageTriggerFilters | ConversationTriggerFilters | undefined
  if (!filters) return true

  if ('channelId' in filters && filters.channelId && filters.channelId !== event.channelId) return false
  if ('channelType' in filters && filters.channelType && filters.channelType !== event.channelType) return false

  if (event.type === 'message.received') {
    const f = filters as MessageTriggerFilters
    if (f.conversationExternalId && f.conversationExternalId !== event.conversationExternalId) return false
    if (f.direction && f.direction !== event.direction) return false
    if (f.bodyContains) {
      const needle = f.bodyContains.toLowerCase()
      const hay = (event.body ?? '').toLowerCase()
      if (!hay.includes(needle)) return false
    }
  }

  return true
}

/**
 * Type guard pra validar shape de TriggerConfig vindo de JSON (Agent.trigger).
 */
export function isTriggerConfig(v: unknown): v is TriggerConfig {
  if (!v || typeof v !== 'object') return false
  const t = (v as { type?: unknown }).type
  return t === 'message.received' || t === 'conversation.created' || t === 'cron' || t === 'manual'
}

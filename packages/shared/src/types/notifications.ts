// ─────────────────────────────────────────────────────────────────────────────
// Central de Lembretes e Notificações — tipos e catálogo compartilhados.
//
// Adicionar um novo tipo de evento = acrescentar uma entrada em
// NOTIFICATION_EVENTS. Nenhuma regra de negócio (service/providers) precisa mudar.
// ─────────────────────────────────────────────────────────────────────────────

export type NotificationPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export type NotificationCategory = 'task' | 'card' | 'calendar' | 'reminder' | 'system'

/** Canais de entrega plugáveis. Novos canais (sms, push, slack…) entram aqui. */
export type NotificationChannelKey = 'in_app' | 'email' | 'whatsapp'

export type NotificationEventType =
  | 'TASK_DUE_SOON'
  | 'TASK_OVERDUE'
  | 'CARD_DUE_SOON'
  | 'CARD_OVERDUE'
  | 'CALENDAR_EVENT_UPCOMING'
  | 'CALENDAR_EVENT_STARTED'
  | 'MANUAL_REMINDER'
  | 'AI_NOTIFICATION'

export interface NotificationEventDef {
  key: NotificationEventType
  category: NotificationCategory
  defaultPriority: NotificationPriority
  /** Aviso temporal (lembrete agendado) vs. instantâneo (IA/manual). */
  temporal: boolean
  label: string
  description: string
}

/** Catálogo central — fonte de verdade dos tipos de evento suportados. */
export const NOTIFICATION_EVENTS: Record<NotificationEventType, NotificationEventDef> = {
  TASK_DUE_SOON: {
    key: 'TASK_DUE_SOON',
    category: 'task',
    defaultPriority: 'MEDIUM',
    temporal: true,
    label: 'Tarefa a vencer',
    description: 'Tarefa com lembrete se aproximando do horário.',
  },
  TASK_OVERDUE: {
    key: 'TASK_OVERDUE',
    category: 'task',
    defaultPriority: 'HIGH',
    temporal: true,
    label: 'Tarefa vencida',
    description: 'Tarefa cujo horário de lembrete já passou e não foi concluída.',
  },
  CARD_DUE_SOON: {
    key: 'CARD_DUE_SOON',
    category: 'card',
    defaultPriority: 'MEDIUM',
    temporal: true,
    label: 'Atividade do Kanban próxima do vencimento',
    description: 'Card com prazo (dueDate) se aproximando.',
  },
  CARD_OVERDUE: {
    key: 'CARD_OVERDUE',
    category: 'card',
    defaultPriority: 'HIGH',
    temporal: true,
    label: 'Atividade do Kanban atrasada',
    description: 'Card com prazo vencido em coluna não concluída.',
  },
  CALENDAR_EVENT_UPCOMING: {
    key: 'CALENDAR_EVENT_UPCOMING',
    category: 'calendar',
    defaultPriority: 'MEDIUM',
    temporal: true,
    label: 'Evento do calendário próximo',
    description: 'Evento da agenda começando dentro da antecedência configurada.',
  },
  CALENDAR_EVENT_STARTED: {
    key: 'CALENDAR_EVENT_STARTED',
    category: 'calendar',
    defaultPriority: 'HIGH',
    temporal: true,
    label: 'Evento do calendário iniciado',
    description: 'Evento da agenda que acabou de começar.',
  },
  MANUAL_REMINDER: {
    key: 'MANUAL_REMINDER',
    category: 'reminder',
    defaultPriority: 'MEDIUM',
    temporal: false,
    label: 'Lembrete manual',
    description: 'Lembrete criado manualmente pelo usuário.',
  },
  AI_NOTIFICATION: {
    key: 'AI_NOTIFICATION',
    category: 'system',
    defaultPriority: 'MEDIUM',
    temporal: false,
    label: 'Notificação da IA',
    description: 'Alerta gerado por um agente de IA (ferramenta notify).',
  },
}

/** Tipos SSE emitidos pela central (consumidos pelo frontend via useSSE). */
export const NOTIFICATION_SSE = {
  NEW: 'notification.new',
  READ: 'notification.read',
  DISMISSED: 'notification.dismissed',
} as const

/** Payload do evento SSE `notification.new`. */
export interface NotificationNewPayload {
  id: string
  userId: string
  eventType: NotificationEventType | string
  category: NotificationCategory | string
  priority: NotificationPriority
  title: string
  body: string | null
  link: string | null
  soundId: string | null
  createdAt: string
  /** Em modo não-perturbe: aparece na central mas sem som/toast. */
  silent: boolean
}

/** Mapeia o nível visual da ferramenta de IA para prioridade da central. */
export function aiLevelToPriority(level: string | undefined): NotificationPriority {
  switch (level) {
    case 'error':
      return 'CRITICAL'
    case 'warning':
      return 'HIGH'
    case 'success':
    case 'info':
    default:
      return 'MEDIUM'
  }
}

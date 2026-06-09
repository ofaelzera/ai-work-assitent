export type CommChannel = 'WHATSAPP' | 'EMAIL'

export type CampaignStatus = 'DRAFT' | 'SCHEDULED' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELED'

export type CommStatus = 'PENDING' | 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELED'

export interface Campaign {
  id: string
  name: string
  description: string | null
  channelType: CommChannel
  channelId: string | null
  subject: string | null
  body: string
  status: CampaignStatus
  listId: string | null
  scheduledAt: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  list?: { id: string; name: string } | null
  _count?: { messages: number }
}

export interface CampaignMetrics {
  campaignId: string
  status: CampaignStatus
  recipients: number
  sent: number
  pending: number
  failed: number
  successRate: number
  startedAt: string | null
  completedAt: string | null
  scheduledAt: string | null
}

export interface BroadcastList {
  id: string
  name: string
  description: string | null
  createdAt: string
  _count?: { members: number; campaigns: number }
}

export interface ListContact {
  id: string
  name: string | null
  phone: string | null
  email: string | null
}

export interface BroadcastListDetail extends BroadcastList {
  members: { id: string; contact: ListContact }[]
}

export interface CommMessage {
  id: string
  channelType: CommChannel
  to: string
  subject: string | null
  status: CommStatus
  priority: number
  scheduledAt: string | null
  sentAt: string | null
  attempts: number
  lastError: string | null
  source: string
  campaignId: string | null
  createdAt: string
}

export interface CommDashboard {
  sentToday: number
  pending: number
  failed: number
  deliveryRate: number
  runningCampaigns: number
  completedCampaigns: number
  volumeByChannel: { channel: CommChannel; count: number }[]
}

export interface CommApiKey {
  id: string
  name: string
  prefix: string
  scopes: string[]
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
}

export interface Channel {
  id: string
  type: string
  label: string
  status: string
}

export const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  SCHEDULED: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
  RUNNING: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  PAUSED: 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400',
  COMPLETED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  CANCELED: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
  PENDING: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  PROCESSING: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  SENT: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  FAILED: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
}

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  SCHEDULED: 'Agendada',
  RUNNING: 'Em execução',
  PAUSED: 'Pausada',
  COMPLETED: 'Concluída',
  CANCELED: 'Cancelada',
  PENDING: 'Pendente',
  PROCESSING: 'Processando',
  SENT: 'Enviada',
  FAILED: 'Falhou',
}

export function channelMatches(channelType: CommChannel, type: string): boolean {
  if (channelType === 'WHATSAPP') return type === 'WHATSAPP' || type === 'META_WHATSAPP'
  return type === 'IMAP_SMTP' || type === 'GMAIL'
}

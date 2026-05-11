export type Role = 'ADMIN' | 'MEMBER'
export type ChannelType = 'WHATSAPP' | 'GMAIL' | 'IMAP_SMTP'
export type ChannelStatus = 'CONNECTED' | 'DISCONNECTED' | 'ERROR'
export type MessageDirection = 'INBOUND' | 'OUTBOUND'
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
export type CreatedBy = 'USER' | 'AI'

export interface JwtPayload {
  sub: string       // userId
  workspaceId: string
  role: Role
  iat?: number
  exp?: number
}

export interface AIClassification {
  isDemand: boolean
  intent: 'support' | 'billing' | 'sales' | 'info' | 'technical' | 'other'
  priority: Priority
  summary: string
  suggestedTitle: string
  checklist: string[]
  confidence: number
}

export interface SSEEvent {
  type: string
  payload: unknown
}

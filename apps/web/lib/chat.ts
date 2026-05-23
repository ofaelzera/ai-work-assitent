import { apiFetch } from './api'

export interface ChatParticipant {
  id: string
  userId: string
  role: 'OWNER' | 'MEMBER'
  joinedAt: string
  lastReadAt: string | null
  leftAt: string | null
  user: { id: string; name: string; email: string }
}

export interface ChatLastMessage {
  id: string
  body: string
  sentAt: string
  fromUserId: string | null
  attachments: any
}

export interface ChatRoom {
  id: string
  type: 'DIRECT' | 'GROUP'
  name: string | null
  lastMessageAt: string | null
  unreadCount: number
  channel: { id: string; type: string; label: string }
  participants: ChatParticipant[]
  messages: ChatLastMessage[]
}

export interface ChatMessage {
  id: string
  conversationId: string
  body: string
  sentAt: string
  fromUserId: string | null
  attachments: any
  fromUser: { id: string; name: string; email: string } | null
  reads: Array<{ userId: string; readAt: string }>
  quotedMsgId?: string | null
}

export function fetchRooms() {
  return apiFetch<{ rooms: ChatRoom[] }>('/chat/rooms')
}

export function fetchRoom(id: string) {
  return apiFetch<ChatRoom>(`/chat/rooms/${id}`)
}

export function fetchMessages(roomId: string, cursor?: string) {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  return apiFetch<{ messages: ChatMessage[]; nextCursor: string | null }>(
    `/chat/rooms/${roomId}/messages${qs}`,
  )
}

export function sendMessage(
  roomId: string,
  body: string,
  attachments?: Array<{ name: string; url: string; mime?: string; size?: number }>,
) {
  return apiFetch<ChatMessage>(`/chat/rooms/${roomId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body, attachments }),
  })
}

export function markRead(roomId: string, uptoMessageId?: string) {
  return apiFetch<{ ok: true }>(`/chat/rooms/${roomId}/read`, {
    method: 'PATCH',
    body: JSON.stringify({ uptoMessageId }),
  })
}

export function emitTyping(roomId: string, action: 'start' | 'stop') {
  return apiFetch<{ ok: true }>(`/chat/rooms/${roomId}/typing`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  })
}

export function createRoom(userIds: string[], name?: string) {
  return apiFetch<ChatRoom>('/chat/rooms', {
    method: 'POST',
    body: JSON.stringify({ userIds, name }),
  })
}

export function fetchUnreadTotal() {
  return apiFetch<{ total: number }>('/chat/unread-count')
}

export function roomDisplayName(room: ChatRoom, currentUserId: string): string {
  if (room.type === 'GROUP') return room.name ?? 'Grupo'
  const other = room.participants.find((p) => p.userId !== currentUserId)
  return other?.user.name ?? other?.user.email ?? 'Conversa'
}

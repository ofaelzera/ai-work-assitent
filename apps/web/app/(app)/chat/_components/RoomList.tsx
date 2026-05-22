'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { fetchRooms, roomDisplayName, type ChatRoom } from '@/lib/chat'
import { useAuthStore } from '@/store/auth'
import { useSSE } from '@/lib/sse'
import { cn } from '@/lib/utils'
import { Users, MessageSquare, Plus } from 'lucide-react'

function formatTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function initials(name: string) {
  const p = name.trim().split(/\s+/)
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase()
}

export function RoomList({ onNew }: { onNew: () => void }) {
  const params = useParams<{ roomId?: string }>()
  const activeId = params.roomId
  const { user } = useAuthStore()
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['chat', 'rooms'],
    queryFn: fetchRooms,
    refetchOnWindowFocus: true,
  })

  // Realtime: invalida lista quando há nova mensagem ou alteração de sala
  useSSE((ev) => {
    if (ev.type === 'chat.message.new' || ev.type === 'chat.room.updated' || ev.type === 'chat.room.read') {
      qc.invalidateQueries({ queryKey: ['chat', 'rooms'] })
      qc.invalidateQueries({ queryKey: ['chat', 'unread-total'] })
    }
  })

  const rooms = data?.rooms ?? []

  return (
    <aside className="w-80 flex-shrink-0 border-r border-border bg-card flex flex-col">
      <div className="p-4 flex items-center justify-between">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <MessageSquare className="h-4 w-4" /> Chat interno
        </h2>
        <button
          onClick={onNew}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition"
          title="Nova conversa"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {rooms.length === 0 && (
          <p className="p-6 text-xs text-muted-foreground text-center">
            Nenhuma conversa ainda. Clique em <Plus className="inline h-3 w-3" /> para iniciar.
          </p>
        )}
        {rooms.map((room) => (
          <RoomRow key={room.id} room={room} active={room.id === activeId} currentUserId={user?.sub ?? ''} />
        ))}
      </div>
    </aside>
  )
}

function RoomRow({ room, active, currentUserId }: { room: ChatRoom; active: boolean; currentUserId: string }) {
  const name = roomDisplayName(room, currentUserId)
  const last = room.messages[0]
  const preview = last ? (last.fromUserId === currentUserId ? 'Você: ' : '') + last.body : 'Sem mensagens'

  return (
    <Link
      href={`/chat/${room.id}`}
      className={cn(
        'flex gap-3 px-4 py-3 border-b border-border/40 hover:bg-accent/40 transition',
        active && 'bg-primary/10',
      )}
    >
      <div className="h-10 w-10 rounded-full bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-white text-xs font-semibold shrink-0">
        {room.type === 'GROUP' ? <Users className="h-5 w-5" /> : initials(name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-sm truncate">{name}</span>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {formatTime(room.lastMessageAt)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground truncate">{preview}</span>
          {room.unreadCount > 0 && (
            <span className="h-5 min-w-[20px] px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shrink-0">
              {room.unreadCount}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

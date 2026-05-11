'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { useSSE } from '@/lib/sse'
import { MessageSquare, Search, Wifi, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from '@/lib/date'

interface Conversation {
  id: string
  externalId: string
  isGroup: boolean
  subject: string | null
  unreadCount: number
  lastMessageAt: string | null
  contact: { id: string; name: string | null; phone: string | null } | null
  channel: { id: string; type: string; label: string }
  messages: Array<{ body: string; sentAt: string; direction: string }>
}

function ConversationItem({
  conv,
  active,
  onClick,
}: {
  conv: Conversation
  active: boolean
  onClick: () => void
}) {
  const name = conv.contact?.name ?? conv.contact?.phone ?? conv.subject ?? conv.externalId
  const lastMsg = conv.messages[0]
  const channelIcon = conv.channel.type === 'WHATSAPP' ? '📱' : '📧'

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-4 py-3 border-b hover:bg-accent transition-colors',
        active && 'bg-primary/5 border-l-2 border-l-primary',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base shrink-0">{channelIcon}</span>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{name}</p>
            {lastMsg && (
              <p className="text-xs text-muted-foreground truncate">
                {lastMsg.direction === 'OUTBOUND' ? '→ ' : ''}
                {lastMsg.body}
              </p>
            )}
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          {conv.lastMessageAt && (
            <span className="text-[10px] text-muted-foreground">
              {formatDistanceToNow(conv.lastMessageAt)}
            </span>
          )}
          {conv.unreadCount > 0 && (
            <span className="text-[10px] font-bold bg-primary text-primary-foreground rounded-full px-1.5 py-0.5">
              {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

export default function InboxPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['conversations', search],
    queryFn: () =>
      apiFetch<{ conversations: Conversation[] }>(
        `/conversations${search ? `?q=${encodeURIComponent(search)}` : ''}`,
      ),
    refetchInterval: 30_000,
  })

  useSSE((event) => {
    if (event.type === 'message.received') {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    }
  })

  const conversations = data?.conversations ?? []

  return (
    <div className="flex h-full">
      {/* Lista */}
      <div className="w-80 flex-shrink-0 border-r flex flex-col">
        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar conversas..."
              className="w-full rounded-md border bg-transparent pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="p-4 text-center text-sm text-muted-foreground">Carregando...</div>
          )}
          {!isLoading && conversations.length === 0 && (
            <div className="p-8 text-center space-y-2">
              <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {search ? 'Nenhuma conversa encontrada' : 'Nenhuma conversa ainda'}
              </p>
              {!search && (
                <p className="text-xs text-muted-foreground">
                  Conecte um canal em{' '}
                  <a href="/admin/channels" className="text-primary hover:underline">
                    Admin → Canais
                  </a>
                </p>
              )}
            </div>
          )}
          {conversations.map((conv) => (
            <ConversationItem
              key={conv.id}
              conv={conv}
              active={activeId === conv.id}
              onClick={() => {
                setActiveId(conv.id)
                router.push(`/inbox/${conv.id}`)
              }}
            />
          ))}
        </div>
      </div>

      {/* Placeholder quando nenhuma conversa selecionada */}
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-2">
          <MessageSquare className="h-10 w-10 mx-auto opacity-30" />
          <p className="text-sm">Selecione uma conversa</p>
        </div>
      </div>
    </div>
  )
}

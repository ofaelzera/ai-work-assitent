'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import {
  fetchMessages,
  fetchRoom,
  markRead,
  sendMessage,
  emitTyping,
  roomDisplayName,
  type ChatMessage,
} from '@/lib/chat'
import { useAuthStore } from '@/store/auth'
import { useSSE } from '@/lib/sse'
import { cn } from '@/lib/utils'
import { Send, Users } from 'lucide-react'

function initials(name: string) {
  const p = name.trim().split(/\s+/)
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase()
}

function formatMsgTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function ChatView({ roomId }: { roomId: string }) {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [input, setInput] = useState('')
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map())
  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const lastTypingEmitRef = useRef<number>(0)
  const typingStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: room } = useQuery({
    queryKey: ['chat', 'room', roomId],
    queryFn: () => fetchRoom(roomId),
  })

  const { data, refetch } = useQuery({
    queryKey: ['chat', 'messages', roomId],
    queryFn: () => fetchMessages(roomId),
  })

  // Scroll para o fim quando carregar/chegar nova msg
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [data?.messages?.length])

  // Marca como lido ao montar e quando chegam novas msgs (se aba ativa)
  useEffect(() => {
    if (!data?.messages?.length) return
    const last = data.messages[data.messages.length - 1]
    if (last.fromUserId !== user?.sub) {
      markRead(roomId, last.id).then(() => {
        qc.invalidateQueries({ queryKey: ['chat', 'rooms'] })
        qc.invalidateQueries({ queryKey: ['chat', 'unread-total'] })
      })
    }
  }, [roomId, data?.messages?.length])

  // Realtime
  useSSE((ev) => {
    if (ev.type === 'chat.message.new') {
      const payload = ev.payload as { conversationId: string }
      if (payload.conversationId === roomId) {
        refetch()
      }
    }
    if (ev.type === 'chat.typing') {
      const p = ev.payload as { conversationId: string; userId: string; userName: string; action: 'start' | 'stop' }
      if (p.conversationId !== roomId || p.userId === user?.sub) return

      // Cleanup existing timeout
      const ex = typingTimeoutsRef.current.get(p.userId)
      if (ex) clearTimeout(ex)

      if (p.action === 'stop') {
        setTypingUsers((m) => {
          const next = new Map(m)
          next.delete(p.userId)
          return next
        })
        typingTimeoutsRef.current.delete(p.userId)
      } else {
        setTypingUsers((m) => {
          const next = new Map(m)
          next.set(p.userId, p.userName)
          return next
        })
        // Auto-stop após 4s sem outro start
        const t = setTimeout(() => {
          setTypingUsers((m) => {
            const next = new Map(m)
            next.delete(p.userId)
            return next
          })
          typingTimeoutsRef.current.delete(p.userId)
        }, 4000)
        typingTimeoutsRef.current.set(p.userId, t)
      }
    }
  })

  const send = useMutation({
    mutationFn: () => sendMessage(roomId, input.trim()),
    onSuccess: () => {
      setInput('')
      refetch()
      qc.invalidateQueries({ queryKey: ['chat', 'rooms'] })
    },
  })

  function handleTyping(value: string) {
    setInput(value)
    const now = Date.now()
    if (now - lastTypingEmitRef.current > 1500) {
      lastTypingEmitRef.current = now
      void emitTyping(roomId, 'start').catch(() => {})
    }
    if (typingStopTimeoutRef.current) clearTimeout(typingStopTimeoutRef.current)
    typingStopTimeoutRef.current = setTimeout(() => {
      void emitTyping(roomId, 'stop').catch(() => {})
      lastTypingEmitRef.current = 0
    }, 1800)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || send.isPending) return
    void emitTyping(roomId, 'stop').catch(() => {})
    if (typingStopTimeoutRef.current) clearTimeout(typingStopTimeoutRef.current)
    lastTypingEmitRef.current = 0
    send.mutate()
  }

  const messages = data?.messages ?? []
  const title = room ? roomDisplayName(room as any, user?.sub ?? '') : '...'
  const typingNames = Array.from(typingUsers.values())

  return (
    <div className="flex-1 flex flex-col bg-accent/10">
      {/* Header */}
      <div className="border-b border-border bg-card px-4 py-3 flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-white text-xs font-semibold">
          {room?.type === 'GROUP' ? <Users className="h-4 w-4" /> : initials(title)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{title}</p>
          {room?.type === 'GROUP' && (
            <p className="text-xs text-muted-foreground truncate">
              {room.participants.length} participantes
            </p>
          )}
          {room?.type === 'DIRECT' && (
            <p className="text-xs text-muted-foreground">
              Chat interno
            </p>
          )}
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-medium">
          Interno
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-12">
            Envie a primeira mensagem!
          </div>
        )}
        {messages.map((m, i) => (
          <Bubble
            key={m.id}
            msg={m}
            isMine={m.fromUserId === user?.sub}
            showAuthor={
              room?.type === 'GROUP' &&
              m.fromUserId !== user?.sub &&
              (i === 0 || messages[i - 1].fromUserId !== m.fromUserId)
            }
          />
        ))}
        {typingNames.length > 0 && (
          <div className="text-xs text-muted-foreground italic px-2">
            {typingNames.join(', ')} {typingNames.length === 1 ? 'está' : 'estão'} digitando...
          </div>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-border bg-card p-3 flex gap-2 items-end"
      >
        <textarea
          value={input}
          onChange={(e) => handleTyping(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSubmit(e as any)
            }
          }}
          placeholder="Mensagem..."
          rows={1}
          className="flex-1 resize-none px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 max-h-32"
        />
        <button
          type="submit"
          disabled={!input.trim() || send.isPending}
          className="p-2 rounded-md bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90"
          title="Enviar"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  )
}

function Bubble({
  msg,
  isMine,
  showAuthor,
}: {
  msg: ChatMessage
  isMine: boolean
  showAuthor: boolean
}) {
  return (
    <div className={cn('flex', isMine ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[70%] space-y-0.5', isMine ? 'items-end' : 'items-start')}>
        {showAuthor && msg.fromUser && (
          <p className="text-[11px] font-semibold text-muted-foreground px-1">
            {msg.fromUser.name}
          </p>
        )}
        <div
          className={cn(
            'rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words shadow-sm',
            isMine
              ? 'bg-primary text-primary-foreground rounded-br-sm'
              : 'bg-card text-foreground rounded-bl-sm',
          )}
        >
          {msg.body}
        </div>
        <p
          className={cn(
            'text-[10px] text-muted-foreground px-1',
            isMine ? 'text-right' : 'text-left',
          )}
        >
          {formatMsgTime(msg.sentAt)}
          {isMine && msg.reads && msg.reads.length > 0 && (
            <span className="ml-1 text-blue-500">✓✓</span>
          )}
        </p>
      </div>
    </div>
  )
}

'use client'

import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { useSSE } from '@/lib/sse'
import { Send, ArrowLeft, Phone, Mail } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { formatTime, formatDate } from '@/lib/date'

interface Message {
  id: string
  body: string
  direction: 'INBOUND' | 'OUTBOUND'
  sentAt: string
  fromContactId: string | null
  fromUserId: string | null
}

interface ConversationDetail {
  conversation: {
    id: string
    externalId: string
    isGroup: boolean
    subject: string | null
    contact: { id: string; name: string | null; phone: string | null; email: string | null } | null
    channel: { id: string; type: string; label: string }
  }
  messages: Message[]
  nextCursor: string | null
}

function groupByDate(messages: Message[]) {
  const groups: { date: string; messages: Message[] }[] = []
  let lastDate = ''
  for (const msg of messages) {
    const date = formatDate(msg.sentAt)
    if (date !== lastDate) {
      groups.push({ date, messages: [] })
      lastDate = date
    }
    groups[groups.length - 1].messages.push(msg)
  }
  return groups
}

export default function ConversationPage() {
  const { conversationId } = useParams<{ conversationId: string }>()
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => apiFetch<ConversationDetail>(`/conversations/${conversationId}/messages`),
    enabled: !!conversationId,
  })

  const sendMutation = useMutation({
    mutationFn: (body: string) =>
      apiFetch<Message>(`/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text: body }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      setText('')
    },
  })

  useSSE((event) => {
    if (
      event.type === 'message.received' &&
      (event.payload as any)?.conversationId === conversationId
    ) {
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    }
  })

  // Scroll to bottom quando chegam novas mensagens
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [data?.messages?.length])

  const conv = data?.conversation
  const messages = data?.messages ?? []
  const groups = groupByDate(messages)

  const name =
    conv?.contact?.name ?? conv?.contact?.phone ?? conv?.subject ?? conv?.externalId ?? '...'

  const handleSend = () => {
    const trimmed = text.trim()
    if (!trimmed || sendMutation.isPending) return
    sendMutation.mutate(trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-card shrink-0">
        <Link href="/inbox" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{name}</p>
          <p className="text-xs text-muted-foreground">
            {conv?.channel.type === 'WHATSAPP' ? '📱' : '📧'} {conv?.channel.label}
            {conv?.contact?.phone && (
              <span className="ml-2 text-muted-foreground">{conv.contact.phone}</span>
            )}
          </p>
        </div>
      </div>

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoading && (
          <div className="text-center text-sm text-muted-foreground">Carregando...</div>
        )}

        {groups.map((group) => (
          <div key={group.date}>
            <div className="flex items-center gap-2 my-3">
              <hr className="flex-1 border-border" />
              <span className="text-[10px] text-muted-foreground px-2">{group.date}</span>
              <hr className="flex-1 border-border" />
            </div>
            <div className="space-y-1.5">
              {group.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    'flex',
                    msg.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start',
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[70%] rounded-2xl px-3 py-2 text-sm',
                      msg.direction === 'OUTBOUND'
                        ? 'bg-primary text-primary-foreground rounded-br-sm'
                        : 'bg-muted rounded-bl-sm',
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                    <p
                      className={cn(
                        'text-[10px] mt-0.5 text-right',
                        msg.direction === 'OUTBOUND'
                          ? 'text-primary-foreground/70'
                          : 'text-muted-foreground',
                      )}
                    >
                      {formatTime(msg.sentAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {messages.length === 0 && !isLoading && (
          <div className="text-center text-sm text-muted-foreground py-8">
            Nenhuma mensagem ainda
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t bg-card shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Digite uma mensagem... (Enter para enviar, Shift+Enter para nova linha)"
            rows={1}
            className="flex-1 resize-none rounded-xl border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring max-h-32"
            style={{ minHeight: '40px' }}
          />
          <button
            onClick={handleSend}
            disabled={!text.trim() || sendMutation.isPending}
            className="rounded-xl bg-primary text-primary-foreground p-2.5 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

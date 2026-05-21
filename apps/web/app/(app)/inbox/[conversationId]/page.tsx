'use client'

import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import WhatsappView from './_components/WhatsappView'
import EmailView from './_components/EmailView'
import type { ConversationInfo, Message } from './_components/WhatsappView'

interface ConversationDetail {
  conversation: ConversationInfo
  messages: Message[]
  nextCursor: string | null
}

export default function ConversationPage() {
  const { conversationId } = useParams<{ conversationId: string }>()

  const { data, isLoading } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => apiFetch<ConversationDetail>(`/conversations/${conversationId}/messages`),
    enabled: !!conversationId,
  })

  const conv = data?.conversation
  const messages = data?.messages ?? []
  const channelType = conv?.channel.type

  if (!conv && !isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Conversa não encontrada
      </div>
    )
  }

  // Skeleton inicial — evita flash antes de saber o tipo de canal
  if (!conv && isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b bg-card flex items-center gap-3 shrink-0">
          <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-32 rounded bg-muted animate-pulse" />
            <div className="h-3 w-20 rounded bg-muted animate-pulse" />
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          Carregando...
        </div>
      </div>
    )
  }

  // ── Roteamento por tipo de canal ──────────────────────────────────────────
  if (channelType === 'GMAIL' || channelType === 'IMAP_SMTP') {
    return (
      <EmailView
        conversationId={conversationId}
        conv={conv!}
        messages={messages}
        isLoading={isLoading}
      />
    )
  }

  // Default: WhatsApp (e qualquer futuro canal de mensagens)
  return (
    <WhatsappView
      conversationId={conversationId}
      conv={conv!}
      messages={messages}
      isLoading={isLoading}
    />
  )
}

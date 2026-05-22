'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { History, X, User as UserIcon, Bot } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ActorRef { id: string; name: string | null; email: string }
interface TimelineEvent {
  id: string
  type: string
  actorUserId: string | null
  actor: ActorRef | null
  targetType: string | null
  targetId: string | null
  payload: Record<string, unknown>
  createdAt: string
}

const TYPE_LABEL: Record<string, string> = {
  'conversation.claimed': 'Assumiu a conversa',
  'conversation.released': 'Devolveu à fila',
  'conversation.status_changed': 'Mudou status',
  'conversation.moved': 'Moveu de pasta',
  'conversation.deleted': 'Deletou conversa',
  'conversation.first_response': 'Primeira resposta',
  'conversation.resolved': 'Resolvida',
}

const TYPE_DOT: Record<string, string> = {
  'conversation.claimed': 'bg-violet-500',
  'conversation.released': 'bg-amber-500',
  'conversation.status_changed': 'bg-indigo-500',
  'conversation.moved': 'bg-sky-500',
  'conversation.deleted': 'bg-rose-500',
  'conversation.first_response': 'bg-emerald-500',
  'conversation.resolved': 'bg-emerald-500',
}

function formatPayload(e: TimelineEvent): string | null {
  const p = e.payload ?? {}
  if (e.type === 'conversation.status_changed') {
    return `${p.previousStatus ?? '?'} → ${p.status ?? '?'}`
  }
  if (e.type === 'conversation.released' && typeof p.reason === 'string') {
    return `Motivo: ${p.reason}`
  }
  if (e.type === 'conversation.moved' && typeof p.toFolder === 'string') {
    return `Para: ${p.toFolder}`
  }
  return null
}

export function ConversationTimelineModal({
  conversationId,
  onClose,
}: {
  conversationId: string
  onClose: () => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['conversation-timeline', conversationId],
    queryFn: () =>
      apiFetch<{ conversationId: string; events: TimelineEvent[] }>(
        `/conversations/${conversationId}/timeline`,
      ),
  })

  const events = data?.events ?? []

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" /> Histórico da conversa
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 overflow-y-auto">
          {isLoading && <p className="text-xs text-muted-foreground">Carregando...</p>}
          {!isLoading && events.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">Nenhum evento de auditoria pra esta conversa ainda.</p>
          )}
          {events.length > 0 && (
            <ol className="relative border-l-2 border-muted ml-2 space-y-4">
              {events.map((e) => {
                const actor = e.actor?.name ?? e.actor?.email
                const isSystem = !e.actorUserId
                const subtitle = formatPayload(e)
                return (
                  <li key={e.id} className="ml-4">
                    <span className={cn('absolute -left-[7px] h-3 w-3 rounded-full ring-4 ring-card', TYPE_DOT[e.type] ?? 'bg-muted-foreground/40')} />
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium">
                          {TYPE_LABEL[e.type] ?? e.type}
                        </p>
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                          {isSystem ? <Bot className="h-3 w-3" /> : <UserIcon className="h-3 w-3" />}
                          {isSystem ? 'Sistema' : actor ?? 'Usuário'}
                        </p>
                        {subtitle && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 italic">{subtitle}</p>
                        )}
                      </div>
                      <time className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0" title={new Date(e.createdAt).toLocaleString('pt-BR')}>
                        {new Date(e.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </time>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}

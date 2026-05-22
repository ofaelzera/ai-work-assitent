'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Activity, ChevronDown, RefreshCw, Filter, User as UserIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AdminPageLayout } from '@/components/admin/AdminPageLayout'

interface ActorRef { id: string; name: string | null; email: string }
interface EventLog {
  id: string
  type: string
  actorUserId: string | null
  actor: ActorRef | null
  targetType: string | null
  targetId: string | null
  payload: unknown
  createdAt: string
}
interface EventsResponse { events: EventLog[]; nextCursor: string | null }
interface UserOption { id: string; name: string | null; email: string }

function relativeTime(date: string): string {
  const diff = Date.now() - new Date(date).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `há ${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `há ${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.floor(h / 24)
  return `há ${d}d`
}

const TYPE_COLORS: Record<string, string> = {
  'message.received': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  'message.sent': 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  'card.created': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  'card.moved': 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  'task.created': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  'task.updated': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  'conversation.claimed': 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  'conversation.released': 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  'conversation.status_changed': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  'ai.executed': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  'vault.accessed': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  'channel.connected': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  'channel.disconnected': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

function humanize(type: string): string {
  return ({
    'conversation.claimed': 'assumiu conversa',
    'conversation.released': 'devolveu à fila',
    'conversation.status_changed': 'mudou status da conversa',
    'conversation.deleted': 'deletou conversa',
    'conversation.moved': 'moveu conversa de pasta',
    'card.created': 'criou card',
    'card.moved': 'moveu card',
    'task.created': 'criou tarefa',
    'task.updated': 'atualizou tarefa',
    'vault.accessed': 'acessou cofre',
    'message.sent': 'enviou mensagem',
    'message.received': 'recebeu mensagem',
  } as Record<string, string>)[type] ?? type
}

function TypeBadge({ type }: { type: string }) {
  const color = TYPE_COLORS[type] ?? 'bg-muted text-muted-foreground'
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap', color)}>
      {type}
    </span>
  )
}

function EventRow({ event }: { event: EventLog }) {
  const [expanded, setExpanded] = useState(false)
  const actorLabel = event.actor?.name ?? event.actor?.email ?? (event.actorUserId ? 'Usuário' : 'Sistema')
  const targetShort = event.targetId ? event.targetId.slice(-6).toUpperCase() : null

  return (
    <div className="border rounded-xl overflow-hidden">
      <button onClick={() => setExpanded(e => !e)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors">
        <div className="h-2 w-2 rounded-full bg-primary/60 shrink-0" />
        <div className="shrink-0"><TypeBadge type={event.type} /></div>
        <div className="flex-1 min-w-0">
          <p className="text-xs truncate">
            <span className="font-medium">{actorLabel}</span>{' '}
            <span className="text-muted-foreground">{humanize(event.type)}</span>
            {targetShort && (
              <span className="text-muted-foreground/80 font-mono ml-1">#{targetShort}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
          <span className="hidden sm:block" title={new Date(event.createdAt).toLocaleString('pt-BR')}>{relativeTime(event.createdAt)}</span>
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
        </div>
      </button>
      {expanded && (
        <div className="border-t px-4 py-3 bg-muted/10 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Payload</p>
            <p className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString('pt-BR')}</p>
          </div>
          <pre className="text-xs bg-muted/40 rounded-lg p-3 whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
          <div className="text-[11px] text-muted-foreground font-mono space-y-0.5">
            <p>ID: {event.id}</p>
            {event.targetType && <p>Alvo: {event.targetType} · {event.targetId}</p>}
            {event.actorUserId && <p>Ator: {event.actorUserId}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

export default function EventsPage() {
  const [typeFilter, setTypeFilter] = useState('')
  const [actorFilter, setActorFilter] = useState('')
  const [targetIdFilter, setTargetIdFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    autoRefreshRef.current = setInterval(() => setTick(t => t + 1), 30_000)
    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current) }
  }, [])

  const { data: types = [] } = useQuery<string[]>({
    queryKey: ['event-types'],
    queryFn: () => apiFetch('/events/types'),
    staleTime: 60_000,
  })

  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ['users'],
    queryFn: () => apiFetch('/users'),
    staleTime: 60_000,
  })

  const buildParams = useCallback(() => {
    const p = new URLSearchParams({ limit: '50' })
    if (typeFilter) p.set('type', typeFilter)
    if (actorFilter) p.set('actorUserId', actorFilter)
    if (targetIdFilter) p.set('targetId', targetIdFilter.trim())
    if (from) p.set('from', new Date(from).toISOString())
    if (to) p.set('to', new Date(to + 'T23:59:59').toISOString())
    return p.toString()
  }, [typeFilter, actorFilter, targetIdFilter, from, to])

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['events', typeFilter, actorFilter, targetIdFilter, from, to, tick],
    queryFn: () => apiFetch<EventsResponse>(`/events?${buildParams()}`),
    retry: false,
    staleTime: 0,
  })

  const events = data?.events ?? []
  const hasFilters = typeFilter || actorFilter || targetIdFilter || from || to

  return (
    <AdminPageLayout
      title="Eventos & Auditoria"
      description="Quem fez o quê, quando — atualiza a cada 30s"
      maxWidth="5xl"
      action={
        <button onClick={() => refetch()} disabled={isFetching}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm hover:bg-accent disabled:opacity-50">
          <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} /> Atualizar
        </button>
      }
    >

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs font-medium">Tipo</label>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            className="mt-1 block rounded-lg border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
            <option value="">Todos</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium flex items-center gap-1"><UserIcon className="h-3 w-3" /> Ator</label>
          <select value={actorFilter} onChange={e => setActorFilter(e.target.value)}
            className="mt-1 block rounded-lg border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
            <option value="">Todos</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name ?? u.email}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium">ID do alvo</label>
          <input type="text" value={targetIdFilter} onChange={e => setTargetIdFilter(e.target.value)}
            placeholder="card/conversation/..."
            className="mt-1 block rounded-lg border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring w-40" />
        </div>
        <div>
          <label className="text-xs font-medium">De</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="mt-1 block rounded-lg border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <div>
          <label className="text-xs font-medium">Até</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="mt-1 block rounded-lg border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
        {hasFilters && (
          <button onClick={() => { setTypeFilter(''); setActorFilter(''); setTargetIdFilter(''); setFrom(''); setTo('') }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm hover:bg-accent text-muted-foreground">
            <Filter className="h-3.5 w-3.5" /> Limpar
          </button>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
      {error && (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <Activity className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-40" />
          <p className="text-sm text-muted-foreground">Erro ao carregar eventos</p>
        </div>
      )}
      {!isLoading && !error && events.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <Activity className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-40" />
          <p className="text-sm text-muted-foreground">Nenhum evento encontrado</p>
          {hasFilters && <p className="text-xs text-muted-foreground mt-1">Tente ajustar os filtros</p>}
        </div>
      )}
      {events.length > 0 && (
        <div className="space-y-2">
          {events.map(e => <EventRow key={e.id} event={e} />)}
        </div>
      )}
    </AdminPageLayout>
  )
}

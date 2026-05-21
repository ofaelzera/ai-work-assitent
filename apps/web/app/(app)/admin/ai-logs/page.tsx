'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { ChevronDown, ChevronUp, AlertCircle, Clock, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AgentRef { id: string; name: string }

interface AILog {
  id: string
  agentId: string | null
  provider: string
  model: string
  input: unknown
  output: unknown | null
  tokensIn: number | null
  tokensOut: number | null
  costUsd: string | null
  latencyMs: number | null
  error: string | null
  createdAt: string
  agent: AgentRef | null
}

interface LogsResponse {
  logs: AILog[]
  nextCursor: string | null
}

interface Agent { id: string; name: string }

function JsonViewer({ data, label }: { data: unknown; label: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {label}
      </button>
      {open && (
        <pre className="mt-1 text-xs bg-muted/40 rounded-lg p-3 whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  )
}

function LogRow({ log }: { log: AILog }) {
  const [expanded, setExpanded] = useState(false)
  const hasError = !!log.error

  return (
    <div className={cn('border rounded-xl overflow-hidden', hasError && 'border-destructive/40')}>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        {/* Status dot */}
        <div className={cn('h-2 w-2 rounded-full shrink-0', hasError ? 'bg-destructive' : 'bg-emerald-500')} />

        {/* Agent / model */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              {log.agent?.name ?? log.agentId ?? 'sem agente'}
            </span>
            <span className="text-xs text-muted-foreground shrink-0">{log.provider}/{log.model}</span>
          </div>
          {hasError && (
            <p className="text-xs text-destructive truncate">{log.error}</p>
          )}
        </div>

        {/* Metrics */}
        <div className="hidden sm:flex items-center gap-4 shrink-0 text-xs text-muted-foreground">
          {log.latencyMs != null && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {log.latencyMs}ms
            </span>
          )}
          {(log.tokensIn != null || log.tokensOut != null) && (
            <span className="flex items-center gap-1">
              <Zap className="h-3 w-3" />
              {(log.tokensIn ?? 0) + (log.tokensOut ?? 0)} tk
            </span>
          )}
          {log.costUsd && (
            <span>${parseFloat(log.costUsd).toFixed(6)}</span>
          )}
        </div>

        {/* Timestamp */}
        <span className="hidden md:block text-xs text-muted-foreground shrink-0">
          {new Date(log.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
        </span>

        <ChevronDown className={cn('h-4 w-4 text-muted-foreground shrink-0 transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div className="border-t px-4 py-3 space-y-3 bg-muted/10">
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>Tokens entrada: <strong className="text-foreground">{log.tokensIn ?? '—'}</strong></span>
            <span>Tokens saída: <strong className="text-foreground">{log.tokensOut ?? '—'}</strong></span>
            <span>Latência: <strong className="text-foreground">{log.latencyMs != null ? `${log.latencyMs}ms` : '—'}</strong></span>
            {log.costUsd && <span>Custo: <strong className="text-foreground">${parseFloat(log.costUsd).toFixed(6)}</strong></span>}
            <span className="md:hidden">
              {new Date(log.createdAt).toLocaleString('pt-BR')}
            </span>
          </div>

          {hasError && (
            <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/5 rounded-lg p-3">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <pre className="whitespace-pre-wrap font-mono">{log.error}</pre>
            </div>
          )}

          <JsonViewer data={log.input} label="Input" />
          {log.output != null && <JsonViewer data={log.output} label="Output" />}
        </div>
      )}
    </div>
  )
}

export default function AILogsPage() {
  const [agentId, setAgentId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [cursor, setCursor] = useState<string | undefined>()
  const [allLogs, setAllLogs] = useState<AILog[]>([])

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: () => apiFetch<Agent[]>('/ai/agents'),
  })

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['ai-logs', agentId, from, to, cursor],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '30' })
      if (agentId) params.set('agentId', agentId)
      if (from) params.set('from', new Date(from).toISOString())
      if (to) params.set('to', new Date(to + 'T23:59:59').toISOString())
      if (cursor) params.set('cursor', cursor)
      return apiFetch<LogsResponse>(`/ai/logs?${params}`)
    },
  })

  // Accumulate pages
  useEffect(() => {
    if (!data) return
    if (!cursor) {
      setAllLogs(data.logs)
    } else {
      setAllLogs(prev => {
        const ids = new Set(prev.map(l => l.id))
        return [...prev, ...data.logs.filter(l => !ids.has(l.id))]
      })
    }
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFilter = () => {
    setCursor(undefined)
    setAllLogs([])
  }

  return (
    <div className="p-6 max-w-4xl space-y-6 h-full overflow-y-auto">
      <div>
        <h1 className="text-xl font-bold">Logs de IA</h1>
        <p className="text-sm text-muted-foreground">Histórico de execuções dos agentes</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs font-medium">Agente</label>
          <select
            value={agentId}
            onChange={e => { setAgentId(e.target.value); handleFilter() }}
            className="mt-1 block rounded-lg border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">Todos</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium">De</label>
          <input
            type="date"
            value={from}
            onChange={e => { setFrom(e.target.value); handleFilter() }}
            className="mt-1 block rounded-lg border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-xs font-medium">Até</label>
          <input
            type="date"
            value={to}
            onChange={e => { setTo(e.target.value); handleFilter() }}
            className="mt-1 block rounded-lg border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <button
          onClick={() => { setAgentId(''); setFrom(''); setTo(''); handleFilter() }}
          className="px-3 py-1.5 rounded-lg text-sm hover:bg-accent text-muted-foreground"
        >
          Limpar
        </button>
      </div>

      {/* Logs */}
      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      {!isLoading && allLogs.length === 0 && (
        <div className="border border-dashed rounded-xl p-8 text-center">
          <p className="text-sm text-muted-foreground">Nenhuma execução encontrada</p>
        </div>
      )}

      <div className="space-y-2">
        {allLogs.map(log => <LogRow key={log.id} log={log} />)}
      </div>

      {data?.nextCursor && (
        <div className="flex justify-center">
          <button
            onClick={() => setCursor(data.nextCursor ?? undefined)}
            disabled={isFetching}
            className="px-4 py-2 rounded-lg text-sm hover:bg-accent disabled:opacity-50"
          >
            {isFetching ? 'Carregando...' : 'Carregar mais'}
          </button>
        </div>
      )}
    </div>
  )
}

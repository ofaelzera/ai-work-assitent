'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { BarChart3, Users as UsersIcon, MessageSquare, Bot, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

type TabKey = 'agents' | 'channels' | 'queue' | 'ai'

const TABS: { key: TabKey; label: string; icon: any }[] = [
  { key: 'agents',   label: 'Atendentes', icon: UsersIcon },
  { key: 'channels', label: 'Canais',     icon: MessageSquare },
  { key: 'queue',    label: 'Fila',       icon: Clock },
  { key: 'ai',       label: 'IA',         icon: Bot },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtSec(s: number | null): string {
  if (s == null) return '—'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}min`
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return `${h}h${m > 0 ? ' ' + m + 'min' : ''}`
}
function fmtPct(n: number | null): string { return n == null ? '—' : `${n}%` }
function fmtNum(n: number | null | undefined): string { return n == null ? '—' : new Intl.NumberFormat('pt-BR').format(n) }

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wider">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  )
}

function presetRange(preset: '24h' | '7d' | '30d' | 'month') {
  const now = new Date()
  const to = now.toISOString().slice(0, 10)
  let from: Date
  if (preset === '24h') from = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  else if (preset === '7d') from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  else if (preset === '30d') from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  else from = new Date(now.getFullYear(), now.getMonth(), 1)
  return { from: from.toISOString().slice(0, 10), to }
}

function exportCsv(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0])
  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? '')).join(',')),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ─── Tabs ────────────────────────────────────────────────────────────────────
function AgentsTab({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['reports-agents', from, to],
    queryFn: () => apiFetch<any>(`/reports/agents?from=${from}&to=${to}`),
  })
  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>
  const rows = data?.rows ?? []
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{rows.length} atendente(s) com conversas no período</p>
        <button onClick={() => exportCsv('atendentes.csv', rows.map((r: any) => ({
          atendente: r.user?.name ?? r.user?.email ?? r.userId,
          conversas: r.convCount, resolvidas: r.resolvedCount,
          tempo_primeira_resposta_s: r.avgFirstResponseSec ?? '',
          tempo_resolucao_s: r.avgResolveSec ?? '',
          mensagens_enviadas: r.messagesSent,
        })))} className="text-xs text-muted-foreground hover:text-foreground border rounded px-2 py-1">
          Exportar CSV
        </button>
      </div>
      <div className="rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs">
            <tr>
              <th className="text-left p-3 font-semibold">Atendente</th>
              <th className="text-right p-3 font-semibold">Conversas</th>
              <th className="text-right p-3 font-semibold">Resolvidas</th>
              <th className="text-right p-3 font-semibold">T.M. Resp.</th>
              <th className="text-right p-3 font-semibold">T.M. Resol.</th>
              <th className="text-right p-3 font-semibold">Msgs Env.</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Nenhum dado no período</td></tr>
            )}
            {rows.map((r: any) => (
              <tr key={r.userId} className="border-t">
                <td className="p-3">
                  <p className="font-medium">{r.user?.name ?? r.user?.email ?? '—'}</p>
                  {r.user?.email && r.user.name && <p className="text-xs text-muted-foreground">{r.user.email}</p>}
                </td>
                <td className="p-3 text-right tabular-nums">{fmtNum(r.convCount)}</td>
                <td className="p-3 text-right tabular-nums">{fmtNum(r.resolvedCount)}</td>
                <td className="p-3 text-right tabular-nums">{fmtSec(r.avgFirstResponseSec)}</td>
                <td className="p-3 text-right tabular-nums">{fmtSec(r.avgResolveSec)}</td>
                <td className="p-3 text-right tabular-nums">{fmtNum(r.messagesSent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ChannelsTab({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['reports-channels', from, to],
    queryFn: () => apiFetch<any>(`/reports/channels?from=${from}&to=${to}`),
  })
  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>
  const rows = data?.rows ?? []
  const heatmap: number[][] = data?.heatmap ?? Array.from({ length: 7 }, () => Array(24).fill(0))
  const maxHeat = Math.max(1, ...heatmap.flat())
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

  const maxConv = Math.max(1, ...rows.map((r: any) => r.convCount))

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">Volume por canal</h3>
          <button onClick={() => exportCsv('canais.csv', rows.map((r: any) => ({
            canal: r.channel?.label ?? r.channelId, tipo: r.channel?.type ?? '—',
            conversas: r.convCount, mensagens: r.messages,
          })))} className="text-xs text-muted-foreground hover:text-foreground border rounded px-2 py-1">
            Exportar CSV
          </button>
        </div>
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr>
                <th className="text-left p-3 font-semibold">Canal</th>
                <th className="text-left p-3 font-semibold">Tipo</th>
                <th className="text-right p-3 font-semibold">Conversas</th>
                <th className="text-right p-3 font-semibold">Mensagens</th>
                <th className="p-3 w-[40%]"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Nenhum dado no período</td></tr>
              )}
              {rows.map((r: any) => (
                <tr key={r.channelId} className="border-t">
                  <td className="p-3 font-medium">{r.channel?.label ?? r.channelId.slice(0, 8)}</td>
                  <td className="p-3 text-muted-foreground text-xs">{r.channel?.type ?? '—'}</td>
                  <td className="p-3 text-right tabular-nums">{fmtNum(r.convCount)}</td>
                  <td className="p-3 text-right tabular-nums">{fmtNum(r.messages)}</td>
                  <td className="p-3">
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${(r.convCount / maxConv) * 100}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-sm mb-2">Heatmap — mensagens recebidas por dia/hora</h3>
        <div className="rounded-xl border bg-card p-3 overflow-x-auto">
          <div className="inline-block min-w-full">
            <div className="flex gap-0.5 mb-1 pl-8">
              {Array.from({ length: 24 }).map((_, h) => (
                <div key={h} className="w-5 text-center text-[9px] text-muted-foreground">{h}</div>
              ))}
            </div>
            {days.map((d, di) => (
              <div key={d} className="flex items-center gap-0.5">
                <span className="w-8 text-[10px] text-muted-foreground pr-1">{d}</span>
                {heatmap[di].map((v, h) => {
                  const intensity = v / maxHeat
                  return (
                    <div key={h}
                      className="w-5 h-5 rounded-sm"
                      style={{ backgroundColor: v === 0 ? 'rgb(0 0 0 / 0.05)' : `rgba(124, 58, 237, ${0.15 + intensity * 0.85})` }}
                      title={`${d} ${h}h: ${v} msgs`}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function QueueTab({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['reports-queue', from, to],
    queryFn: () => apiFetch<any>(`/reports/queue?from=${from}&to=${to}`),
  })
  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>
  const d = data ?? {}
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Total de conversas" value={fmtNum(d.total)} hint={`${fmtNum(d.respondedCount)} respondidas`} />
        <MetricCard label="Tempo médio na fila" value={fmtSec(d.avgQueueWaitSec)} hint="até ser assumida" />
        <MetricCard label="Tempo médio 1ª resp." value={fmtSec(d.avgFirstResponseSec)} hint="até primeira resposta" />
        <MetricCard label="Tempo médio resolução" value={fmtSec(d.avgResolveSec)} hint={`${fmtNum(d.resolvedCount)} resolvidas`} />
        <MetricCard label="Taxa de abandono" value={fmtPct(d.abandonmentRate)} hint="sem nenhuma resposta" />
        <MetricCard label="SLA 2 min" value={fmtPct(d.sla?.within2min)} hint="% respondidas em ≤ 2 min" />
        <MetricCard label="SLA 5 min" value={fmtPct(d.sla?.within5min)} hint="% respondidas em ≤ 5 min" />
        <MetricCard label="SLA 15 min" value={fmtPct(d.sla?.within15min)} hint="% respondidas em ≤ 15 min" />
      </div>
    </div>
  )
}

function AiTab({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['reports-ai', from, to],
    queryFn: () => apiFetch<any>(`/reports/ai?from=${from}&to=${to}`),
  })
  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>
  const rows = data?.rows ?? []
  const series: { date: string; tokens: number }[] = data?.series ?? []
  const maxTokens = Math.max(1, ...series.map((s) => s.tokens))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <MetricCard label="Execuções totais" value={fmtNum(data?.totalRuns)} />
        <MetricCard label="Erros" value={fmtNum(data?.totalErrors)} hint={data?.totalRuns ? fmtPct(Math.round((data.totalErrors / data.totalRuns) * 100)) + ' do total' : ''} />
        <MetricCard label="Tokens consumidos" value={fmtNum(data?.totalTokens)} />
      </div>

      {series.length > 0 && (
        <div>
          <h3 className="font-semibold text-sm mb-2">Tokens por dia</h3>
          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-end gap-1 h-32">
              {series.map((s) => (
                <div key={s.date} className="flex-1 flex flex-col items-center gap-1" title={`${s.date}: ${s.tokens.toLocaleString('pt-BR')} tokens`}>
                  <div className="flex-1 w-full flex items-end">
                    <div className="w-full bg-primary/70 rounded-t" style={{ height: `${(s.tokens / maxTokens) * 100}%` }} />
                  </div>
                  <span className="text-[9px] text-muted-foreground">{s.date.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">Execuções por agente</h3>
          <button onClick={() => exportCsv('ai.csv', rows.map((r: any) => ({
            agente: r.agent?.name ?? '—', provider: r.agent?.provider ?? '—', model: r.agent?.model ?? '—',
            execucoes: r.runs, erros: r.errors, taxa_erro_pct: r.errorRate,
            tokens_in: r.tokensIn, tokens_out: r.tokensOut, latencia_media_ms: r.avgLatencyMs ?? '',
          })))} className="text-xs text-muted-foreground hover:text-foreground border rounded px-2 py-1">
            Exportar CSV
          </button>
        </div>
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr>
                <th className="text-left p-3 font-semibold">Agente</th>
                <th className="text-right p-3 font-semibold">Execuções</th>
                <th className="text-right p-3 font-semibold">Erros</th>
                <th className="text-right p-3 font-semibold">Tokens In</th>
                <th className="text-right p-3 font-semibold">Tokens Out</th>
                <th className="text-right p-3 font-semibold">Latência</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Nenhuma execução no período</td></tr>
              )}
              {rows.map((r: any) => (
                <tr key={r.agentId ?? 'unknown'} className="border-t">
                  <td className="p-3">
                    <p className="font-medium">{r.agent?.name ?? <span className="text-muted-foreground italic">Sem agente</span>}</p>
                    {r.agent && (
                      <p className="text-[10px] text-muted-foreground">{r.agent.provider} · {r.agent.model}</p>
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums">{fmtNum(r.runs)}</td>
                  <td className="p-3 text-right tabular-nums">
                    {fmtNum(r.errors)}
                    {r.errorRate > 0 && <span className="text-[10px] text-rose-600 ml-1">({r.errorRate}%)</span>}
                  </td>
                  <td className="p-3 text-right tabular-nums">{fmtNum(r.tokensIn)}</td>
                  <td className="p-3 text-right tabular-nums">{fmtNum(r.tokensOut)}</td>
                  <td className="p-3 text-right tabular-nums">{r.avgLatencyMs ? `${r.avgLatencyMs}ms` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default function ReportsPage() {
  const [tab, setTab] = useState<TabKey>('agents')
  const initial = useMemo(() => presetRange('7d'), [])
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)

  const applyPreset = (p: '24h' | '7d' | '30d' | 'month') => {
    const r = presetRange(p)
    setFrom(r.from); setTo(r.to)
  }

  return (
    <div className="p-6 max-w-6xl space-y-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><BarChart3 className="h-5 w-5" /> Relatórios</h1>
          <p className="text-sm text-muted-foreground">Métricas operacionais por atendente, canal, fila e IA</p>
        </div>
      </div>

      {/* Date range */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-medium">De</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block rounded-lg border bg-transparent px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="text-xs font-medium">Até</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="mt-1 block rounded-lg border bg-transparent px-3 py-1.5 text-sm" />
        </div>
        <div className="flex gap-1">
          {[
            { k: '24h' as const, l: '24h' },
            { k: '7d' as const, l: '7 dias' },
            { k: '30d' as const, l: '30 dias' },
            { k: 'month' as const, l: 'Este mês' },
          ].map(({ k, l }) => (
            <button key={k} onClick={() => applyPreset(k)}
              className="text-xs border rounded px-2.5 py-1.5 hover:bg-accent text-muted-foreground hover:text-foreground">
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn('flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      <div>
        {tab === 'agents' && <AgentsTab from={from} to={to} />}
        {tab === 'channels' && <ChannelsTab from={from} to={to} />}
        {tab === 'queue' && <QueueTab from={from} to={to} />}
        {tab === 'ai' && <AiTab from={from} to={to} />}
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import {
  Users2, Activity, Clock, AlertTriangle, ChevronRight, Inbox as InboxIcon,
  Headphones, ShoppingCart, Wallet,
} from 'lucide-react'

const ICON_MAP: Record<string, any> = {
  headphones: Headphones,
  'shopping-cart': ShoppingCart,
  wallet: Wallet,
  inbox: InboxIcon,
}

interface TeamCard {
  id: string
  name: string
  slug: string
  color: string
  icon: string | null
  distributionMode: string
  isActive: boolean
  slaFirstResponseMin: number | null
  slaResolutionMin: number | null
  _count: { members: number }
  stats: {
    open: number
    waiting: number
    resolved24h: number
    avgFirstResponseMin: number | null
    activeMembers: number
  }
}

interface AgentRow {
  user: { id: string; name: string; email: string }
  role: string
  capacity: number | null
  openConversations: number
  avgFirstResponseMin: number | null
}

function AgentsModal({ teamId, teamName, onClose }: { teamId: string; teamName: string; onClose: () => void }) {
  const { data: agents = [] } = useQuery<AgentRow[]>({
    queryKey: ['team-agents', teamId],
    queryFn: () => apiFetch(`/dashboard/teams/${teamId}/agents`),
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="modal-surface rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-sm">Carga por agente — {teamName}</h2>
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Fechar</button>
        </div>
        <div className="p-5 overflow-y-auto">
          {agents.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Sem agentes ativos</p>
          ) : (
            <div className="space-y-1.5">
              {agents
                .sort((a, b) => b.openConversations - a.openConversations)
                .map((a) => {
                  const ratio = a.capacity ? Math.min(a.openConversations / a.capacity, 1) : 0
                  return (
                    <div key={a.user.id} className="rounded-lg border p-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate">{a.user.name}</p>
                          {a.role === 'LEADER' && (
                            <span className="text-[10px] font-semibold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">LÍDER</span>
                          )}
                        </div>
                        {a.capacity && (
                          <div className="h-1.5 bg-muted rounded-full mt-1.5 overflow-hidden">
                            <div className="h-full bg-primary transition-all" style={{ width: `${ratio * 100}%` }} />
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold">{a.openConversations}{a.capacity ? `/${a.capacity}` : ''}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {a.avgFirstResponseMin != null ? `${a.avgFirstResponseMin}min` : 'sem dados'}
                        </p>
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function TeamsDashboardPage() {
  const [openAgents, setOpenAgents] = useState<{ id: string; name: string } | null>(null)

  const { data: teams = [], isLoading } = useQuery<TeamCard[]>({
    queryKey: ['dashboard', 'teams'],
    queryFn: () => apiFetch('/dashboard/teams'),
    refetchInterval: 30_000,
  })

  return (
    <>
      <div className="p-6 max-w-7xl mx-auto space-y-6 h-full overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Users2 className="h-5 w-5 text-primary" /> Setores
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              KPIs por setor de atendimento — atualiza a cada 30s.
            </p>
          </div>
          <Link href="/admin/teams" className="text-xs text-primary hover:underline">
            Gerenciar setores →
          </Link>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : teams.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            Nenhum setor disponível. <Link href="/admin/teams" className="text-primary hover:underline">Cadastrar</Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {teams.map((t) => {
              const Icon = ICON_MAP[t.icon ?? 'inbox'] ?? InboxIcon
              const slaWarn = t.slaFirstResponseMin && t.stats.avgFirstResponseMin && t.stats.avgFirstResponseMin > t.slaFirstResponseMin
              return (
                <div key={t.id} className="rounded-xl border bg-card p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: `${t.color}20`, color: t.color }}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{t.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {t._count.members} membros · {t.distributionMode}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-muted/40 p-2 text-center">
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1 justify-center">
                        <Activity className="h-3 w-3" /> Abertas
                      </p>
                      <p className="text-lg font-bold">{t.stats.open}</p>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-2 text-center">
                      <p className="text-[10px] text-muted-foreground">Aguardando</p>
                      <p className="text-lg font-bold">{t.stats.waiting}</p>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-2 text-center">
                      <p className="text-[10px] text-muted-foreground">Resolv. 24h</p>
                      <p className="text-lg font-bold">{t.stats.resolved24h}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className={`rounded-lg p-2 ${slaWarn ? 'bg-amber-50 dark:bg-amber-950/20' : 'bg-muted/40'}`}>
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1 justify-center">
                        <Clock className="h-3 w-3" /> TMA 1ª resp
                      </p>
                      <p className={`text-sm font-semibold ${slaWarn ? 'text-amber-700 dark:text-amber-400' : ''}`}>
                        {t.stats.avgFirstResponseMin != null ? `${t.stats.avgFirstResponseMin}min` : '—'}
                        {t.slaFirstResponseMin && (
                          <span className="text-[10px] text-muted-foreground"> / {t.slaFirstResponseMin}min</span>
                        )}
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-2">
                      <p className="text-[10px] text-muted-foreground">Ativos</p>
                      <p className="text-sm font-semibold">{t.stats.activeMembers}</p>
                    </div>
                  </div>

                  {slaWarn && (
                    <div className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3" />
                      SLA de 1ª resposta estourado
                    </div>
                  )}

                  <button onClick={() => setOpenAgents({ id: t.id, name: t.name })}
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-medium hover:bg-accent">
                    Ver carga por agente <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {openAgents && (
        <AgentsModal teamId={openAgents.id} teamName={openAgents.name} onClose={() => setOpenAgents(null)} />
      )}
    </>
  )
}

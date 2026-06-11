'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Send, Clock, AlertTriangle, TrendingUp, Play, CheckCircle2 } from 'lucide-react'
import { CommDashboard as CommDashboardData } from './types'

export function CommDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['comm-dashboard'],
    queryFn: () => apiFetch<CommDashboardData>('/comm/dashboard'),
    refetchInterval: 5000,
  })

  if (isLoading || !data) return <p className="text-sm text-muted-foreground">Carregando…</p>

  const cards = [
    { label: 'Enviadas hoje', value: data.sentToday, icon: Send, tone: 'text-emerald-600' },
    { label: 'Pendentes', value: data.pending, icon: Clock, tone: 'text-amber-600' },
    { label: 'Com erro', value: data.failed, icon: AlertTriangle, tone: 'text-red-600' },
    { label: 'Taxa de entrega', value: `${data.deliveryRate}%`, icon: TrendingUp, tone: 'text-primary' },
    { label: 'Campanhas ativas', value: data.runningCampaigns, icon: Play, tone: 'text-amber-600' },
    { label: 'Campanhas concluídas', value: data.completedCampaigns, icon: CheckCircle2, tone: 'text-emerald-600' },
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border bg-card p-4">
            <c.icon className={`h-5 w-5 ${c.tone}`} />
            <p className="text-2xl font-bold mt-2">{c.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border bg-card p-5">
        <p className="font-semibold text-sm mb-3">Volume por canal</p>
        {data.volumeByChannel.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum envio ainda.</p>
        ) : (
          <div className="space-y-2">
            {data.volumeByChannel.map((v) => (
              <div key={v.channel} className="flex items-center justify-between text-sm">
                <span>{v.channel === 'WHATSAPP' ? 'WhatsApp' : 'E-mail'}</span>
                <span className="font-medium">{v.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

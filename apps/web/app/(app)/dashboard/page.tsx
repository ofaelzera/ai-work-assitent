'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { MessageSquare, Kanban, Calendar, Bot } from 'lucide-react'

interface Summary {
  unreadMessages: number
  openCards: number
  todayEvents: number
  aiExecutionsLast24h: number
}

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiFetch<Summary>('/dashboard/summary'),
  })

  const stats = [
    {
      label: 'Mensagens não lidas',
      value: data?.unreadMessages ?? 0,
      icon: MessageSquare,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: 'Demandas abertas',
      value: data?.openCards ?? 0,
      icon: Kanban,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
    {
      label: 'Eventos hoje',
      value: data?.todayEvents ?? 0,
      icon: Calendar,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    {
      label: 'Execuções de IA (24h)',
      value: data?.aiExecutionsLast24h ?? 0,
      icon: Bot,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
    },
  ]

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Visão geral do dia</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border bg-card p-4 shadow-sm space-y-3">
            <div className={`inline-flex rounded-md p-2 ${stat.bg}`}>
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {isLoading ? '–' : stat.value}
              </p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border bg-card p-6 text-center text-muted-foreground text-sm">
        Sprint 1 em andamento — conecte seus canais em{' '}
        <a href="/admin/channels" className="text-primary hover:underline">
          Admin → Canais
        </a>
      </div>
    </div>
  )
}

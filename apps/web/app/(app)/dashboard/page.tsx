'use client'

import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { formatPhone, isInternalId } from '@/lib/phone'
import {
  MessageSquare, Kanban, Calendar, Bot, Users, TrendingUp,
  ArrowRight, Zap, Clock, ListTodo, Inbox, UsersRound, Bell,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface ConvPreview {
  id: string; externalId: string; isGroup: boolean; subject: string | null
  unreadCount: number; lastMessageAt: string | null; status?: string
  assigneeId?: string | null
  contact: { id: string; name: string | null; phone: string | null; email: string | null } | null
  channel: { id: string; type: string; label: string }
  assignee?: { id: string; name: string | null; email: string } | null
  messages: Array<{ body: string; direction: string; sentAt: string }>
}

interface AdminSummary {
  scope: 'admin'
  kpis: {
    unreadMessages: number
    openCards: number
    todayEvents: number
    aiExecutionsLast24h: number
    messagesToday: number
    messagesYesterday: number
    contactsTotal: number
  }
  recentConversations: ConvPreview[]
  recentCards: Array<{
    id: string; title: string; priority: string; createdAt: string; createdBy: string
    column: { name: string }
    contact: { name: string | null; phone: string | null } | null
  }>
  channelBreakdown: Array<{ type: string; total: number }>
}

interface MemberSummary {
  scope: 'member'
  kpis: {
    myOpenConversations: number
    queueCount: number
    unreadMessages: number
    pendingTasks: number
  }
  upcomingEvents: Array<{
    id: string; title: string; startAt: string; endAt: string
    contact: { id: string; name: string | null; phone: string | null } | null
    conversation: { id: string } | null
  }>
  recentConversations: ConvPreview[]
  recentTasks: Array<{
    id: string; title: string; remindAt: string | null
    conversationId: string | null
    contact: { id: string; name: string | null; phone: string | null } | null
  }>
}

type Summary = AdminSummary | MemberSummary

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatRelative(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function formatEventTime(iso: string) {
  const d = new Date(iso)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
  const evDay = new Date(d); evDay.setHours(0, 0, 0, 0)
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (evDay.getTime() === today.getTime()) return `Hoje, ${time}`
  if (evDay.getTime() === tomorrow.getTime()) return `Amanhã, ${time}`
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}, ${time}`
}

function channelLabel(type: string) {
  if (type === 'WHATSAPP') return { icon: '📱', label: 'WhatsApp', color: 'text-green-600' }
  if (type === 'GMAIL') return { icon: '📧', label: 'Gmail', color: 'text-red-500' }
  return { icon: '📨', label: 'Email', color: 'text-indigo-500' }
}

function priorityBadge(p: string) {
  if (p === 'URGENT') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
  if (p === 'HIGH') return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
  if (p === 'MEDIUM') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
  return 'bg-muted text-muted-foreground'
}
function priorityLabel(p: string) {
  if (p === 'URGENT') return 'Urgente'
  if (p === 'HIGH') return 'Alta'
  if (p === 'MEDIUM') return 'Média'
  return 'Baixa'
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse bg-muted rounded', className)} />
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
interface KpiProps {
  label: string
  value: number | string
  icon: React.ElementType
  iconBg: string
  iconColor: string
  trend?: { value: number; label: string }
  href?: string
  loading?: boolean
}

function KpiCard({ label, value, icon: Icon, iconBg, iconColor, trend, href, loading }: KpiProps) {
  const router = useRouter()
  const interactive = !!href
  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : -1}
      onClick={() => href && router.push(href)}
      className={cn(
        'group relative overflow-hidden rounded-3xl border bg-card/50 backdrop-blur-sm p-6 transition-all duration-500',
        interactive && 'hover:border-primary/40 hover:shadow-2xl hover:shadow-primary/5 hover:-translate-y-1.5 cursor-pointer',
      )}>
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-gradient-to-br from-primary/10 to-transparent rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700 pointer-events-none" />
      
      <div className="absolute top-0 right-0 p-4 opacity-[0.03] pointer-events-none group-hover:opacity-10 group-hover:-translate-x-2 group-hover:translate-y-2 transition-all duration-500">
        <Icon className="h-28 w-28 -mt-6 -mr-6" />
      </div>
      
      <div className="relative flex items-start justify-between z-10">
        <div className={cn('h-12 w-12 rounded-2xl flex items-center justify-center transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3 shadow-inner ring-1 ring-white/10', iconBg)}>
          <Icon className={cn('h-6 w-6', iconColor)} />
        </div>
        {trend != null && (
          <span className={cn(
            'text-[11px] font-bold px-2.5 py-1 rounded-full shadow-sm flex items-center gap-1 transition-transform group-hover:scale-105', 
            trend.value >= 0 
              ? 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 ring-1 ring-emerald-500/20' 
              : 'bg-red-500/10 text-red-600 dark:bg-red-500/20 dark:text-red-400 ring-1 ring-red-500/20'
          )}>
            {trend.value >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingUp className="h-3 w-3 rotate-180" />} 
            {Math.abs(trend.value)}%
          </span>
        )}
      </div>
      
      {loading
        ? <Skeleton className="h-10 w-20 mt-6 rounded-lg" />
        : (
          <div className="relative mt-5 z-10">
            <p className="text-4xl font-black tracking-tight text-foreground bg-clip-text text-transparent bg-gradient-to-br from-foreground to-foreground/70">{value}</p>
            <p className="text-[14px] font-medium text-muted-foreground mt-1.5">{label}</p>
            {trend != null && (
              <p className="text-[11px] text-muted-foreground/70 mt-1">{trend.label}</p>
            )}
          </div>
        )}
    </div>
  )
}

// ─── Lista compartilhada: conversas recentes ─────────────────────────────────
function RecentConversationsList({ items, loading }: { items: ConvPreview[]; loading: boolean }) {
  const router = useRouter()
  return (
    <div className="rounded-3xl border bg-card/50 backdrop-blur-sm p-3 space-y-1 shadow-sm">
      {loading && Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <Skeleton className="h-11 w-11 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      ))}

      {!loading && items.length === 0 && (
        <div className="py-12 flex flex-col items-center justify-center text-center text-sm text-muted-foreground bg-gradient-to-b from-transparent to-muted/20 rounded-2xl">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
            <MessageSquare className="h-6 w-6 text-primary" />
          </div>
          <p className="font-medium text-foreground">Nenhuma conversa ainda</p>
          <p className="text-[12px] mt-0.5">As conversas recentes aparecerão aqui.</p>
        </div>
      )}

      {items.map(conv => {
        const ch = channelLabel(conv.channel.type)
        const rawPhone = conv.contact?.phone
        const phoneIsId = rawPhone ? isInternalId(rawPhone) : false
        const name =
          conv.contact?.name ??
          (rawPhone && !phoneIsId ? formatPhone(rawPhone) : null) ??
          conv.contact?.email ??
          conv.subject ??
          conv.externalId.split('@')[0]
        const lastMsg = conv.messages[0]
        return (
          <div
            key={conv.id}
            onClick={() => router.push(`/inbox/${conv.id}`)}
            className="group flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-background/80 hover:shadow-sm cursor-pointer transition-all duration-200"
          >
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center text-sm font-bold text-primary shrink-0 ring-1 ring-primary/10">
              {name.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[13px] font-semibold text-foreground truncate">{name}</span>
                <span className={cn('text-[10px] shrink-0', ch.color)}>{ch.icon}</span>
                {conv.assignee && (
                  <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 leading-none">
                    @{(conv.assignee.name ?? conv.assignee.email).split(' ')[0].slice(0, 10)}
                  </span>
                )}
              </div>
              {lastMsg && (
                <p className="text-xs text-muted-foreground truncate group-hover:text-foreground/80 transition-colors">
                  {lastMsg.direction === 'OUTBOUND' && <span className="mr-1 font-medium text-primary/70">Você:</span>}
                  {lastMsg.body}
                </p>
              )}
            </div>
            <div className="shrink-0 text-right space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground">{formatRelative(conv.lastMessageAt)}</p>
              {conv.unreadCount > 0 && (
                <span className="inline-flex items-center justify-center text-[10px] font-bold bg-primary text-primary-foreground rounded-full min-w-[18px] h-[18px] px-1 shadow-sm shadow-primary/30">
                  {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter()
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiFetch<Summary>('/dashboard/summary'),
    refetchInterval: 60_000,
  })

  const greetingHour = new Date().getHours()
  const greeting = greetingHour < 12 ? 'Bom dia' : greetingHour < 18 ? 'Boa tarde' : 'Boa noite'

  const isAdminScope = data?.scope === 'admin'
  const adminData = isAdminScope ? (data as AdminSummary) : null
  const memberData = data?.scope === 'member' ? (data as MemberSummary) : null

  const msgTrend = adminData
    ? adminData.kpis.messagesYesterday > 0
      ? Math.round(((adminData.kpis.messagesToday - adminData.kpis.messagesYesterday) / adminData.kpis.messagesYesterday) * 100)
      : 0
    : 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-8">

        {/* ── Cabeçalho ── */}
        <div className="animate-slide-up flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground">{greeting} 👋</h1>
            <p className="text-sm font-medium text-muted-foreground mt-1">
              {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
          <button onClick={() => router.push('/dashboard/teams')}
            className="text-xs font-medium px-3 py-2 rounded-lg border hover:bg-accent transition-colors flex items-center gap-1.5">
            Ver setores <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        {/* ─────────────────── VISÃO ADMIN ─────────────────── */}
        {isAdminScope && adminData && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-slide-up delay-100">
              <KpiCard label="Mensagens não lidas" value={adminData.kpis.unreadMessages} icon={MessageSquare}
                iconBg="bg-blue-100 dark:bg-blue-900/30" iconColor="text-blue-600 dark:text-blue-400" href="/inbox" loading={isLoading} />
              <KpiCard label="Demandas abertas" value={adminData.kpis.openCards} icon={Kanban}
                iconBg="bg-purple-100 dark:bg-purple-900/30" iconColor="text-purple-600 dark:text-purple-400" href="/kanban" loading={isLoading} />
              <KpiCard label="Mensagens hoje" value={adminData.kpis.messagesToday} icon={TrendingUp}
                iconBg="bg-green-100 dark:bg-green-900/30" iconColor="text-green-600 dark:text-green-400"
                trend={{ value: msgTrend, label: `${adminData.kpis.messagesYesterday} ontem` }} loading={isLoading} />
              <KpiCard label="Contatos" value={adminData.kpis.contactsTotal} icon={Users}
                iconBg="bg-amber-100 dark:bg-amber-900/30" iconColor="text-amber-600 dark:text-amber-400" href="/contacts" loading={isLoading} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-slide-up delay-200">
              <div className="lg:col-span-2 space-y-3">
                <div className="flex items-center justify-between px-1">
                  <h2 className="text-sm font-bold text-foreground/80 tracking-wide uppercase">Conversas recentes</h2>
                  <button onClick={() => router.push('/inbox')} className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
                    Ver todas <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
                <RecentConversationsList items={adminData.recentConversations} loading={isLoading} />
              </div>

              <div className="space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between px-1">
                    <h2 className="text-sm font-bold text-foreground/80 tracking-wide uppercase">Cards recentes</h2>
                    <button onClick={() => router.push('/kanban')} className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
                      Ver todos <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="rounded-3xl border bg-card/50 backdrop-blur-sm p-3 space-y-1 shadow-sm">
                    {isLoading && Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="px-4 py-3.5 space-y-2">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    ))}
                    {!isLoading && adminData.recentCards.length === 0 && (
                      <div className="py-12 flex flex-col items-center justify-center text-center text-sm text-muted-foreground bg-gradient-to-b from-transparent to-muted/20 rounded-2xl">
                        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                          <Kanban className="h-6 w-6 text-primary" />
                        </div>
                        <p className="font-medium text-foreground">Nenhum card ainda</p>
                        <p className="text-[12px] mt-0.5">Seus cards aparecerão aqui.</p>
                      </div>
                    )}
                    {adminData.recentCards.map(card => (
                      <div key={card.id} className="group px-4 py-3.5 rounded-2xl hover:bg-background/80 hover:shadow-sm transition-all duration-200">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[13px] font-semibold text-foreground truncate flex-1">{card.title}</p>
                          <span className={cn('shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full', priorityBadge(card.priority))}>
                            {priorityLabel(card.priority)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-[11px] font-medium text-muted-foreground">{card.column.name}</span>
                          {card.createdBy === 'AI' && (
                            <span className="text-[10px] bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 px-1.5 py-0.5 rounded-full font-bold flex items-center gap-1 shadow-sm">
                              <Zap className="h-2.5 w-2.5" /> IA
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {adminData.channelBreakdown.length > 0 && (
                  <div className="space-y-3">
                    <h2 className="text-sm font-bold text-foreground/80 tracking-wide uppercase px-1">Mensagens hoje por canal</h2>
                    <div className="rounded-3xl border bg-card/50 backdrop-blur-sm p-6 space-y-4 shadow-sm">
                      {adminData.channelBreakdown.map(({ type, total }) => {
                        const ch = channelLabel(type)
                        const maxTotal = Math.max(...adminData.channelBreakdown.map(b => b.total))
                        const pct = maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0
                        return (
                          <div key={type} className="group">
                            <div className="flex items-center justify-between text-[13px] mb-2">
                              <span className={cn('font-semibold flex items-center gap-2 transition-transform group-hover:translate-x-1', ch.color)}>
                                {ch.icon} {ch.label}
                              </span>
                              <span className="text-muted-foreground font-bold">{total}</span>
                            </div>
                            <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary transition-all duration-1000 ease-out" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border bg-gradient-to-br from-secondary/10 to-transparent p-5 flex items-center gap-4 shadow-sm">
                  <div className="h-12 w-12 rounded-2xl bg-secondary/20 flex items-center justify-center shrink-0 shadow-inner">
                    <Bot className="h-6 w-6 text-secondary-foreground" />
                  </div>
                  <div>
                    {isLoading ? <Skeleton className="h-6 w-12 mb-1" /> : <p className="text-2xl font-bold tracking-tight text-foreground">{adminData.kpis.aiExecutionsLast24h}</p>}
                    <p className="text-xs font-medium text-muted-foreground">Execuções de IA (24h)</p>
                  </div>
                  <Clock className="h-5 w-5 text-muted-foreground ml-auto shrink-0" />
                </div>
              </div>
            </div>
          </>
        )}

        {/* ─────────────────── VISÃO MEMBER ─────────────────── */}
        {memberData && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-slide-up delay-100">
              <KpiCard label="Minhas conversas abertas" value={memberData.kpis.myOpenConversations} icon={Inbox}
                iconBg="bg-blue-100 dark:bg-blue-900/30" iconColor="text-blue-600 dark:text-blue-400" href="/inbox" loading={isLoading} />
              <KpiCard label="Na fila pública" value={memberData.kpis.queueCount} icon={UsersRound}
                iconBg="bg-amber-100 dark:bg-amber-900/30" iconColor="text-amber-600 dark:text-amber-400" href="/inbox" loading={isLoading} />
              <KpiCard label="Mensagens não lidas" value={memberData.kpis.unreadMessages} icon={Bell}
                iconBg="bg-rose-100 dark:bg-rose-900/30" iconColor="text-rose-600 dark:text-rose-400" href="/inbox" loading={isLoading} />
              <KpiCard label="Tarefas pendentes" value={memberData.kpis.pendingTasks} icon={ListTodo}
                iconBg="bg-emerald-100 dark:bg-emerald-900/30" iconColor="text-emerald-600 dark:text-emerald-400" href="/tasks" loading={isLoading} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-slide-up delay-200">
              {/* Conversas recentes */}
              <div className="lg:col-span-2 space-y-3">
                <div className="flex items-center justify-between px-1">
                  <h2 className="text-sm font-bold text-foreground/80 tracking-wide uppercase">Conversas recentes</h2>
                  <button onClick={() => router.push('/inbox')} className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
                    Ver inbox <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
                <RecentConversationsList items={memberData.recentConversations} loading={isLoading} />
              </div>

              {/* Coluna direita: próximos eventos + minhas tarefas */}
              <div className="space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between px-1">
                    <h2 className="text-sm font-bold text-foreground/80 tracking-wide uppercase">Próximos eventos</h2>
                    <button onClick={() => router.push('/calendar')} className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
                      Ver agenda <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="rounded-3xl border bg-card/50 backdrop-blur-sm p-3 space-y-1 shadow-sm">
                    {isLoading && Array.from({ length: 2 }).map((_, i) => (
                      <div key={i} className="px-4 py-3.5 space-y-2">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    ))}
                    {!isLoading && memberData.upcomingEvents.length === 0 && (
                      <div className="py-12 flex flex-col items-center justify-center text-center text-sm text-muted-foreground bg-gradient-to-b from-transparent to-muted/20 rounded-2xl">
                        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                          <Calendar className="h-6 w-6 text-primary" />
                        </div>
                        <p className="font-medium text-foreground">Nenhum evento</p>
                        <p className="text-[12px] mt-0.5">Próximos eventos nos 7 dias.</p>
                      </div>
                    )}
                    {memberData.upcomingEvents.map(ev => (
                      <div key={ev.id} className="group px-4 py-3.5 rounded-2xl hover:bg-background/80 hover:shadow-sm transition-all duration-200">
                        <p className="text-[13px] font-semibold text-foreground truncate">{ev.title}</p>
                        <p className="text-[11px] font-medium text-muted-foreground mt-2 flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" /> {formatEventTime(ev.startAt)}
                          {ev.contact && (
                            <span className="ml-1 px-2 py-0.5 rounded-full bg-accent/50 truncate font-medium flex items-center gap-1">
                              <Users className="h-2.5 w-2.5" />
                              {ev.contact.name ?? ev.contact.phone}
                            </span>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between px-1">
                    <h2 className="text-sm font-bold text-foreground/80 tracking-wide uppercase">Minhas tarefas</h2>
                    <button onClick={() => router.push('/tasks')} className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
                      Ver todas <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="rounded-3xl border bg-card/50 backdrop-blur-sm p-3 space-y-1 shadow-sm">
                    {isLoading && Array.from({ length: 2 }).map((_, i) => (
                      <div key={i} className="px-4 py-3.5 space-y-2">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-3/4" />
                      </div>
                    ))}
                    {!isLoading && memberData.recentTasks.length === 0 && (
                      <div className="py-12 flex flex-col items-center justify-center text-center text-sm text-muted-foreground bg-gradient-to-b from-transparent to-muted/20 rounded-2xl">
                        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                          <ListTodo className="h-6 w-6 text-primary" />
                        </div>
                        <p className="font-medium text-foreground">Nenhuma tarefa pendente</p>
                        <p className="text-[12px] mt-0.5">As tarefas atribuídas a você aparecerão aqui.</p>
                      </div>
                    )}
                    {memberData.recentTasks.map(t => (
                      <div key={t.id} className="group px-4 py-3.5 rounded-2xl hover:bg-background/80 hover:shadow-sm transition-all duration-200">
                        <p className="text-[13px] font-semibold text-foreground truncate">{t.title}</p>
                        <div className="flex items-center gap-3 mt-1.5 text-[11px] font-medium text-muted-foreground">
                          {t.remindAt && (
                            <span className="flex items-center gap-1 text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30 px-1.5 py-0.5 rounded-md">
                              <Bell className="h-3 w-3" />
                              {formatRelative(t.remindAt)}
                            </span>
                          )}
                          {t.conversationId && (
                            <Link
                              href={`/inbox/${t.conversationId}`}
                              className="text-primary hover:underline flex items-center gap-1"
                            >
                              <MessageSquare className="h-3 w-3" />
                              {t.contact?.name ?? t.contact?.phone ?? 'Conversa'}
                            </Link>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

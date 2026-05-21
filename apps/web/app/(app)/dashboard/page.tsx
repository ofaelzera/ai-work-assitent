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
        'rounded-xl border bg-card px-4 py-4 transition-all',
        interactive && 'hover:border-primary/40 hover:shadow-sm cursor-pointer',
      )}>
      <div className="flex items-start justify-between">
        <div className={cn('h-9 w-9 rounded-xl flex items-center justify-center', iconBg)}>
          <Icon className={cn('h-4 w-4', iconColor)} />
        </div>
        {trend != null && (
          <span className={cn('text-[11px] font-medium', trend.value >= 0 ? 'text-emerald-600' : 'text-red-600')}>
            {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}%
          </span>
        )}
      </div>
      {loading
        ? <Skeleton className="h-8 w-16 mt-3" />
        : (
          <div className="mt-3">
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            {trend != null && (
              <p className="text-[11px] text-muted-foreground mt-0.5">{trend.label}</p>
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
    <div className="rounded-xl border bg-card overflow-hidden divide-y">
      {loading && Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-10 w-10 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      ))}

      {!loading && items.length === 0 && (
        <div className="py-10 text-center text-sm text-muted-foreground">
          <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-30" />
          Nenhuma conversa ainda
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
            className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 cursor-pointer transition-colors"
          >
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
              {name.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium truncate">{name}</span>
                <span className={cn('text-[10px] shrink-0', ch.color)}>{ch.icon}</span>
                {conv.assignee && (
                  <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 leading-none">
                    @{(conv.assignee.name ?? conv.assignee.email).split(' ')[0].slice(0, 10)}
                  </span>
                )}
              </div>
              {lastMsg && (
                <p className="text-xs text-muted-foreground truncate">
                  {lastMsg.direction === 'OUTBOUND' && <span className="mr-0.5">Você:</span>}
                  {lastMsg.body}
                </p>
              )}
            </div>
            <div className="shrink-0 text-right space-y-1">
              <p className="text-[11px] text-muted-foreground">{formatRelative(conv.lastMessageAt)}</p>
              {conv.unreadCount > 0 && (
                <span className="inline-flex items-center justify-center text-[10px] font-bold bg-primary text-primary-foreground rounded-full min-w-[18px] h-[18px] px-1">
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
        <div>
          <h1 className="text-2xl font-bold">{greeting} 👋</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>

        {/* ─────────────────── VISÃO ADMIN ─────────────────── */}
        {isAdminScope && adminData && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard label="Mensagens não lidas" value={adminData.kpis.unreadMessages} icon={MessageSquare}
                iconBg="bg-blue-50 dark:bg-blue-950/40" iconColor="text-blue-600" href="/inbox" loading={isLoading} />
              <KpiCard label="Demandas abertas" value={adminData.kpis.openCards} icon={Kanban}
                iconBg="bg-purple-50 dark:bg-purple-950/40" iconColor="text-purple-600" href="/kanban" loading={isLoading} />
              <KpiCard label="Mensagens hoje" value={adminData.kpis.messagesToday} icon={TrendingUp}
                iconBg="bg-green-50 dark:bg-green-950/40" iconColor="text-green-600"
                trend={{ value: msgTrend, label: `${adminData.kpis.messagesYesterday} ontem` }} loading={isLoading} />
              <KpiCard label="Contatos" value={adminData.kpis.contactsTotal} icon={Users}
                iconBg="bg-amber-50 dark:bg-amber-950/40" iconColor="text-amber-600" href="/contacts" loading={isLoading} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Conversas recentes</h2>
                  <button onClick={() => router.push('/inbox')} className="text-xs text-primary hover:underline flex items-center gap-0.5">
                    Ver todas <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
                <RecentConversationsList items={adminData.recentConversations} loading={isLoading} />
              </div>

              <div className="space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold">Cards recentes</h2>
                    <button onClick={() => router.push('/kanban')} className="text-xs text-primary hover:underline flex items-center gap-0.5">
                      Ver todos <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="rounded-xl border bg-card overflow-hidden divide-y">
                    {isLoading && Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="px-4 py-3 space-y-1.5">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    ))}
                    {!isLoading && adminData.recentCards.length === 0 && (
                      <div className="py-8 text-center text-sm text-muted-foreground">
                        <Kanban className="h-6 w-6 mx-auto mb-2 opacity-30" />
                        Nenhum card ainda
                      </div>
                    )}
                    {adminData.recentCards.map(card => (
                      <div key={card.id} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium truncate flex-1">{card.title}</p>
                          <span className={cn('shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full', priorityBadge(card.priority))}>
                            {priorityLabel(card.priority)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[11px] text-muted-foreground">{card.column.name}</span>
                          {card.createdBy === 'AI' && (
                            <span className="text-[10px] bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 px-1.5 py-0.5 rounded-full font-medium flex items-center gap-0.5">
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
                    <h2 className="text-sm font-semibold">Mensagens hoje por canal</h2>
                    <div className="rounded-xl border bg-card p-4 space-y-3">
                      {adminData.channelBreakdown.map(({ type, total }) => {
                        const ch = channelLabel(type)
                        const maxTotal = Math.max(...adminData.channelBreakdown.map(b => b.total))
                        const pct = maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0
                        return (
                          <div key={type}>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className={cn('font-medium', ch.color)}>{ch.icon} {ch.label}</span>
                              <span className="text-muted-foreground font-medium">{total}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full bg-primary/60 transition-all" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                <div className="rounded-xl border bg-card p-4 flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-violet-50 dark:bg-violet-950/40 flex items-center justify-center shrink-0">
                    <Bot className="h-4 w-4 text-violet-600" />
                  </div>
                  <div>
                    {isLoading ? <Skeleton className="h-5 w-12 mb-1" /> : <p className="text-xl font-bold">{adminData.kpis.aiExecutionsLast24h}</p>}
                    <p className="text-xs text-muted-foreground">Execuções de IA (24h)</p>
                  </div>
                  <Clock className="h-4 w-4 text-muted-foreground ml-auto shrink-0 opacity-50" />
                </div>
              </div>
            </div>
          </>
        )}

        {/* ─────────────────── VISÃO MEMBER ─────────────────── */}
        {memberData && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard label="Minhas conversas abertas" value={memberData.kpis.myOpenConversations} icon={Inbox}
                iconBg="bg-blue-50 dark:bg-blue-950/40" iconColor="text-blue-600" href="/inbox" loading={isLoading} />
              <KpiCard label="Na fila pública" value={memberData.kpis.queueCount} icon={UsersRound}
                iconBg="bg-amber-50 dark:bg-amber-950/40" iconColor="text-amber-600" href="/inbox" loading={isLoading} />
              <KpiCard label="Mensagens não lidas" value={memberData.kpis.unreadMessages} icon={Bell}
                iconBg="bg-rose-50 dark:bg-rose-950/40" iconColor="text-rose-600" href="/inbox" loading={isLoading} />
              <KpiCard label="Tarefas pendentes" value={memberData.kpis.pendingTasks} icon={ListTodo}
                iconBg="bg-emerald-50 dark:bg-emerald-950/40" iconColor="text-emerald-600" href="/tasks" loading={isLoading} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Conversas recentes */}
              <div className="lg:col-span-2 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Conversas recentes</h2>
                  <button onClick={() => router.push('/inbox')} className="text-xs text-primary hover:underline flex items-center gap-0.5">
                    Ver inbox <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
                <RecentConversationsList items={memberData.recentConversations} loading={isLoading} />
              </div>

              {/* Coluna direita: próximos eventos + minhas tarefas */}
              <div className="space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold">Próximos eventos</h2>
                    <button onClick={() => router.push('/calendar')} className="text-xs text-primary hover:underline flex items-center gap-0.5">
                      Ver agenda <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="rounded-xl border bg-card overflow-hidden divide-y">
                    {isLoading && Array.from({ length: 2 }).map((_, i) => (
                      <div key={i} className="px-4 py-3 space-y-1.5">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    ))}
                    {!isLoading && memberData.upcomingEvents.length === 0 && (
                      <div className="py-8 text-center text-sm text-muted-foreground">
                        <Calendar className="h-6 w-6 mx-auto mb-2 opacity-30" />
                        Nenhum evento nos próximos 7 dias
                      </div>
                    )}
                    {memberData.upcomingEvents.map(ev => (
                      <div key={ev.id} className="px-4 py-3">
                        <p className="text-sm font-medium truncate">{ev.title}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {formatEventTime(ev.startAt)}
                          {ev.contact && (
                            <span className="ml-1">• {ev.contact.name ?? ev.contact.phone}</span>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold">Minhas tarefas</h2>
                    <button onClick={() => router.push('/tasks')} className="text-xs text-primary hover:underline flex items-center gap-0.5">
                      Ver todas <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="rounded-xl border bg-card overflow-hidden divide-y">
                    {isLoading && Array.from({ length: 2 }).map((_, i) => (
                      <div key={i} className="px-4 py-3"><Skeleton className="h-3 w-full" /></div>
                    ))}
                    {!isLoading && memberData.recentTasks.length === 0 && (
                      <div className="py-8 text-center text-sm text-muted-foreground">
                        <ListTodo className="h-6 w-6 mx-auto mb-2 opacity-30" />
                        Nenhuma tarefa pendente
                      </div>
                    )}
                    {memberData.recentTasks.map(t => (
                      <div key={t.id} className="px-4 py-3">
                        <p className="text-sm font-medium truncate">{t.title}</p>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                          {t.remindAt && (
                            <span className="flex items-center gap-1">
                              <Bell className="h-3 w-3" />
                              {formatRelative(t.remindAt)}
                            </span>
                          )}
                          {t.conversationId && (
                            <Link
                              href={`/inbox/${t.conversationId}`}
                              className="text-blue-600 hover:underline flex items-center gap-1"
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

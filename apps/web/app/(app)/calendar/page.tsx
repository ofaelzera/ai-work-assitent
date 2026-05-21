'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Plus,
  Wifi,
  X,
  Calendar as CalendarIcon,
  Clock,
  Trash2,
  MessageSquare,
} from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface CalendarAccount {
  id: string
  provider: string
  email?: string
}

interface CalendarEvent {
  id: string
  title: string
  startAt: string
  endAt: string
  cardId?: string
  contactId?: string | null
  conversationId?: string | null
  calendarAccountId: string
  externalId?: string
  contact?: { id: string; name: string | null; phone: string | null } | null
  conversation?: { id: string; subject: string | null; isGroup: boolean } | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function toLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Returns the grid days for a monthly calendar view (42 cells, Mon-Sun would need adjustment — using Sun–Sat) */
function buildCalendarGrid(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)

  const startDow = firstDay.getDay() // 0=Sun
  const endDow = lastDay.getDay()   // 0=Sun

  const days: Date[] = []

  // Leading days from previous month
  for (let i = startDow - 1; i >= 0; i--) {
    const d = new Date(year, month, -i)
    days.push(d)
  }

  // Current month days
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(new Date(year, month, d))
  }

  // Trailing days to fill last row
  const trailing = 6 - endDow
  for (let i = 1; i <= trailing; i++) {
    days.push(new Date(year, month + 1, i))
  }

  return days
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface NewEventModalProps {
  open: boolean
  defaultDate: string
  accounts: CalendarAccount[]
  onClose: () => void
  onCreated: () => void
}

function NewEventModal({ open, defaultDate, accounts, onClose, onCreated }: NewEventModalProps) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(defaultDate)
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [description, setDescription] = useState('')
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')

  const mutation = useMutation({
    mutationFn: async () => {
      const startAt = new Date(`${date}T${startTime}:00`).toISOString()
      const endAt = new Date(`${date}T${endTime}:00`).toISOString()
      return apiFetch('/calendar/events', {
        method: 'POST',
        body: JSON.stringify({
          accountId: accountId || undefined,
          title,
          startAt,
          endAt,
          description: description || undefined,
        }),
      })
    },
    onSuccess: () => {
      toast.success('Evento criado com sucesso')
      onCreated()
      onClose()
      setTitle('')
      setDescription('')
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'Erro ao criar evento')
    },
  })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-card border rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Novo evento</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Título</label>
            <input
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nome do evento"
              autoFocus
            />
          </div>

          <div>
            <label className="text-sm font-medium">Data</label>
            <input
              type="date"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Início</label>
              <input
                type="time"
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Fim</label>
              <input
                type="time"
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>

          {accounts.length > 1 && (
            <div>
              <label className="text-sm font-medium">Conta</label>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.email ?? a.provider}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-sm font-medium">Descrição (opcional)</label>
            <textarea
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detalhes do evento..."
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm hover:bg-accent transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!title.trim() || mutation.isPending}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? 'Criando...' : 'Criar evento'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface EventDetailSheetProps {
  event: CalendarEvent | null
  onClose: () => void
  onDeleted: () => void
}

function EventDetailSheet({ event, onClose, onDeleted }: EventDetailSheetProps) {
  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/calendar/events/${event!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Evento removido')
      onDeleted()
      onClose()
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'Erro ao remover evento')
    },
  })

  if (!event) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-card border-l shadow-xl w-full max-w-sm h-full flex flex-col p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Detalhes do evento</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Título</p>
            <p className="text-base font-semibold">{event.title}</p>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium flex items-center gap-1">
              <Clock className="h-3 w-3" /> Horário
            </p>
            <p className="text-sm">{formatDateTime(event.startAt)}</p>
            <p className="text-sm text-muted-foreground">até {formatTime(event.endAt)}</p>
          </div>

          {event.conversationId && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Origem</p>
              <Link
                href={`/inbox/${event.conversationId}`}
                className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 hover:underline">
                <MessageSquare className="h-3.5 w-3.5" />
                {event.contact?.name ?? event.contact?.phone ?? 'Conversa vinculada'}
              </Link>
            </div>
          )}
        </div>

        <div className="pt-4 border-t">
          <button
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            className="flex items-center gap-2 rounded-md border border-destructive text-destructive px-4 py-2 text-sm hover:bg-destructive/10 disabled:opacity-50 transition-colors w-full justify-center"
          >
            <Trash2 className="h-4 w-4" />
            {deleteMutation.isPending ? 'Removendo...' : 'Remover evento'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const queryClient = useQueryClient()
  const today = new Date()

  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [newEventOpen, setNewEventOpen] = useState(false)
  const [newEventDate, setNewEventDate] = useState(toLocalDateStr(today))
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)

  // ── Accounts ──────────────────────────────────────────────────────────────

  const { data: accounts = [] } = useQuery<CalendarAccount[]>({
    queryKey: ['calendar-accounts'],
    queryFn: () => apiFetch<CalendarAccount[]>('/calendar/accounts'),
  })

  const disconnectMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/calendar/accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Conta desconectada')
      queryClient.invalidateQueries({ queryKey: ['calendar-accounts'] })
    },
    onError: (err: Error) => toast.error(err.message ?? 'Erro ao desconectar'),
  })

  const connectMutation = useMutation({
    mutationFn: () => apiFetch<{ url: string }>('/calendar/auth'),
    onSuccess: ({ url }) => {
      window.location.href = url
    },
    onError: (err: Error) => toast.error(err.message ?? 'Erro ao conectar'),
  })

  // ── Events ────────────────────────────────────────────────────────────────

  const from = new Date(year, month, 1).toISOString()
  const to = new Date(year, month + 1, 0, 23, 59, 59).toISOString()

  const { data: events = [] } = useQuery<CalendarEvent[]>({
    queryKey: ['calendar-events', year, month],
    queryFn: () =>
      apiFetch<CalendarEvent[]>(
        `/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
  })

  const syncMutation = useMutation({
    mutationFn: () => apiFetch<{ synced: number }>('/calendar/sync', { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: ({ synced }) => {
      toast.success(`${synced} evento${synced !== 1 ? 's' : ''} sincronizado${synced !== 1 ? 's' : ''}`)
      queryClient.invalidateQueries({ queryKey: ['calendar-events', year, month] })
    },
    onError: (err: Error) => toast.error(err.message ?? 'Erro ao sincronizar'),
  })

  // ── Calendar grid ─────────────────────────────────────────────────────────

  const gridDays = useMemo(() => buildCalendarGrid(year, month), [year, month])

  const eventsByDay = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {}
    for (const ev of events) {
      const key = toLocalDateStr(new Date(ev.startAt))
      if (!map[key]) map[key] = []
      map[key].push(ev)
    }
    return map
  }, [events])

  // ── Navigation ────────────────────────────────────────────────────────────

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }

  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  function goToday() {
    setYear(today.getFullYear())
    setMonth(today.getMonth())
  }

  function openNewEvent(day: Date) {
    setNewEventDate(toLocalDateStr(day))
    setNewEventOpen(true)
  }

  const invalidateEvents = () =>
    queryClient.invalidateQueries({ queryKey: ['calendar-events', year, month] })

  const todayStr = toLocalDateStr(today)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0 gap-4">
        {/* Navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={prevMonth}
            className="rounded-md border p-1.5 hover:bg-accent transition-colors"
            aria-label="Mês anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-base font-semibold w-40 text-center">
            {MONTH_NAMES[month]} {year}
          </span>
          <button
            onClick={nextMonth}
            className="rounded-md border p-1.5 hover:bg-accent transition-colors"
            aria-label="Próximo mês"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={goToday}
            className="ml-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
          >
            Hoje
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {accounts.length > 0 ? (
            <>
              {accounts.map((acc) => (
                <div
                  key={acc.id}
                  className="flex items-center gap-1.5 rounded-full border bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 px-3 py-1 text-xs font-medium"
                >
                  <Wifi className="h-3 w-3" />
                  {acc.email ?? acc.provider}
                  <button
                    onClick={() => disconnectMutation.mutate(acc.id)}
                    disabled={disconnectMutation.isPending}
                    className="ml-0.5 hover:text-red-500 transition-colors"
                    aria-label="Desconectar"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </>
          ) : (
            <button
              onClick={() => connectMutation.mutate()}
              disabled={connectMutation.isPending}
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
            >
              <Wifi className="h-4 w-4" />
              {connectMutation.isPending ? 'Conectando...' : 'Conectar Google'}
            </button>
          )}

          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
            Sincronizar
          </button>

          <button
            onClick={() => { setNewEventDate(toLocalDateStr(today)); setNewEventOpen(true) }}
            className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Novo evento
          </button>
        </div>
      </div>

      {/* ── Calendar grid ── */}
      <div className="flex-1 overflow-auto p-4">
        <div className="min-w-[640px]">
          {/* Day header row */}
          <div className="grid grid-cols-7 mb-1">
            {DAY_NAMES.map((d) => (
              <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-2">
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 border-l border-t">
            {gridDays.map((day, idx) => {
              const isCurrentMonth = day.getMonth() === month
              const dayStr = toLocalDateStr(day)
              const isToday = dayStr === todayStr
              const dayEvents = eventsByDay[dayStr] ?? []
              const shown = dayEvents.slice(0, 3)
              const overflow = dayEvents.length - 3

              return (
                <div
                  key={idx}
                  onClick={() => openNewEvent(day)}
                  className={`border-r border-b min-h-[96px] p-1.5 cursor-pointer hover:bg-accent/30 transition-colors ${
                    !isCurrentMonth ? 'bg-muted/30' : ''
                  }`}
                >
                  {/* Day number */}
                  <div className="flex justify-end mb-1">
                    <span
                      className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full ${
                        isToday
                          ? 'bg-primary text-primary-foreground'
                          : isCurrentMonth
                          ? 'text-foreground'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {day.getDate()}
                    </span>
                  </div>

                  {/* Events */}
                  <div className="space-y-0.5">
                    {shown.map((ev) => (
                      <button
                        key={ev.id}
                        onClick={(e) => { e.stopPropagation(); setSelectedEvent(ev) }}
                        className="w-full text-left rounded px-1 py-0.5 bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-xs truncate block"
                        title={ev.title}
                      >
                        <span className="text-muted-foreground mr-1">{formatTime(ev.startAt)}</span>
                        {ev.title}
                      </button>
                    ))}
                    {overflow > 0 && (
                      <p className="text-xs text-muted-foreground pl-1">+{overflow} mais</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Modals / Sheets ── */}
      <NewEventModal
        open={newEventOpen}
        defaultDate={newEventDate}
        accounts={accounts}
        onClose={() => setNewEventOpen(false)}
        onCreated={invalidateEvents}
      />

      <EventDetailSheet
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        onDeleted={invalidateEvents}
      />
    </div>
  )
}

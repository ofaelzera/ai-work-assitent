'use client'

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '@/lib/api'
import { usePermission } from '@/lib/usePermission'
import { useAuthStore } from '@/store/auth'
import { toast } from 'sonner'
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Plus,
  Wifi,
  X,
  Lock,
  Ban,
  Clock,
  Trash2,
  MessageSquare,
  MapPin,
  Video,
  Users,
  User,
  CheckCircle2,
  HelpCircle,
  XCircle,
  MinusCircle,
  Calendar as CalendarIcon,
  AtSign,
  Building2,
} from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface CalendarAccount {
  id: string
  provider: string
  email?: string | null
}

interface Attendee {
  email: string
  name?: string | null
  status?: string | null
}

interface CalendarEvent {
  id: string
  title: string
  ownerId?: string
  createdById?: string | null
  startAt: string
  endAt: string
  description?: string | null
  location?: string | null
  meetLink?: string | null
  attendees?: Attendee[] | null
  allDay?: boolean
  status?: string | null
  organizer?: string | null
  color?: string | null
  calendarAccountId?: string | null
  externalId?: string | null
  cardId?: string | null
  contactId?: string | null
  conversationId?: string | null
  contact?: { id: string; name: string | null; phone: string | null } | null
  conversation?: { id: string; subject: string | null; isGroup: boolean } | null
}

interface WorkspaceUser {
  id: string
  name: string | null
  email: string
  settings?: { avatarUrl?: string | null } | null
}

interface Contact {
  id: string
  name: string | null
  email: string
  phone: string | null
  metadata?: { avatarUrl?: string | null } | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

// Google Calendar color palette (colorId → hex)
const GOOGLE_COLORS: Record<string, string> = {
  '1': '#a4bdfc', '2': '#7ae7bf', '3': '#dbadff', '4': '#ff887c',
  '5': '#fbd75b', '6': '#ffb878', '7': '#46d6db', '8': '#e1e1e1',
  '9': '#5484ed', '10': '#51b749', '11': '#dc2127',
}

// Paleta para diferenciar donos na visualização de agenda compartilhada.
const OWNER_PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6']

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

function buildCalendarGrid(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startDow = firstDay.getDay()
  const endDow = lastDay.getDay()
  const days: Date[] = []

  for (let i = startDow - 1; i >= 0; i--) {
    days.push(new Date(year, month, -i))
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(new Date(year, month, d))
  }
  for (let i = 1; i <= 6 - endDow; i++) {
    days.push(new Date(year, month + 1, i))
  }

  return days
}

function AttendeeStatusIcon({ status }: { status?: string | null }) {
  switch (status) {
    case 'accepted':
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
    case 'declined':
      return <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
    case 'tentative':
      return <MinusCircle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
    default:
      return <HelpCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
  }
}

// ─── AttendeeInput ────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface AttendeePill {
  email: string
  name?: string | null
  type: 'user' | 'contact' | 'manual'
  contactId?: string
}

interface AttendeeInputProps {
  value: AttendeePill[]
  onChange: (v: AttendeePill[]) => void
}

function useDebounce<T>(val: T, ms: number): T {
  const [deb, setDeb] = useState(val)
  useEffect(() => {
    const t = setTimeout(() => setDeb(val), ms)
    return () => clearTimeout(t)
  }, [val, ms])
  return deb
}

function AttendeeInput({ value, onChange }: AttendeeInputProps) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const debouncedQ = useDebounce(input.trim(), 250)

  // Fetch workspace users (cached once)
  const { data: users = [] } = useQuery<WorkspaceUser[]>({
    queryKey: ['workspace-users'],
    queryFn: () => apiFetch<WorkspaceUser[]>('/users'),
    staleTime: 5 * 60 * 1000,
  })

  // Search contacts with email only
  const { data: contactsData } = useQuery<{ items: Contact[] }>({
    queryKey: ['contacts-search-email', debouncedQ],
    queryFn: () =>
      apiFetch<{ items: Contact[] }>(
        `/contacts?${debouncedQ ? `q=${encodeURIComponent(debouncedQ)}&` : ''}limit=8&excludeLid=true`,
      ),
    enabled: open,
    staleTime: 30_000,
    select: (d) => ({ items: d.items.filter((c) => !!c.email) }),
  })

  const contacts: Contact[] = contactsData?.items ?? []

  const selectedEmails = new Set(value.map((a) => a.email.toLowerCase()))

  const filteredUsers = debouncedQ
    ? users.filter(
        (u) =>
          !selectedEmails.has(u.email.toLowerCase()) &&
          (u.name?.toLowerCase().includes(debouncedQ.toLowerCase()) ||
            u.email.toLowerCase().includes(debouncedQ.toLowerCase())),
      )
    : users.filter((u) => !selectedEmails.has(u.email.toLowerCase())).slice(0, 5)

  const filteredContacts = contacts.filter(
    (c) => !selectedEmails.has(c.email.toLowerCase()),
  )

  const canAddManual =
    EMAIL_RE.test(input.trim()) && !selectedEmails.has(input.trim().toLowerCase())

  const hasResults = filteredUsers.length > 0 || filteredContacts.length > 0 || canAddManual

  // Close dropdown on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  function addPill(pill: AttendeePill) {
    onChange([...value, pill])
    setInput('')
    setOpen(false)
    inputRef.current?.focus()
  }

  function removePill(email: string) {
    onChange(value.filter((a) => a.email !== email))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === 'Enter' || e.key === ',') && input.trim()) {
      e.preventDefault()
      if (canAddManual) {
        addPill({ email: input.trim(), type: 'manual' })
      }
    }
    if (e.key === 'Backspace' && !input && value.length > 0) {
      onChange(value.slice(0, -1))
    }
    if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Pills + input */}
      <div
        onClick={() => { inputRef.current?.focus(); setOpen(true) }}
        className={`min-h-[38px] flex flex-wrap gap-1.5 rounded-md border bg-background px-2 py-1.5 cursor-text transition-colors ${
          focused ? 'ring-2 ring-primary border-primary' : ''
        }`}
      >
        {value.map((a) => (
          <span
            key={a.email}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              a.type === 'user'
                ? 'bg-primary/15 text-primary'
                : a.type === 'contact'
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {a.type === 'user' && <User className="h-2.5 w-2.5" />}
            {a.type === 'contact' && <Building2 className="h-2.5 w-2.5" />}
            {a.type === 'manual' && <AtSign className="h-2.5 w-2.5" />}
            <span>{a.name ?? a.email}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removePill(a.email) }}
              className="hover:text-destructive transition-colors"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => { setInput(e.target.value); setOpen(true) }}
          onFocus={() => { setFocused(true); setOpen(true) }}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? 'Buscar ou digitar e-mail...' : ''}
          className="flex-1 min-w-[140px] bg-transparent text-sm outline-none placeholder:text-muted-foreground py-0.5"
        />
      </div>

      {/* Dropdown */}
      {open && hasResults && (
        <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-lg overflow-hidden">
          {filteredUsers.length > 0 && (
            <div>
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/50">
                Usuários do sistema
              </div>
              {filteredUsers.map((u) => {
                const av = u.settings?.avatarUrl
                return (
                  <button
                    key={u.id}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); addPill({ email: u.email, name: u.name, type: 'user' }) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
                  >
                    <div className="h-7 w-7 rounded-full shrink-0 overflow-hidden bg-primary/20 text-primary flex items-center justify-center text-xs font-semibold">
                      {av
                        ? <img src={av} alt="" className="h-full w-full object-cover" />
                        : (u.name ?? u.email)[0].toUpperCase()
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{u.name ?? u.email}</p>
                      {u.name && <p className="text-xs text-muted-foreground truncate">{u.email}</p>}
                    </div>
                    <User className="h-3 w-3 text-muted-foreground shrink-0" />
                  </button>
                )
              })}
            </div>
          )}

          {filteredContacts.length > 0 && (
            <div>
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/50">
                Contatos
              </div>
              {filteredContacts.map((c) => {
                const av = (c.metadata as any)?.avatarUrl as string | undefined
                return (
                  <button
                    key={c.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      addPill({ email: c.email, name: c.name, type: 'contact', contactId: c.id })
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
                  >
                    <div className="h-7 w-7 rounded-full shrink-0 overflow-hidden bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 flex items-center justify-center text-xs font-semibold">
                      {av
                        ? <img src={av} alt="" className="h-full w-full object-cover" />
                        : (c.name ?? c.email)[0].toUpperCase()
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{c.name ?? c.email}</p>
                      <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                    </div>
                    <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
                  </button>
                )
              })}
            </div>
          )}

          {canAddManual && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                addPill({ email: input.trim(), type: 'manual' })
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors text-left border-t"
            >
              <AtSign className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>Adicionar <strong>{input.trim()}</strong></span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── NewEventModal ─────────────────────────────────────────────────────────────

interface NewEventModalProps {
  open: boolean
  defaultDate: string
  accounts: CalendarAccount[]
  users: WorkspaceUser[]
  currentUserId: string
  canCreateForOthers: boolean
  onClose: () => void
  onCreated: () => void
}

function NewEventModal({ open, defaultDate, accounts, users, currentUserId, canCreateForOthers, onClose, onCreated }: NewEventModalProps) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(defaultDate)
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState('')
  const [attendees, setAttendees] = useState<AttendeePill[]>([])
  const [createMeetLink, setCreateMeetLink] = useState(false)
  const [allDay, setAllDay] = useState(false)
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [ownerId, setOwnerId] = useState(currentUserId)

  const isForOther = ownerId !== currentUserId

  // Ao abrir (ou mudar o dia clicado), reseta data/dono — corrige o modal que
  // ficava preso na data inicial.
  useEffect(() => {
    if (open) {
      setDate(defaultDate)
      setOwnerId(currentUserId)
    }
  }, [open, defaultDate, currentUserId])

  // ── Horários disponíveis (selects derivados dos intervalos livres) ─────────
  const STEP = 15 // granularidade dos horários (min)
  const dayFrom = date ? new Date(`${date}T00:00:00`).toISOString() : null
  const dayTo = date ? new Date(`${date}T23:59:59`).toISOString() : null
  const { data: freeIntervals = [] } = useQuery<{ start: string; end: string }[]>({
    queryKey: ['free-intervals', ownerId, date],
    queryFn: () =>
      apiFetch(`/calendar/free-intervals?userId=${ownerId}&from=${encodeURIComponent(dayFrom!)}&to=${encodeURIComponent(dayTo!)}`),
    enabled: open && !allDay && !!date,
  })

  const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0) }
  const toHHMM = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`

  // Intervalos livres em minutos-do-dia
  const intervalMins = useMemo(
    () => freeIntervals.map((i) => {
      const s = new Date(i.start), e = new Date(i.end)
      return { startMin: s.getHours() * 60 + s.getMinutes(), endMin: e.getHours() * 60 + e.getMinutes() }
    }),
    [freeIntervals],
  )

  // Opções de início: cada STEP dentro de um intervalo com pelo menos STEP livre
  const startOptions = useMemo(() => {
    const opts = new Set<number>()
    for (const itv of intervalMins) {
      for (let m = itv.startMin; m + STEP <= itv.endMin; m += STEP) opts.add(m)
    }
    return Array.from(opts).sort((a, b) => a - b)
  }, [intervalMins])

  const startMin = startTime ? toMin(startTime) : null
  const activeInterval = intervalMins.find((itv) => startMin != null && startMin >= itv.startMin && startMin < itv.endMin)
  // Opções de fim: só horários depois do início, dentro do mesmo intervalo livre
  const endOptions = useMemo(() => {
    if (startMin == null || !activeInterval) return []
    const opts: number[] = []
    for (let m = startMin + STEP; m <= activeInterval.endMin; m += STEP) opts.push(m)
    return opts
  }, [startMin, activeInterval])

  // Auto-seleciona um horário válido quando o dia muda / opções carregam
  useEffect(() => {
    if (!open || allDay || startOptions.length === 0) return
    const cur = startTime ? toMin(startTime) : null
    if (cur == null || !startOptions.includes(cur)) {
      const s = startOptions[0]
      const itv = intervalMins.find((i) => s >= i.startMin && s < i.endMin)
      const e = Math.min(s + 60, itv?.endMin ?? s + STEP)
      setStartTime(toHHMM(s))
      setEndTime(toHHMM(e > s ? e : s + STEP))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startOptions, open, allDay, date, ownerId])

  function onChangeStart(v: string) {
    setStartTime(v)
    const sm = toMin(v)
    const itv = intervalMins.find((i) => sm >= i.startMin && sm < i.endMin)
    const e = Math.min(sm + 60, itv?.endMin ?? sm + STEP)
    setEndTime(toHHMM(e > sm ? e : sm + STEP))
  }

  const noSlots = !allDay && !!date && startOptions.length === 0
  const timeInvalid = !allDay && (!startTime || !endTime || toMin(endTime) <= toMin(startTime))

  const mutation = useMutation({
    mutationFn: async (opts?: { force?: boolean }) => {
      const startAt = allDay
        ? new Date(`${date}T00:00:00`).toISOString()
        : new Date(`${date}T${startTime}:00`).toISOString()
      const endAt = allDay
        ? new Date(`${date}T23:59:59`).toISOString()
        : new Date(`${date}T${endTime}:00`).toISOString()

      return apiFetch('/calendar/events', {
        method: 'POST',
        body: JSON.stringify({
          // Para terceiros o backend resolve a conta Google do dono automaticamente.
          accountId: isForOther ? undefined : (accountId || undefined),
          ownerId: isForOther ? ownerId : undefined,
          force: opts?.force || undefined,
          title,
          startAt,
          endAt,
          description: description || undefined,
          location: location || undefined,
          attendees: attendees.length > 0
            ? attendees.map((a) => ({ email: a.email, name: a.name ?? undefined }))
            : undefined,
          createMeetLink: createMeetLink || undefined,
          allDay,
        }),
      })
    },
    onSuccess: () => {
      toast.success('Evento criado com sucesso')
      onCreated()
      onClose()
      setTitle('')
      setDescription('')
      setLocation('')
      setAttendees([])
      setCreateMeetLink(false)
      setAllDay(false)
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.status === 409) {
        if (typeof window !== 'undefined' && window.confirm('Há conflito de horário na agenda. Deseja agendar mesmo assim?')) {
          mutation.mutate({ force: true })
          return
        }
        toast.error('Conflito de horário — agendamento cancelado')
        return
      }
      if (err instanceof ApiError && err.status === 422) {
        toast.error(err.message ?? 'Horário indisponível para agendamento')
        return
      }
      toast.error(err.message ?? 'Erro ao criar evento')
    },
  })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-card border rounded-xl shadow-xl w-full max-w-lg mx-4 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Novo evento</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          {/* Title */}
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

          {/* Owner (agenda compartilhada) */}
          {canCreateForOthers && (
            <div>
              <label className="text-sm font-medium">Para quem (dono da agenda)</label>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
              >
                <option value={currentUserId}>Minha agenda</option>
                {users
                  .filter((u) => u.id !== currentUserId)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name ?? u.email}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {/* All-day toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="allDay"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="h-4 w-4 rounded border"
            />
            <label htmlFor="allDay" className="text-sm font-medium cursor-pointer">
              Dia inteiro
            </label>
          </div>

          {/* Date */}
          <div>
            <label className="text-sm font-medium">Data</label>
            <input
              type="date"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          {/* Horários (selects derivados dos intervalos livres — evita escolher hora indisponível) */}
          {!allDay && (
            noSlots ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                Nenhum horário disponível neste dia para {isForOther ? 'este usuário' : 'você'}.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Início</label>
                  <select
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    value={startTime}
                    onChange={(e) => onChangeStart(e.target.value)}
                  >
                    {startOptions.map((m) => (
                      <option key={m} value={toHHMM(m)}>{toHHMM(m)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">Fim</label>
                  <select
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  >
                    {endOptions.map((m) => (
                      <option key={m} value={toHHMM(m)}>{toHHMM(m)}</option>
                    ))}
                  </select>
                </div>
              </div>
            )
          )}

          {/* Location */}
          <div>
            <label className="text-sm font-medium flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
              Local (opcional)
            </label>
            <input
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Endereço ou link do local"
            />
          </div>

          {/* Attendees */}
          <div>
            <label className="text-sm font-medium flex items-center gap-1.5 mb-1">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              Participantes (opcional)
            </label>
            <AttendeeInput value={attendees} onChange={setAttendees} />
            <p className="text-xs text-muted-foreground mt-1">
              Digite para buscar usuários ou contatos. Pressione Enter para adicionar um e-mail externo.
            </p>
          </div>

          {/* Google Meet */}
          {accountId && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="createMeetLink"
                checked={createMeetLink}
                onChange={(e) => setCreateMeetLink(e.target.checked)}
                className="h-4 w-4 rounded border"
              />
              <label htmlFor="createMeetLink" className="text-sm font-medium cursor-pointer flex items-center gap-1.5">
                <Video className="h-3.5 w-3.5 text-muted-foreground" />
                Criar link do Google Meet
              </label>
            </div>
          )}

          {/* Account selector */}
          {accounts.length > 0 && (
            <div>
              <label className="text-sm font-medium">Conta Google</label>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">Somente local (sem sincronizar)</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.email ?? a.provider}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Description */}
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
            onClick={() => mutation.mutate({})}
            disabled={!title.trim() || mutation.isPending || noSlots || timeInvalid}
            title={noSlots ? 'Nenhum horário disponível neste dia' : undefined}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? 'Criando...' : 'Criar evento'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── EventDetailSheet ────────────────────────────────────────────────────────

interface EventDetailSheetProps {
  event: CalendarEvent | null
  currentUserId: string
  canCancelOthers: boolean
  users: WorkspaceUser[]
  onClose: () => void
  onDeleted: () => void
}

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Confirmado',
  tentative: 'Tentativo',
  cancelled: 'Cancelado',
}

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  tentative: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 line-through',
}

function EventDetailSheet({ event, currentUserId, canCancelOthers, users, onClose, onDeleted }: EventDetailSheetProps) {
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

  const colorHex = event.color ? GOOGLE_COLORS[event.color] : null
  // Pode remover se é dono da agenda, se criou o evento, ou se tem permissão.
  const canDelete =
    event.ownerId === currentUserId ||
    event.createdById === currentUserId ||
    canCancelOthers
  const isOwnAgenda = !event.ownerId || event.ownerId === currentUserId
  const ownerLabel = isOwnAgenda ? 'Sua agenda' : (users.find((u) => u.id === event.ownerId)?.name ?? 'Outro usuário')

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-card border-l shadow-xl w-full max-w-sm h-full flex flex-col">
        {/* Color bar */}
        {colorHex && (
          <div className="h-1.5 w-full shrink-0" style={{ backgroundColor: colorHex }} />
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5 flex-1">
              <h2 className="text-lg font-semibold leading-tight">{event.title}</h2>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  <User className="h-3 w-3" /> {ownerLabel}
                </span>
                {event.status && (
                  <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[event.status] ?? 'bg-muted text-muted-foreground'}`}>
                    {STATUS_LABELS[event.status] ?? event.status}
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Date/Time */}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium flex items-center gap-1">
              <Clock className="h-3 w-3" /> Horário
            </p>
            {event.allDay ? (
              <p className="text-sm font-medium">
                <CalendarIcon className="h-3.5 w-3.5 inline mr-1 text-muted-foreground" />
                {new Date(event.startAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })} — dia inteiro
              </p>
            ) : (
              <>
                <p className="text-sm">{formatDateTime(event.startAt)}</p>
                <p className="text-sm text-muted-foreground">até {formatTime(event.endAt)}</p>
              </>
            )}
          </div>

          {/* Location */}
          {event.location && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium flex items-center gap-1">
                <MapPin className="h-3 w-3" /> Local
              </p>
              <p className="text-sm break-words">{event.location}</p>
            </div>
          )}

          {/* Google Meet link */}
          {event.meetLink && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium flex items-center gap-1">
                <Video className="h-3 w-3" /> Videochamada
              </p>
              <a
                href={event.meetLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-md bg-green-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-green-700 transition-colors"
              >
                <Video className="h-3.5 w-3.5" />
                Entrar na reunião
              </a>
            </div>
          )}

          {/* Organizer */}
          {event.organizer && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium flex items-center gap-1">
                <User className="h-3 w-3" /> Organizador
              </p>
              <p className="text-sm">{event.organizer}</p>
            </div>
          )}

          {/* Attendees */}
          {event.attendees && event.attendees.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium flex items-center gap-1">
                <Users className="h-3 w-3" /> Participantes ({event.attendees.length})
              </p>
              <ul className="space-y-1.5">
                {event.attendees.map((a, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <AttendeeStatusIcon status={a.status} />
                    <span className="truncate">
                      {a.name ? (
                        <>
                          <span className="font-medium">{a.name}</span>
                          <span className="text-muted-foreground ml-1">({a.email})</span>
                        </>
                      ) : (
                        a.email
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Description */}
          {event.description && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Descrição</p>
              <p className="text-sm whitespace-pre-wrap break-words text-muted-foreground">{event.description}</p>
            </div>
          )}

          {/* Linked conversation */}
          {event.conversationId && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Origem</p>
              <Link
                href={`/inbox/${event.conversationId}`}
                className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 hover:underline"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                {event.contact?.name ?? event.contact?.phone ?? 'Conversa vinculada'}
              </Link>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 pt-4 border-t shrink-0">
          {canDelete ? (
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="flex items-center gap-2 rounded-md border border-destructive text-destructive px-4 py-2 text-sm hover:bg-destructive/10 disabled:opacity-50 transition-colors w-full justify-center"
            >
              <Trash2 className="h-4 w-4" />
              {deleteMutation.isPending ? 'Removendo...' : 'Remover evento'}
            </button>
          ) : (
            <p className="text-xs text-muted-foreground text-center">
              Só o dono da agenda ou quem criou o evento pode removê-lo.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

// ─── Owner picker (agenda compartilhada) ──────────────────────────────────────

function OwnerPicker({
  users,
  selected,
  onChange,
}: {
  users: WorkspaceUser[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
      >
        <Users className="h-4 w-4" />
        {selected.length > 0 ? `Agendas (${selected.length + 1})` : 'Ver agenda de'}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-64 max-h-72 overflow-y-auto rounded-md border bg-popover shadow-lg p-1">
          {users.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Nenhum outro usuário</p>
          ) : (
            users.map((u) => (
              <label
                key={u.id}
                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent rounded cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(u.id)}
                  onChange={() => toggle(u.id)}
                  className="h-4 w-4 rounded border"
                />
                <span className="truncate">{u.name ?? u.email}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ─── Modal de bloqueio de agenda ───────────────────────────────────────────────
function BlockModal({
  open, defaultDate, userId, onClose, onCreated,
}: {
  open: boolean
  defaultDate: string
  userId: string
  onClose: () => void
  onCreated: () => void
}) {
  const [date, setDate] = useState(defaultDate)
  const [startTime, setStartTime] = useState('08:00')
  const [endTime, setEndTime] = useState('12:00')
  const [title, setTitle] = useState('')

  useEffect(() => {
    if (open) { setDate(defaultDate); setStartTime('08:00'); setEndTime('12:00'); setTitle('') }
  }, [open, defaultDate])

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch('/calendar/blocks', {
        method: 'POST',
        body: JSON.stringify({
          userId, // bloqueia a própria agenda
          title: title || undefined,
          startAt: new Date(`${date}T${startTime}:00`).toISOString(),
          endAt: new Date(`${date}T${endTime}:00`).toISOString(),
        }),
      }),
    onSuccess: () => { toast.success('Período bloqueado'); onCreated(); onClose() },
    onError: (e: Error) => toast.error(e.message ?? 'Erro ao bloquear'),
  })

  if (!open) return null
  const invalid = !date || new Date(`${date}T${endTime}:00`) <= new Date(`${date}T${startTime}:00`)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-card border rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Ban className="h-4 w-4" /> Bloquear agenda</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-muted-foreground">Impede agendamentos no período (ex: consulta, reunião interna, almoço estendido).</p>
        <div>
          <label className="text-sm font-medium">Motivo (opcional)</label>
          <input className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" value={title}
            onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Dentista" autoFocus />
        </div>
        <div>
          <label className="text-sm font-medium">Data</label>
          <input type="date" className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" value={date}
            onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">Início</label>
            <input type="time" className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" value={startTime}
              onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium">Fim</label>
            <input type="time" className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" value={endTime}
              onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">Cancelar</button>
          <button onClick={() => mutation.mutate()} disabled={invalid || mutation.isPending}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
            {mutation.isPending ? 'Bloqueando...' : 'Bloquear'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CalendarPage() {
  const queryClient = useQueryClient()
  const today = new Date()

  const [currentDate, setCurrentDate] = useState(today)
  const [view, setView] = useState<'month' | 'week' | 'day'>('month')
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  const [newEventOpen, setNewEventOpen] = useState(false)
  const [newEventDate, setNewEventDate] = useState(toLocalDateStr(today))
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)

  // ── Agenda compartilhada ────────────────────────────────────────────────────
  const currentUserId = useAuthStore((s) => s.user?.sub ?? '')
  const canViewOthers = usePermission('calendar.viewOthers')
  const canCreateForOthers = usePermission('calendar.createForOthers')
  const canCancelOthers = usePermission('calendar.cancelOthers')
  // Donos selecionados pra visualizar. Vazio = só o próprio.
  const [viewOwnerIds, setViewOwnerIds] = useState<string[]>([])

  const { data: users = [] } = useQuery<WorkspaceUser[]>({
    queryKey: ['workspace-users'],
    queryFn: () => apiFetch<WorkspaceUser[]>('/users'),
    staleTime: 5 * 60 * 1000,
    enabled: canViewOthers || canCreateForOthers,
  })

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

  const { from, to } = useMemo(() => {
    let f: Date, t: Date
    if (view === 'month') {
      f = new Date(year, month, 1)
      t = new Date(year, month + 1, 0, 23, 59, 59)
    } else if (view === 'week') {
      f = new Date(year, month, currentDate.getDate() - currentDate.getDay())
      f.setHours(0, 0, 0, 0)
      t = new Date(f)
      t.setDate(t.getDate() + 6)
      t.setHours(23, 59, 59, 999)
    } else {
      f = new Date(year, month, currentDate.getDate())
      f.setHours(0, 0, 0, 0)
      t = new Date(f)
      t.setHours(23, 59, 59, 999)
    }
    return { from: f.toISOString(), to: t.toISOString() }
  }, [view, currentDate, year, month])

  const ownerKey = viewOwnerIds.join(',')
  const { data: events = [] } = useQuery<CalendarEvent[]>({
    queryKey: ['calendar-events', year, month, ownerKey],
    queryFn: () => {
      const params = new URLSearchParams({ from, to })
      // Vazio = só a própria agenda. Com seleção, sempre inclui a própria + os colegas.
      if (viewOwnerIds.length > 0) {
        params.append('ownerIds', currentUserId)
        for (const id of viewOwnerIds) params.append('ownerIds', id)
      }
      return apiFetch<CalendarEvent[]>(`/calendar/events?${params.toString()}`)
    },
  })

  const syncMutation = useMutation({
    mutationFn: () => apiFetch<{ synced: number }>('/calendar/sync', { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: ({ synced }) => {
      toast.success(`${synced} evento${synced !== 1 ? 's' : ''} sincronizado${synced !== 1 ? 's' : ''}`)
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] })
    },
    onError: (err: Error) => toast.error(err.message ?? 'Erro ao sincronizar'),
  })

  // ── Dias fechados (empresa não atende) ──────────────────────────────────────
  // Bloqueia clique em fim de semana/dias fora do expediente e feriados.
  const { data: companyHours = [] } = useQuery<{ weekday: number }[]>({
    queryKey: ['company-hours'],
    queryFn: () => apiFetch('/calendar/company-hours'),
    staleTime: 5 * 60 * 1000,
  })
  const { data: holidays = [] } = useQuery<{ date: string; closed: boolean }[]>({
    queryKey: ['holidays'],
    queryFn: () => apiFetch('/calendar/holidays'),
    staleTime: 5 * 60 * 1000,
  })

  // Feriados nacionais (automáticos) dos anos visíveis na grade.
  const gridYears = useMemo(() => {
    const startY = new Date(from).getFullYear()
    const endY = new Date(to).getFullYear()
    return Array.from(new Set([startY, endY, year]))
  }, [from, to, year])
  const { data: nationalHolidays = [] } = useQuery<{ date: string; name: string }[]>({
    queryKey: ['national-holidays', gridYears.join(',')],
    queryFn: async () => {
      const lists = await Promise.all(
        gridYears.map((y) => apiFetch<{ date: string; name: string }[]>(`/calendar/national-holidays?year=${y}`)),
      )
      return lists.flat()
    },
    staleTime: 60 * 60 * 1000,
  })

  const openWeekdays = useMemo(() => new Set(companyHours.map((h) => h.weekday)), [companyHours])
  const companyConfigured = companyHours.length > 0
  const closedHolidays = useMemo(
    () => new Set(holidays.filter((h) => h.closed).map((h) => h.date.slice(0, 10))),
    [holidays],
  )
  const nationalSet = useMemo(
    () => new Set(nationalHolidays.map((h) => h.date.slice(0, 10))),
    [nationalHolidays],
  )

  const nationalNameByDate = useMemo(
    () => new Map(nationalHolidays.map((h) => [h.date.slice(0, 10), h.name])),
    [nationalHolidays],
  )

  // Dia fechado = feriado (tabela ou nacional automático) OU empresa não abre nesse weekday.
  const isDayClosed = useCallback(
    (day: Date) => {
      const key = toLocalDateStr(day)
      if (closedHolidays.has(key)) return true
      if (nationalSet.has(key)) return true
      if (companyConfigured && !openWeekdays.has(day.getDay())) return true
      return false
    },
    [closedHolidays, nationalSet, companyConfigured, openWeekdays],
  )
  const closedReason = useCallback(
    (day: Date): string => {
      const key = toLocalDateStr(day)
      return nationalNameByDate.get(key) ?? (closedHolidays.has(key) ? 'Feriado / empresa fechada' : 'Empresa fechada neste dia')
    },
    [nationalNameByDate, closedHolidays],
  )

  // ── Bloqueios de agenda (do próprio usuário) ─────────────────────────────────
  const [blockModalOpen, setBlockModalOpen] = useState(false)
  const [blockDate, setBlockDate] = useState(toLocalDateStr(today))

  const { data: blocks = [] } = useQuery<{ id: string; title: string | null; startAt: string; endAt: string; userId: string | null }[]>({
    queryKey: ['schedule-blocks', year, month, ownerKey],
    queryFn: () => {
      const params = new URLSearchParams({ from, to })
      if (viewOwnerIds.length > 0) {
        params.append('ownerIds', currentUserId)
        for (const id of viewOwnerIds) params.append('ownerIds', id)
      }
      return apiFetch(`/calendar/blocks?${params.toString()}`)
    },
  })

  const blocksByDay = useMemo(() => {
    const map: Record<string, typeof blocks> = {}
    for (const b of blocks) {
      const key = toLocalDateStr(new Date(b.startAt))
      ;(map[key] ??= []).push(b)
    }
    return map
  }, [blocks])

  const deleteBlock = useMutation({
    mutationFn: (id: string) => apiFetch(`/calendar/blocks/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Bloqueio removido')
      queryClient.invalidateQueries({ queryKey: ['schedule-blocks'] })
    },
    onError: (e: Error) => toast.error(e.message ?? 'Erro ao remover'),
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

  // Cor por dono (agenda compartilhada): self + colegas visualizados.
  const multiOwner = viewOwnerIds.length > 0
  const ownerColor = useMemo(() => {
    const ids = [currentUserId, ...viewOwnerIds]
    const map: Record<string, string> = {}
    ids.forEach((id, i) => { map[id] = OWNER_PALETTE[i % OWNER_PALETTE.length] })
    return map
  }, [currentUserId, viewOwnerIds])
  const ownerName = (id?: string | null) =>
    id === currentUserId ? 'Você' : (users.find((u) => u.id === id)?.name ?? 'Outro')

  // ── Navigation ────────────────────────────────────────────────────────────

  function prevPeriod() {
    setCurrentDate((prev) => {
      const d = new Date(prev)
      if (view === 'month') d.setMonth(d.getMonth() - 1)
      else if (view === 'week') d.setDate(d.getDate() - 7)
      else d.setDate(d.getDate() - 1)
      return d
    })
  }

  function nextPeriod() {
    setCurrentDate((prev) => {
      const d = new Date(prev)
      if (view === 'month') d.setMonth(d.getMonth() + 1)
      else if (view === 'week') d.setDate(d.getDate() + 7)
      else d.setDate(d.getDate() + 1)
      return d
    })
  }

  function goToday() {
    setCurrentDate(new Date())
  }

  const periodLabel = useMemo(() => {
    if (view === 'month') return `${MONTH_NAMES[month]} ${year}`
    if (view === 'day') return `${pad(currentDate.getDate())} de ${MONTH_NAMES[month]} de ${year}`
    const startOfWeek = new Date(from)
    const endOfWeek = new Date(to)
    if (startOfWeek.getMonth() === endOfWeek.getMonth()) {
      return `${pad(startOfWeek.getDate())} - ${pad(endOfWeek.getDate())} de ${MONTH_NAMES[startOfWeek.getMonth()]}`
    }
    return `${pad(startOfWeek.getDate())}/${pad(startOfWeek.getMonth() + 1)} - ${pad(endOfWeek.getDate())}/${pad(endOfWeek.getMonth() + 1)}`
  }, [view, currentDate, month, year, from, to])

  function openNewEvent(day: Date) {
    setNewEventDate(toLocalDateStr(day))
    setNewEventOpen(true)
  }

  const invalidateEvents = () =>
    queryClient.invalidateQueries({ queryKey: ['calendar-events'] })

  const todayStr = toLocalDateStr(today)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0 gap-4">
        {/* Navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={prevPeriod}
            className="rounded-md border p-1.5 hover:bg-accent transition-colors"
            aria-label="Anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-base font-semibold min-w-[180px] text-center">
            {periodLabel}
          </span>
          <button
            onClick={nextPeriod}
            className="rounded-md border p-1.5 hover:bg-accent transition-colors"
            aria-label="Próximo"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={goToday}
            className="ml-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
          >
            Hoje
          </button>
          <div className="ml-4 flex bg-muted rounded-md p-1">
            {(['month', 'week', 'day'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${view === v ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {v === 'month' ? 'Mês' : v === 'week' ? 'Semana' : 'Dia'}
              </button>
            ))}
          </div>
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

          {canViewOthers && (
            <OwnerPicker
              users={users.filter((u) => u.id !== currentUserId)}
              selected={viewOwnerIds}
              onChange={setViewOwnerIds}
            />
          )}

          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            title="Sincronização automática a cada 15 min"
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
            Sincronizar
          </button>

          <button
            onClick={() => { setBlockDate(toLocalDateStr(today)); setBlockModalOpen(true) }}
            title="Bloquear um período da sua agenda"
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
          >
            <Ban className="h-4 w-4" />
            Bloquear
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
      <div className="flex-1 overflow-auto p-4 flex flex-col">
        {/* Legenda de cores por dono (agenda compartilhada) */}
        {multiOwner && (
          <div className="flex flex-wrap items-center gap-3 mb-3 text-xs shrink-0">
            {[currentUserId, ...viewOwnerIds].map((id) => (
              <span key={id} className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: ownerColor[id] }} />
                {ownerName(id)}
              </span>
            ))}
          </div>
        )}

        {view === 'month' && (
          <div className="min-w-[640px] flex-1 flex flex-col">
            <div className="grid grid-cols-7 mb-1 shrink-0">
              {DAY_NAMES.map((d) => (
                <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-2">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 border-l border-t flex-1">
              {gridDays.map((day, idx) => {
                const isCurrentMonth = day.getMonth() === month
                const dayStr = toLocalDateStr(day)
                const isToday = dayStr === todayStr
                const dayEvents = eventsByDay[dayStr] ?? []
                const shown = dayEvents.slice(0, 3)
                const overflow = dayEvents.length - 3
                const closed = isDayClosed(day)
                const reason = closed ? closedReason(day) : ''

                return (
                  <div
                    key={idx}
                    onClick={() => { if (!closed) openNewEvent(day) }}
                    title={closed ? reason : undefined}
                    className={`border-r border-b min-h-[96px] p-1.5 transition-colors flex flex-col gap-0.5 ${
                      closed ? 'bg-muted/40 cursor-not-allowed' : 'cursor-pointer hover:bg-accent/30'
                    } ${!isCurrentMonth ? 'bg-muted/30' : ''}`}
                  >
                    <div className="flex justify-end mb-1">
                      <span className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-primary text-primary-foreground' : isCurrentMonth ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {day.getDate()}
                      </span>
                    </div>
                    {closed && <p className="text-[10px] leading-tight text-muted-foreground truncate" title={reason}>{reason}</p>}
                    {(blocksByDay[dayStr] ?? []).map((b) => (
                      <button key={b.id} onClick={(e) => { e.stopPropagation(); if (window.confirm('Remover este bloqueio de agenda?')) deleteBlock.mutate(b.id) }} className="w-full text-left rounded px-1 py-0.5 text-xs truncate block bg-muted text-muted-foreground hover:bg-muted/70 transition-colors" title={`Bloqueado — clique para remover`}>
                        <Lock className="h-2.5 w-2.5 inline mr-1 opacity-70" />
                        <span className="mr-1">{formatTime(b.startAt)}</span>{b.title ?? 'Bloqueado'}
                      </button>
                    ))}
                    {shown.map((ev) => {
                      const colorHex = multiOwner ? (ownerColor[ev.ownerId ?? ''] ?? '#6366f1') : (ev.color ? GOOGLE_COLORS[ev.color] : null)
                      return (
                        <button key={ev.id} onClick={(e) => { e.stopPropagation(); setSelectedEvent(ev) }} className="w-full text-left rounded px-1 py-0.5 text-xs truncate flex items-center gap-1 transition-colors hover:opacity-80" style={colorHex ? { backgroundColor: `${colorHex}22`, borderLeft: `3px solid ${colorHex}` } : undefined} title={ev.title}>
                          <span className={`truncate ${!colorHex ? 'bg-primary/10 text-primary px-1 rounded' : ''}`} style={colorHex ? { color: colorHex } : undefined}>
                            <span className="text-muted-foreground mr-1">{ev.allDay ? '◆' : formatTime(ev.startAt)}</span>
                            {ev.title}
                            {ev.meetLink && <Video className="h-2.5 w-2.5 inline ml-1 opacity-60" />}
                          </span>
                        </button>
                      )
                    })}
                    {overflow > 0 && <p className="text-xs text-muted-foreground pl-1">+{overflow} mais</p>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {(view === 'week' || view === 'day') && (() => {
          const hours = Array.from({ length: 24 }, (_, i) => i)
          const startDate = new Date(from)
          const daysCount = view === 'week' ? 7 : 1
          const days = Array.from({ length: daysCount }, (_, i) => {
            const d = new Date(startDate)
            d.setDate(d.getDate() + i)
            return d
          })

          const getEventStyles = (event: CalendarEvent, allEventsInDay: CalendarEvent[]) => {
            const s = new Date(event.startAt)
            const e = new Date(event.endAt)
            const startMin = s.getHours() * 60 + s.getMinutes()
            let endMin = e.getHours() * 60 + e.getMinutes()
            if (endMin <= startMin) endMin = startMin + 30 
            
            const top = (startMin / 1440) * 100
            const height = ((endMin - startMin) / 1440) * 100

            const overlaps = allEventsInDay.filter(ev => {
              if (ev.allDay) return false
              const evS = new Date(ev.startAt)
              const evE = new Date(ev.endAt)
              const evStart = evS.getHours() * 60 + evS.getMinutes()
              let evEnd = evE.getHours() * 60 + evE.getMinutes()
              if (evEnd <= evStart) evEnd = evStart + 30
              return (startMin < evEnd && endMin > evStart)
            })
            
            const overlapIndex = overlaps.findIndex(ev => ev.id === event.id)
            const width = 100 / Math.max(1, overlaps.length)
            const left = overlapIndex * width

            return { top: `${top}%`, height: `${height}%`, left: `${left}%`, width: `${width}%` }
          }

          return (
            <div className="flex-1 flex flex-col min-w-[640px] overflow-hidden border rounded-md bg-background">
              {/* Header */}
              <div className="flex border-b shrink-0 bg-muted/20">
                <div className="w-16 border-r shrink-0"></div>
                <div className={`flex-1 grid ${view === 'week' ? 'grid-cols-7' : 'grid-cols-1'}`}>
                  {days.map((day, i) => {
                    const isToday = toLocalDateStr(day) === todayStr
                    return (
                      <div key={i} className={`text-center py-2 border-r last:border-r-0 ${isToday ? 'bg-primary/5' : ''}`}>
                        <div className="text-xs text-muted-foreground font-medium">{DAY_NAMES[day.getDay()]}</div>
                        <div className={`text-lg mt-0.5 flex justify-center items-center`}>
                          <span className={`w-8 h-8 flex items-center justify-center rounded-full ${isToday ? 'bg-primary text-primary-foreground font-bold' : 'font-semibold'}`}>
                            {day.getDate()}
                          </span>
                        </div>
                        {isDayClosed(day) && (
                          <div className="text-[10px] text-muted-foreground px-1 truncate mt-1" title={closedReason(day)}>
                            {closedReason(day)}
                          </div>
                        )}
                        {/* All-day events */}
                        <div className="mt-1 flex flex-col gap-1 px-1">
                          {(eventsByDay[toLocalDateStr(day)] ?? []).filter(e => e.allDay).map(ev => {
                            const colorHex = multiOwner ? (ownerColor[ev.ownerId ?? ''] ?? '#6366f1') : (ev.color ? GOOGLE_COLORS[ev.color] : null)
                            return (
                              <button key={ev.id} onClick={(e) => { e.stopPropagation(); setSelectedEvent(ev) }} className="text-left text-[10px] px-1.5 py-0.5 rounded truncate text-white" style={{ backgroundColor: colorHex ?? 'var(--primary)' }}>
                                {ev.title}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
              {/* Body */}
              <div className="flex-1 overflow-y-auto relative">
                <div className="flex min-h-[1440px]">
                  {/* Time labels */}
                  <div className="w-16 border-r shrink-0 flex flex-col relative bg-muted/10">
                    {hours.map(h => (
                      <div key={h} className="flex-1 border-b relative">
                        <span className="absolute -top-3 right-2 text-xs text-muted-foreground bg-muted/10 px-1 rounded-sm">
                          {pad(h)}:00
                        </span>
                      </div>
                    ))}
                  </div>
                  {/* Day columns */}
                  <div className={`flex-1 grid ${view === 'week' ? 'grid-cols-7' : 'grid-cols-1'}`}>
                    {days.map((day, i) => {
                      const dayStr = toLocalDateStr(day)
                      const isToday = dayStr === todayStr
                      const closed = isDayClosed(day)
                      const dayEvents = (eventsByDay[dayStr] ?? []).filter(e => !e.allDay)
                      const dayBlocks = blocksByDay[dayStr] ?? []

                      return (
                        <div
                          key={i}
                          className={`border-r last:border-r-0 relative ${closed ? 'bg-muted/20 cursor-not-allowed' : 'hover:bg-accent/10 cursor-pointer'} ${isToday && !closed ? 'bg-primary/[0.02]' : ''}`}
                          onClick={(e) => {
                            if (closed) return;
                            openNewEvent(day)
                          }}
                        >
                          {/* Hour lines */}
                          {hours.map(h => (
                            <div key={h} className="h-[60px] border-b pointer-events-none" />
                          ))}

                          {/* Blocks */}
                          {dayBlocks.map(b => {
                            const s = new Date(b.startAt)
                            const e = new Date(b.endAt)
                            const startMin = s.getHours() * 60 + s.getMinutes()
                            const endMin = e.getHours() * 60 + e.getMinutes()
                            const top = (startMin / 1440) * 100
                            const height = ((endMin - startMin) / 1440) * 100
                            return (
                              <div
                                key={b.id}
                                className="absolute left-0 right-0 pointer-events-auto cursor-pointer"
                                style={{
                                  top: `${top}%`, height: `${height}%`,
                                  backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.05) 10px, rgba(0,0,0,0.05) 20px)'
                                }}
                                onClick={(e) => { e.stopPropagation(); if (window.confirm('Remover este bloqueio?')) deleteBlock.mutate(b.id) }}
                              >
                                <div className="text-[10px] font-medium p-1 text-muted-foreground bg-background/80 m-1 rounded"><Lock className="w-2.5 h-2.5 inline mr-1" />{b.title || 'Bloqueado'}</div>
                              </div>
                            )
                          })}

                          {/* Events */}
                          {dayEvents.map(ev => {
                            const style = getEventStyles(ev, dayEvents)
                            const colorHex = multiOwner ? (ownerColor[ev.ownerId ?? ''] ?? '#6366f1') : (ev.color ? GOOGLE_COLORS[ev.color] : null)
                            const isDark = false // You can make text dark/light depending on colorHex if needed
                            
                            return (
                              <div
                                key={ev.id}
                                className="absolute p-[1px] pointer-events-auto"
                                style={style}
                              >
                                <button
                                  onClick={(e) => { e.stopPropagation(); setSelectedEvent(ev) }}
                                  className="w-full h-full rounded text-left px-1.5 py-1 text-xs overflow-hidden shadow-sm transition-all hover:brightness-95 border"
                                  style={{ 
                                    backgroundColor: colorHex ? `${colorHex}22` : 'var(--primary-10)', 
                                    borderColor: colorHex ?? 'transparent', 
                                    color: colorHex ?? 'var(--primary)' 
                                  }}
                                  title={ev.title}
                                >
                                  <div className="font-semibold truncate">{ev.title} {ev.meetLink && <Video className="h-2.5 w-2.5 inline ml-0.5 opacity-60" />}</div>
                                  <div className="text-[10px] opacity-80 leading-tight">{formatTime(ev.startAt)} - {formatTime(ev.endAt)}</div>
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )
        })()}
      </div>

      {/* ── Modals / Sheets ── */}
      <NewEventModal
        open={newEventOpen}
        defaultDate={newEventDate}
        accounts={accounts}
        users={users}
        currentUserId={currentUserId}
        canCreateForOthers={canCreateForOthers}
        onClose={() => setNewEventOpen(false)}
        onCreated={invalidateEvents}
      />

      <BlockModal
        open={blockModalOpen}
        defaultDate={blockDate}
        userId={currentUserId}
        onClose={() => setBlockModalOpen(false)}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ['schedule-blocks'] })
          queryClient.invalidateQueries({ queryKey: ['free-intervals'] })
        }}
      />

      <EventDetailSheet
        event={selectedEvent}
        currentUserId={currentUserId}
        canCancelOthers={canCancelOthers}
        users={users}
        onClose={() => setSelectedEvent(null)}
        onDeleted={invalidateEvents}
      />
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { usePermission } from '@/lib/usePermission'
import { useAuthStore } from '@/store/auth'
import { toast } from 'sonner'
import { ArrowLeft, Plus, Trash2, Save } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface HoursRow {
  weekday: number
  startMin: number
  endMin: number
  isActive?: boolean
}

interface Holiday {
  id: string
  date: string
  name: string
  closed: boolean
  startMin?: number | null
  endMin?: number | null
}

interface WorkspaceUser {
  id: string
  name: string | null
  email: string
}

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

function minToTime(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

// ─── Editor de grade semanal (reutilizado por usuário e empresa) ────────────────

function WeeklyHoursEditor({
  rows,
  onSave,
  saving,
}: {
  rows: HoursRow[]
  onSave: (rows: HoursRow[]) => void
  saving: boolean
}) {
  const [draft, setDraft] = useState<HoursRow[]>(rows)

  useEffect(() => {
    setDraft(rows)
  }, [rows])

  function addRow(weekday: number) {
    setDraft((d) => [...d, { weekday, startMin: 480, endMin: 720, isActive: true }])
  }
  function removeRow(idx: number) {
    setDraft((d) => d.filter((_, i) => i !== idx))
  }
  function updateRow(idx: number, patch: Partial<HoursRow>) {
    setDraft((d) => d.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  return (
    <div className="space-y-3">
      {WEEKDAYS.map((label, wd) => {
        const dayRows = draft.map((r, i) => ({ r, i })).filter((x) => x.r.weekday === wd)
        return (
          <div key={wd} className="flex items-start gap-3 border-b pb-2">
            <div className="w-24 pt-2 text-sm font-medium">{label}</div>
            <div className="flex-1 space-y-1.5">
              {dayRows.length === 0 && <p className="text-xs text-muted-foreground pt-2">Fechado</p>}
              {dayRows.map(({ r, i }) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="time"
                    value={minToTime(r.startMin)}
                    onChange={(e) => updateRow(i, { startMin: timeToMin(e.target.value) })}
                    className="rounded-md border bg-background px-2 py-1 text-sm"
                  />
                  <span className="text-muted-foreground">até</span>
                  <input
                    type="time"
                    value={minToTime(r.endMin)}
                    onChange={(e) => updateRow(i, { endMin: timeToMin(e.target.value) })}
                    className="rounded-md border bg-background px-2 py-1 text-sm"
                  />
                  <button onClick={() => removeRow(i)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => addRow(wd)}
              className="mt-1 flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
            >
              <Plus className="h-3 w-3" /> intervalo
            </button>
          </div>
        )
      })}
      <button
        onClick={() => onSave(draft)}
        disabled={saving}
        className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        <Save className="h-4 w-4" />
        {saving ? 'Salvando...' : 'Salvar'}
      </button>
    </div>
  )
}

// ─── Página ─────────────────────────────────────────────────────────────────

export default function CalendarSettingsPage() {
  const queryClient = useQueryClient()
  const currentUserId = useAuthStore((s) => s.user?.sub ?? '')
  const canManageWorkingHours = usePermission('calendar.manageWorkingHours')
  const canManageCompanyHours = usePermission('calendar.manageCompanyHours')

  const [targetUserId, setTargetUserId] = useState(currentUserId)

  useEffect(() => {
    if (currentUserId && !targetUserId) setTargetUserId(currentUserId)
  }, [currentUserId, targetUserId])

  const { data: users = [] } = useQuery<WorkspaceUser[]>({
    queryKey: ['workspace-users'],
    queryFn: () => apiFetch<WorkspaceUser[]>('/users'),
    enabled: canManageWorkingHours,
  })

  // Working hours
  const { data: workingHours = [] } = useQuery<HoursRow[]>({
    queryKey: ['working-hours', targetUserId],
    queryFn: () => apiFetch<HoursRow[]>(`/calendar/working-hours/${targetUserId}`),
    enabled: !!targetUserId,
  })
  const saveWorking = useMutation({
    mutationFn: (rows: HoursRow[]) =>
      apiFetch(`/calendar/working-hours/${targetUserId}`, { method: 'PUT', body: JSON.stringify({ rows }) }),
    onSuccess: () => {
      toast.success('Horário de trabalho salvo')
      queryClient.invalidateQueries({ queryKey: ['working-hours', targetUserId] })
    },
    onError: (e: Error) => toast.error(e.message ?? 'Erro ao salvar'),
  })

  // Company hours
  const { data: companyHours = [] } = useQuery<HoursRow[]>({
    queryKey: ['company-hours'],
    queryFn: () => apiFetch<HoursRow[]>('/calendar/company-hours'),
  })
  const saveCompany = useMutation({
    mutationFn: (rows: HoursRow[]) =>
      apiFetch('/calendar/company-hours', { method: 'PUT', body: JSON.stringify({ rows }) }),
    onSuccess: () => {
      toast.success('Horário da empresa salvo')
      queryClient.invalidateQueries({ queryKey: ['company-hours'] })
    },
    onError: (e: Error) => toast.error(e.message ?? 'Erro ao salvar'),
  })

  // Holidays
  const { data: holidays = [] } = useQuery<Holiday[]>({
    queryKey: ['holidays'],
    queryFn: () => apiFetch<Holiday[]>('/calendar/holidays'),
  })
  const [newHolidayDate, setNewHolidayDate] = useState('')
  const [newHolidayName, setNewHolidayName] = useState('')
  const addHoliday = useMutation({
    mutationFn: () =>
      apiFetch('/calendar/holidays', {
        method: 'POST',
        body: JSON.stringify({ date: newHolidayDate, name: newHolidayName, closed: true }),
      }),
    onSuccess: () => {
      toast.success('Feriado adicionado')
      setNewHolidayDate('')
      setNewHolidayName('')
      queryClient.invalidateQueries({ queryKey: ['holidays'] })
    },
    onError: (e: Error) => toast.error(e.message ?? 'Erro ao adicionar'),
  })
  const delHoliday = useMutation({
    mutationFn: (id: string) => apiFetch(`/calendar/holidays/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Feriado removido')
      queryClient.invalidateQueries({ queryKey: ['holidays'] })
    },
    onError: (e: Error) => toast.error(e.message ?? 'Erro ao remover'),
  })

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="flex items-center gap-3 px-6 py-4 border-b shrink-0">
        <Link href="/calendar" className="rounded-md border p-1.5 hover:bg-accent">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-lg font-semibold">Configurações de agenda</h1>
      </div>

      <div className="p-6 space-y-10 max-w-3xl">
        {/* Horário de trabalho */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">Horário de trabalho</h2>
            {canManageWorkingHours && users.length > 0 && (
              <select
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                className="rounded-md border bg-background px-3 py-1.5 text-sm"
              >
                <option value={currentUserId}>Meu horário</option>
                {users
                  .filter((u) => u.id !== currentUserId)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name ?? u.email}
                    </option>
                  ))}
              </select>
            )}
          </div>
          <WeeklyHoursEditor rows={workingHours} onSave={(r) => saveWorking.mutate(r)} saving={saveWorking.isPending} />
        </section>

        {/* Horário da empresa */}
        {canManageCompanyHours && (
          <section>
            <h2 className="text-base font-semibold mb-4">Horário de funcionamento da empresa</h2>
            <WeeklyHoursEditor rows={companyHours} onSave={(r) => saveCompany.mutate(r)} saving={saveCompany.isPending} />
          </section>
        )}

        {/* Feriados */}
        {canManageCompanyHours && (
          <section>
            <h2 className="text-base font-semibold mb-4">Feriados e datas especiais</h2>
            <div className="space-y-2 mb-4">
              {holidays.length === 0 && <p className="text-sm text-muted-foreground">Nenhum feriado cadastrado.</p>}
              {holidays.map((h) => (
                <div key={h.id} className="flex items-center gap-3 border rounded-md px-3 py-2 text-sm">
                  <span className="font-medium">{new Date(h.date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</span>
                  <span className="flex-1">{h.name}</span>
                  <span className="text-xs text-muted-foreground">{h.closed ? 'Fechado' : 'Horário especial'}</span>
                  <button onClick={() => delHoliday.mutate(h.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <div>
                <label className="text-xs">Data</label>
                <input
                  type="date"
                  value={newHolidayDate}
                  onChange={(e) => setNewHolidayDate(e.target.value)}
                  className="mt-1 block rounded-md border bg-background px-3 py-1.5 text-sm"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs">Nome</label>
                <input
                  value={newHolidayName}
                  onChange={(e) => setNewHolidayName(e.target.value)}
                  placeholder="Ex: Natal"
                  className="mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm"
                />
              </div>
              <button
                onClick={() => addHoliday.mutate()}
                disabled={!newHolidayDate || !newHolidayName.trim() || addHoliday.isPending}
                className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> Adicionar
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

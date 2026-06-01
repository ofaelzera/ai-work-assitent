'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2, Save } from 'lucide-react'

export interface HoursRow {
  weekday: number
  startMin: number
  endMin: number
  isActive?: boolean
}

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

export function minToTime(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Editor de grade semanal de horários (07 dias × N intervalos). */
export function WeeklyHoursEditor({
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
    const next = draft.filter((_, i) => i !== idx)
    setDraft(next)
    // Remoção é destrutiva e o usuário espera efeito imediato → persiste já.
    onSave(next)
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

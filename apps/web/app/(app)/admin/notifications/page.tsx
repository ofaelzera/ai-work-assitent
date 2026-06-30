'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Bell, Play, Trash2, Upload, Save } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { getAccessToken } from '@/lib/api'
import { getApiUrl } from '@/lib/runtime-config'
import { cn } from '@/lib/utils'

type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

interface EventDef {
  key: string
  category: string
  defaultPriority: Priority
  temporal: boolean
  label: string
  description: string
}
interface Rule {
  eventType: string
  enabled: boolean
  leadTimeMinutes: number | null
  channels: string[]
  recipientContactIds: string[] | null
  externalChannelId: string | null
  soundId: string | null
  priority: Priority
  dndStart: string | null
  dndEnd: string | null
  dndWeekdays: number[] | null
}
interface Sound {
  id: string
  label: string
  category: string | null
  mimeType: string
}
interface Channel {
  id: string
  type: string
  label: string
}
interface Contact {
  id: string
  name: string | null
  phone: string | null
  email: string | null
}

const CHANNEL_LABELS: Record<string, string> = { in_app: 'No sistema', email: 'E-mail', whatsapp: 'WhatsApp' }
const LEAD_OPTIONS = [
  { v: 0, l: 'No horário' },
  { v: 5, l: '5 min antes' },
  { v: 15, l: '15 min antes' },
  { v: 30, l: '30 min antes' },
  { v: 60, l: '1 hora antes' },
  { v: 1440, l: '1 dia antes' },
]

function defaultRule(ev: EventDef): Rule {
  return {
    eventType: ev.key,
    enabled: true,
    leadTimeMinutes: ev.temporal ? (ev.category === 'calendar' ? 15 : 60) : null,
    channels: ['in_app'],
    recipientContactIds: [],
    externalChannelId: null,
    soundId: null,
    priority: ev.defaultPriority,
    dndStart: null,
    dndEnd: null,
    dndWeekdays: null,
  }
}

export default function NotificationsAdminPage() {
  const qc = useQueryClient()

  const { data: catalog } = useQuery({
    queryKey: ['notif-catalog'],
    queryFn: () => apiFetch<{ events: EventDef[]; channels: string[] }>('/notifications/catalog'),
  })
  const { data: rules } = useQuery({
    queryKey: ['notif-rules'],
    queryFn: () => apiFetch<Rule[]>('/notifications/rules'),
  })
  const { data: sounds } = useQuery({
    queryKey: ['notif-sounds'],
    queryFn: () => apiFetch<Sound[]>('/notifications/sounds'),
  })
  const { data: channels } = useQuery({
    queryKey: ['channels'],
    queryFn: () => apiFetch<Channel[]>('/channels'),
  })

  const ruleByType = useMemo(() => {
    const m = new Map<string, Rule>()
    for (const r of rules ?? []) m.set(r.eventType, r)
    return m
  }, [rules])

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Bell className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Notificações</h1>
          <p className="text-sm text-muted-foreground">
            Configure como cada tipo de evento alerta os usuários e os canais de entrega.
          </p>
        </div>
      </header>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Regras por evento</h2>
        {(catalog?.events ?? []).map((ev) => (
          <RuleCard
            key={ev.key}
            ev={ev}
            rule={ruleByType.get(ev.key) ?? defaultRule(ev)}
            sounds={sounds ?? []}
            channels={channels ?? []}
            onSaved={() => qc.invalidateQueries({ queryKey: ['notif-rules'] })}
          />
        ))}
      </section>

      <SoundGallery sounds={sounds ?? []} onChanged={() => qc.invalidateQueries({ queryKey: ['notif-sounds'] })} />
    </div>
  )
}

function RuleCard({
  ev,
  rule,
  sounds,
  channels,
  onSaved,
}: {
  ev: EventDef
  rule: Rule
  sounds: Sound[]
  channels: Channel[]
  onSaved: () => void
}) {
  const [draft, setDraft] = useState<Rule>(rule)
  const [saving, setSaving] = useState(false)
  useEffect(() => setDraft(rule), [rule])

  const set = (patch: Partial<Rule>) => setDraft((d) => ({ ...d, ...patch }))
  const toggleChannel = (c: string) => {
    const has = draft.channels.includes(c)
    set({ channels: has ? draft.channels.filter((x) => x !== c) : [...draft.channels, c] })
  }

  const hasExternal = draft.channels.some((c) => c !== 'in_app')

  const save = async () => {
    setSaving(true)
    try {
      await apiFetch(`/notifications/rules/${ev.key}`, {
        method: 'PUT',
        body: JSON.stringify({
          enabled: draft.enabled,
          leadTimeMinutes: ev.temporal ? draft.leadTimeMinutes : null,
          channels: draft.channels,
          recipientContactIds: draft.recipientContactIds ?? [],
          externalChannelId: draft.externalChannelId,
          soundId: draft.soundId,
          priority: draft.priority,
          dndStart: draft.dndStart,
          dndEnd: draft.dndEnd,
          dndWeekdays: draft.dndWeekdays,
        }),
      })
      toast.success(`Regra de "${ev.label}" salva`)
      onSaved()
    } catch (e: any) {
      toast.error(e?.message ?? 'Falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border bg-card/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={draft.enabled}
                onChange={(e) => set({ enabled: e.target.checked })}
              />
              <div className="h-5 w-9 rounded-full bg-muted peer-checked:bg-primary after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-4" />
            </label>
            <span className="text-[14px] font-semibold">{ev.label}</span>
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">{ev.description}</p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" /> Salvar
        </button>
      </div>

      {draft.enabled && (
        <div className="mt-4 grid gap-4 border-t pt-4 sm:grid-cols-2">
          {ev.temporal && (
            <Field label="Antecedência">
              <select
                className="input-base"
                value={draft.leadTimeMinutes ?? 0}
                onChange={(e) => set({ leadTimeMinutes: Number(e.target.value) })}
              >
                {LEAD_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.l}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Prioridade">
            <select
              className="input-base"
              value={draft.priority}
              onChange={(e) => set({ priority: e.target.value as Priority })}
            >
              <option value="LOW">Baixa</option>
              <option value="MEDIUM">Média</option>
              <option value="HIGH">Alta</option>
              <option value="CRITICAL">Crítica</option>
            </select>
          </Field>

          <Field label="Canais de entrega">
            <div className="flex flex-wrap gap-2">
              {['in_app', 'email', 'whatsapp'].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleChannel(c)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-[12px] transition-colors',
                    draft.channels.includes(c)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-accent/50',
                  )}
                >
                  {CHANNEL_LABELS[c]}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Som">
            <select
              className="input-base"
              value={draft.soundId ?? ''}
              onChange={(e) => set({ soundId: e.target.value || null })}
            >
              <option value="">Padrão (por categoria)</option>
              {sounds.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>

          {hasExternal && (
            <>
              <Field label="Canal externo (envio)">
                <select
                  className="input-base"
                  value={draft.externalChannelId ?? ''}
                  onChange={(e) => set({ externalChannelId: e.target.value || null })}
                >
                  <option value="">Resolver automaticamente</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} ({c.type})
                    </option>
                  ))}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Contatos a notificar (canais externos)">
                  <ContactPicker
                    selected={draft.recipientContactIds ?? []}
                    onChange={(ids) => set({ recipientContactIds: ids })}
                  />
                </Field>
              </div>
            </>
          )}

          <div className="sm:col-span-2">
            <Field label="Não perturbe (silencia som/toast e canais externos)">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="time"
                  className="input-base w-auto"
                  value={draft.dndStart ?? ''}
                  onChange={(e) => set({ dndStart: e.target.value || null })}
                />
                <span className="text-[12px] text-muted-foreground">até</span>
                <input
                  type="time"
                  className="input-base w-auto"
                  value={draft.dndEnd ?? ''}
                  onChange={(e) => set({ dndEnd: e.target.value || null })}
                />
              </div>
            </Field>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function ContactPicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState('')
  const { data } = useQuery({
    queryKey: ['notif-contact-search', q],
    queryFn: () => apiFetch<{ items: Contact[] }>(`/contacts?limit=8${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    enabled: q.length >= 2,
  })
  // Resolve rótulos dos já selecionados
  const { data: all } = useQuery({
    queryKey: ['notif-contact-resolve', selected.join(',')],
    queryFn: () => apiFetch<{ items: Contact[] }>(`/contacts?limit=50`),
    enabled: selected.length > 0,
  })
  const labelFor = (id: string) => {
    const c = (all?.items ?? []).find((x) => x.id === id)
    return c?.name || c?.phone || c?.email || id.slice(0, 6)
  }

  return (
    <div>
      <input
        className="input-base"
        placeholder="Buscar contato (mín. 2 letras)…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {q.length >= 2 && (data?.items?.length ?? 0) > 0 && (
        <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border bg-popover">
          {data!.items.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                if (!selected.includes(c.id)) onChange([...selected, c.id])
                setQ('')
              }}
              className="block w-full px-3 py-1.5 text-left text-[12px] hover:bg-accent"
            >
              {c.name || c.phone || c.email || c.id}
            </button>
          ))}
        </div>
      )}
      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <span key={id} className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
              {labelFor(id)}
              <button type="button" onClick={() => onChange(selected.filter((x) => x !== id))}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function SoundGallery({ sounds, onChanged }: { sounds: Sound[]; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [label, setLabel] = useState('')
  const [uploading, setUploading] = useState(false)

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('label', label || file.name)
      await apiFetch('/notifications/sounds', { method: 'POST', body: fd })
      toast.success('Som adicionado')
      setLabel('')
      if (fileRef.current) fileRef.current.value = ''
      onChanged()
    } catch (e: any) {
      toast.error(e?.message ?? 'Falha no upload')
    } finally {
      setUploading(false)
    }
  }

  const remove = async (id: string) => {
    try {
      await apiFetch(`/notifications/sounds/${id}`, { method: 'DELETE' })
      toast.success('Som removido')
      onChanged()
    } catch (e: any) {
      toast.error(e?.message ?? 'Falha ao remover')
    }
  }

  const preview = async (id: string) => {
    try {
      const token = getAccessToken()
      const res = await fetch(`${getApiUrl()}/notifications/sounds/${id}/audio`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      })
      if (!res.ok) return
      const url = URL.createObjectURL(await res.blob())
      await new Audio(url).play()
    } catch {
      /* ignora */
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Galeria de sons</h2>
      <div className="rounded-xl border bg-card/50 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Nome</span>
            <input className="input-base" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex: Sino suave" />
          </label>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void upload(f)
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-medium hover:bg-accent/50 disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" /> {uploading ? 'Enviando…' : 'Enviar áudio'}
          </button>
        </div>

        <div className="mt-4 divide-y">
          {sounds.length === 0 ? (
            <p className="py-4 text-[13px] text-muted-foreground">Nenhum som na galeria. Envie mp3/wav/ogg (máx 5 MB).</p>
          ) : (
            sounds.map((s) => (
              <div key={s.id} className="flex items-center justify-between py-2">
                <span className="text-[13px]">{s.label}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => preview(s.id)} className="rounded p-1.5 text-muted-foreground hover:bg-accent" title="Ouvir">
                    <Play className="h-4 w-4" />
                  </button>
                  <button onClick={() => remove(s.id)} className="rounded p-1.5 text-red-500 hover:bg-red-500/10" title="Remover">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}

'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { Plus, X, Send, Copy, Trash2, Pencil, BarChart3, Ban } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  Campaign, CampaignMetrics, BroadcastList, Channel, CommChannel,
  STATUS_COLORS, STATUS_LABELS, channelMatches,
} from './types'

const EMPTY = {
  name: '', description: '', channelType: 'WHATSAPP' as CommChannel,
  channelId: '', subject: '', body: '', listId: '', scheduledAt: '',
}

export function CampaignsTab() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [metricsFor, setMetricsFor] = useState<string | null>(null)

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => apiFetch<Campaign[]>('/comm/campaigns'),
  })
  const { data: lists = [] } = useQuery({
    queryKey: ['broadcast-lists'],
    queryFn: () => apiFetch<BroadcastList[]>('/comm/broadcast-lists'),
  })
  const { data: channels = [] } = useQuery({
    queryKey: ['channels'],
    queryFn: () => apiFetch<Channel[]>('/channels'),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['campaigns'] })

  const saveMutation = useMutation({
    mutationFn: (payload: any) =>
      editingId
        ? apiFetch(`/comm/campaigns/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : apiFetch('/comm/campaigns', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => { invalidate(); toast.success(editingId ? 'Campanha atualizada' : 'Campanha criada'); closeModal() },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao salvar'),
  })

  const actionMutation = useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: string; body?: any }) =>
      apiFetch(`/comm/campaigns/${id}/${action}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
    onSuccess: () => { invalidate() },
    onError: (e: any) => toast.error(e?.message ?? 'Erro na ação'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/comm/campaigns/${id}`, { method: 'DELETE' }),
    onSuccess: () => { invalidate(); toast.success('Campanha removida') },
    onError: () => toast.error('Erro ao remover'),
  })

  function openCreate() {
    setEditingId(null); setForm(EMPTY); setModalOpen(true)
  }
  function openEdit(c: Campaign) {
    setEditingId(c.id)
    setForm({
      name: c.name, description: c.description ?? '', channelType: c.channelType,
      channelId: c.channelId ?? '', subject: c.subject ?? '', body: c.body,
      listId: c.listId ?? '', scheduledAt: c.scheduledAt ? c.scheduledAt.slice(0, 16) : '',
    })
    setModalOpen(true)
  }
  function closeModal() { setModalOpen(false); setEditingId(null); setForm(EMPTY) }

  function submit() {
    if (!form.name.trim() || !form.body.trim()) { toast.error('Nome e mensagem são obrigatórios'); return }
    saveMutation.mutate({
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      channelType: form.channelType,
      channelId: form.channelId || null,
      subject: form.channelType === 'EMAIL' ? (form.subject.trim() || undefined) : undefined,
      body: form.body,
      listId: form.listId || null,
      scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
    })
  }

  async function dispatch(c: Campaign) {
    if (!c.listId) { toast.error('Vincule uma lista antes de disparar'); return }
    const scheduled = c.scheduledAt && new Date(c.scheduledAt) > new Date()
    const ok = await confirm({
      title: scheduled ? 'Agendar campanha?' : 'Disparar campanha agora?',
      message: scheduled
        ? `A campanha "${c.name}" será disparada em ${new Date(c.scheduledAt!).toLocaleString('pt-BR')}.`
        : `Os destinatários da lista vinculada receberão a mensagem imediatamente.`,
      type: scheduled ? 'info' : 'warning',
      confirmLabel: scheduled ? 'Agendar' : 'Disparar',
    })
    if (!ok) return
    actionMutation.mutate(
      { id: c.id, action: 'schedule', body: { scheduledAt: c.scheduledAt } },
      { onSuccess: () => toast.success(scheduled ? 'Campanha agendada' : 'Campanha disparada') },
    )
  }

  async function cancel(c: Campaign) {
    const ok = await confirm({ title: 'Cancelar campanha?', message: 'Mensagens ainda não enviadas serão canceladas.', type: 'danger', confirmLabel: 'Cancelar campanha' })
    if (!ok) return
    actionMutation.mutate({ id: c.id, action: 'cancel' }, { onSuccess: () => toast.success('Campanha cancelada') })
  }

  async function remove(c: Campaign) {
    const ok = await confirm({ title: 'Remover campanha?', message: `"${c.name}" e seu histórico serão excluídos.`, type: 'danger', confirmLabel: 'Remover' })
    if (ok) deleteMutation.mutate(c.id)
  }

  const compatChannels = channels.filter((ch) => channelMatches(form.channelType, ch.type))

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={openCreate} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
          <Plus className="h-4 w-4" /> Nova campanha
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : campaigns.length === 0 ? (
        <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
          Nenhuma campanha ainda. Crie a primeira para começar a enviar em massa.
        </div>
      ) : (
        <div className="rounded-xl border bg-card divide-y">
          {campaigns.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm truncate">{c.name}</p>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_COLORS[c.status])}>{STATUS_LABELS[c.status]}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {c.channelType === 'WHATSAPP' ? 'WhatsApp' : 'E-mail'}
                  {c.list ? ` · Lista: ${c.list.name}` : ' · sem lista'}
                  {c._count ? ` · ${c._count.messages} msgs` : ''}
                  {c.scheduledAt ? ` · ${new Date(c.scheduledAt).toLocaleString('pt-BR')}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <IconBtn title="Métricas" onClick={() => setMetricsFor(c.id)}><BarChart3 className="h-4 w-4" /></IconBtn>
                {['DRAFT', 'SCHEDULED'].includes(c.status) && (
                  <IconBtn title="Disparar" onClick={() => dispatch(c)}><Send className="h-4 w-4 text-primary" /></IconBtn>
                )}
                {['DRAFT', 'SCHEDULED'].includes(c.status) && (
                  <IconBtn title="Editar" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></IconBtn>
                )}
                <IconBtn title="Duplicar" onClick={() => actionMutation.mutate({ id: c.id, action: 'duplicate' }, { onSuccess: () => toast.success('Campanha duplicada') })}><Copy className="h-4 w-4" /></IconBtn>
                {['RUNNING', 'SCHEDULED'].includes(c.status) && (
                  <IconBtn title="Cancelar" onClick={() => cancel(c)}><Ban className="h-4 w-4 text-amber-600" /></IconBtn>
                )}
                <IconBtn title="Remover" onClick={() => remove(c)}><Trash2 className="h-4 w-4 text-destructive" /></IconBtn>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <Modal onClose={closeModal} title={editingId ? 'Editar campanha' : 'Nova campanha'}>
          <div className="space-y-4">
            <Field label="Nome" required>
              <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className={inputCls} placeholder="Promoção de junho" />
            </Field>
            <Field label="Descrição">
              <input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Canal" required>
                <select value={form.channelType} onChange={(e) => setForm((p) => ({ ...p, channelType: e.target.value as CommChannel, channelId: '' }))} className={inputCls}>
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="EMAIL">E-mail</option>
                </select>
              </Field>
              <Field label="Conexão (opcional)">
                <select value={form.channelId} onChange={(e) => setForm((p) => ({ ...p, channelId: e.target.value }))} className={inputCls}>
                  <option value="">Automático (1ª conectada)</option>
                  {compatChannels.map((ch) => <option key={ch.id} value={ch.id}>{ch.label} ({ch.status})</option>)}
                </select>
              </Field>
            </div>
            {form.channelType === 'EMAIL' && (
              <Field label="Assunto">
                <input value={form.subject} onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))} className={inputCls} />
              </Field>
            )}
            <Field label="Mensagem" required>
              <textarea value={form.body} onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))} rows={5} className={inputCls} placeholder="Conteúdo da campanha…" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Lista de transmissão">
                <select value={form.listId} onChange={(e) => setForm((p) => ({ ...p, listId: e.target.value }))} className={inputCls}>
                  <option value="">Selecione…</option>
                  {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l._count?.members ?? 0})</option>)}
                </select>
              </Field>
              <Field label="Agendar para (opcional)">
                <input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm((p) => ({ ...p, scheduledAt: e.target.value }))} className={inputCls} />
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button onClick={closeModal} className="px-4 py-2 rounded-lg border text-sm">Cancelar</button>
            <button onClick={submit} disabled={saveMutation.isPending} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
              {editingId ? 'Salvar' : 'Criar'}
            </button>
          </div>
        </Modal>
      )}

      {metricsFor && <MetricsModal campaignId={metricsFor} onClose={() => setMetricsFor(null)} />}
    </div>
  )
}

function MetricsModal({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['campaign-metrics', campaignId],
    queryFn: () => apiFetch<CampaignMetrics>(`/comm/campaigns/${campaignId}/metrics`),
    refetchInterval: 5000,
  })
  return (
    <Modal onClose={onClose} title="Métricas da campanha">
      {isLoading || !data ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Destinatários" value={data.recipients} />
            <Stat label="Enviadas" value={data.sent} tone="emerald" />
            <Stat label="Pendentes" value={data.pending} tone="amber" />
            <Stat label="Falhas" value={data.failed} tone="red" />
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">Taxa de sucesso</p>
            <p className="text-2xl font-bold mt-1">{data.successRate}%</p>
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>Início: {data.startedAt ? new Date(data.startedAt).toLocaleString('pt-BR') : '—'}</p>
            <p>Término: {data.completedAt ? new Date(data.completedAt).toLocaleString('pt-BR') : '—'}</p>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ─── primitivos compartilhados ───────────────────────────────────────────────
export const inputCls = 'w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50'

export function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium">{label} {required && <span className="text-destructive">*</span>}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

export function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick} className="p-1.5 rounded-lg hover:bg-muted transition-colors">{children}</button>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border bg-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <p className="font-semibold">{title}</p>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted"><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'emerald' | 'amber' | 'red' }) {
  const toneCls = tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : tone === 'red' ? 'text-red-600' : ''
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-xl font-bold mt-0.5', toneCls)}>{value}</p>
    </div>
  )
}

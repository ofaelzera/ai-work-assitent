'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { RefreshCw, Ban, Plus, Paperclip, X, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CommMessage, CommStatus, Channel, CommChannel, STATUS_COLORS, STATUS_LABELS, channelMatches } from './types'
import { Modal, Field, inputCls, formatBytes } from './ui'
import { MessageField } from './MessageField'

const STATUSES: CommStatus[] = ['PENDING', 'SCHEDULED', 'PROCESSING', 'SENT', 'FAILED', 'CANCELED']

export function MessageQueue() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [composeOpen, setComposeOpen] = useState(false)

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['comm-messages', statusFilter],
    queryFn: () => apiFetch<CommMessage[]>(`/comm/messages${statusFilter ? `?status=${statusFilter}` : ''}`),
    refetchInterval: 4000,
  })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['comm-messages'] })

  const retryMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/comm/messages/${id}/retry`, { method: 'POST' }),
    onSuccess: () => { invalidate(); toast.success('Reenfileirada') },
    onError: (e: any) => toast.error(e?.message ?? 'Erro'),
  })
  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/comm/messages/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => { invalidate(); toast.success('Cancelada') },
    onError: (e: any) => toast.error(e?.message ?? 'Erro'),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 flex-wrap">
          <FilterChip active={statusFilter === ''} onClick={() => setStatusFilter('')}>Todas</FilterChip>
          {STATUSES.map((s) => (
            <FilterChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>{STATUS_LABELS[s]}</FilterChip>
          ))}
        </div>
        <button onClick={() => setComposeOpen(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium shrink-0">
          <Plus className="h-4 w-4" /> Envio avulso
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : messages.length === 0 ? (
        <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">Nenhuma mensagem na fila.</div>
      ) : (
        <div className="rounded-xl border bg-card divide-y">
          {messages.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium shrink-0', STATUS_COLORS[m.status])}>{STATUS_LABELS[m.status]}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">{m.to} <span className="text-muted-foreground">· {m.channelType === 'WHATSAPP' ? 'WhatsApp' : 'E-mail'}</span></p>
                <p className="text-xs text-muted-foreground truncate">
                  {m.source}{m.attempts > 0 ? ` · ${m.attempts} tentativa(s)` : ''}
                  {m.lastError ? ` · erro: ${m.lastError.slice(0, 80)}` : ''}
                  {m.scheduledAt ? ` · agendada ${new Date(m.scheduledAt).toLocaleString('pt-BR')}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {['FAILED', 'CANCELED'].includes(m.status) && (
                  <button title="Tentar de novo" onClick={() => retryMutation.mutate(m.id)} className="p-1.5 rounded-lg hover:bg-muted"><RefreshCw className="h-4 w-4 text-primary" /></button>
                )}
                {['PENDING', 'SCHEDULED'].includes(m.status) && (
                  <button title="Cancelar" onClick={() => cancelMutation.mutate(m.id)} className="p-1.5 rounded-lg hover:bg-muted"><Ban className="h-4 w-4 text-amber-600" /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {composeOpen && <ComposeModal onClose={() => { setComposeOpen(false); invalidate() }} />}
    </div>
  )
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '')
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function ComposeModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ channelType: 'WHATSAPP' as CommChannel, channelId: '', to: '', subject: '', body: '', scheduledAt: '' })
  const [files, setFiles] = useState<File[]>([])
  const { data: channels = [] } = useQuery({ queryKey: ['channels'], queryFn: () => apiFetch<Channel[]>('/channels') })

  const sendMutation = useMutation({
    mutationFn: async (payload: any) => apiFetch('/comm/messages', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => { toast.success('Mensagem enfileirada'); onClose() },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao enviar'),
  })

  async function submit() {
    if (!form.to.trim() || !form.body.trim()) { toast.error('Destinatário e mensagem são obrigatórios'); return }
    const attachments = await Promise.all(files.map(async (f) => ({
      tipo: 'base64' as const, nome: f.name, mime_type: f.type || 'application/octet-stream', arquivo: await fileToBase64(f),
    })))
    sendMutation.mutate({
      channelType: form.channelType,
      channelId: form.channelId || null,
      to: form.to.trim(),
      subject: form.channelType === 'EMAIL' ? (form.subject.trim() || undefined) : undefined,
      body: form.body,
      scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
      attachments: attachments.length > 0 ? attachments : undefined,
    })
  }

  const compat = channels.filter((ch) => channelMatches(form.channelType, ch.type))

  return (
    <Modal onClose={onClose} title="Envio avulso">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Canal" required>
            <select value={form.channelType} onChange={(e) => setForm((p) => ({ ...p, channelType: e.target.value as CommChannel, channelId: '' }))} className={inputCls}>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="EMAIL">E-mail</option>
            </select>
          </Field>
          <Field label="Conexão (opcional)">
            <select value={form.channelId} onChange={(e) => setForm((p) => ({ ...p, channelId: e.target.value }))} className={inputCls}>
              <option value="">Automático</option>
              {compat.map((ch) => <option key={ch.id} value={ch.id}>{ch.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label={form.channelType === 'WHATSAPP' ? 'Telefone (ex: 5511999999999)' : 'E-mail'} required>
          <input value={form.to} onChange={(e) => setForm((p) => ({ ...p, to: e.target.value }))} className={inputCls} />
        </Field>
        {form.channelType === 'EMAIL' && (
          <Field label="Assunto"><input value={form.subject} onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))} className={inputCls} /></Field>
        )}
        <Field label="Mensagem" required>
          <MessageField channelType={form.channelType} value={form.body} onChange={(v) => setForm((p) => ({ ...p, body: v }))} />
        </Field>
        <Field label="Anexos">
          <div className="space-y-2">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="truncate flex-1">{f.name}</span>
                <span className="text-xs text-muted-foreground">{formatBytes(f.size)}</span>
                <button type="button" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} className="p-1 rounded hover:bg-muted"><X className="h-4 w-4 text-muted-foreground" /></button>
              </div>
            ))}
            <label className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed cursor-pointer text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 w-fit">
              <Paperclip className="h-4 w-4" /> Adicionar anexo
              <input type="file" multiple className="hidden" onChange={(e) => { const fs = Array.from(e.target.files ?? []); setFiles((p) => [...p, ...fs]); e.target.value = '' }} />
            </label>
          </div>
        </Field>
        <Field label="Agendar para (opcional)">
          <input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm((p) => ({ ...p, scheduledAt: e.target.value }))} className={inputCls} />
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-6">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border text-sm">Cancelar</button>
        <button onClick={submit} disabled={sendMutation.isPending} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">Enviar</button>
      </div>
    </Modal>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn('px-3 py-1 rounded-full text-xs font-medium transition-colors', active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}>
      {children}
    </button>
  )
}

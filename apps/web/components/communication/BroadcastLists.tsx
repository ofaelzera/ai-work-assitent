'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { Plus, Trash2, Pencil, Users, Download, Upload, X, Search, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { BroadcastList, BroadcastListDetail, ListContact, CompanyRef } from './types'
import { Modal, Field, IconBtn, ContactAvatar, inputCls } from './ui'

export function BroadcastLists() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<BroadcastList | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })
  const [manageId, setManageId] = useState<string | null>(null)

  const { data: lists = [], isLoading } = useQuery({
    queryKey: ['broadcast-lists'],
    queryFn: () => apiFetch<BroadcastList[]>('/comm/broadcast-lists'),
  })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['broadcast-lists'] })

  const saveMutation = useMutation({
    mutationFn: (payload: { name: string; description?: string }) =>
      editing
        ? apiFetch(`/comm/broadcast-lists/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : apiFetch('/comm/broadcast-lists', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => { invalidate(); toast.success(editing ? 'Lista atualizada' : 'Lista criada'); close() },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao salvar'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/comm/broadcast-lists/${id}`, { method: 'DELETE' }),
    onSuccess: () => { invalidate(); toast.success('Lista removida') },
    onError: () => toast.error('Erro ao remover'),
  })

  function openCreate() { setCreating(true); setEditing(null); setForm({ name: '', description: '' }) }
  function openEdit(l: BroadcastList) { setEditing(l); setCreating(false); setForm({ name: l.name, description: l.description ?? '' }) }
  function close() { setCreating(false); setEditing(null); setForm({ name: '', description: '' }) }

  function submit() {
    if (!form.name.trim()) { toast.error('Nome obrigatório'); return }
    saveMutation.mutate({ name: form.name.trim(), description: form.description.trim() || undefined })
  }

  async function remove(l: BroadcastList) {
    const ok = await confirm({ title: 'Remover lista?', message: `"${l.name}" será excluída.`, type: 'danger', confirmLabel: 'Remover' })
    if (ok) deleteMutation.mutate(l.id)
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={openCreate} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
          <Plus className="h-4 w-4" /> Nova lista
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : lists.length === 0 ? (
        <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">Nenhuma lista de transmissão ainda.</div>
      ) : (
        <div className="rounded-xl border bg-card divide-y">
          {lists.map((l) => (
            <div key={l.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm truncate">{l.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {l._count?.members ?? 0} contatos · {l._count?.campaigns ?? 0} campanhas{l.description ? ` · ${l.description}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <IconBtn title="Gerenciar contatos" onClick={() => setManageId(l.id)}><Users className="h-4 w-4 text-primary" /></IconBtn>
                <IconBtn title="Editar" onClick={() => openEdit(l)}><Pencil className="h-4 w-4" /></IconBtn>
                <IconBtn title="Remover" onClick={() => remove(l)}><Trash2 className="h-4 w-4 text-destructive" /></IconBtn>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <Modal onClose={close} title={editing ? 'Editar lista' : 'Nova lista'}>
          <div className="space-y-4">
            <Field label="Nome" required>
              <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="Descrição">
              <input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} className={inputCls} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button onClick={close} className="px-4 py-2 rounded-lg border text-sm">Cancelar</button>
            <button onClick={submit} disabled={saveMutation.isPending} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
              {editing ? 'Salvar' : 'Criar'}
            </button>
          </div>
        </Modal>
      )}

      {manageId && <ManageMembersModal listId={manageId} onClose={() => { setManageId(null); invalidate() }} />}
    </div>
  )
}

type VerifiedFilter = 'all' | 'verified' | 'unverified'

function ManageMembersModal({ listId, onClose }: { listId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [verified, setVerified] = useState<VerifiedFilter>('all')
  const [showImport, setShowImport] = useState(false)
  const [csv, setCsv] = useState('')

  const { data: list, refetch } = useQuery({
    queryKey: ['broadcast-list', listId],
    queryFn: () => apiFetch<BroadcastListDetail>(`/comm/broadcast-lists/${listId}`),
  })
  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => apiFetch<CompanyRef[]>('/companies'),
  })

  const hasFilter = search.length >= 2 || !!companyId || verified !== 'all'
  const { data: searchResults = [] } = useQuery({
    queryKey: ['contacts-search', search, companyId, verified],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '30' })
      if (search.length >= 2) params.set('q', search)
      if (companyId) params.set('companyId', companyId)
      if (verified !== 'all') params.set('verified', verified)
      return apiFetch<{ items: ListContact[] }>(`/contacts?${params.toString()}`).then((r) => r.items ?? [])
    },
    enabled: hasFilter,
  })

  const addMutation = useMutation({
    mutationFn: (contactIds: string[]) => apiFetch(`/comm/broadcast-lists/${listId}/members`, { method: 'POST', body: JSON.stringify({ contactIds }) }),
    onSuccess: () => { refetch(); qc.invalidateQueries({ queryKey: ['broadcast-lists'] }); toast.success('Contato adicionado') },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao adicionar'),
  })
  const removeMutation = useMutation({
    mutationFn: (contactId: string) => apiFetch(`/comm/broadcast-lists/${listId}/members/${contactId}`, { method: 'DELETE' }),
    onSuccess: () => { refetch(); qc.invalidateQueries({ queryKey: ['broadcast-lists'] }) },
  })
  const importMutation = useMutation({
    mutationFn: () => apiFetch<{ added: number; skipped: number; notFound: string[] }>(`/comm/broadcast-lists/${listId}/import`, { method: 'POST', body: JSON.stringify({ csv }) }),
    onSuccess: (r) => { refetch(); qc.invalidateQueries({ queryKey: ['broadcast-lists'] }); toast.success(`${r.added} adicionados, ${r.skipped} já existiam, ${r.notFound.length} não encontrados`); setShowImport(false); setCsv('') },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao importar'),
  })

  const memberIds = new Set(list?.members.map((m) => m.contact.id))

  async function exportCsv() {
    try {
      const { filename, csv: text } = await apiFetch<{ filename: string; csv: string }>(`/comm/broadcast-lists/${listId}/export`)
      const blob = new Blob([text], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Erro ao exportar') }
  }

  return (
    <Modal onClose={onClose} title={`Contatos — ${list?.name ?? ''}`}>
      <div className="flex items-center gap-2 mb-3">
        <button onClick={() => setShowImport((s) => !s)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs"><Upload className="h-3.5 w-3.5" /> Importar CSV</button>
        <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs"><Download className="h-3.5 w-3.5" /> Exportar CSV</button>
      </div>

      {showImport && (
        <div className="rounded-lg border p-3 mb-3 space-y-2">
          <p className="text-xs text-muted-foreground">Cole linhas com telefone e/ou email. Só vincula contatos já cadastrados.</p>
          <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={4} className={inputCls} placeholder={'nome,telefone,email\nJoão,5511999999999,joao@email.com'} />
          <div className="flex justify-end">
            <button onClick={() => importMutation.mutate()} disabled={!csv.trim() || importMutation.isPending} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs disabled:opacity-50">Importar</button>
          </div>
        </div>
      )}

      <div className="relative mb-2">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar contato por nome, telefone ou email…" className={`${inputCls} pl-8`} />
      </div>
      <div className={cn('grid gap-2 mb-2', companies.length > 0 ? 'grid-cols-2' : 'grid-cols-1')}>
        {companies.length > 0 && (
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={inputCls}>
            <option value="">Todas as empresas</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <select value={verified} onChange={(e) => setVerified(e.target.value as VerifiedFilter)} className={inputCls}>
          <option value="all">Verificados e não verificados</option>
          <option value="verified">Só verificados</option>
          <option value="unverified">Só não verificados</option>
        </select>
      </div>

      {hasFilter && (
        <div className="rounded-lg border divide-y mb-3 max-h-48 overflow-y-auto">
          {searchResults.filter((c) => !memberIds.has(c.id)).map((c) => {
            const label = c.name ?? c.phone ?? c.email ?? 'Sem nome'
            return (
              <button key={c.id} onClick={() => addMutation.mutate([c.id])} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5 text-left">
                <ContactAvatar name={label} avatarUrl={c.metadata?.avatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate flex items-center gap-1.5">
                    {label}
                    {c.verified && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{c.phone ?? c.email ?? '—'}{c.company ? ` · ${c.company.name}` : ''}</p>
                </div>
                <Plus className="h-4 w-4 text-primary shrink-0" />
              </button>
            )
          })}
          {searchResults.filter((c) => !memberIds.has(c.id)).length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">Nenhum contato novo encontrado.</p>}
        </div>
      )}

      <p className="text-xs font-medium text-muted-foreground mb-1">{list?.members.length ?? 0} contatos na lista</p>
      <div className="rounded-lg border divide-y max-h-64 overflow-y-auto">
        {list?.members.map((m) => {
          const label = m.contact.name ?? m.contact.phone ?? m.contact.email ?? 'Sem nome'
          return (
            <div key={m.id} className="flex items-center gap-2.5 px-3 py-2">
              <ContactAvatar name={label} avatarUrl={m.contact.metadata?.avatarUrl} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate flex items-center gap-1.5">
                  {m.contact.name ?? 'Sem nome'}
                  {m.contact.verified && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                </p>
                <p className="text-xs text-muted-foreground truncate">{m.contact.phone ?? m.contact.email ?? '—'}{m.contact.company ? ` · ${m.contact.company.name}` : ''}</p>
              </div>
              <button onClick={() => removeMutation.mutate(m.contact.id)} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10"><X className="h-4 w-4 text-muted-foreground" /></button>
            </div>
          )
        })}
        {(list?.members.length ?? 0) === 0 && <p className="px-3 py-3 text-xs text-muted-foreground text-center">Lista vazia.</p>}
      </div>
    </Modal>
  )
}

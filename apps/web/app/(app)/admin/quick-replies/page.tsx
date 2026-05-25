'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { Zap, Plus, Trash2, Save, X, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AdminPageLayout } from '@/components/admin/AdminPageLayout'

interface QuickReply {
  id: string
  shortcut: string
  title: string | null
  body: string
  createdAt: string
}

const EMPTY_FORM = { shortcut: '', title: '', body: '' }

export default function QuickRepliesPage() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  const { data: replies = [], isLoading } = useQuery({
    queryKey: ['quick-replies'],
    queryFn: () => apiFetch<QuickReply[]>('/quick-replies'),
  })

  const createMutation = useMutation({
    mutationFn: (data: { shortcut: string; title?: string; body: string }) =>
      apiFetch<QuickReply>('/quick-replies', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quick-replies'] })
      toast.success('Resposta rápida criada')
      setShowForm(false)
      setForm(EMPTY_FORM)
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao criar'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<typeof EMPTY_FORM> }) =>
      apiFetch<QuickReply>(`/quick-replies/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quick-replies'] })
      toast.success('Resposta rápida atualizada')
      setEditingId(null)
      setForm(EMPTY_FORM)
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao atualizar'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/quick-replies/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quick-replies'] })
      toast.success('Removida')
    },
    onError: () => toast.error('Erro ao remover'),
  })

  const startEdit = (qr: QuickReply) => {
    setEditingId(qr.id)
    setForm({ shortcut: qr.shortcut, title: qr.title ?? '', body: qr.body })
    setShowForm(false)
  }

  const cancelForm = () => {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  const handleSubmit = () => {
    if (!form.shortcut.trim() || !form.body.trim()) {
      toast.error('Atalho e mensagem são obrigatórios')
      return
    }
    const payload = {
      shortcut: form.shortcut.trim().replace(/^\/+/, ''),
      title: form.title.trim() || undefined,
      body: form.body.trim(),
    }
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload })
    } else {
      createMutation.mutate(payload)
    }
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending

  return (
    <AdminPageLayout
      title="Respostas Rápidas"
      icon={Zap}
      description="Atalhos de texto disponíveis no inbox e chat — digite / para acessar"
      action={
        !showForm && !editingId ? (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
          >
            <Plus className="h-4 w-4" /> Nova resposta rápida
          </button>
        ) : null
      }
    >
      {(showForm || editingId) && (
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-sm">{editingId ? 'Editar resposta rápida' : 'Nova resposta rápida'}</p>
            <button onClick={cancelForm} className="p-1 rounded hover:bg-muted transition-colors">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium">Atalho <span className="text-destructive">*</span></label>
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="text-muted-foreground font-mono text-sm">/</span>
                <input
                  value={form.shortcut}
                  onChange={e => setForm(p => ({ ...p, shortcut: e.target.value.replace(/\s/g, '') }))}
                  placeholder="cumprimento"
                  className="flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Sem espaços. Ex: <code className="font-mono">/cumprimento</code></p>
            </div>

            <div>
              <label className="text-xs font-medium">Título <span className="text-muted-foreground">(opcional)</span></label>
              <input
                value={form.title}
                onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                placeholder="Nome de exibição no menu"
                className="mt-1.5 w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium">Mensagem <span className="text-destructive">*</span></label>
            <textarea
              value={form.body}
              onChange={e => setForm(p => ({ ...p, body: e.target.value }))}
              placeholder="Digite o texto completo da resposta..."
              rows={4}
              className="mt-1.5 w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Suporta variáveis: <code className="font-mono text-xs">{'{cliente}'}</code> <code className="font-mono text-xs">{'{atendente}'}</code> <code className="font-mono text-xs">{'{cnpj}'}</code> etc.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-1 border-t">
            <button
              onClick={cancelForm}
              className="px-4 py-2 rounded-lg border text-sm hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {isSubmitting ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Criar'}
            </button>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
          Carregando...
        </div>
      )}

      {!isLoading && replies.length === 0 && !showForm && (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center space-y-3">
          <Zap className="h-8 w-8 mx-auto text-muted-foreground/40" />
          <div>
            <p className="font-medium text-sm">Nenhuma resposta rápida</p>
            <p className="text-xs text-muted-foreground mt-1">
              Crie atalhos para agilizar o atendimento. No chat, digite <code className="font-mono">/</code> para ver as opções.
            </p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
          >
            <Plus className="h-4 w-4" /> Criar primeira resposta
          </button>
        </div>
      )}

      {!isLoading && replies.length > 0 && (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="grid grid-cols-[1fr_2fr_auto] text-xs font-medium text-muted-foreground uppercase tracking-wide px-4 py-2.5 bg-muted/30 border-b">
            <span>Atalho</span>
            <span>Mensagem</span>
            <span />
          </div>
          <div className="divide-y">
            {replies.map(qr => (
              <div key={qr.id} className={cn('grid grid-cols-[1fr_2fr_auto] items-start gap-4 px-4 py-3.5 hover:bg-muted/20 transition-colors', editingId === qr.id && 'bg-primary/5')}>
                <div>
                  <code className="text-sm font-mono font-semibold text-primary">/{qr.shortcut}</code>
                  {qr.title && <p className="text-xs text-muted-foreground mt-0.5">{qr.title}</p>}
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 whitespace-pre-wrap">{qr.body}</p>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => startEdit(qr)}
                    className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                    title="Editar"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Remover /${qr.shortcut}?`)) deleteMutation.mutate(qr.id)
                    }}
                    className="p-1.5 rounded-md hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                    title="Remover"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </AdminPageLayout>
  )
}

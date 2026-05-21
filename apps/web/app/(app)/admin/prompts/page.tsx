'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { BookOpen, Plus, Trash2, Copy, Save, X, Tag } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Prompt {
  id: string
  name: string
  body: string
  version: number
  tags: string[] | null
  createdAt: string
  updatedAt: string
}

const DEFAULT_FORM = { name: '', body: '', tags: '' }

function TagBadge({ tag }: { tag: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-medium">
      <Tag className="h-2.5 w-2.5" />
      {tag}
    </span>
  )
}

export default function PromptsPage() {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState(DEFAULT_FORM)

  const { data: prompts = [], isLoading, error } = useQuery({
    queryKey: ['prompts'],
    queryFn: () => apiFetch<Prompt[]>('/ai/prompts'),
    retry: false,
  })

  const selectedPrompt = prompts.find(p => p.id === selectedId) ?? null

  const createMutation = useMutation({
    mutationFn: (data: { name: string; body: string; tags?: string[] }) =>
      apiFetch<Prompt>('/ai/prompts', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: ['prompts'] })
      setIsNew(false)
      setSelectedId(p.id)
      setForm({ name: p.name, body: p.body, tags: (p.tags ?? []).join(', ') })
      toast.success('Prompt criado!')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao criar prompt'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; body?: string; tags?: string[] } }) =>
      apiFetch<Prompt>(`/ai/prompts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompts'] })
      toast.success('Prompt salvo!')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao salvar prompt'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/ai/prompts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompts'] })
      setSelectedId(null)
      setIsNew(false)
      toast.success('Prompt removido')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao remover prompt'),
  })

  const parseTags = (raw: string): string[] =>
    raw.split(',').map(t => t.trim()).filter(Boolean)

  const handleSelect = (p: Prompt) => {
    setIsNew(false)
    setSelectedId(p.id)
    setForm({ name: p.name, body: p.body, tags: (p.tags ?? []).join(', ') })
  }

  const handleNew = () => {
    setIsNew(true)
    setSelectedId(null)
    setForm(DEFAULT_FORM)
  }

  const handleSave = () => {
    const tags = parseTags(form.tags)
    if (isNew) {
      if (!form.name || !form.body) { toast.error('Nome e corpo são obrigatórios'); return }
      createMutation.mutate({ name: form.name, body: form.body, tags: tags.length ? tags : undefined })
    } else if (selectedPrompt) {
      updateMutation.mutate({ id: selectedPrompt.id, data: { name: form.name, body: form.body, tags } })
    }
  }

  const handleDuplicate = () => {
    if (!selectedPrompt) return
    createMutation.mutate({
      name: `${selectedPrompt.name} (cópia)`,
      body: selectedPrompt.body,
      tags: selectedPrompt.tags ?? undefined,
    })
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  const showEditor = isNew || selectedId !== null

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 border-r flex flex-col shrink-0">
        <div className="p-3 border-b flex items-center justify-between">
          <p className="text-sm font-semibold">Prompts</p>
          <button
            onClick={handleNew}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"
            title="Novo prompt"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {isLoading && <p className="px-2 py-3 text-xs text-muted-foreground">Carregando...</p>}

          {error && (
            <div className="px-2 py-3 text-xs text-muted-foreground text-center space-y-1">
              <BookOpen className="h-6 w-6 mx-auto opacity-40" />
              <p>Endpoint não disponível</p>
              <p className="text-[11px]">Adicione <code className="font-mono bg-muted px-1 rounded">GET /ai/prompts</code></p>
            </div>
          )}

          {isNew && (
            <button
              className="w-full text-left rounded-md px-2.5 py-2 text-sm bg-primary/10 text-primary"
            >
              <span className="italic">Novo prompt...</span>
            </button>
          )}

          {prompts.map(p => (
            <button
              key={p.id}
              onClick={() => handleSelect(p)}
              className={cn(
                'w-full text-left rounded-md px-2.5 py-2 text-sm transition-colors',
                selectedId === p.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="truncate">{p.name}</span>
                <span className="text-[10px] shrink-0 text-muted-foreground">v{p.version}</span>
              </div>
              {p.tags && p.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {p.tags.slice(0, 2).map(t => (
                    <span key={t} className="text-[10px] bg-muted rounded px-1">{t}</span>
                  ))}
                  {p.tags.length > 2 && (
                    <span className="text-[10px] text-muted-foreground">+{p.tags.length - 2}</span>
                  )}
                </div>
              )}
            </button>
          ))}

          {!isLoading && !error && prompts.length === 0 && !isNew && (
            <div className="px-2 py-6 text-center">
              <BookOpen className="h-6 w-6 mx-auto mb-2 opacity-40" />
              <p className="text-xs text-muted-foreground">Nenhum prompt ainda</p>
            </div>
          )}
        </div>
      </aside>

      {/* Editor panel */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {!showEditor ? (
          <div className="flex-1 flex items-center justify-center text-center p-8">
            <div>
              <BookOpen className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-30" />
              <p className="text-sm text-muted-foreground">Selecione um prompt ou crie um novo</p>
              <button
                onClick={handleNew}
                className="mt-4 flex items-center gap-2 mx-auto px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" /> Novo prompt
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-5 max-w-3xl">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {selectedPrompt && (
                  <span className="text-xs font-semibold bg-muted px-2 py-0.5 rounded-full">
                    v{selectedPrompt.version}
                  </span>
                )}
                <h2 className="font-semibold">{isNew ? 'Novo prompt' : form.name}</h2>
              </div>
              <div className="flex items-center gap-2">
                {!isNew && selectedPrompt && (
                  <>
                    <button
                      onClick={handleDuplicate}
                      disabled={isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm hover:bg-accent disabled:opacity-50"
                      title="Duplicar"
                    >
                      <Copy className="h-3.5 w-3.5" /> Duplicar
                    </button>
                    <button
                      onClick={() => { if (confirm(`Remover "${selectedPrompt.name}"?`)) deleteMutation.mutate(selectedPrompt.id) }}
                      disabled={deleteMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-destructive/40 text-sm text-destructive hover:bg-destructive/5 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Excluir
                    </button>
                  </>
                )}
                {isNew && (
                  <button
                    onClick={() => { setIsNew(false) }}
                    className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={handleSave}
                  disabled={isPending}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  {isPending ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>

            {/* Form fields */}
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nome</label>
                <input
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Nome do prompt"
                  className="mt-1.5 w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Tags <span className="normal-case">(separadas por vírgula)</span>
                </label>
                <div className="mt-1.5 relative">
                  <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    value={form.tags}
                    onChange={e => setForm(p => ({ ...p, tags: e.target.value }))}
                    placeholder="triage, resposta, email..."
                    className="w-full rounded-lg border bg-transparent pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                {form.tags && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {parseTags(form.tags).map(t => <TagBadge key={t} tag={t} />)}
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Corpo do prompt</label>
                <textarea
                  value={form.body}
                  onChange={e => setForm(p => ({ ...p, body: e.target.value }))}
                  rows={18}
                  placeholder="Escreva o prompt aqui. Use variáveis como {{name}}, {{context}}, {{history}}..."
                  className="mt-1.5 w-full rounded-lg border bg-transparent px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
                />
              </div>

              {selectedPrompt && (
                <p className="text-xs text-muted-foreground">
                  Criado em {new Date(selectedPrompt.createdAt).toLocaleString('pt-BR')} ·
                  Atualizado em {new Date(selectedPrompt.updatedAt).toLocaleString('pt-BR')}
                </p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

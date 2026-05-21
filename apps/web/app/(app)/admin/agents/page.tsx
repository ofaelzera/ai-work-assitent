'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { Bot, Plus, Pencil, Trash2, Play, X, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Agent {
  id: string
  name: string
  description?: string | null
  systemPrompt: string
  model: string
  provider: string
  temperature: number
  isActive: boolean
  createdAt: string
}

const MODELS: { group: string; items: { value: string; provider: string; label: string }[] }[] = [
  {
    group: 'OpenRouter — Gratuitos',
    items: [
      { value: 'meta-llama/llama-4-scout:free', provider: 'openrouter', label: 'Llama 4 Scout (Meta) — grátis' },
      { value: 'meta-llama/llama-4-maverick:free', provider: 'openrouter', label: 'Llama 4 Maverick (Meta) — grátis' },
      { value: 'google/gemini-2.0-flash-exp:free', provider: 'openrouter', label: 'Gemini 2.0 Flash Exp — grátis' },
      { value: 'deepseek/deepseek-r1:free', provider: 'openrouter', label: 'DeepSeek R1 — grátis' },
      { value: 'mistralai/mistral-small-3.2-24b-instruct:free', provider: 'openrouter', label: 'Mistral Small 3.2 — grátis' },
    ],
  },
  {
    group: 'OpenRouter — Pagos',
    items: [
      { value: 'openai/gpt-4o-mini', provider: 'openrouter', label: 'GPT-4o Mini (OpenAI)' },
      { value: 'openai/gpt-4o', provider: 'openrouter', label: 'GPT-4o (OpenAI)' },
      { value: 'anthropic/claude-3.5-haiku', provider: 'openrouter', label: 'Claude 3.5 Haiku (Anthropic)' },
      { value: 'anthropic/claude-3.7-sonnet', provider: 'openrouter', label: 'Claude 3.7 Sonnet (Anthropic)' },
      { value: 'google/gemini-2.5-pro-preview', provider: 'openrouter', label: 'Gemini 2.5 Pro (Google)' },
    ],
  },
  {
    group: 'Gemini Direto',
    items: [
      { value: 'gemini-2.5-flash', provider: 'gemini', label: 'Gemini 2.5 Flash ✓' },
      { value: 'gemini-2.5-pro', provider: 'gemini', label: 'Gemini 2.5 Pro' },
      { value: 'gemini-2.0-flash-lite', provider: 'gemini', label: 'Gemini 2.0 Flash Lite' },
    ],
  },
]

const ALL_MODEL_OPTIONS = MODELS.flatMap(g => g.items)

const DEFAULT_FORM = {
  name: '', description: '', systemPrompt: '', model: 'gemini-2.5-flash',
  provider: 'gemini', temperature: 0.4,
}

export default function AgentsPage() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Agent | null>(null)
  const [form, setForm] = useState(DEFAULT_FORM)
  const [testInput, setTestInput] = useState('')
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => apiFetch<Agent[]>('/ai/agents'),
  })

  const saveMutation = useMutation({
    mutationFn: (data: typeof DEFAULT_FORM) =>
      editing
        ? apiFetch(`/ai/agents/${editing.id}`, { method: 'PATCH', body: JSON.stringify(data) })
        : apiFetch('/ai/agents', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      setShowForm(false); setEditing(null); setForm(DEFAULT_FORM)
      toast.success(editing ? 'Agente atualizado!' : 'Agente criado!')
    },
    onError: () => toast.error('Erro ao salvar agente'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/ai/agents/${id}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['agents'] }); toast.success('Agente removido') },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiFetch(`/ai/agents/${id}`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  })

  const handleEdit = (agent: Agent) => {
    setEditing(agent)
    setForm({
      name: agent.name, description: agent.description ?? '',
      systemPrompt: agent.systemPrompt, model: agent.model,
      provider: agent.provider, temperature: agent.temperature,
    })
    setShowForm(true)
  }

  const handleTest = async (agent: Agent) => {
    if (!testInput.trim()) { toast.error('Digite um input para testar'); return }
    setTestingId(agent.id); setTestResult(null)
    try {
      const res = await apiFetch<{ text: string }>(`/ai/agents/${agent.id}/run`, {
        method: 'POST', body: JSON.stringify({ input: testInput }),
      })
      setTestResult(res.text)
    } catch { toast.error('Erro ao testar agente') }
    finally { setTestingId(null) }
  }

  return (
    <div className="p-6 max-w-4xl space-y-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Agentes IA</h1>
          <p className="text-sm text-muted-foreground">Configure os agentes de triagem, resposta e automação</p>
        </div>
        <button
          onClick={() => { setEditing(null); setForm(DEFAULT_FORM); setShowForm(true) }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Novo agente
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="border rounded-xl p-5 bg-card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{editing ? 'Editar agente' : 'Novo agente'}</h2>
            <button onClick={() => { setShowForm(false); setEditing(null) }}><X className="h-4 w-4" /></button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="text-xs font-medium">Nome *</label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="ex: triage, reply-suggester" />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="text-xs font-medium">Descrição</label>
              <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Para que serve este agente?" />
            </div>
            <div>
              <label className="text-xs font-medium">Modelo</label>
              <select
                value={form.model}
                onChange={e => {
                  const selected = ALL_MODEL_OPTIONS.find(m => m.value === e.target.value)
                  setForm(p => ({ ...p, model: e.target.value, provider: selected?.provider ?? p.provider }))
                }}
                className="mt-1 w-full rounded-lg border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {MODELS.map(group => (
                  <optgroup key={group.group} label={group.group}>
                    {group.items.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Provider: <span className="font-mono">{form.provider}</span>
              </p>
            </div>
            <div>
              <label className="text-xs font-medium">Temperatura: {form.temperature}</label>
              <input type="range" min={0} max={1} step={0.05} value={form.temperature}
                onChange={e => setForm(p => ({ ...p, temperature: Number(e.target.value) }))}
                className="mt-2 w-full" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium">System Prompt *</label>
              <textarea value={form.systemPrompt} onChange={e => setForm(p => ({ ...p, systemPrompt: e.target.value }))}
                rows={8} placeholder="Instruções do sistema para o agente..."
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring resize-y" />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowForm(false); setEditing(null) }}
              className="px-4 py-2 rounded-lg text-sm hover:bg-accent">Cancelar</button>
            <button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending || !form.name || !form.systemPrompt}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
              {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>
      )}

      {/* Lista */}
      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      {!isLoading && agents.length === 0 && (
        <div className="border border-dashed rounded-xl p-8 text-center">
          <Bot className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-40" />
          <p className="text-sm text-muted-foreground">Nenhum agente configurado</p>
          <p className="text-xs text-muted-foreground mt-1">Os agentes padrão (triage, reply) são criados automaticamente na primeira execução</p>
        </div>
      )}

      <div className="space-y-3">
        {agents.map(agent => (
          <div key={agent.id} className="border rounded-xl bg-card overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3">
              <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center shrink-0', agent.isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                <Bot className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm truncate">{agent.name}</p>
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', agent.isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-muted text-muted-foreground')}>
                    {agent.isActive ? 'ativo' : 'inativo'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{agent.description ?? agent.model}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => toggleMutation.mutate({ id: agent.id, isActive: !agent.isActive })}
                  className="text-xs px-2 py-1 rounded-lg hover:bg-accent text-muted-foreground">
                  {agent.isActive ? 'Desativar' : 'Ativar'}
                </button>
                <button onClick={() => handleEdit(agent)} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => { if (confirm(`Remover "${agent.name}"?`)) deleteMutation.mutate(agent.id) }}
                  className="p-1.5 rounded-lg hover:bg-accent text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setExpandedId(expandedId === agent.id ? null : agent.id)}
                  className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground">
                  {expandedId === agent.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            {expandedId === agent.id && (
              <div className="border-t px-4 py-3 space-y-3 bg-muted/20">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">System Prompt</p>
                  <pre className="text-xs bg-muted/40 rounded-lg p-3 whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">{agent.systemPrompt}</pre>
                </div>
                <div className="flex gap-2">
                  <input value={testInput} onChange={e => setTestInput(e.target.value)}
                    placeholder="Input para testar o agente..."
                    className="flex-1 rounded-lg border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
                  <button onClick={() => handleTest(agent)} disabled={testingId === agent.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm disabled:opacity-50">
                    <Play className="h-3.5 w-3.5" />
                    {testingId === agent.id ? 'Executando...' : 'Testar'}
                  </button>
                </div>
                {testResult && (
                  <pre className="text-xs bg-muted/40 rounded-lg p-3 whitespace-pre-wrap max-h-48 overflow-y-auto">{testResult}</pre>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

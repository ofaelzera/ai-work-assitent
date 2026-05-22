'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { Bot, Plus, Pencil, Trash2, Play, X, ChevronDown, ChevronUp, Zap, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AdminPageLayout } from '@/components/admin/AdminPageLayout'

type TriggerType = 'message.received' | 'conversation.created' | 'cron' | 'manual'

interface TriggerConfig {
  type: TriggerType
  filters?: {
    channelId?: string
    channelType?: string
    conversationExternalId?: string
    bodyContains?: string
    direction?: 'INBOUND' | 'OUTBOUND'
  }
  schedule?: string
}

interface ToolMeta { name: string; description: string }

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
  trigger?: TriggerConfig | null
  enabledTools?: string[] | null
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
  trigger: null as TriggerConfig | null,
  enabledTools: [] as string[],
}

const CHANNEL_TYPES = ['WHATSAPP', 'IMAP_SMTP', 'GMAIL', 'TELEGRAM', 'INSTAGRAM']

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

  const { data: availableTools = [] } = useQuery({
    queryKey: ['ai-tools'],
    queryFn: () => apiFetch<ToolMeta[]>('/ai/tools'),
    staleTime: 5 * 60_000,
  })

  const { data: channels = [] } = useQuery<{ id: string; label: string; type: string }[]>({
    queryKey: ['channels'],
    queryFn: () => apiFetch('/channels'),
    staleTime: 60_000,
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
      trigger: agent.trigger ?? null,
      enabledTools: agent.enabledTools ?? [],
    })
    setShowForm(true)
  }

  const handleTest = async (agent: Agent, dryRun = false) => {
    if (!testInput.trim()) { toast.error('Digite um input para testar'); return }
    setTestingId(agent.id); setTestResult(null)
    try {
      const res = await apiFetch<any>(`/ai/agents/${agent.id}/run`, {
        method: 'POST', body: JSON.stringify({ input: testInput, dryRun }),
      })
      // Resposta v2 traz toolInvocations; v1 traz só text
      if (res.toolInvocations) {
        const summary = [
          res.text && `Reply: ${res.text}`,
          res.toolInvocations.length > 0 &&
            `Tool calls:\n${res.toolInvocations.map((i: any) =>
              `• ${i.call.name}(${JSON.stringify(i.call.params)}) → ${i.result.ok ? '✅' : '❌ ' + (i.result.error ?? '')}`
            ).join('\n')}`,
          dryRun && '(dry-run — tools não executados)',
        ].filter(Boolean).join('\n\n')
        setTestResult(summary)
      } else {
        setTestResult(res.text)
      }
    } catch (e: any) { toast.error(e?.message ?? 'Erro ao testar agente') }
    finally { setTestingId(null) }
  }

  const updateTriggerField = (patch: Partial<TriggerConfig> | { filters: Partial<NonNullable<TriggerConfig['filters']>> }) => {
    setForm(p => {
      const cur = p.trigger ?? { type: 'manual' as TriggerType }
      if ('filters' in patch) {
        return { ...p, trigger: { ...cur, filters: { ...(cur.filters ?? {}), ...patch.filters } } }
      }
      return { ...p, trigger: { ...cur, ...patch } }
    })
  }

  return (
    <AdminPageLayout
      title="Agentes IA"
      description="Configure os agentes de triagem, resposta e automação"
      maxWidth="4xl"
      action={
        <button onClick={() => { setEditing(null); setForm(DEFAULT_FORM); setShowForm(true) }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">
          <Plus className="h-4 w-4" /> Novo agente
        </button>
      }
    >

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

          {/* ── Trigger ─────────────────────────────────────────────────── */}
          <div className="space-y-2 border rounded-lg p-3 bg-muted/10">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-amber-500" /> Trigger — quando este agente roda
              </label>
              {form.trigger && (
                <button type="button" onClick={() => setForm(p => ({ ...p, trigger: null }))}
                  className="text-[11px] text-muted-foreground hover:text-foreground">
                  Limpar
                </button>
              )}
            </div>
            <select
              value={form.trigger?.type ?? 'manual'}
              onChange={e => updateTriggerField({ type: e.target.value as TriggerType, filters: {} })}
              className="w-full rounded-lg border bg-background px-3 py-1.5 text-sm">
              <option value="manual">Manual (só executa via botão "Testar")</option>
              <option value="message.received">Mensagem recebida</option>
              <option value="conversation.created">Conversa criada</option>
              <option value="cron">Recorrente (cron)</option>
            </select>

            {form.trigger?.type === 'message.received' && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <label className="text-[11px] text-muted-foreground">Canal específico</label>
                  <select
                    value={form.trigger.filters?.channelId ?? ''}
                    onChange={e => updateTriggerField({ filters: { channelId: e.target.value || undefined } })}
                    className="mt-0.5 w-full rounded-lg border bg-background px-2 py-1 text-xs">
                    <option value="">Qualquer canal</option>
                    {channels.map(c => <option key={c.id} value={c.id}>{c.label} ({c.type})</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Tipo de canal</label>
                  <select
                    value={form.trigger.filters?.channelType ?? ''}
                    onChange={e => updateTriggerField({ filters: { channelType: e.target.value || undefined } })}
                    className="mt-0.5 w-full rounded-lg border bg-background px-2 py-1 text-xs">
                    <option value="">Qualquer</option>
                    {CHANNEL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] text-muted-foreground">Texto contém (case-insensitive)</label>
                  <input
                    value={form.trigger.filters?.bodyContains ?? ''}
                    onChange={e => updateTriggerField({ filters: { bodyContains: e.target.value || undefined } })}
                    placeholder="ex: urgente, rafael, agendamento..."
                    className="mt-0.5 w-full rounded-lg border bg-transparent px-2 py-1 text-xs" />
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] text-muted-foreground">ID externo da conversa (ex: grupo WhatsApp)</label>
                  <input
                    value={form.trigger.filters?.conversationExternalId ?? ''}
                    onChange={e => updateTriggerField({ filters: { conversationExternalId: e.target.value || undefined } })}
                    placeholder="ex: 5511999...@g.us"
                    className="mt-0.5 w-full rounded-lg border bg-transparent px-2 py-1 text-xs font-mono" />
                </div>
              </div>
            )}

            {form.trigger?.type === 'cron' && (
              <div className="mt-2">
                <label className="text-[11px] text-muted-foreground">Schedule cron (5 campos)</label>
                <input
                  value={form.trigger.schedule ?? ''}
                  onChange={e => updateTriggerField({ schedule: e.target.value })}
                  placeholder="0 8 * * *  (todos os dias às 8h)"
                  className="mt-0.5 w-full rounded-lg border bg-transparent px-2 py-1 text-xs font-mono" />
                <p className="text-[10px] text-muted-foreground/70 mt-1">
                  Formato Unix cron (5 campos). Exs: <code className="font-mono">0 8 * * *</code> (todo dia 8h UTC), <code className="font-mono">*/15 * * * *</code> (a cada 15min).
                </p>
              </div>
            )}

            <details className="mt-2">
              <summary className="text-[10px] text-muted-foreground cursor-pointer">Ver JSON do trigger</summary>
              <pre className="mt-1 text-[10px] bg-muted/40 rounded p-2 font-mono overflow-x-auto">
                {JSON.stringify(form.trigger, null, 2)}
              </pre>
            </details>
          </div>

          {/* ── Tools ───────────────────────────────────────────────────── */}
          <div className="space-y-2 border rounded-lg p-3 bg-muted/10">
            <label className="text-xs font-semibold flex items-center gap-1.5">
              <Wrench className="h-3.5 w-3.5 text-violet-500" /> Tools — ações que o agente pode executar
            </label>
            {availableTools.length === 0 && (
              <p className="text-[11px] text-muted-foreground">Nenhuma tool disponível</p>
            )}
            <div className="space-y-1.5">
              {availableTools.map(t => {
                const selected = form.enabledTools.includes(t.name)
                return (
                  <label key={t.name}
                    className={cn('flex items-start gap-2 rounded-lg border p-2 text-xs cursor-pointer hover:bg-accent/40',
                      selected && 'border-primary bg-primary/5')}>
                    <input
                      type="checkbox" checked={selected}
                      onChange={() => setForm(p => ({
                        ...p,
                        enabledTools: selected
                          ? p.enabledTools.filter(n => n !== t.name)
                          : [...p.enabledTools, t.name],
                      }))}
                      className="mt-0.5 accent-primary" />
                    <div className="min-w-0">
                      <p className="font-medium font-mono">{t.name}</p>
                      <p className="text-[11px] text-muted-foreground">{t.description}</p>
                    </div>
                  </label>
                )
              })}
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
                <div className="flex flex-wrap items-center gap-1 mt-1">
                  {agent.trigger && agent.trigger.type !== 'manual' && (
                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      <Zap className="h-2.5 w-2.5" /> {agent.trigger.type}
                    </span>
                  )}
                  {(agent.enabledTools ?? []).map(t => (
                    <span key={t} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 font-mono">
                      <Wrench className="h-2.5 w-2.5" /> {t}
                    </span>
                  ))}
                </div>
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
                  {(agent.enabledTools?.length ?? 0) > 0 && (
                    <button onClick={() => handleTest(agent, true)} disabled={testingId === agent.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm hover:bg-accent disabled:opacity-50"
                      title="Simula sem executar tools de verdade">
                      Dry-run
                    </button>
                  )}
                  <button onClick={() => handleTest(agent, false)} disabled={testingId === agent.id}
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
    </AdminPageLayout>
  )
}

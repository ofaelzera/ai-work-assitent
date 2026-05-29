'use client'

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { Sparkles, Save, KeyRound, CheckCircle2, XCircle, Loader2, Zap, Plus, Trash2, Star, Pencil, X } from 'lucide-react'
import { AdminPageLayout } from '@/components/admin/AdminPageLayout'
import { AdminSection } from '@/components/admin/AdminSection'

type ProviderName = 'gemini' | 'openrouter' | 'anthropic' | 'openai'

interface AiModel {
  id: string
  provider: ProviderName
  modelId: string
  label: string
  description: string | null
  temperature: number | null
  maxTokens: number | null
  enabled: boolean
  isDefault: boolean
}

interface ProviderConfig {
  provider: ProviderName
  enabled: boolean
  extra: Record<string, unknown>
  hasKey: boolean
  maskedKey: string | null
  models: AiModel[]
}

interface ConfigResponse {
  providers: ProviderConfig[]
}

const PROVIDER_META: Record<ProviderName, { label: string; modelPlaceholder: string; keyHint: string; hasSiteUrl?: boolean }> = {
  gemini: {
    label: 'Google Gemini',
    modelPlaceholder: 'gemini-2.5-flash',
    keyHint: 'Crie em aistudio.google.com → API keys',
  },
  openrouter: {
    label: 'OpenRouter',
    modelPlaceholder: 'openai/gpt-4o-mini',
    keyHint: 'Crie em openrouter.ai/keys',
    hasSiteUrl: true,
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    modelPlaceholder: 'claude-sonnet-4-6',
    keyHint: 'Crie em console.anthropic.com → API Keys',
  },
  openai: {
    label: 'OpenAI',
    modelPlaceholder: 'gpt-4o-mini',
    keyHint: 'Crie em platform.openai.com → API keys',
  },
}

const ORDER: ProviderName[] = ['gemini', 'openrouter', 'anthropic', 'openai']

const EMPTY_MODEL = { modelId: '', label: '', description: '', temperature: '', maxTokens: '' }
type ModelForm = typeof EMPTY_MODEL

// ─── Form de criar/editar modelo ─────────────────────────────────────────────
function ModelEditor({
  provider,
  placeholder,
  editing,
  onClose,
}: {
  provider: ProviderName
  placeholder: string
  editing: AiModel | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<ModelForm>(
    editing
      ? {
          modelId: editing.modelId,
          label: editing.label,
          description: editing.description ?? '',
          temperature: editing.temperature?.toString() ?? '',
          maxTokens: editing.maxTokens?.toString() ?? '',
        }
      : EMPTY_MODEL,
  )

  const payload = () => ({
    provider,
    modelId: form.modelId.trim(),
    label: form.label.trim(),
    description: form.description.trim() || null,
    temperature: form.temperature === '' ? null : Number(form.temperature),
    maxTokens: form.maxTokens === '' ? null : Number(form.maxTokens),
  })

  const save = useMutation({
    mutationFn: () =>
      editing
        ? apiFetch(`/ai/models/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload()) })
        : apiFetch('/ai/models', { method: 'POST', body: JSON.stringify(payload()) }),
    onSuccess: () => {
      toast.success(editing ? 'Modelo atualizado!' : 'Modelo cadastrado!')
      queryClient.invalidateQueries({ queryKey: ['ai-providers-config'] })
      queryClient.invalidateQueries({ queryKey: ['ai-models'] })
      onClose()
    },
    onError: (err: any) => toast.error(err?.message ?? 'Erro ao salvar modelo'),
  })

  const valid = form.modelId.trim() && form.label.trim()

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {editing ? 'Editar modelo' : 'Novo modelo'}
        </p>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium">ID do modelo (slug da API)</label>
          <input
            value={form.modelId}
            onChange={(e) => setForm((f) => ({ ...f, modelId: e.target.value }))}
            placeholder={placeholder}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Nome amigável</label>
          <input
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            placeholder="Ex: GPT-4o Mini (rápido)"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium">Particularidades / notas (opcional)</label>
        <textarea
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          rows={2}
          placeholder="Contexto, custo, quando usar este modelo..."
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium">Temperatura padrão (opcional)</label>
          <input
            type="number" step="0.1" min="0" max="2"
            value={form.temperature}
            onChange={(e) => setForm((f) => ({ ...f, temperature: e.target.value }))}
            placeholder="0.4"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Máx. tokens (opcional)</label>
          <input
            type="number" min="1"
            value={form.maxTokens}
            onChange={(e) => setForm((f) => ({ ...f, maxTokens: e.target.value }))}
            placeholder="2048"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => save.mutate()}
          disabled={!valid || save.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Save className="h-4 w-4" /> {save.isPending ? 'Salvando...' : 'Salvar modelo'}
        </button>
        <button onClick={onClose} className="rounded-lg border bg-background px-3 py-1.5 text-sm hover:bg-muted">Cancelar</button>
      </div>
    </div>
  )
}

// ─── Linha de um modelo cadastrado ───────────────────────────────────────────
function ModelRow({ model, onEdit }: { model: AiModel; onEdit: () => void }) {
  const queryClient = useQueryClient()
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const mutate = (body: object) =>
    apiFetch(`/ai/models/${model.id}`, { method: 'PATCH', body: JSON.stringify(body) })

  const setDefault = useMutation({
    mutationFn: () => mutate({ isDefault: true }),
    onSuccess: () => {
      toast.success(`"${model.label}" agora é o modelo padrão`)
      queryClient.invalidateQueries({ queryKey: ['ai-providers-config'] })
      queryClient.invalidateQueries({ queryKey: ['ai-models'] })
    },
  })

  const toggle = useMutation({
    mutationFn: () => mutate({ enabled: !model.enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-providers-config'] }),
  })

  const remove = useMutation({
    mutationFn: () => apiFetch(`/ai/models/${model.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Modelo removido')
      queryClient.invalidateQueries({ queryKey: ['ai-providers-config'] })
      queryClient.invalidateQueries({ queryKey: ['ai-models'] })
    },
  })

  const test = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; model: string; sample?: string; error?: string }>(`/ai/models/${model.id}/test`, { method: 'POST' }),
    onSuccess: (r) => setTestResult(r.ok ? { ok: true, msg: `OK: ${r.sample ?? ''}`.trim() } : { ok: false, msg: r.error ?? 'Falha' }),
    onError: (err: any) => setTestResult({ ok: false, msg: err?.message ?? 'Falha' }),
  })

  return (
    <div className={'rounded-lg border p-3 ' + (model.enabled ? 'bg-background' : 'bg-muted/40 opacity-70')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{model.label}</span>
            {model.isDefault && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                <Star className="h-3 w-3 fill-current" /> Padrão
              </span>
            )}
            {!model.enabled && <span className="text-[10px] text-muted-foreground">(desativado)</span>}
          </div>
          <p className="text-xs font-mono text-muted-foreground truncate">{model.modelId}</p>
          {model.description && <p className="text-xs text-muted-foreground mt-1">{model.description}</p>}
          {(model.temperature != null || model.maxTokens != null) && (
            <p className="text-[10px] text-muted-foreground mt-1 font-mono">
              {model.temperature != null && `temp ${model.temperature}`}
              {model.temperature != null && model.maxTokens != null && ' · '}
              {model.maxTokens != null && `max ${model.maxTokens}t`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => { setTestResult(null); test.mutate() }} disabled={test.isPending} title="Testar" className="rounded-md p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground">
            {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          </button>
          {!model.isDefault && (
            <button onClick={() => setDefault.mutate()} disabled={setDefault.isPending} title="Tornar padrão" className="rounded-md p-1.5 hover:bg-muted text-muted-foreground hover:text-amber-500">
              <Star className="h-4 w-4" />
            </button>
          )}
          <button onClick={() => toggle.mutate()} title={model.enabled ? 'Desativar' : 'Ativar'} className="rounded-md p-1.5 hover:bg-muted text-muted-foreground text-[10px] w-auto px-2">
            {model.enabled ? 'On' : 'Off'}
          </button>
          <button onClick={onEdit} title="Editar" className="rounded-md p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground">
            <Pencil className="h-4 w-4" />
          </button>
          <button onClick={() => remove.mutate()} disabled={remove.isPending} title="Remover" className="rounded-md p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      {testResult && (
        <div className={'mt-2 flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs ' + (testResult.ok ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400' : 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-400')}>
          {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" /> : <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
          <span className="break-all">{testResult.msg}</span>
        </div>
      )}
    </div>
  )
}

// ─── Card de provedor (key + lista de modelos) ───────────────────────────────
function ProviderCard({ config }: { config: ProviderConfig }) {
  const queryClient = useQueryClient()
  const meta = PROVIDER_META[config.provider]

  const [apiKey, setApiKey] = useState('')
  const [enabled, setEnabled] = useState(config.enabled)
  const [siteUrl, setSiteUrl] = useState((config.extra?.siteUrl as string) ?? '')
  const [keyTest, setKeyTest] = useState<{ ok: boolean; msg: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [editingModel, setEditingModel] = useState<AiModel | null>(null)

  useEffect(() => {
    setEnabled(config.enabled)
    setSiteUrl((config.extra?.siteUrl as string) ?? '')
    setApiKey('')
  }, [config])

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/ai/providers/config/${config.provider}`, {
        method: 'PUT',
        body: JSON.stringify({
          enabled,
          ...(apiKey ? { apiKey } : {}),
          ...(meta.hasSiteUrl ? { extra: { siteUrl: siteUrl || undefined } } : {}),
        }),
      }),
    onSuccess: () => {
      toast.success(`${meta.label} atualizado!`)
      setApiKey('')
      queryClient.invalidateQueries({ queryKey: ['ai-providers-config'] })
    },
    onError: (err: any) => toast.error(err?.message ?? 'Erro ao salvar'),
  })

  return (
    <AdminSection title={meta.label} description={meta.keyHint} icon={Sparkles}>
      <div className="space-y-5">
        {/* Credenciais */}
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer w-fit">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 rounded border-input" />
            Provedor ativo
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" /> API Key</label>
              <input
                type="password" autoComplete="new-password"
                value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono"
                placeholder={config.hasKey ? `Salva: ${config.maskedKey}` : 'Cole a API key'}
              />
              <p className="text-xs text-muted-foreground">
                {config.hasKey ? 'Deixe em branco para manter a key atual.' : 'Nenhuma key configurada.'}
              </p>
            </div>
            {meta.hasSiteUrl && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Site URL (Referer)</label>
                <input
                  value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono"
                  placeholder="https://app.seudominio.com"
                />
              </div>
            )}
          </div>

          {keyTest && (
            <div className={'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ' + (keyTest.ok ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400' : 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-400')}>
              {keyTest.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : <XCircle className="h-4 w-4 shrink-0 mt-0.5" />}
              <span className="break-all">{keyTest.msg}</span>
            </div>
          )}

          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> {save.isPending ? 'Salvando...' : 'Salvar credenciais'}
          </button>
        </div>

        {/* Modelos cadastrados */}
        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Modelos cadastrados</p>
            {!adding && !editingModel && (
              <button
                onClick={() => setAdding(true)}
                disabled={!config.hasKey}
                title={!config.hasKey ? 'Salve uma API key antes de cadastrar modelos' : undefined}
                className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> Cadastrar modelo
              </button>
            )}
          </div>

          {(adding || editingModel) && (
            <ModelEditor
              provider={config.provider}
              placeholder={meta.modelPlaceholder}
              editing={editingModel}
              onClose={() => { setAdding(false); setEditingModel(null) }}
            />
          )}

          {config.models.length === 0 && !adding ? (
            <p className="text-xs text-muted-foreground">Nenhum modelo cadastrado para este provedor.</p>
          ) : (
            <div className="space-y-2">
              {config.models.map((m) => (
                <ModelRow key={m.id} model={m} onEdit={() => { setAdding(false); setEditingModel(m) }} />
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminSection>
  )
}

export default function AiSettingsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['ai-providers-config'],
    queryFn: () => apiFetch<ConfigResponse>('/ai/providers/config'),
  })

  const byProvider = new Map((data?.providers ?? []).map((p) => [p.provider, p]))

  return (
    <AdminPageLayout
      title="Provedores de IA"
      description="Configure as chaves de API (cifradas em AES-256) e cadastre os modelos de cada provedor. O sistema usa estes modelos nos agentes e nas sugestões de resposta."
      icon={Sparkles}
      maxWidth="4xl"
    >
      {isLoading ? (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">Carregando...</div>
      ) : (
        <>
          {ORDER.map((name) => {
            const cfg = byProvider.get(name)
            if (!cfg) return null
            return <ProviderCard key={name} config={cfg} />
          })}
        </>
      )}
    </AdminPageLayout>
  )
}

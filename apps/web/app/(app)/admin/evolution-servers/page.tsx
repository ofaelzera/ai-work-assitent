'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import {
  Server, Plus, Trash2, Save, X, Pencil, RefreshCw,
  CheckCircle2, AlertCircle, Clock, Activity,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AdminPageLayout } from '@/components/admin/AdminPageLayout'
import { useConfirm } from '@/components/ui/confirm-dialog'

interface EvolutionServer {
  id: string
  name: string
  url: string
  status: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE'
  maxInstances: number
  instanceCount: number
  priority: number
  isHealthy: boolean
  lastHealthCheck: string | null
  createdAt: string
}

interface HealthcheckResult {
  healthy: boolean
  instanceCount?: number
  error?: string
}

const EMPTY_FORM = {
  name: '',
  url: '',
  apiKey: '',
  maxInstances: 100,
  priority: 0,
}

const STATUS_LABELS: Record<EvolutionServer['status'], string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  MAINTENANCE: 'Manutenção',
}

function HealthBadge({ isHealthy, lastCheck }: { isHealthy: boolean; lastCheck: string | null }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full',
      isHealthy
        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
        : 'bg-red-500/10 text-red-600 dark:text-red-400',
    )}>
      {isHealthy
        ? <CheckCircle2 className="h-3 w-3" />
        : <AlertCircle className="h-3 w-3" />}
      {isHealthy ? 'Saudável' : 'Degradado'}
    </span>
  )
}

function StatusBadge({ status }: { status: EvolutionServer['status'] }) {
  return (
    <span className={cn(
      'inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full',
      status === 'ACTIVE' && 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
      status === 'INACTIVE' && 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400',
      status === 'MAINTENANCE' && 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
    )}>
      {STATUS_LABELS[status]}
    </span>
  )
}

export default function EvolutionServersPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editStatus, setEditStatus] = useState<EvolutionServer['status']>('ACTIVE')

  const { data: servers = [], isLoading } = useQuery({
    queryKey: ['evolution-servers'],
    queryFn: () => apiFetch<EvolutionServer[]>('/evolution-servers'),
  })

  const createMutation = useMutation({
    mutationFn: (data: typeof EMPTY_FORM) =>
      apiFetch<EvolutionServer>('/evolution-servers', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evolution-servers'] })
      toast.success('Servidor cadastrado')
      setShowForm(false)
      setForm(EMPTY_FORM)
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao cadastrar servidor'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<typeof EMPTY_FORM> & { status?: EvolutionServer['status'] } }) =>
      apiFetch<EvolutionServer>(`/evolution-servers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evolution-servers'] })
      toast.success('Servidor atualizado')
      setEditingId(null)
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao atualizar servidor'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/evolution-servers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evolution-servers'] })
      toast.success('Servidor removido')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao remover servidor'),
  })

  const healthcheckMutation = useMutation({
    mutationFn: (id: string) => apiFetch<HealthcheckResult>(`/evolution-servers/${id}/healthcheck`, { method: 'POST' }),
    onSuccess: (result, id) => {
      queryClient.invalidateQueries({ queryKey: ['evolution-servers'] })
      if (result.healthy) {
        toast.success(`Servidor saudável — ${result.instanceCount} instância(s)`)
      } else {
        toast.error(`Servidor com problema: ${result.error ?? 'erro desconhecido'}`)
      }
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro no healthcheck'),
  })

  function startEdit(server: EvolutionServer) {
    setEditingId(server.id)
    setForm({
      name: server.name,
      url: server.url,
      apiKey: '',
      maxInstances: server.maxInstances,
      priority: server.priority,
    })
    setEditStatus(server.status)
    setShowForm(false)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (editingId) {
      const data: any = {
        name: form.name,
        url: form.url,
        maxInstances: form.maxInstances,
        priority: form.priority,
        status: editStatus,
      }
      if (form.apiKey) data.apiKey = form.apiKey
      updateMutation.mutate({ id: editingId, data })
    } else {
      if (!form.apiKey) return toast.error('API Key é obrigatória')
      createMutation.mutate(form)
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending

  return (
    <AdminPageLayout
      icon={Server}
      title="Servidores Evolution"
      description="Gerencie os servidores Evolution API para distribuição de instâncias WhatsApp."
      action={
        !showForm && !editingId ? (
          <button
            onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_FORM) }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> Adicionar servidor
          </button>
        ) : undefined
      }
    >
      {/* Formulário de criação/edição */}
      {(showForm || editingId) && (
        <form
          onSubmit={handleSubmit}
          className="border border-border rounded-lg p-4 mb-6 bg-card space-y-3"
        >
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold">
              {editingId ? 'Editar servidor' : 'Novo servidor'}
            </h3>
            <button
              type="button"
              onClick={() => { setShowForm(false); setEditingId(null) }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Nome</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="VPS Brasil"
                required
                className="w-full text-sm bg-background border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">URL da API</label>
              <input
                value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                placeholder="https://evo.meusite.com"
                required
                type="url"
                className="w-full text-sm bg-background border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                API Key {editingId && <span className="text-muted-foreground/70">(deixe em branco para não alterar)</span>}
              </label>
              <input
                value={form.apiKey}
                onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
                placeholder={editingId ? '••••••••••••••••' : 'changeme_api_key'}
                required={!editingId}
                type="password"
                className="w-full text-sm bg-background border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Máx. instâncias</label>
                <input
                  value={form.maxInstances}
                  onChange={e => setForm(f => ({ ...f, maxInstances: Number(e.target.value) }))}
                  type="number"
                  min={1}
                  required
                  className="w-full text-sm bg-background border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Prioridade</label>
                <input
                  value={form.priority}
                  onChange={e => setForm(f => ({ ...f, priority: Number(e.target.value) }))}
                  type="number"
                  className="w-full text-sm bg-background border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
            {editingId && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Status</label>
                <select
                  value={editStatus}
                  onChange={e => setEditStatus(e.target.value as EvolutionServer['status'])}
                  className="w-full text-sm bg-background border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="ACTIVE">Ativo</option>
                  <option value="INACTIVE">Inativo</option>
                  <option value="MAINTENANCE">Manutenção</option>
                </select>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {isSaving ? 'Salvando…' : 'Salvar'}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setEditingId(null) }}
              className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-accent"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Lista de servidores */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <RefreshCw className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : servers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Server className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nenhum servidor cadastrado.</p>
          <p className="text-xs mt-1">
            Adicione um servidor para distribuir instâncias WhatsApp entre múltiplas VPS.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {servers.map(server => (
            <div
              key={server.id}
              className={cn(
                'border border-border rounded-lg p-4 bg-card',
                editingId === server.id && 'ring-1 ring-primary',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{server.name}</span>
                    <StatusBadge status={server.status} />
                    <HealthBadge isHealthy={server.isHealthy} lastCheck={server.lastHealthCheck} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{server.url}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Activity className="h-3 w-3" />
                      {server.instanceCount} / {server.maxInstances} instâncias
                    </span>
                    <span>Prioridade: {server.priority}</span>
                    {server.lastHealthCheck && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Verificado {new Date(server.lastHealthCheck).toLocaleString('pt-BR', {
                          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => healthcheckMutation.mutate(server.id)}
                    disabled={healthcheckMutation.isPending && healthcheckMutation.variables === server.id}
                    title="Verificar saúde"
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
                  >
                    <RefreshCw className={cn(
                      'h-4 w-4',
                      healthcheckMutation.isPending && healthcheckMutation.variables === server.id && 'animate-spin',
                    )} />
                  </button>
                  <button
                    onClick={() => startEdit(server)}
                    title="Editar"
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={async () => {
                      const ok = await confirm({
                        type: 'danger',
                        title: `Remover servidor "${server.name}"?`,
                        message: 'Os canais vinculados a este servidor serão desvinculados (mas não removidos). Você pode revinculá-los a outro servidor depois.',
                        warning: 'As instâncias no Evolution permanecem intactas — só o cadastro do servidor é removido daqui.',
                        confirmLabel: 'Remover servidor',
                      })
                      if (ok) deleteMutation.mutate(server.id)
                    }}
                    title="Remover"
                    className="p-1.5 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Barra de uso */}
              <div className="mt-3">
                <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      server.instanceCount / server.maxInstances > 0.9
                        ? 'bg-red-500'
                        : server.instanceCount / server.maxInstances > 0.7
                        ? 'bg-yellow-500'
                        : 'bg-emerald-500',
                    )}
                    style={{ width: `${Math.min(100, (server.instanceCount / server.maxInstances) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminPageLayout>
  )
}

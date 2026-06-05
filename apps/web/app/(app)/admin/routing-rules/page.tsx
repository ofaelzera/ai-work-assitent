'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, X, Filter, ArrowDown, ArrowUp, Power } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { AdminPageLayout } from '@/components/admin/AdminPageLayout'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth'

const ACTION_LABELS: Record<string, string> = {
  assign_team: 'Atribuir ao setor',
  assign_user: 'Atribuir ao usuário',
  start_flow: 'Iniciar fluxo',
  add_tag: 'Adicionar tag',
}

const CHANNEL_TYPES = ['WHATSAPP', 'GMAIL', 'IMAP_SMTP', 'META_WHATSAPP', 'META_INSTAGRAM', 'META_MESSENGER']

interface RoutingRule {
  id: string
  name: string
  description: string | null
  matcher: any
  action: any
  priority: number
  isActive: boolean
  triggers: string[] | null
  assignTeam: { id: string; name: string; color: string } | null
}

interface TeamOpt { id: string; name: string; color: string }
interface UserOpt { id: string; name: string; email: string }
interface FlowOpt { id: string; name: string }
interface ChannelOpt { id: string; label: string; type: string }

function RuleFormModal({
  rule, teams, users, flows, channels, companies, onClose,
}: {
  rule: RoutingRule | null
  teams: TeamOpt[]
  users: UserOpt[]
  flows: FlowOpt[]
  channels: ChannelOpt[]
  companies: { id: string; name: string }[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(rule?.name ?? '')
  const [description, setDescription] = useState(rule?.description ?? '')
  const [priority, setPriority] = useState(rule?.priority ?? 100)
  const [isActive, setIsActive] = useState(rule?.isActive ?? true)

  // Matcher
  const matcher = rule?.matcher ?? {}
  const [channelIds, setChannelIds] = useState<string[]>(matcher.channelIds ?? [])
  const [channelTypes, setChannelTypes] = useState<string[]>(matcher.channelTypes ?? [])
  const [companyIds, setCompanyIds] = useState<string[]>(matcher.companyIds ?? [])
  const [keywords, setKeywords] = useState((matcher.keywordsAny ?? []).join(', '))
  const [tags, setTags] = useState((matcher.contactTagsAny ?? []).join(', '))
  const [isGroup, setIsGroup] = useState<'any' | 'true' | 'false'>(
    matcher.isGroup === true ? 'true' : matcher.isGroup === false ? 'false' : 'any',
  )

  // Action
  const action = rule?.action ?? { type: 'assign_team' }
  const [actionType, setActionType] = useState(action.type ?? 'assign_team')
  const [actionTeamId, setActionTeamId] = useState(action.teamId ?? '')
  const [actionUserId, setActionUserId] = useState(action.userId ?? '')
  const [actionFlowId, setActionFlowId] = useState(action.flowId ?? '')
  const [actionTags, setActionTags] = useState((action.tags ?? []).join(', '))

  const save = useMutation({
    mutationFn: () => {
      const matcherBody: any = {}
      if (channelIds.length) matcherBody.channelIds = channelIds
      if (channelTypes.length) matcherBody.channelTypes = channelTypes
      if (companyIds.length) matcherBody.companyIds = companyIds
      const kwArr = keywords.split(',').map((s: string) => s.trim()).filter(Boolean)
      if (kwArr.length) matcherBody.keywordsAny = kwArr
      const tagsArr = tags.split(',').map((s: string) => s.trim()).filter(Boolean)
      if (tagsArr.length) matcherBody.contactTagsAny = tagsArr
      if (isGroup !== 'any') matcherBody.isGroup = isGroup === 'true'

      let actionBody: any = { type: actionType }
      if (actionType === 'assign_team') actionBody.teamId = actionTeamId
      if (actionType === 'assign_user') actionBody.userId = actionUserId
      if (actionType === 'start_flow') actionBody.flowId = actionFlowId
      if (actionType === 'add_tag') actionBody.tags = actionTags.split(',').map((s: string) => s.trim()).filter(Boolean)

      const body = JSON.stringify({
        name: name.trim(),
        description: description.trim() || null,
        matcher: matcherBody,
        action: actionBody,
        priority,
        isActive,
      })
      return rule
        ? apiFetch(`/routing-rules/${rule.id}`, { method: 'PATCH', body })
        : apiFetch('/routing-rules', { method: 'POST', body })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routing-rules'] })
      toast.success(rule ? 'Regra atualizada' : 'Regra criada')
      onClose()
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao salvar'),
  })

  const toggleArr = (arr: string[], value: string, setter: (next: string[]) => void) => {
    setter(arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value])
  }

  const canSave =
    name.trim() &&
    (actionType === 'assign_team' ? !!actionTeamId :
     actionType === 'assign_user' ? !!actionUserId :
     actionType === 'start_flow' ? !!actionFlowId :
     actionType === 'add_tag' ? actionTags.trim().length > 0 : false)

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="modal-surface rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold text-sm">{rule ? 'Editar regra' : 'Nova regra de roteamento'}</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          <div className="grid grid-cols-[1fr_120px_auto] gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Nome</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Ex: WhatsApp do número de vendas → Vendas"
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Prioridade</label>
              <input type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))}
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm" />
            </div>
            <label className="flex items-end gap-2 text-xs pb-2">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="accent-primary" />
              Ativa
            </label>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Descrição (opcional)</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm" />
          </div>

          {/* MATCHER */}
          <div className="border-t pt-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Quando casar (filtros AND)</p>

            <div>
              <label className="text-xs font-medium">Canais</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {channels.map((c) => (
                  <button key={c.id}
                    onClick={() => toggleArr(channelIds, c.id, setChannelIds)}
                    className={`px-2 py-1 rounded-full text-xs border transition ${
                      channelIds.includes(c.id) ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'
                    }`}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium">Tipos de canal</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {CHANNEL_TYPES.map((t) => (
                  <button key={t}
                    onClick={() => toggleArr(channelTypes, t, setChannelTypes)}
                    className={`px-2 py-1 rounded-full text-xs border transition ${
                      channelTypes.includes(t) ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'
                    }`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium">Empresas</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {companies.map((c) => (
                  <button key={c.id}
                    onClick={() => toggleArr(companyIds, c.id, setCompanyIds)}
                    className={`px-2 py-1 rounded-full text-xs border transition ${
                      companyIds.includes(c.id) ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'
                    }`}>
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Palavras-chave (qualquer)</label>
                <input value={keywords} onChange={(e) => setKeywords(e.target.value)}
                  placeholder="orçamento, comprar, suporte"
                  className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Tags do contato (qualquer)</label>
                <input value={tags} onChange={(e) => setTags(e.target.value)}
                  placeholder="VIP, premium"
                  className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Conversa de grupo?</label>
              <select value={isGroup} onChange={(e) => setIsGroup(e.target.value as any)}
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm">
                <option value="any">Qualquer</option>
                <option value="true">Só grupos</option>
                <option value="false">Só 1:1</option>
              </select>
            </div>
          </div>

          {/* ACTION */}
          <div className="border-t pt-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Então fazer</p>
            <div className="space-y-1.5">
              <select value={actionType} onChange={(e) => setActionType(e.target.value)}
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm">
                {Object.entries(ACTION_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            {actionType === 'assign_team' && (
              <select value={actionTeamId} onChange={(e) => setActionTeamId(e.target.value)}
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm">
                <option value="">— selecione um setor —</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            {actionType === 'assign_user' && (
              <select value={actionUserId} onChange={(e) => setActionUserId(e.target.value)}
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm">
                <option value="">— selecione um usuário —</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
              </select>
            )}
            {actionType === 'start_flow' && (
              <select value={actionFlowId} onChange={(e) => setActionFlowId(e.target.value)}
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm">
                <option value="">— selecione um fluxo —</option>
                {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            )}
            {actionType === 'add_tag' && (
              <input value={actionTags} onChange={(e) => setActionTags(e.target.value)}
                placeholder="tag1, tag2"
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm" />
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t shrink-0">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm hover:bg-accent">Cancelar</button>
          <button onClick={() => canSave && save.mutate()} disabled={!canSave || save.isPending}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50">
            {save.isPending ? 'Salvando...' : rule ? 'Salvar' : 'Criar regra'}
          </button>
        </div>
      </div>
    </div>
  )
}

function FallbackRulePanel({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()

  type WsSettings = {
    distributionMode?: 'all' | 'fixed' | 'round_robin'
    defaultAssigneeId?: string | null
    roundRobinUserIds?: string[]
  }

  const { data: settings, isLoading } = useQuery<WsSettings>({
    queryKey: ['workspace-settings'],
    queryFn: () => apiFetch<WsSettings>('/workspace/settings'),
  })

  const { data: users = [] } = useQuery<{ id: string; name: string | null; email: string }[]>({
    queryKey: ['users-list'],
    queryFn: () => apiFetch('/users'),
  })

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<WsSettings>) =>
      apiFetch('/workspace/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-settings'] })
      toast.success('Regra padrão atualizada')
    },
    onError: () => toast.error('Erro ao salvar regra padrão'),
  })

  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Carregando...</p>

  const s: WsSettings = settings ?? {}
  const distMode = s.distributionMode ?? 'all'
  const patch = (update: Partial<WsSettings>) => saveMutation.mutate(update)

  const userLabel = (id: string) => {
    const u = users.find(u => u.id === id)
    return u?.name ?? u?.email ?? id
  }

  const DIST_LABELS: Record<string, { label: string; desc: string }> = {
    all: { label: 'Todos veem', desc: 'Ninguém é atribuído — conversa entra na fila pública' },
    fixed: { label: 'Fixo', desc: 'Todas as conversas são atribuídas ao mesmo atendente' },
    round_robin: { label: 'Round-robin', desc: 'Rodízio entre os atendentes selecionados' },
  }

  return (
    <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4 mt-8">
      <div className="flex items-center gap-2 mb-2">
        <Filter className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-sm text-primary">Regra Padrão (Fallback)</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Se nenhuma regra acima casar e a empresa do contato não tiver regra específica, esta é a distribuição usada:
      </p>

      <div className="space-y-4">
        <div className="space-y-2">
          {(['all', 'fixed', 'round_robin'] as const).map((mode) => (
            <label key={mode} className={cn('flex items-start gap-2.5 cursor-pointer rounded-lg border bg-card p-3 transition-colors',
              distMode === mode ? 'border-primary ring-1 ring-primary/20' : 'hover:border-primary/40',
              !isAdmin && 'cursor-not-allowed opacity-60',
            )}>
              <input
                type="radio"
                name="fallback-dist"
                checked={distMode === mode}
                onChange={() => isAdmin && patch({ distributionMode: mode })}
                disabled={!isAdmin}
                className="mt-0.5 accent-primary"
              />
              <div>
                <p className="text-sm font-medium">{DIST_LABELS[mode].label}</p>
                <p className="text-xs text-muted-foreground">{DIST_LABELS[mode].desc}</p>
              </div>
            </label>
          ))}
        </div>

        {distMode === 'fixed' && (
          <div className="space-y-1.5 p-3 rounded-lg bg-card border">
            <p className="text-xs font-medium">Atendente padrão</p>
            <select
              value={s.defaultAssigneeId ?? ''}
              onChange={e => patch({ defaultAssigneeId: e.target.value || null })}
              disabled={!isAdmin}
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60"
            >
              <option value="">— Selecione —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name ?? u.email}</option>
              ))}
            </select>
          </div>
        )}

        {distMode === 'round_robin' && (
          <div className="space-y-1.5 p-3 rounded-lg bg-card border">
            <p className="text-xs font-medium">Atendentes no rodízio</p>
            <div className="rounded-lg border divide-y max-h-40 overflow-y-auto bg-transparent">
              {users.map(u => {
                const selected = (s.roundRobinUserIds ?? []).includes(u.id)
                return (
                  <label key={u.id} className={cn('flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-muted/40', !isAdmin && 'cursor-not-allowed opacity-60')}>
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={!isAdmin}
                      onChange={e => {
                        const current = s.roundRobinUserIds ?? []
                        patch({ roundRobinUserIds: e.target.checked ? [...current, u.id] : current.filter(id => id !== u.id) })
                      }}
                      className="accent-primary"
                    />
                    <span className="text-sm">{u.name ?? u.email}</span>
                  </label>
                )
              })}
            </div>
            {(s.roundRobinUserIds ?? []).length > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                Ordem atual: {(s.roundRobinUserIds ?? []).map(userLabel).join(' → ')}
              </p>
            )}
          </div>
        )}

        {!isAdmin && (
          <p className="text-xs text-muted-foreground italic">Apenas administradores podem alterar a regra padrão.</p>
        )}
      </div>
    </div>
  )
}

export default function RoutingRulesPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<RoutingRule | null | 'new'>(null)
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'ADMIN'

  const { data: rules = [] } = useQuery<RoutingRule[]>({
    queryKey: ['routing-rules'],
    queryFn: () => apiFetch('/routing-rules'),
  })

  const { data: teams = [] } = useQuery<TeamOpt[]>({
    queryKey: ['teams', 'opt'],
    queryFn: () => apiFetch('/teams/options'),
  })

  const { data: users = [] } = useQuery<UserOpt[]>({
    queryKey: ['users-list'],
    queryFn: () => apiFetch('/users'),
  })

  const { data: flows = [] } = useQuery<FlowOpt[]>({
    queryKey: ['flows', 'opt'],
    queryFn: () => apiFetch('/flows'),
  })

  const { data: channels = [] } = useQuery<ChannelOpt[]>({
    queryKey: ['channels-list'],
    queryFn: () => apiFetch('/channels'),
  })

  const { data: companies = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['companies'],
    queryFn: () => apiFetch('/companies'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/routing-rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routing-rules'] })
      toast.success('Regra removida')
    },
  })

  const toggle = useMutation({
    mutationFn: (vars: { id: string; isActive: boolean }) =>
      apiFetch(`/routing-rules/${vars.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: vars.isActive }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['routing-rules'] }),
  })

  const move = useMutation({
    mutationFn: (vars: { id: string; delta: number }) => {
      const idx = rules.findIndex((r) => r.id === vars.id)
      const swap = rules[idx + vars.delta]
      if (!swap) return Promise.resolve()
      return apiFetch('/routing-rules/reorder', {
        method: 'POST',
        body: JSON.stringify({
          order: [
            { id: rules[idx].id, priority: swap.priority },
            { id: swap.id, priority: rules[idx].priority },
          ],
        }),
      })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['routing-rules'] }),
  })

  function describeAction(action: any): string {
    if (!action) return '?'
    if (action.type === 'assign_team') {
      const t = teams.find((x) => x.id === action.teamId)
      return `→ Setor ${t?.name ?? action.teamId}`
    }
    if (action.type === 'assign_user') {
      const u = users.find((x) => x.id === action.userId)
      return `→ ${u?.name ?? action.userId}`
    }
    if (action.type === 'start_flow') {
      const f = flows.find((x) => x.id === action.flowId)
      return `▶ Flow ${f?.name ?? action.flowId}`
    }
    if (action.type === 'add_tag') return `🏷 ${(action.tags ?? []).join(', ')}`
    return action.type
  }

  return (
    <>
      <AdminPageLayout
        title="Regras de roteamento"
        icon={Filter}
        description="Direcione conversas automaticamente com base em canal, palavras-chave, tags e mais. Avaliadas em ordem de prioridade."
        action={
          <button onClick={() => setEditing('new')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
            <Plus className="h-3.5 w-3.5" /> Nova regra
          </button>
        }
      >
        {rules.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            Nenhuma regra cadastrada. Adicione uma para rotear conversas automaticamente.
          </div>
        ) : (
          <div className="space-y-1.5">
            {rules.map((r, i) => (
              <div key={r.id} className="rounded-xl border bg-card p-3 flex items-center gap-3">
                <div className="flex flex-col items-center gap-0.5">
                  <button onClick={() => move.mutate({ id: r.id, delta: -1 })} disabled={i === 0}
                    className="p-0.5 rounded hover:bg-accent disabled:opacity-30">
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <span className="text-[10px] text-muted-foreground font-mono">{r.priority}</span>
                  <button onClick={() => move.mutate({ id: r.id, delta: 1 })} disabled={i === rules.length - 1}
                    className="p-0.5 rounded hover:bg-accent disabled:opacity-30">
                    <ArrowDown className="h-3 w-3" />
                  </button>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm">{r.name}</p>
                    {!r.isActive && (
                      <span className="text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
                        INATIVA
                      </span>
                    )}
                  </div>
                  {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
                  <p className="text-xs text-muted-foreground mt-1">
                    <span className="font-mono text-[10px]">{describeAction(r.action)}</span>
                  </p>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button onClick={() => toggle.mutate({ id: r.id, isActive: !r.isActive })}
                    className={`p-2 rounded hover:bg-accent ${r.isActive ? 'text-green-600' : 'text-muted-foreground'}`}
                    title={r.isActive ? 'Pausar' : 'Ativar'}>
                    <Power className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setEditing(r)} className="p-2 rounded hover:bg-accent text-muted-foreground" title="Editar">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={async () => {
                      const ok = await confirm({ type: 'danger', title: `Remover "${r.name}"?`, confirmLabel: 'Remover' })
                      if (ok) remove.mutate(r.id)
                    }}
                    className="p-2 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="Remover">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Fallback panel at the bottom */}
        <FallbackRulePanel isAdmin={isAdmin} />
      </AdminPageLayout>

      {editing !== null && (
        <RuleFormModal
          rule={editing === 'new' ? null : editing}
          teams={teams} users={users} flows={flows} channels={channels} companies={companies}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

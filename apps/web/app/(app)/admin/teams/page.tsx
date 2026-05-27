'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import {
  Users2, Plus, Pencil, Trash2, X, Shield,
  Headphones, ShoppingCart, Wallet, Inbox as InboxIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { AdminPageLayout } from '@/components/admin/AdminPageLayout'

const DIST_LABELS: Record<string, string> = {
  all: 'Fila pública (todos veem)',
  fixed: 'Atendente fixo',
  round_robin: 'Round-robin (rotativo)',
  load_balanced: 'Balanceado por carga',
}

const ICON_MAP: Record<string, any> = {
  headphones: Headphones,
  'shopping-cart': ShoppingCart,
  wallet: Wallet,
  inbox: InboxIcon,
}

const ICON_OPTIONS = [
  { value: 'inbox', label: 'Inbox' },
  { value: 'headphones', label: 'Suporte' },
  { value: 'shopping-cart', label: 'Vendas' },
  { value: 'wallet', label: 'Financeiro' },
]

interface TeamMember {
  userId: string
  role: 'LEADER' | 'AGENT'
  isActive: boolean
  capacity: number | null
  user: { id: string; name: string; email: string }
}

interface Team {
  id: string
  workspaceId: string
  name: string
  slug: string
  color: string
  icon: string | null
  description: string | null
  distributionMode: string
  defaultAssigneeId: string | null
  roundRobinUserIds: string[] | null
  slaFirstResponseMin: number | null
  slaResolutionMin: number | null
  overflowTeamId: string | null
  isActive: boolean
  _count: { members: number; conversations: number }
  members: TeamMember[]
  stats?: {
    open: number
    waiting: number
    resolved24h: number
    avgFirstResponseMin: number | null
    activeMembers: number
  }
}

interface UserOption { id: string; name: string; email: string }

// ─── Modal CRUD ──────────────────────────────────────────────────────────────
function TeamFormModal({
  team, allUsers, allTeams, onClose,
}: { team: Team | null; allUsers: UserOption[]; allTeams: Team[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(team?.name ?? '')
  const [description, setDescription] = useState(team?.description ?? '')
  const [color, setColor] = useState(team?.color ?? '#6366f1')
  const [icon, setIcon] = useState(team?.icon ?? 'inbox')
  const [distributionMode, setDistMode] = useState(team?.distributionMode ?? 'all')
  const [defaultAssigneeId, setDefaultAssignee] = useState(team?.defaultAssigneeId ?? '')
  const [roundRobinUserIds, setRR] = useState<string[]>(
    Array.isArray(team?.roundRobinUserIds) ? team!.roundRobinUserIds! : [],
  )
  const [slaFR, setSlaFR] = useState(team?.slaFirstResponseMin?.toString() ?? '')
  const [slaRes, setSlaRes] = useState(team?.slaResolutionMin?.toString() ?? '')
  const [overflowTeamId, setOverflow] = useState(team?.overflowTeamId ?? '')

  const save = useMutation({
    mutationFn: () => {
      const body = JSON.stringify({
        name: name.trim(),
        description: description.trim() || null,
        color,
        icon: icon || null,
        distributionMode,
        defaultAssigneeId: distributionMode === 'fixed' ? (defaultAssigneeId || null) : null,
        roundRobinUserIds: distributionMode === 'round_robin' && roundRobinUserIds.length > 0 ? roundRobinUserIds : null,
        slaFirstResponseMin: slaFR ? Number(slaFR) : null,
        slaResolutionMin: slaRes ? Number(slaRes) : null,
        overflowTeamId: overflowTeamId || null,
      })
      return team
        ? apiFetch(`/teams/${team.id}`, { method: 'PATCH', body })
        : apiFetch('/teams', { method: 'POST', body })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      toast.success(team ? 'Setor atualizado' : 'Setor criado')
      onClose()
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao salvar'),
  })

  const toggleRR = (id: string) => {
    setRR((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Users2 className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold text-sm">{team ? 'Editar setor' : 'Novo setor'}</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_120px] gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Nome</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Suporte Técnico"
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Cor</label>
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                className="w-full h-9 rounded-lg border bg-transparent cursor-pointer" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Ícone</label>
              <select value={icon ?? ''} onChange={(e) => setIcon(e.target.value)}
                className="w-full rounded-lg border bg-transparent px-2 py-2 text-sm">
                {ICON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Descrição</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Para que serve este setor?"
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm" />
          </div>

          <div className="space-y-2 border-t pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Distribuição</p>
            <div className="space-y-1.5">
              <select value={distributionMode} onChange={(e) => setDistMode(e.target.value)}
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm">
                {Object.entries(DIST_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            {distributionMode === 'fixed' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Atendente fixo</label>
                <select value={defaultAssigneeId} onChange={(e) => setDefaultAssignee(e.target.value)}
                  className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm">
                  <option value="">— selecione —</option>
                  {allUsers.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
                </select>
              </div>
            )}

            {distributionMode === 'round_robin' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Usuários na rotação (deixe vazio pra usar todos os membros)</label>
                <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto p-2 border rounded-lg">
                  {allUsers.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="checkbox" checked={roundRobinUserIds.includes(u.id)}
                        onChange={() => toggleRR(u.id)} className="accent-primary" />
                      {u.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 border-t pt-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">SLA 1ª resposta (min)</label>
              <input type="number" min={1} value={slaFR} onChange={(e) => setSlaFR(e.target.value)}
                placeholder="Ex: 15"
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">SLA resolução (min)</label>
              <input type="number" min={1} value={slaRes} onChange={(e) => setSlaRes(e.target.value)}
                placeholder="Ex: 240"
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Setor de overflow (transborda se ninguém disponível)</label>
            <select value={overflowTeamId} onChange={(e) => setOverflow(e.target.value)}
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm">
              <option value="">— nenhum —</option>
              {allTeams.filter((t) => t.id !== team?.id).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t shrink-0">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm hover:bg-accent">Cancelar</button>
          <button onClick={() => name.trim() && save.mutate()}
            disabled={!name.trim() || save.isPending}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50">
            {save.isPending ? 'Salvando...' : team ? 'Salvar' : 'Criar setor'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal de membros ────────────────────────────────────────────────────────
function MembersModal({ team, allUsers, onClose }: { team: Team; allUsers: UserOption[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [addUserId, setAddUserId] = useState('')
  const [addRole, setAddRole] = useState<'LEADER' | 'AGENT'>('AGENT')
  const [addCapacity, setAddCapacity] = useState('')

  const add = useMutation({
    mutationFn: () => apiFetch(`/teams/${team.id}/members`, {
      method: 'POST',
      body: JSON.stringify({
        userId: addUserId,
        role: addRole,
        isActive: true,
        capacity: addCapacity ? Number(addCapacity) : null,
      }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', 'admin'] })
      setAddUserId('')
      setAddCapacity('')
      toast.success('Membro adicionado')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro'),
  })

  const updateMember = useMutation({
    mutationFn: (vars: { userId: string; patch: Partial<TeamMember> }) =>
      apiFetch(`/teams/${team.id}/members/${vars.userId}`, {
        method: 'PATCH',
        body: JSON.stringify(vars.patch),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', 'admin'] })
      toast.success('Status atualizado!')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao atualizar membro'),
  })

  const remove = useMutation({
    mutationFn: (userId: string) => apiFetch(`/teams/${team.id}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', 'admin'] })
      toast.success('Membro removido')
    },
  })

  const availableUsers = allUsers.filter((u) => !team.members.some((m) => m.userId === u.id))

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ background: team.color }} />
            <h2 className="font-semibold text-sm">Membros — {team.name}</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Add new */}
          {availableUsers.length > 0 && (
            <div className="rounded-lg border p-3 bg-muted/30 space-y-2">
              <p className="text-xs font-semibold">Adicionar membro</p>
              <div className="grid grid-cols-[1fr_120px_120px_auto] gap-2">
                <select value={addUserId} onChange={(e) => setAddUserId(e.target.value)}
                  className="rounded-lg border bg-background px-2 py-2 text-xs">
                  <option value="">— usuário —</option>
                  {availableUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <select value={addRole} onChange={(e) => setAddRole(e.target.value as any)}
                  className="rounded-lg border bg-background px-2 py-2 text-xs">
                  <option value="AGENT">Atendente</option>
                  <option value="LEADER">Líder</option>
                </select>
                <input type="number" min={1} placeholder="Capacidade" value={addCapacity}
                  onChange={(e) => setAddCapacity(e.target.value)}
                  className="rounded-lg border bg-background px-2 py-2 text-xs" />
                <button onClick={() => addUserId && add.mutate()} disabled={!addUserId || add.isPending}
                  className="px-3 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground disabled:opacity-50">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Lista */}
          <div className="space-y-1.5">
            {team.members.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">Nenhum membro ainda.</p>
            ) : team.members.map((m) => (
              <div key={m.userId} className="flex items-center gap-3 p-2 rounded-lg border hover:bg-accent/30">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{m.user.name}</p>
                    {m.role === 'LEADER' && (
                      <span className="text-[10px] font-semibold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                        LÍDER
                      </span>
                    )}
                    {!m.isActive && (
                      <span className="text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
                        PAUSADO
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">{m.user.email}</p>
                </div>
                <div className="flex items-center gap-1">
                  <select value={m.role}
                    onChange={(e) => updateMember.mutate({ userId: m.userId, patch: { role: e.target.value as any } })}
                    className="text-xs border rounded px-1.5 py-1 bg-background">
                    <option value="AGENT">Atendente</option>
                    <option value="LEADER">Líder</option>
                  </select>
                  <input type="number" min={1} placeholder="∞" value={m.capacity ?? ''}
                    onChange={(e) => updateMember.mutate({
                      userId: m.userId,
                      patch: { capacity: e.target.value ? Number(e.target.value) : null },
                    })}
                    className="w-14 text-xs border rounded px-1.5 py-1 bg-background" />
                  <button onClick={() => updateMember.mutate({ userId: m.userId, patch: { isActive: !m.isActive } })}
                    className={cn('px-2 py-1 text-xs rounded', m.isActive ? 'text-green-600' : 'text-muted-foreground')}>
                    {m.isActive ? 'Ativo' : 'Pausado'}
                  </button>
                  <button onClick={() => remove.mutate(m.userId)}
                    className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end px-5 py-4 border-t shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-muted">Fechar</button>
        </div>
      </div>
    </div>
  )
}

// ─── Página ──────────────────────────────────────────────────────────────────
export default function TeamsPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<Team | null | 'new'>(null)
  const [managingMembers, setManagingMembers] = useState<Team | null>(null)

  const { data: teams = [], isLoading } = useQuery<Team[]>({
    queryKey: ['teams', 'admin'],
    queryFn: () => apiFetch('/teams?includeStats=1'),
  })

  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ['users-list'],
    queryFn: () => apiFetch('/users'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/teams/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      toast.success('Setor removido')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao remover'),
  })

  return (
    <>
      <AdminPageLayout
        title="Setores de atendimento"
        icon={Users2}
        description="Organize atendentes em times com regras de distribuição, SLA e overflow."
        action={
          <button onClick={() => setEditing('new')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
            <Plus className="h-3.5 w-3.5" /> Novo setor
          </button>
        }
      >
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : teams.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            Nenhum setor criado. Comece criando um time como "Suporte" ou "Vendas".
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {teams.map((t) => {
              const Icon = ICON_MAP[t.icon ?? 'inbox'] ?? InboxIcon
              return (
                <div key={t.id} className="rounded-xl border bg-card p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: `${t.color}20`, color: t.color }}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm">{t.name}</p>
                        {!t.isActive && (
                          <span className="text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
                            INATIVO
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {DIST_LABELS[t.distributionMode] ?? t.distributionMode}
                      </p>
                      {t.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button onClick={() => setEditing(t)} className="p-2 rounded hover:bg-accent text-muted-foreground" title="Editar">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={async () => {
                          const ok = await confirm({
                            type: 'danger',
                            title: `Remover "${t.name}"?`,
                            message: `${t._count.conversations} conversa(s) já passaram por este setor.`,
                            warning: 'Não pode haver conversas OPEN/WAITING no setor.',
                            confirmLabel: 'Remover',
                          })
                          if (ok) remove.mutate(t.id)
                        }}
                        className="p-2 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="Remover">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div className="rounded-lg bg-muted/40 p-2">
                      <p className="text-[10px] text-muted-foreground">Abertas</p>
                      <p className="text-sm font-semibold">{t.stats?.open ?? 0}</p>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-2">
                      <p className="text-[10px] text-muted-foreground">Aguardando</p>
                      <p className="text-sm font-semibold">{t.stats?.waiting ?? 0}</p>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-2">
                      <p className="text-[10px] text-muted-foreground">Membros</p>
                      <p className="text-sm font-semibold">{t.stats?.activeMembers ?? t._count.members}</p>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-2">
                      <p className="text-[10px] text-muted-foreground">TMA (min)</p>
                      <p className="text-sm font-semibold">{t.stats?.avgFirstResponseMin ?? '—'}</p>
                    </div>
                  </div>

                  <button onClick={() => setManagingMembers(t)}
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-medium hover:bg-accent">
                    <Shield className="h-3.5 w-3.5" /> Gerenciar membros ({t._count.members})
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </AdminPageLayout>

      {editing !== null && (
        <TeamFormModal
          team={editing === 'new' ? null : editing}
          allUsers={users}
          allTeams={teams}
          onClose={() => setEditing(null)}
        />
      )}
      {managingMembers && (
        <MembersModal team={teams.find(t => t.id === managingMembers.id) ?? managingMembers} allUsers={users} onClose={() => setManagingMembers(null)} />
      )}
    </>
  )
}

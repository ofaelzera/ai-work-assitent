'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Plus, Kanban, LayoutGrid, X, User, Users, Lock, Globe, UserPlus, Settings, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { usePermission } from '@/lib/usePermission'

type Visibility = 'PRIVATE' | 'SHARED' | 'PUBLIC'

interface Board {
  id: string
  name: string
  ownerId: string | null
  visibility: Visibility
  isGlobal: boolean
  isShared: boolean
  isMine: boolean
  sharesCount: number
  createdAt: string
  cardCount: number
}

interface WorkspaceUser { id: string; name: string; email: string }

// ─── Modal de criar board ────────────────────────────────────────────────────
function NewBoardModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const canShareBoard = usePermission('boards.manage')
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('PRIVATE')
  const [shareWith, setShareWith] = useState<Set<string>>(new Set())

  const { data: users = [] } = useQuery<WorkspaceUser[]>({
    queryKey: ['users'],
    queryFn: () => apiFetch('/users'),
    staleTime: 60_000,
  })

  const create = useMutation({
    mutationFn: () => apiFetch<{ id: string }>('/kanban/boards', {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(),
        visibility: shareWith.size > 0 ? 'SHARED' : visibility,
        ...(shareWith.size > 0 && { shareWith: Array.from(shareWith) }),
      }),
    }),
    onSuccess: (board) => { onCreated(board.id); onClose() },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao criar board'),
  })

  const toggleUser = (id: string) => {
    setShareWith(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    if (visibility === 'PRIVATE') setVisibility('SHARED')
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Plus className="h-4 w-4 text-muted-foreground" /> Novo board
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Nome do board</label>
            <input
              autoFocus value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && name.trim()) create.mutate() }}
              placeholder="Ex: Vendas Q2, Backlog do João, ..."
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Visibilidade</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { v: 'PRIVATE' as Visibility, icon: Lock, label: 'Privado', desc: 'Só você', color: 'text-amber-600', enabled: true },
                { v: 'SHARED'  as Visibility, icon: Users, label: 'Compartilhado', desc: 'Pessoas específicas', color: 'text-blue-600', enabled: true },
                { v: 'PUBLIC'  as Visibility, icon: Globe, label: 'Público', desc: 'Todos veem', color: 'text-emerald-600', enabled: canShareBoard },
              ]).map(({ v, icon: Icon, label, desc, color, enabled }) => (
                <button key={v} type="button"
                  onClick={() => enabled && setVisibility(v)}
                  disabled={!enabled}
                  title={!enabled ? 'Você não tem permissão pra criar board público' : ''}
                  className={cn('flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left text-xs transition-colors',
                    visibility === v ? 'border-primary bg-primary/5' : 'hover:bg-muted/30',
                    !enabled && 'opacity-40 cursor-not-allowed')}>
                  <Icon className={cn('h-3.5 w-3.5', color)} />
                  <div>
                    <p className="font-medium">{label}</p>
                    <p className="text-[10px] text-muted-foreground">{desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Picker de users (só visível se SHARED) */}
          {(visibility === 'SHARED' || shareWith.size > 0) && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium flex items-center gap-1">
                <UserPlus className="h-3 w-3" /> Compartilhar com ({shareWith.size})
              </label>
              <div className="rounded-lg border max-h-48 overflow-y-auto divide-y">
                {users.length === 0 && (
                  <p className="text-xs text-muted-foreground p-3 text-center">Nenhum outro usuário no workspace</p>
                )}
                {users.map(u => {
                  const selected = shareWith.has(u.id)
                  return (
                    <button key={u.id} type="button"
                      onClick={() => toggleUser(u.id)}
                      className={cn('w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent text-left',
                        selected && 'bg-primary/5')}>
                      <input
                        type="checkbox" checked={selected} readOnly
                        className="accent-primary shrink-0 pointer-events-none"
                      />
                      <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-semibold text-primary shrink-0">
                        {(u.name ?? u.email)[0].toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{u.name ?? u.email}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{u.email}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t shrink-0">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm hover:bg-accent">Cancelar</button>
          <button
            onClick={() => name.trim() && create.mutate()}
            disabled={!name.trim() || create.isPending}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50">
            {create.isPending ? 'Criando...' : 'Criar board'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal de editar board ───────────────────────────────────────────────────
interface BoardShareRow { id: string; userId: string; user: WorkspaceUser | null; createdAt: string }
interface TeamLite { id: string; name: string; slug: string; color: string; icon?: string | null }
interface BoardTeamShareRow { id: string; teamId: string; team: TeamLite; createdAt: string }

function EditBoardModal({ board, onClose, onSaved }: { board: Board; onClose: () => void; onSaved: () => void }) {
  const canShareBoard = usePermission('boards.manage')
  const qc = useQueryClient()
  const [name, setName] = useState(board.name)
  const [visibility, setVisibility] = useState<Visibility>(board.visibility)

  const { data: users = [] } = useQuery<WorkspaceUser[]>({
    queryKey: ['users'],
    queryFn: () => apiFetch('/users'),
    staleTime: 60_000,
  })

  const { data: teams = [] } = useQuery<TeamLite[]>({
    queryKey: ['teams'],
    queryFn: () => apiFetch('/teams'),
    staleTime: 60_000,
  })

  const { data: shares = [] } = useQuery<BoardShareRow[]>({
    queryKey: ['board-shares', board.id],
    queryFn: () => apiFetch(`/kanban/boards/${board.id}/shares`),
  })

  const { data: teamShares = [] } = useQuery<BoardTeamShareRow[]>({
    queryKey: ['board-team-shares', board.id],
    queryFn: () => apiFetch(`/kanban/boards/${board.id}/team-shares`),
  })

  const sharedIds = new Set(shares.map(s => s.userId))
  const sharedTeamIds = new Set(teamShares.map(s => s.teamId))

  const addTeamShare = useMutation({
    mutationFn: (teamId: string) => apiFetch(`/kanban/boards/${board.id}/team-shares`, {
      method: 'POST', body: JSON.stringify({ teamId }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['board-team-shares', board.id] }),
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao compartilhar setor'),
  })

  const removeTeamShare = useMutation({
    mutationFn: (teamId: string) => apiFetch(`/kanban/boards/${board.id}/team-shares/${teamId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['board-team-shares', board.id] }),
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao remover'),
  })

  const toggleTeam = (id: string) => {
    if (sharedTeamIds.has(id)) removeTeamShare.mutate(id)
    else addTeamShare.mutate(id)
  }

  const addShare = useMutation({
    mutationFn: (userId: string) => apiFetch(`/kanban/boards/${board.id}/shares`, {
      method: 'POST', body: JSON.stringify({ userId }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['board-shares', board.id] }),
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao compartilhar'),
  })

  const removeShare = useMutation({
    mutationFn: (userId: string) => apiFetch(`/kanban/boards/${board.id}/shares/${userId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['board-shares', board.id] }),
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao remover'),
  })

  const save = useMutation({
    mutationFn: () => apiFetch(`/kanban/boards/${board.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...(name.trim() && name.trim() !== board.name && { name: name.trim() }),
        ...(visibility !== board.visibility && { visibility }),
      }),
    }),
    onSuccess: () => { toast.success('Board atualizado'); onSaved(); onClose() },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao salvar'),
  })

  const remove = useMutation({
    mutationFn: () => apiFetch(`/kanban/boards/${board.id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success('Board removido'); onSaved(); onClose() },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao deletar'),
  })

  const handleDelete = () => {
    if (!confirm(`Deletar o board "${board.name}"? Isso remove colunas e cards (soft-delete).`)) return
    remove.mutate()
  }

  const toggleUser = (id: string) => {
    if (sharedIds.has(id)) removeShare.mutate(id)
    else addShare.mutate(id)
  }

  const otherUsers = users.filter(u => u.id !== board.ownerId)

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Settings className="h-4 w-4 text-muted-foreground" /> Editar board
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Nome</label>
            <input
              value={name} onChange={e => setName(e.target.value)}
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Visibilidade</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { v: 'PRIVATE' as Visibility, icon: Lock, label: 'Privado', desc: 'Só você', color: 'text-amber-600', enabled: true },
                { v: 'SHARED'  as Visibility, icon: Users, label: 'Compartilhado', desc: 'Pessoas escolhidas', color: 'text-blue-600', enabled: true },
                { v: 'PUBLIC'  as Visibility, icon: Globe, label: 'Público', desc: 'Todos veem', color: 'text-emerald-600', enabled: canShareBoard },
              ]).map(({ v, icon: Icon, label, desc, color, enabled }) => (
                <button key={v} type="button"
                  onClick={() => enabled && setVisibility(v)}
                  disabled={!enabled}
                  title={!enabled ? 'Sem permissão pra tornar público' : ''}
                  className={cn('flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left text-xs transition-colors',
                    visibility === v ? 'border-primary bg-primary/5' : 'hover:bg-muted/30',
                    !enabled && 'opacity-40 cursor-not-allowed')}>
                  <Icon className={cn('h-3.5 w-3.5', color)} />
                  <div>
                    <p className="font-medium">{label}</p>
                    <p className="text-[10px] text-muted-foreground">{desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {(visibility === 'SHARED' || sharedIds.size > 0) && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium flex items-center gap-1">
                <UserPlus className="h-3 w-3" /> Compartilhado com ({sharedIds.size})
              </label>
              <div className="rounded-lg border max-h-48 overflow-y-auto divide-y">
                {otherUsers.length === 0 && (
                  <p className="text-xs text-muted-foreground p-3 text-center">Nenhum outro usuário no workspace</p>
                )}
                {otherUsers.map(u => {
                  const selected = sharedIds.has(u.id)
                  return (
                    <button key={u.id} type="button"
                      onClick={() => toggleUser(u.id)}
                      disabled={addShare.isPending || removeShare.isPending}
                      className={cn('w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent text-left',
                        selected && 'bg-primary/5')}>
                      <input type="checkbox" checked={selected} readOnly className="accent-primary shrink-0 pointer-events-none" />
                      <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-semibold text-primary shrink-0">
                        {(u.name ?? u.email)[0].toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{u.name ?? u.email}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{u.email}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
              <p className="text-[10px] text-muted-foreground">Mudanças nos compartilhamentos são salvas na hora.</p>
            </div>
          )}

          {(visibility === 'SHARED' || sharedTeamIds.size > 0) && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium flex items-center gap-1">
                <Users className="h-3 w-3" /> Compartilhar com setores ({sharedTeamIds.size})
              </label>
              <div className="rounded-lg border max-h-48 overflow-y-auto divide-y">
                {teams.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-3 text-center">Nenhum setor cadastrado</p>
                ) : (
                  teams.map(t => {
                    const selected = sharedTeamIds.has(t.id)
                    return (
                      <button key={t.id} type="button"
                        onClick={() => toggleTeam(t.id)}
                        disabled={addTeamShare.isPending || removeTeamShare.isPending}
                        className={cn('w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent text-left',
                          selected && 'bg-primary/5')}>
                        <input type="checkbox" checked={selected} readOnly className="accent-primary shrink-0 pointer-events-none" />
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: t.color }} />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{t.name}</p>
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">Todos os membros do setor veem o board. Líderes podem gerenciá-lo.</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t shrink-0">
          {(board.isMine || canShareBoard) ? (
            <button
              onClick={handleDelete}
              disabled={remove.isPending}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50">
              <Trash2 className="h-3.5 w-3.5" /> Deletar
            </button>
          ) : <div />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm hover:bg-accent">Cancelar</button>
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending || !name.trim()}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50">
              {save.isPending ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function KanbanPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Board | null>(null)
  const canShareBoard = usePermission('boards.manage')

  const { data: boards = [], isLoading } = useQuery({
    queryKey: ['boards'],
    queryFn: () => apiFetch<Board[]>('/kanban/boards'),
  })

  const handleCreated = (id: string) => {
    queryClient.invalidateQueries({ queryKey: ['boards'] })
    router.push(`/kanban/${id}`)
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Carregando...
      </div>
    )
  }

  if (boards.length === 0) {
    return (
      <>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <Kanban className="h-12 w-12 mx-auto text-muted-foreground opacity-40" />
            <div>
              <p className="font-medium">Nenhum board ainda</p>
              <p className="text-sm text-muted-foreground">
                {canShareBoard ? 'Crie seu primeiro board para começar' : 'Peça a um admin pra criar um board e compartilhar com você'}
              </p>
            </div>
            {canShareBoard && (
              <button
                onClick={() => setCreating(true)}
                className="flex items-center gap-2 mx-auto rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                Criar board
              </button>
            )}
          </div>
        </div>
        {creating && <NewBoardModal onClose={() => setCreating(false)} onCreated={handleCreated} />}
      </>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-card shrink-0">
        <div className="flex items-center gap-2">
          <LayoutGrid className="h-5 w-5 text-muted-foreground" />
          <h1 className="font-semibold">Boards</h1>
          <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
            {boards.length}
          </span>
        </div>
        {canShareBoard && (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Novo board
          </button>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {boards.map((board) => {
            const badge = board.visibility === 'PUBLIC'
              ? { Icon: Globe, label: 'Público', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' }
              : board.visibility === 'SHARED'
              ? { Icon: Users, label: board.isMine ? `Compartilhado (${board.sharesCount})` : 'Compartilhado', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' }
              : board.isMine
              ? { Icon: User, label: 'Privado', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' }
              : { Icon: Lock, label: 'De outro', cls: 'bg-muted text-muted-foreground' }
            const canEdit = board.isMine || canShareBoard
            return (
              <div
                key={board.id}
                onClick={() => router.push(`/kanban/${board.id}`)}
                className={cn(
                  'relative flex flex-col gap-3 text-left glass-card rounded-xl p-4 cursor-pointer overflow-hidden',
                  'hover:border-primary/40 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 group',
                )}
              >
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary to-secondary opacity-0 group-hover:opacity-100 transition-opacity" />
                
                <div className="flex items-start justify-between relative z-10">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shrink-0">
                    <Kanban className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex items-center gap-1.5 h-8">
                    <span className={cn('flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider', badge.cls)}>
                      <badge.Icon className="h-3 w-3" /> {badge.label}
                    </span>
                    {canEdit ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditing(board) }}
                        title="Editar board"
                        className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-accent transition-all shrink-0">
                        <Settings className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    ) : (
                      <div className="w-5" /> /* Placeholder para manter alinhamento */
                    )}
                  </div>
                </div>
                
                <div className="flex-1 mt-1">
                  <p className="font-bold text-base group-hover:text-primary transition-colors tracking-tight line-clamp-2 leading-tight">
                    {board.name}
                  </p>
                  <p className="text-xs font-medium text-muted-foreground mt-1">
                    {board.cardCount} {board.cardCount === 1 ? 'card' : 'cards'}
                  </p>
                </div>
                
                <div className="pt-2.5 mt-1 border-t border-border/50">
                  <p className="text-[10px] text-muted-foreground/60 font-semibold uppercase tracking-wider">
                    Criado em {new Date(board.createdAt).toLocaleDateString('pt-BR')}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {creating && <NewBoardModal onClose={() => setCreating(false)} onCreated={handleCreated} />}
      {editing && (
        <EditBoardModal
          board={editing}
          onClose={() => setEditing(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['boards'] })}
        />
      )}
    </div>
  )
}

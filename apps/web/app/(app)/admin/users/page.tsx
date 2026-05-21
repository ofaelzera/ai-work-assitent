'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { Users, Plus, Trash2, Pencil, X, ShieldCheck, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth'

interface WorkspaceUser {
  id: string
  name: string
  email: string
  role: 'ADMIN' | 'MEMBER'
  createdAt: string
}

const DEFAULT_FORM = { name: '', email: '', password: '', role: 'MEMBER' as 'ADMIN' | 'MEMBER' }

function RoleBadge({ role }: { role: 'ADMIN' | 'MEMBER' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        role === 'ADMIN'
          ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
          : 'bg-muted text-muted-foreground',
      )}
    >
      {role === 'ADMIN' ? <ShieldCheck className="h-3 w-3" /> : <User className="h-3 w-3" />}
      {role === 'ADMIN' ? 'Admin' : 'Membro'}
    </span>
  )
}

interface UserModalProps {
  onClose: () => void
  onSave: (data: typeof DEFAULT_FORM) => void
  isPending: boolean
  editing: WorkspaceUser | null
}

function UserModal({ onClose, onSave, isPending, editing }: UserModalProps) {
  const [form, setForm] = useState<typeof DEFAULT_FORM>(
    editing
      ? { name: editing.name, email: editing.email, password: '', role: editing.role }
      : DEFAULT_FORM,
  )

  const canSubmit = form.name && form.email && (!editing || form.name)

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md p-6 space-y-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{editing ? 'Editar usuário' : 'Novo usuário'}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Nome *</label>
            <input
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="Nome completo"
              className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div>
            <label className="text-xs font-medium">Email *</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
              placeholder="email@exemplo.com"
              disabled={!!editing}
              className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60"
            />
          </div>

          {!editing && (
            <div>
              <label className="text-xs font-medium">Senha *</label>
              <input
                type="password"
                value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                placeholder="Mínimo 8 caracteres"
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          )}

          <div>
            <label className="text-xs font-medium">Perfil</label>
            <select
              value={form.role}
              onChange={e => setForm(p => ({ ...p, role: e.target.value as 'ADMIN' | 'MEMBER' }))}
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="MEMBER">Membro</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-accent">
            Cancelar
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={!canSubmit || isPending}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {isPending ? 'Salvando...' : editing ? 'Salvar' : 'Criar usuário'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function UsersPage() {
  const queryClient = useQueryClient()
  const { user: me } = useAuthStore()
  const isAdmin = me?.role === 'ADMIN'

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<WorkspaceUser | null>(null)

  const { data: users = [], isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch<WorkspaceUser[]>('/users'),
    retry: false,
  })

  const createMutation = useMutation({
    mutationFn: (data: typeof DEFAULT_FORM) =>
      apiFetch<WorkspaceUser>('/users', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: (u) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setShowModal(false)
      toast.success(`Usuário "${u.name}" criado!`)
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao criar usuário'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<typeof DEFAULT_FORM> }) =>
      apiFetch(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setShowModal(false)
      setEditing(null)
      toast.success('Usuário atualizado!')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao atualizar usuário'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('Usuário removido')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao remover usuário'),
  })

  const handleSave = (form: typeof DEFAULT_FORM) => {
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: { name: form.name, role: form.role } })
    } else {
      createMutation.mutate(form)
    }
  }

  const openEdit = (user: WorkspaceUser) => {
    setEditing(user)
    setShowModal(true)
  }

  const openCreate = () => {
    setEditing(null)
    setShowModal(true)
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <>
      <div className="p-6 max-w-4xl space-y-6 h-full overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Usuários</h1>
            <p className="text-sm text-muted-foreground">Gerencie os membros do workspace</p>
          </div>
          {isAdmin && (
            <button
              onClick={openCreate}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> Novo usuário
            </button>
          )}
        </div>

        {!isAdmin && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
            Apenas administradores podem criar ou remover usuários.
          </div>
        )}

        {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

        {error && (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <Users className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground">Endpoint de usuários não disponível ainda</p>
            <p className="text-xs text-muted-foreground mt-1">Adicione a rota <code className="font-mono bg-muted px-1 rounded">GET /users</code> ao backend</p>
          </div>
        )}

        {!isLoading && !error && users.length === 0 && (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <Users className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground">Nenhum usuário encontrado</p>
          </div>
        )}

        {!error && users.length > 0 && (
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Nome</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Perfil</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Criado em</th>
                  {isAdmin && <th className="px-4 py-3 text-right font-medium text-muted-foreground">Ações</th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-medium">{u.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                    <td className="px-4 py-3">
                      <RoleBadge role={u.role} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(u.createdAt).toLocaleDateString('pt-BR')}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(u)}
                            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"
                            title="Editar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => { if (confirm(`Remover "${u.name}"?`)) deleteMutation.mutate(u.id) }}
                            disabled={u.id === me?.sub}
                            className="p-1.5 rounded-lg hover:bg-accent text-destructive disabled:opacity-30"
                            title={u.id === me?.sub ? 'Não é possível remover a si mesmo' : 'Remover'}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <UserModal
          onClose={() => { setShowModal(false); setEditing(null) }}
          onSave={handleSave}
          isPending={isPending}
          editing={editing}
        />
      )}
    </>
  )
}

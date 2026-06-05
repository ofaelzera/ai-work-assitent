'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { Shield, Plus, Pencil, Trash2, X, Check, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { AdminPageLayout } from '@/components/admin/AdminPageLayout'

interface CustomRole {
  id: string
  name: string
  description: string | null
  permissions: string[]
  isSystem: boolean
  _count: { users: number }
}

interface PermissionDef { key: string; label: string }

/** Agrupa permissões por categoria (prefixo antes do ponto). */
function groupPermissions(perms: PermissionDef[]) {
  const categoryLabel: Record<string, string> = {
    conversations: 'Conversas',
    cards: 'Kanban — Cards',
    boards: 'Kanban — Boards',
    contacts: 'Contatos',
    companies: 'Empresas',
    storage: 'Arquivos',
    admin: 'Admin',
    reports: 'Relatórios',
  }
  const groups: Record<string, { label: string; perms: PermissionDef[] }> = {}
  for (const p of perms) {
    const cat = p.key.split('.')[0]
    if (!groups[cat]) groups[cat] = { label: categoryLabel[cat] ?? cat, perms: [] }
    groups[cat].perms.push(p)
  }
  return groups
}

// ─── Modal de criar/editar role ──────────────────────────────────────────────
function RoleFormModal({
  role,
  allPermissions,
  onClose,
}: {
  role: CustomRole | null
  allPermissions: PermissionDef[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permissions ?? []))

  const groups = useMemo(() => groupPermissions(allPermissions), [allPermissions])
  const isEdit = !!role
  const isSystem = role?.isSystem ?? false

  const save = useMutation({
    mutationFn: () => {
      const body = JSON.stringify({
        name: name.trim(),
        description: description.trim() || null,
        permissions: Array.from(selected),
      })
      return isEdit
        ? apiFetch(`/roles/${role!.id}`, { method: 'PATCH', body })
        : apiFetch('/roles', { method: 'POST', body })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
      toast.success(isEdit ? 'Role atualizado' : 'Role criado')
      onClose()
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao salvar role'),
  })

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }
  const toggleGroup = (perms: PermissionDef[]) => {
    const allOn = perms.every(p => selected.has(p.key))
    setSelected(prev => {
      const next = new Set(prev)
      for (const p of perms) allOn ? next.delete(p.key) : next.add(p.key)
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="modal-surface rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <div>
              <h2 className="font-semibold text-sm">{isEdit ? 'Editar role' : 'Novo role'}</h2>
              {isSystem && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <Lock className="h-3 w-3" /> Role do sistema — nome não pode ser alterado
                </p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Nome</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={isSystem}
                placeholder="Ex: Supervisor de Vendas"
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Descrição</label>
              <input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="O que este role faz?"
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Permissões ({selected.size}/{allPermissions.length})
            </p>
            {Object.entries(groups).map(([cat, { label, perms }]) => {
              const allOn = perms.every(p => selected.has(p.key))
              const someOn = perms.some(p => selected.has(p.key))
              return (
                <div key={cat} className="rounded-lg border bg-card overflow-hidden">
                  <button
                    onClick={() => toggleGroup(perms)}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-muted/30 hover:bg-muted/50 text-left transition-colors">
                    <div className={cn('h-4 w-4 rounded border flex items-center justify-center shrink-0',
                      allOn ? 'bg-primary border-primary' : someOn ? 'bg-primary/30 border-primary' : 'border-border')}>
                      {allOn && <Check className="h-3 w-3 text-primary-foreground" />}
                    </div>
                    <span className="text-xs font-semibold">{label}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {perms.filter(p => selected.has(p.key)).length}/{perms.length}
                    </span>
                  </button>
                  <div className="divide-y">
                    {perms.map(p => (
                      <label key={p.key}
                        className="flex items-start gap-2 px-3 py-2 hover:bg-accent/40 cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={selected.has(p.key)}
                          onChange={() => toggle(p.key)}
                          className="mt-0.5 accent-primary shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <code className="text-[10px] font-mono text-muted-foreground">{p.key}</code>
                          <p className="text-foreground">{p.label}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t shrink-0">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm hover:bg-accent">Cancelar</button>
          <button
            onClick={() => name.trim() && save.mutate()}
            disabled={!name.trim() || save.isPending}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50">
            {save.isPending ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Criar role'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Página ──────────────────────────────────────────────────────────────────
export default function RolesPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<CustomRole | null | 'new'>(null)

  const { data: roles = [], isLoading } = useQuery<CustomRole[]>({
    queryKey: ['roles'],
    queryFn: () => apiFetch('/roles'),
  })

  const { data: permissions = [] } = useQuery<PermissionDef[]>({
    queryKey: ['permissions-catalog'],
    queryFn: () => apiFetch('/permissions'),
    staleTime: Infinity,
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/roles/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
      toast.success('Role removido')
    },
    onError: (e: any) => {
      if (e?.body?.error === 'roleInUse') {
        toast.error(e.body.message)
      } else {
        toast.error('Erro ao remover role')
      }
    },
  })

  return (
    <>
      <AdminPageLayout
        title="Roles e permissões"
        description="Crie roles customizados pra controlar o que cada atendente pode fazer."
        action={
          <button
            onClick={() => setEditing('new')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
          >
            <Plus className="h-3.5 w-3.5" /> Novo role
          </button>
        }
      >

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : (
        <div className="space-y-2">
          {roles.map(role => (
            <div key={role.id} className="rounded-xl border bg-card p-4 flex items-center gap-4">
              <div className={cn('h-10 w-10 rounded-xl flex items-center justify-center shrink-0',
                role.isSystem ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                <Shield className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-sm">{role.name}</p>
                  {role.isSystem && (
                    <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 px-1.5 py-0.5 rounded-full">
                      SISTEMA
                    </span>
                  )}
                </div>
                {role.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{role.description}</p>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">
                  {role.permissions.length} permissão(ões) · {role._count.users} usuário(s)
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setEditing(role)}
                  className="p-2 rounded hover:bg-accent text-muted-foreground"
                  title="Editar">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                {!role.isSystem && (
                  <button
                    onClick={async () => {
                      const ok = await confirm({
                        type: 'danger',
                        title: `Remover role "${role.name}"?`,
                        message: role._count.users > 0
                          ? `${role._count.users} usuário(s) usam este role atualmente.`
                          : 'Nenhum usuário usa este role.',
                        warning: role._count.users > 0
                          ? 'Será necessário mover esses usuários antes de deletar.'
                          : undefined,
                        confirmLabel: 'Remover',
                      })
                      if (ok) remove.mutate(role.id)
                    }}
                    className="p-2 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                    title="Remover">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      </AdminPageLayout>

      {editing && (
        <RoleFormModal
          role={editing === 'new' ? null : editing}
          allPermissions={permissions}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

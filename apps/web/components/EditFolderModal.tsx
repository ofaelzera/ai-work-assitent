'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { X, Pencil, Lock, Users, Globe, UserPlus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type Visibility = 'PRIVATE' | 'SHARED' | 'PUBLIC'

interface Folder {
  id: string
  name: string
  visibility: Visibility
  ownerId: string
}

interface ShareEntry {
  id: string
  userId: string
  user: { id: string; name: string | null; email: string } | null
}

interface User {
  id: string
  name: string | null
  email: string
}

interface Props {
  folder: Folder
  onClose: () => void
}

export default function EditFolderModal({ folder, onClose }: Props) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(folder.name)
  const [visibility, setVisibility] = useState<Visibility>(folder.visibility)
  const [pickUserOpen, setPickUserOpen] = useState(false)

  const { data: shares = [] } = useQuery<ShareEntry[]>({
    queryKey: ['folder-shares', folder.id],
    queryFn: () => apiFetch(`/storage/folders/${folder.id}/shares`),
    enabled: visibility === 'SHARED',
  })

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => apiFetch('/users'),
    staleTime: 60_000,
  })

  const saveMeta = useMutation({
    mutationFn: () => apiFetch(`/storage/folders/${folder.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: name.trim(), visibility }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-folders'] })
      toast.success('Pasta atualizada')
      onClose()
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao salvar'),
  })

  const addShare = useMutation({
    mutationFn: (userId: string) => apiFetch(`/storage/folders/${folder.id}/shares`, {
      method: 'POST', body: JSON.stringify({ userId }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folder-shares', folder.id] })
      queryClient.invalidateQueries({ queryKey: ['storage-folders'] })
      // Auto promove pra SHARED quando adiciona alguém
      if (visibility === 'PRIVATE') setVisibility('SHARED')
      setPickUserOpen(false)
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao compartilhar'),
  })

  const removeShare = useMutation({
    mutationFn: (userId: string) => apiFetch(`/storage/folders/${folder.id}/shares/${userId}`, {
      method: 'DELETE',
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['folder-shares', folder.id] }),
    onError: () => toast.error('Erro ao remover acesso'),
  })

  const sharedUserIds = new Set(shares.map(s => s.userId))
  const availableToShare = users.filter(u => u.id !== folder.ownerId && !sharedUserIds.has(u.id))

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="modal-surface rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold text-sm">Editar pasta</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Nome</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Visibilidade</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { v: 'PRIVATE' as Visibility, icon: Lock, label: 'Privada', desc: 'Só você', color: 'text-amber-600' },
                { v: 'SHARED'  as Visibility, icon: Users, label: 'Compartilhada', desc: 'Pessoas específicas', color: 'text-blue-600' },
                { v: 'PUBLIC'  as Visibility, icon: Globe, label: 'Pública', desc: 'Todos veem', color: 'text-emerald-600' },
              ]).map(({ v, icon: Icon, label, desc, color }) => (
                <button
                  key={v}
                  onClick={() => setVisibility(v)}
                  className={cn('flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left text-xs transition-colors',
                    visibility === v ? 'border-primary bg-primary/5' : 'hover:bg-muted/30')}>
                  <Icon className={cn('h-3.5 w-3.5', color)} />
                  <div>
                    <p className="font-medium">{label}</p>
                    <p className="text-[10px] text-muted-foreground">{desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Lista de compartilhamentos — só visível quando SHARED */}
          {visibility === 'SHARED' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium">Compartilhada com</label>
                <button
                  onClick={() => setPickUserOpen(v => !v)}
                  className="flex items-center gap-1 text-xs text-primary hover:underline">
                  <UserPlus className="h-3 w-3" /> Adicionar
                </button>
              </div>

              {pickUserOpen && (
                <div className="rounded-lg border bg-muted/20 max-h-40 overflow-y-auto">
                  {availableToShare.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-3 text-center">Todos já têm acesso</p>
                  ) : (
                    availableToShare.map(u => (
                      <button key={u.id}
                        onClick={() => addShare.mutate(u.id)}
                        disabled={addShare.isPending}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent text-left disabled:opacity-50">
                        <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-semibold text-primary shrink-0">
                          {(u.name ?? u.email)[0].toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{u.name ?? u.email}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{u.email}</p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}

              {shares.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Ninguém compartilhado ainda. Clique em "Adicionar".</p>
              ) : (
                <div className="rounded-lg border divide-y">
                  {shares.map(s => (
                    <div key={s.id} className="flex items-center gap-2 px-3 py-2 group">
                      <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-semibold text-primary shrink-0">
                        {((s.user?.name ?? s.user?.email ?? '?')[0]).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{s.user?.name ?? s.user?.email ?? s.userId}</p>
                        {s.user?.name && <p className="text-[10px] text-muted-foreground truncate">{s.user.email}</p>}
                      </div>
                      <button
                        onClick={() => removeShare.mutate(s.userId)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t shrink-0">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm hover:bg-accent">Cancelar</button>
          <button
            onClick={() => name.trim() && saveMeta.mutate()}
            disabled={!name.trim() || saveMeta.isPending}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50">
            {saveMeta.isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

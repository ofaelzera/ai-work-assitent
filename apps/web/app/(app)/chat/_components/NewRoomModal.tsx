'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { useAuthStore } from '@/store/auth'
import { createRoom } from '@/lib/chat'
import { X, Users } from 'lucide-react'

interface WorkspaceUser {
  id: string
  name: string
  email: string
}

export function NewRoomModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string[]>([])
  const [name, setName] = useState('')
  const [search, setSearch] = useState('')

  const { data: users } = useQuery({
    queryKey: ['workspace-users'],
    queryFn: () => apiFetch<WorkspaceUser[]>('/users'),
    enabled: open,
  })

  useEffect(() => {
    if (!open) {
      setSelected([])
      setName('')
      setSearch('')
    }
  }, [open])

  const mutation = useMutation({
    mutationFn: () => createRoom(selected, selected.length > 1 ? name : undefined),
    onSuccess: (room) => {
      qc.invalidateQueries({ queryKey: ['chat', 'rooms'] })
      router.push(`/chat/${room.id}`)
      onClose()
    },
  })

  if (!open) return null

  const available = (users ?? []).filter((u) => u.id !== user?.sub)
  const filtered = available.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()),
  )

  const isGroup = selected.length > 1
  const canSubmit = selected.length > 0 && (!isGroup || name.trim().length > 0)

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Users className="h-4 w-4" /> Nova conversa
          </h3>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <input
            placeholder="Buscar usuários..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          {isGroup && (
            <input
              placeholder="Nome do grupo (obrigatório)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-2">
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">
              Nenhum usuário encontrado
            </p>
          )}
          {filtered.map((u) => {
            const checked = selected.includes(u.id)
            return (
              <label
                key={u.id}
                className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-accent cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) =>
                    setSelected((prev) =>
                      e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id),
                    )
                  }
                />
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-white text-[10px] font-semibold">
                  {u.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{u.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                </div>
              </label>
            )
          })}
        </div>

        <div className="p-4 border-t border-border flex justify-between items-center">
          <span className="text-xs text-muted-foreground">
            {selected.length === 0
              ? 'Nenhum selecionado'
              : selected.length === 1
                ? '1 selecionado · DM'
                : `${selected.length} selecionados · grupo`}
          </span>
          <button
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:opacity-90"
          >
            {mutation.isPending ? 'Criando...' : 'Iniciar conversa'}
          </button>
        </div>
      </div>
    </div>
  )
}

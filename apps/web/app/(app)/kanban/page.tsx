'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Plus, Kanban, LayoutGrid, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Board {
  id: string
  name: string
  createdAt: string
  cardCount: number
}

export default function KanbanPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const { data: boards = [], isLoading } = useQuery({
    queryKey: ['boards'],
    queryFn: () => apiFetch<Board[]>('/kanban/boards'),
  })

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      apiFetch<Board>('/kanban/boards', { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: (board) => {
      queryClient.invalidateQueries({ queryKey: ['boards'] })
      router.push(`/kanban/${board.id}`)
    },
    onError: () => toast.error('Erro ao criar board'),
  })

  const handleCreate = () => {
    const name = newName.trim()
    if (!name) return
    createMutation.mutate(name)
    setNewName('')
    setCreating(false)
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Carregando...
      </div>
    )
  }

  if (boards.length === 0 && !creating) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Kanban className="h-12 w-12 mx-auto text-muted-foreground opacity-40" />
          <div>
            <p className="font-medium">Nenhum board ainda</p>
            <p className="text-sm text-muted-foreground">Crie seu primeiro board para começar</p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 mx-auto rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Criar board
          </button>
        </div>
      </div>
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
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Novo board
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {/* New board inline card */}
          {creating && (
            <div className="flex flex-col gap-3 border-2 border-dashed border-primary/40 rounded-xl p-4 bg-primary/5">
              <p className="text-sm font-medium text-primary">Novo board</p>
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate()
                  if (e.key === 'Escape') { setCreating(false); setNewName('') }
                }}
                placeholder="Nome do board..."
                className="w-full text-sm bg-background border rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim() || createMutation.isPending}
                  className="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  Criar
                </button>
                <button
                  onClick={() => { setCreating(false); setNewName('') }}
                  className="p-1.5 rounded-md hover:bg-accent text-muted-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {boards.map((board) => (
            <button
              key={board.id}
              onClick={() => router.push(`/kanban/${board.id}`)}
              className={cn(
                'flex flex-col gap-3 text-left border rounded-xl p-4 bg-card',
                'hover:border-primary/40 hover:shadow-sm transition-all group',
              )}
            >
              <div className="flex items-start justify-between">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Kanban className="h-5 w-5 text-primary" />
                </div>
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm group-hover:text-primary transition-colors line-clamp-2">
                  {board.name}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {board.cardCount} {board.cardCount === 1 ? 'card' : 'cards'}
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground/60">
                Criado em {new Date(board.createdAt).toLocaleDateString('pt-BR')}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

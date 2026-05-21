'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  CheckSquare, Square, Plus, Trash2, Bell, RefreshCw,
  Calendar, RotateCcw, ChevronDown, MessageSquare, UserRound,
} from 'lucide-react'

interface Task {
  id: string
  title: string
  description: string | null
  done: boolean
  remindAt: string | null
  recurrence: string | null
  cardId: string | null
  contactId: string | null
  conversationId: string | null
  assigneeId: string | null
  createdAt: string
  contact?: { id: string; name: string | null; phone: string | null } | null
  conversation?: { id: string; isGroup: boolean; subject: string | null; externalId: string } | null
  assignee?: { id: string; name: string | null; email: string } | null
}

type Filter = 'pending' | 'done' | 'all'
type Recurrence = 'daily' | 'weekly' | 'monthly' | ''

function formatRemind(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// ─── Task Form ────────────────────────────────────────────────────────────────
function TaskForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState('')
  const [remindAt, setRemindAt] = useState('')
  const [recurrence, setRecurrence] = useState<Recurrence>('')
  const [expanded, setExpanded] = useState(false)

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch<Task>('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title,
          remindAt: remindAt ? new Date(remindAt).toISOString() : undefined,
          recurrence: recurrence || undefined,
        }),
      }),
    onSuccess: () => {
      setTitle('')
      setRemindAt('')
      setRecurrence('')
      setExpanded(false)
      onCreated()
      toast.success('Tarefa criada')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    createMutation.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-card border rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <Square className="h-4 w-4 text-muted-foreground shrink-0" />
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onFocus={() => setExpanded(true)}
          placeholder="Nova tarefa..."
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>

      {expanded && (
        <div className="mt-3 pl-7 flex flex-col gap-2 border-t pt-3">
          <div className="flex items-center gap-2">
            <Bell className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="datetime-local"
              value={remindAt}
              onChange={e => setRemindAt(e.target.value)}
              className="text-xs bg-muted rounded px-2 py-1 border-0 outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={recurrence}
              onChange={e => setRecurrence(e.target.value as Recurrence)}
              className="text-xs bg-muted rounded px-2 py-1 border-0 outline-none"
            >
              <option value="">Sem recorrência</option>
              <option value="daily">Diária</option>
              <option value="weekly">Semanal</option>
              <option value="monthly">Mensal</option>
            </select>
          </div>
          <div className="flex justify-end mt-1">
            <button
              type="submit"
              disabled={!title.trim() || createMutation.isPending}
              className="px-4 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {createMutation.isPending ? 'Criando...' : 'Criar tarefa'}
            </button>
          </div>
        </div>
      )}
    </form>
  )
}

// ─── Task Row ─────────────────────────────────────────────────────────────────
function TaskRow({ task, onToggle, onDelete }: {
  task: Task
  onToggle: () => void
  onDelete: () => void
}) {
  return (
    <div className={cn(
      'flex items-start gap-3 px-4 py-3 rounded-xl border bg-card hover:bg-muted/40 transition-colors group',
      task.done && 'opacity-60',
    )}>
      <button
        onClick={onToggle}
        className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary transition-colors"
      >
        {task.done
          ? <CheckSquare className="h-4 w-4 text-primary" />
          : <Square className="h-4 w-4" />
        }
      </button>

      <div className="flex-1 min-w-0">
        <p className={cn('text-sm', task.done && 'line-through text-muted-foreground')}>
          {task.title}
        </p>
        {task.description && (
          <p className={cn('text-xs text-muted-foreground mt-0.5 line-clamp-2', task.done && 'line-through')}>
            {task.description}
          </p>
        )}
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          {task.remindAt && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Bell className="h-3 w-3" />
              {formatRemind(task.remindAt)}
            </span>
          )}
          {task.recurrence && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <RotateCcw className="h-3 w-3" />
              {task.recurrence === 'daily' ? 'Diária' : task.recurrence === 'weekly' ? 'Semanal' : 'Mensal'}
            </span>
          )}
          {task.assignee && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <UserRound className="h-3 w-3" /> {task.assignee.name ?? task.assignee.email}
            </span>
          )}
          {task.cardId && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Calendar className="h-3 w-3" /> Card vinculado
            </span>
          )}
          {task.conversationId && (
            <Link
              href={`/inbox/${task.conversationId}`}
              className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 hover:underline"
              title="Abrir conversa de origem">
              <MessageSquare className="h-3 w-3" />
              {task.contact?.name ?? task.contact?.phone ?? 'Conversa'}
            </Link>
          )}
        </div>
      </div>

      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-muted-foreground hover:text-destructive rounded"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function TasksPage() {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<Filter>('pending')

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ['tasks', filter],
    queryFn: () => {
      const params = new URLSearchParams()
      if (filter === 'pending') params.set('done', 'false')
      if (filter === 'done') params.set('done', 'true')
      return apiFetch<Task[]>(`/tasks?${params}`)
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      apiFetch(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ done }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/tasks/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      toast.success('Tarefa removida')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const pending = tasks.filter(t => !t.done).length
  const done = tasks.filter(t => t.done).length

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-card shrink-0">
        <div>
          <h1 className="font-semibold text-lg flex items-center gap-2">
            <CheckSquare className="h-5 w-5 text-primary" /> Tarefas
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {pending} pendente{pending !== 1 ? 's' : ''} · {done} concluída{done !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['tasks'] })}
          className="p-2 rounded-md hover:bg-muted text-muted-foreground"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-2xl w-full mx-auto">
        {/* New task form */}
        <TaskForm onCreated={() => queryClient.invalidateQueries({ queryKey: ['tasks'] })} />

        {/* Filter tabs */}
        <div className="flex gap-1 mt-6 mb-4 bg-muted rounded-lg p-1">
          {(['pending', 'all', 'done'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'flex-1 text-xs py-1.5 rounded-md font-medium transition-colors',
                filter === f ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f === 'pending' ? 'Pendentes' : f === 'done' ? 'Concluídas' : 'Todas'}
            </button>
          ))}
        </div>

        {/* Task list */}
        {isLoading ? (
          <div className="text-center text-sm text-muted-foreground py-12">Carregando...</div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-12">
            <CheckSquare className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              {filter === 'pending' ? 'Nenhuma tarefa pendente 🎉' : 'Nenhuma tarefa encontrada'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {tasks.map(task => (
              <TaskRow
                key={task.id}
                task={task}
                onToggle={() => toggleMutation.mutate({ id: task.id, done: !task.done })}
                onDelete={() => deleteMutation.mutate(task.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

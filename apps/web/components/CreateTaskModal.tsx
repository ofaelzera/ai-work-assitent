'use client'

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { X, ListTodo, Calendar as CalendarIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface User {
  id: string
  name: string | null
  email: string
}

interface CreateTaskModalProps {
  /** Pre-preenche e vincula */
  contactId?: string | null
  contactName?: string | null
  conversationId?: string | null
  messageId?: string | null
  /** Conteúdo inicial (ex: corpo da mensagem) — vira título ou descrição */
  initialTitle?: string
  initialDescription?: string
  onClose: () => void
  onCreated?: () => void
}

/** Próxima hora redonda do mesmo dia (ou amanhã 9h se já passou das 18h) */
function nextRoundHourLocal(): string {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  if (d.getHours() >= 18) {
    d.setDate(d.getDate() + 1)
    d.setHours(9)
  } else {
    d.setHours(d.getHours() + 1)
  }
  // formato datetime-local: YYYY-MM-DDTHH:mm
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function CreateTaskModal({
  contactId,
  contactName,
  conversationId,
  messageId,
  initialTitle = '',
  initialDescription = '',
  onClose,
  onCreated,
}: CreateTaskModalProps) {
  const [title, setTitle] = useState(initialTitle.slice(0, 80))
  const [description, setDescription] = useState(initialDescription)
  const [assigneeId, setAssigneeId] = useState<string>('')
  const [remindAt, setRemindAt] = useState<string>('')

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => apiFetch('/users'),
    staleTime: 60_000,
  })

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          ...(description.trim() && { description: description.trim() }),
          ...(assigneeId && { assigneeId }),
          ...(remindAt && { remindAt: new Date(remindAt).toISOString() }),
          ...(contactId && { contactId }),
          ...(conversationId && { conversationId }),
          ...(messageId && { messageId }),
        }),
      }),
    onSuccess: () => {
      toast.success('Tarefa criada')
      onCreated?.()
      onClose()
    },
    onError: (err: any) => {
      console.error('[CreateTaskModal] erro POST /tasks:', err)
      const detail = err?.body?.message ?? err?.message ?? 'Erro desconhecido'
      toast.error(`Erro ao criar tarefa: ${detail}`)
    },
  })

  const canSubmit = title.trim().length > 0 && !createMutation.isPending

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="modal-surface rounded-xl shadow-2xl w-full max-w-md flex flex-col"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold text-sm">Nova tarefa</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {(contactName || conversationId) && (
            <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Vinculada à conversa com <strong className="text-foreground">{contactName ?? 'conversa atual'}</strong>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Título *</label>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Ex: Ligar de volta amanhã às 14h"
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Descrição</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Detalhes (opcional)"
              rows={3}
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Responsável</label>
              <select
                value={assigneeId}
                onChange={e => setAssigneeId(e.target.value)}
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                <option value="">— Ninguém —</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name ?? u.email}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium flex items-center gap-1">
                <CalendarIcon className="h-3 w-3" /> Lembrete
              </label>
              <input
                type="datetime-local"
                value={remindAt}
                onChange={e => setRemindAt(e.target.value)}
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          {!remindAt && (
            <button
              type="button"
              onClick={() => setRemindAt(nextRoundHourLocal())}
              className="text-xs text-primary hover:underline">
              Lembrar na próxima hora cheia
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end items-center gap-2 px-5 py-4 border-t shrink-0">
          {!canSubmit && !createMutation.isPending && (
            <span className="text-xs text-muted-foreground mr-auto">Preencha o título para continuar</span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-sm hover:bg-accent">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => {
              if (!canSubmit) {
                toast.error('Preencha o título antes de criar')
                return
              }
              createMutation.mutate()
            }}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground transition-opacity',
              !canSubmit && 'opacity-60',
            )}>
            {createMutation.isPending ? 'Criando...' : 'Criar tarefa'}
          </button>
        </div>
      </div>
    </div>
  )
}

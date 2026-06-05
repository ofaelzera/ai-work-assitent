'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, getAccessToken } from '@/lib/api'
import { toast } from 'sonner'
import {
  X, Flag, Calendar, User, MessageSquare,
  Trash2, ExternalLink, Plus, Check, GripVertical, ListTodo,
  Paperclip, Download, FileText, Image as ImageIcon, Music, Video, Upload, Loader2,
  Building2, Search, AlignLeft,
} from 'lucide-react'

import { getApiUrl } from '@/lib/runtime-config'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { usePermission } from '@/lib/usePermission'
import RichEditor from '@/components/RichEditor'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// ── Types ─────────────────────────────────────────────────────────────────

interface ChecklistItem { id: string; text: string; done: boolean }

interface CardDetail {
  id: string
  title: string
  description: string | null
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  dueDate: string | null
  checklist: Omit<ChecklistItem, 'id'>[] | null
  contactId: string | null
  companyId: string | null
  conversationId: string | null
  labels: string[] | null
  columnId: string
  createdAt: string
  contact: { id: string; name: string | null; phone: string | null } | null
  company: { id: string; name: string; color: string } | null
  conversation: { id: string; externalId: string } | null
  creator: { id: string; name: string | null; email: string } | null
  contacts: Array<{ id: string; name: string | null; phone: string | null }>
  assignees: Array<{ id: string; name: string | null; email: string; settings?: { avatarUrl?: string | null } | null }>
  comments: { id: string; userId: string | null; body: string; createdAt: string }[]
  column: { id: string; name: string; boardId: string }
}

// ── Section label ─────────────────────────────────────────────────────────

function SectionLabel({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon && <span className="text-muted-foreground shrink-0">{icon}</span>}
      <h3 className="text-sm font-semibold leading-none">{children}</h3>
    </div>
  )
}

// ── Seletor reutilizável (empresa/contato) ────────────────────────────────

function EntityPicker<T extends { id: string; name?: string | null; phone?: string | null; color?: string }>({
  label, icon, current, fetchOptions, onPick, onClear, displayCurrent, placeholder,
}: {
  label: string
  icon: React.ReactNode
  current: T | null
  fetchOptions: (q: string) => Promise<T[]>
  onPick: (id: string) => void
  onClear: () => void
  displayCurrent: (item: T) => React.ReactNode
  placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    const t = setTimeout(() => {
      fetchOptions(query).then(rows => {
        if (active) setOptions(rows)
      }).finally(() => { if (active) setLoading(false) })
    }, 200)
    return () => { active = false; clearTimeout(t) }
  }, [open, query, fetchOptions])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={containerRef}>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
        {icon} {label}
      </p>
      {current ? (
        <div className="bg-black/5 dark:bg-white/8 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">{displayCurrent(current)}</div>
          <button
            onClick={() => setOpen(true)}
            className="text-[10px] text-muted-foreground hover:text-foreground shrink-0"
          >
            Trocar
          </button>
          <button
            onClick={onClear}
            className="text-muted-foreground hover:text-red-500 shrink-0"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="w-full rounded-lg border border-dashed border-border hover:border-primary/40 hover:bg-black/5 dark:hover:bg-white/5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors text-left"
        >
          + Vincular
        </button>
      )}
      {open && (
        <div className="mt-1.5 rounded-lg border bg-popover shadow-lg p-2 space-y-1 z-10 relative">
          <div className="relative">
            <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={placeholder}
              className="w-full rounded-md border bg-background pl-7 pr-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {loading ? (
              <p className="text-[11px] text-muted-foreground italic px-2 py-1">Buscando...</p>
            ) : options.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic px-2 py-1">Nenhum resultado</p>
            ) : (
              options.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => { onPick(opt.id); setOpen(false); setQuery('') }}
                  className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent text-xs flex items-center gap-2"
                >
                  {opt.color && <span className="h-2 w-2 rounded-full shrink-0" style={{ background: opt.color }} />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{opt.name ?? opt.phone ?? '(sem nome)'}</p>
                    {opt.phone && opt.name && (
                      <p className="text-[10px] text-muted-foreground font-mono truncate">{opt.phone}</p>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Multi-picker: contatos vinculados ao card ─────────────────────────────

function MultiContactsPicker({ cardId, contacts }: {
  cardId: string
  contacts: Array<{ id: string; name: string | null; phone: string | null }>
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const linkedIds = new Set(contacts.map(c => c.id))

  const { data: options = [], isFetching } = useQuery({
    queryKey: ['contact-search', query],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '30', excludeLid: 'true' })
      if (query) params.set('q', query)
      const res = await apiFetch<{ items: Array<{ id: string; name: string | null; phone: string | null }> }>(`/contacts?${params}`)
      return res.items
    },
    enabled: open,
    staleTime: 30_000,
  })

  const add = useMutation({
    mutationFn: (contactId: string) => apiFetch(`/kanban/cards/${cardId}/contacts`, {
      method: 'POST', body: JSON.stringify({ contactId }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['card', cardId] }),
  })
  const remove = useMutation({
    mutationFn: (contactId: string) => apiFetch(`/kanban/cards/${cardId}/contacts/${contactId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['card', cardId] }),
  })

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={containerRef}>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
        <User className="h-3 w-3" /> Contatos ({contacts.length})
      </p>
      <div className="space-y-1.5">
        {contacts.map(c => (
          <div key={c.id} className="bg-black/5 dark:bg-white/8 rounded-lg px-3 py-1.5 flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">{c.name ?? c.phone ?? '(sem nome)'}</p>
              {c.phone && c.name && <p className="text-[10px] text-muted-foreground font-mono">{c.phone}</p>}
            </div>
            <button onClick={() => remove.mutate(c.id)} className="text-muted-foreground hover:text-red-500 shrink-0">
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <button
          onClick={() => setOpen(true)}
          className="w-full rounded-lg border border-dashed border-border hover:border-primary/40 hover:bg-black/5 dark:hover:bg-white/5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors text-left"
        >
          + Vincular contato
        </button>
      </div>
      {open && (
        <div className="mt-1.5 rounded-lg border bg-popover shadow-lg p-2 space-y-1 z-10 relative">
          <div className="relative">
            <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar contato..."
              className="w-full rounded-md border bg-background pl-7 pr-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {isFetching ? (
              <p className="text-[11px] text-muted-foreground italic px-2 py-1">Buscando...</p>
            ) : options.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic px-2 py-1">Nenhum resultado</p>
            ) : (
              options.map(opt => {
                const already = linkedIds.has(opt.id)
                return (
                  <button
                    key={opt.id}
                    onClick={() => !already && add.mutate(opt.id)}
                    disabled={already}
                    className={cn(
                      'w-full text-left px-2 py-1.5 rounded-md text-xs flex items-center gap-2',
                      already ? 'opacity-50 cursor-not-allowed' : 'hover:bg-accent',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{opt.name ?? opt.phone ?? '(sem nome)'}</p>
                      {opt.phone && opt.name && (
                        <p className="text-[10px] text-muted-foreground font-mono truncate">{opt.phone}</p>
                      )}
                    </div>
                    {already && <Check className="h-3 w-3 text-emerald-500 shrink-0" />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Multi-picker: usuários responsáveis ───────────────────────────────────

function MultiAssigneesPicker({ cardId, boardId, assignees }: {
  cardId: string
  boardId: string
  assignees: Array<{ id: string; name: string | null; email: string }>
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const linkedIds = new Set(assignees.map(a => a.id))

  const { data: eligible = [] } = useQuery<Array<{ id: string; name: string | null; email: string }>>({
    queryKey: ['board-eligible-users', boardId],
    queryFn: () => apiFetch(`/kanban/boards/${boardId}/eligible-users`),
    enabled: open,
    staleTime: 60_000,
  })

  const filtered = query
    ? eligible.filter(u => (u.name ?? u.email).toLowerCase().includes(query.toLowerCase()))
    : eligible

  const add = useMutation({
    mutationFn: (userId: string) => apiFetch(`/kanban/cards/${cardId}/assignees`, {
      method: 'POST', body: JSON.stringify({ userId }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['card', cardId] }),
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao vincular usuário'),
  })
  const remove = useMutation({
    mutationFn: (userId: string) => apiFetch(`/kanban/cards/${cardId}/assignees/${userId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['card', cardId] }),
  })

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={containerRef}>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
        <User className="h-3 w-3" /> Responsáveis ({assignees.length})
      </p>
      <div className="space-y-1.5">
        {assignees.map(u => (
          <div key={u.id} className="bg-black/5 dark:bg-white/8 rounded-lg px-3 py-1.5 flex items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-primary/15 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
              {(u.name ?? u.email)[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">{u.name ?? u.email}</p>
            </div>
            <button onClick={() => remove.mutate(u.id)} className="text-muted-foreground hover:text-red-500 shrink-0">
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <button
          onClick={() => setOpen(true)}
          className="w-full rounded-lg border border-dashed border-border hover:border-primary/40 hover:bg-black/5 dark:hover:bg-white/5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors text-left"
        >
          + Vincular responsável
        </button>
      </div>
      {open && (
        <div className="mt-1.5 rounded-lg border bg-popover shadow-lg p-2 space-y-1 z-10 relative">
          <div className="relative">
            <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar usuário..."
              className="w-full rounded-md border bg-background pl-7 pr-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {filtered.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic px-2 py-1">
                {eligible.length === 0 ? 'Nenhum usuário com acesso a este board' : 'Nenhum resultado'}
              </p>
            ) : (
              filtered.map(u => {
                const already = linkedIds.has(u.id)
                return (
                  <button
                    key={u.id}
                    onClick={() => !already && add.mutate(u.id)}
                    disabled={already}
                    className={cn(
                      'w-full text-left px-2 py-1.5 rounded-md text-xs flex items-center gap-2',
                      already ? 'opacity-50 cursor-not-allowed' : 'hover:bg-accent',
                    )}
                  >
                    <div className="h-5 w-5 rounded-full bg-primary/15 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                      {(u.name ?? u.email)[0].toUpperCase()}
                    </div>
                    <span className="truncate flex-1">{u.name ?? u.email}</span>
                    {already && <Check className="h-3 w-3 text-emerald-500 shrink-0" />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Priority ──────────────────────────────────────────────────────────────

const priorityOptions = [
  { value: 'LOW', label: 'Baixa', color: 'text-slate-500', dot: 'bg-slate-400' },
  { value: 'MEDIUM', label: 'Média', color: 'text-blue-500', dot: 'bg-blue-500' },
  { value: 'HIGH', label: 'Alta', color: 'text-orange-500', dot: 'bg-orange-500' },
  { value: 'URGENT', label: 'Urgente', color: 'text-red-500', dot: 'bg-red-500' },
]

// ── Sortable checklist item ───────────────────────────────────────────────

function SortableChecklistItem({
  item,
  onToggle,
  onRemove,
}: {
  item: ChecklistItem
  onToggle: () => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('flex items-center gap-2 group rounded-lg px-1 py-1', isDragging && 'opacity-40 bg-black/5 dark:bg-white/5')}
    >
      <button
        {...attributes}
        {...listeners}
        className="shrink-0 opacity-0 group-hover:opacity-40 cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <button onClick={onToggle} className="shrink-0">
        <div className={cn(
          'h-4 w-4 rounded border flex items-center justify-center transition-colors',
          item.done ? 'bg-primary border-primary' : 'border-muted-foreground/40 hover:border-primary/60',
        )}>
          {item.done && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
        </div>
      </button>
      <span className={cn('text-sm flex-1 select-none', item.done && 'line-through text-muted-foreground')}>
        {item.text}
      </span>
      <button
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-muted-foreground hover:text-red-500 transition-opacity shrink-0"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function withIds(items: Omit<ChecklistItem, 'id'>[]): ChecklistItem[] {
  return items.map((item, i) => ({ ...item, id: `item-${i}-${item.text.slice(0, 8)}` }))
}

// ── Task types ────────────────────────────────────────────────────────────

interface Task {
  id: string
  title: string
  done: boolean
  remindAt: string | null
  recurrence: string | null
  cardId: string | null
  createdAt: string
}

// ── Tasks section ─────────────────────────────────────────────────────────

function TasksSection({ cardId }: { cardId: string }) {
  const queryClient = useQueryClient()
  const [newTaskTitle, setNewTaskTitle] = useState('')

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ['tasks', 'card', cardId],
    queryFn: () => apiFetch<Task[]>(`/tasks?cardId=${cardId}`),
  })

  const createTask = useMutation({
    mutationFn: (title: string) =>
      apiFetch('/tasks', { method: 'POST', body: JSON.stringify({ title, cardId }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', 'card', cardId] })
      setNewTaskTitle('')
    },
    onError: () => toast.error('Erro ao criar tarefa'),
  })

  const toggleTask = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      apiFetch(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ done }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks', 'card', cardId] }),
    onError: () => toast.error('Erro ao atualizar tarefa'),
  })

  const deleteTask = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/tasks/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks', 'card', cardId] }),
    onError: () => toast.error('Erro ao remover tarefa'),
  })

  return (
    <section>
      <SectionLabel icon={<ListTodo className="h-4 w-4" />}>
        Tarefas {tasks.length > 0 && `(${tasks.filter(t => t.done).length}/${tasks.length})`}
      </SectionLabel>

      <div className="space-y-0.5 mb-2">
        {tasks.map((task) => (
          <div key={task.id} className="flex items-center gap-2 group rounded-lg px-1 py-1 hover:bg-black/5 dark:hover:bg-white/5">
            <button
              onClick={() => toggleTask.mutate({ id: task.id, done: !task.done })}
              className="shrink-0"
            >
              <div className={cn(
                'h-4 w-4 rounded border flex items-center justify-center transition-colors',
                task.done ? 'bg-primary border-primary' : 'border-muted-foreground/40 hover:border-primary/60',
              )}>
                {task.done && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
              </div>
            </button>
            <span className={cn('text-sm flex-1 select-none', task.done && 'line-through text-muted-foreground')}>
              {task.title}
            </span>
            <button
              onClick={() => deleteTask.mutate(task.id)}
              className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-muted-foreground hover:text-red-500 transition-opacity shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {tasks.length === 0 && (
          <p className="text-xs text-muted-foreground/60 italic px-1">Nenhuma tarefa ainda</p>
        )}
      </div>

      <div className="flex gap-2">
        <input
          value={newTaskTitle}
          onChange={(e) => setNewTaskTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { const t = newTaskTitle.trim(); if (t) createTask.mutate(t) } }}
          placeholder="Nova tarefa..."
          className="flex-1 rounded-lg border border-black/10 dark:border-white/10 bg-black/3 dark:bg-white/5 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground/50"
        />
        <button
          onClick={() => { const t = newTaskTitle.trim(); if (t) createTask.mutate(t) }}
          disabled={!newTaskTitle.trim() || createTask.isPending}
          className="px-2.5 py-1.5 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-sm disabled:opacity-40 transition-colors"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </section>
  )
}

// ── Attachments section ──────────────────────────────────────────────────

interface Attachment {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  storageKey: string
  createdAt: string
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function useAttachmentBlobUrl(attachmentId: string, mimeType: string, enabled: boolean) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    let objectUrl: string
    fetch(`${getApiUrl()}/storage/attachments/${attachmentId}`, {
      headers: { Authorization: `Bearer ${getAccessToken()}` },
    })
      .then(async r => {
        if (!r.ok) return
        const blob = await r.blob()
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })
      .catch(() => {})
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [attachmentId, enabled])
  return src
}

function AttachmentItem({ att, onDelete }: { att: Attachment; onDelete?: () => void }) {
  const isImage = att.mimeType.startsWith('image/')
  const isAudio = att.mimeType.startsWith('audio/')
  const isVideo = att.mimeType.startsWith('video/')
  const isPdf = att.mimeType === 'application/pdf' || /\.pdf$/i.test(att.filename)
  const isMedia = isImage || isAudio || isVideo || isPdf
  const src = useAttachmentBlobUrl(att.id, att.mimeType, isMedia)

  const Icon = isImage ? ImageIcon : isAudio ? Music : isVideo ? Video : FileText

  const handleDownload = async () => {
    const r = await fetch(`${getApiUrl()}/storage/attachments/${att.id}`, {
      headers: { Authorization: `Bearer ${getAccessToken()}` },
    })
    if (!r.ok) { toast.error('Não foi possível baixar o arquivo'); return }
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = att.filename
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="rounded-lg border border-black/8 dark:border-white/10 bg-black/3 dark:bg-white/4 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{att.filename}</p>
          <p className="text-[10px] text-muted-foreground">{formatBytes(att.sizeBytes)} · {att.mimeType.split('/')[1]}</p>
        </div>
        <button
          onClick={handleDownload}
          className="p-1 rounded-lg hover:bg-black/8 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground"
          title="Baixar">
          <Download className="h-3.5 w-3.5" />
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            className="p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/15 text-muted-foreground hover:text-destructive"
            title="Remover anexo">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {isImage && src && (
        <img src={src} alt={att.filename}
          className="w-full max-h-64 rounded-lg object-contain bg-black/5 dark:bg-white/5 cursor-zoom-in"
          onClick={() => window.open(src, '_blank')} />
      )}
      {isAudio && src && (
        <audio src={src} controls className="w-full h-9" />
      )}
      {isVideo && src && (
        <video src={src} controls className="w-full max-h-64 rounded-lg" />
      )}
      {isPdf && src && (
        <div className="space-y-1">
          <iframe
            src={src}
            title={att.filename}
            className="w-full h-72 rounded-lg border bg-black/5 dark:bg-white/5"
          />
          <button
            onClick={() => window.open(src, '_blank')}
            className="text-[10px] text-primary hover:underline"
          >
            Abrir em tela cheia
          </button>
        </div>
      )}
    </div>
  )
}

function AttachmentsSection({ cardId }: { cardId: string }) {
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const canEdit = usePermission('cards.edit')

  const { data: attachments = [], isLoading } = useQuery<Attachment[]>({
    queryKey: ['card-attachments', cardId],
    queryFn: () => apiFetch(`/kanban/cards/${cardId}/attachments`),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/storage/attachments/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['card-attachments', cardId] })
      toast.success('Anexo removido')
    },
    onError: () => toast.error('Erro ao remover anexo'),
  })

  const handleUpload = async (file: File) => {
    if (file.size > 64 * 1024 * 1024) {
      toast.error('Arquivo muito grande (máx 64 MB)')
      return
    }
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${getApiUrl()}/kanban/cards/${cardId}/attachments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAccessToken()}` },
        body: formData,
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(body || `HTTP ${res.status}`)
      }
      toast.success('Anexo adicionado')
      qc.invalidateQueries({ queryKey: ['card-attachments', cardId] })
    } catch (err: any) {
      toast.error(err?.message ?? 'Erro ao enviar arquivo')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-2">
      {canEdit && (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) handleUpload(f)
              e.target.value = ''
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border hover:border-primary/40 hover:bg-black/5 dark:hover:bg-white/5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {uploading ? 'Enviando...' : 'Anexar arquivo (máx 64 MB)'}
          </button>
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Carregando anexos...</p>
      ) : attachments.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 italic">Nenhum anexo</p>
      ) : (
        attachments.map(a => (
          <AttachmentItem
            key={a.id}
            att={a}
            onDelete={canEdit ? () => {
              if (confirm(`Remover "${a.filename}"?`)) deleteMutation.mutate(a.id)
            } : undefined}
          />
        ))
      )}
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────

export default function CardModal({
  cardId,
  boardId,
  onClose,
}: {
  cardId: string
  boardId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const canEditCard   = usePermission('cards.edit')
  const canDeleteCard = usePermission('cards.delete')
  const [title, setTitle] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [comment, setComment] = useState('')
  const [newItem, setNewItem] = useState('')
  const [localDesc, setLocalDesc] = useState<string | null>(null)

  const { data: card, isLoading } = useQuery({
    queryKey: ['card', cardId],
    queryFn: () => apiFetch<CardDetail>(`/kanban/cards/${cardId}`),
  })

  useEffect(() => {
    if (card) {
      setTitle(card.title)
      setLocalDesc(null)
    }
  }, [card?.id])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['card', cardId] })
    queryClient.invalidateQueries({ queryKey: ['board', boardId] })
  }

  const patchMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => {
      if (!canEditCard) {
        toast.error('Sem permissão pra editar cards')
        return Promise.reject(new Error('forbidden'))
      }
      return apiFetch(`/kanban/cards/${cardId}`, { method: 'PATCH', body: JSON.stringify(data) })
    },
    onSuccess: invalidate,
    onError: (e: any) => { if (e?.message !== 'forbidden') toast.error('Erro ao atualizar card') },
  })

  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/kanban/cards/${cardId}`, { method: 'DELETE' }),
    onSuccess: () => { invalidate(); onClose() },
    onError: () => toast.error('Erro ao remover card'),
  })

  const commentMutation = useMutation({
    mutationFn: (body: string) =>
      apiFetch(`/kanban/cards/${cardId}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
    onSuccess: () => { invalidate(); setComment('') },
    onError: () => toast.error('Erro ao comentar'),
  })

  const saveTitle = () => {
    const t = title.trim()
    if (t && t !== card?.title) patchMutation.mutate({ title: t })
    else setTitle(card?.title ?? '')
    setEditingTitle(false)
  }

  const checklist = withIds(card?.checklist ?? [])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = checklist.findIndex((i) => i.id === active.id)
    const newIndex = checklist.findIndex((i) => i.id === over.id)
    const reordered = arrayMove(checklist, oldIndex, newIndex).map(({ id, ...rest }) => rest)
    patchMutation.mutate({ checklist: reordered })
  }

  const toggleItem = (index: number) => {
    const updated = checklist.map((item, i) =>
      i === index ? { ...item, done: !item.done } : item,
    ).map(({ id, ...rest }) => rest)
    patchMutation.mutate({ checklist: updated })
  }

  const removeItem = (index: number) => {
    const updated = checklist.filter((_, i) => i !== index).map(({ id, ...rest }) => rest)
    patchMutation.mutate({ checklist: updated })
  }

  const addItem = () => {
    if (!newItem.trim()) return
    const updated = [...(card?.checklist ?? []), { text: newItem.trim(), done: false }]
    patchMutation.mutate({ checklist: updated })
    setNewItem('')
  }

  if (isLoading || !card) {
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center px-4">
        <div className="bg-white dark:bg-[#1c1d2e] rounded-2xl p-8 shadow-2xl text-sm text-muted-foreground ring-1 ring-black/10 dark:ring-white/10">
          Carregando...
        </div>
      </div>
    )
  }

  const doneCount = checklist.filter((i) => i.done).length
  const totalCount = checklist.length
  const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0
  const priority = priorityOptions.find((p) => p.value === card.priority)!
  const creatorInitial = (card.creator?.name ?? card.creator?.email ?? 'U')[0].toUpperCase()

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center py-6 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-[#1c1d2e] rounded-2xl shadow-2xl w-full max-w-3xl mx-4 ring-1 ring-black/8 dark:ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-start gap-3 px-6 pt-5 pb-4 border-b border-black/8 dark:border-white/8">
          <div className="flex-1 min-w-0 space-y-1.5">
            {editingTitle ? (
              <textarea
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveTitle() }
                  if (e.key === 'Escape') { setTitle(card.title); setEditingTitle(false) }
                }}
                autoFocus
                rows={2}
                className="w-full text-xl font-bold bg-black/5 dark:bg-white/10 border border-primary/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 px-2 py-1 resize-none leading-snug"
              />
            ) : (
              <h2
                className="text-xl font-bold cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-lg px-2 py-1 -mx-2 -my-1 transition-colors leading-snug"
                onClick={() => setEditingTitle(true)}
                title="Clique para editar"
              >
                {card.title}
              </h2>
            )}
            <p className="text-xs text-muted-foreground px-2">
              em{' '}
              <span className="font-medium text-foreground/80">{card.column.name}</span>
              <span className="mx-1.5 opacity-40">·</span>
              <span className={cn('font-medium', priority.color)}>{priority.label}</span>
            </p>
          </div>

          <div className="flex items-center gap-0.5 shrink-0 pt-1">
            {card.conversationId && (
              <Link
                href={`/inbox/${card.conversationId}`}
                className="p-1.5 rounded-lg hover:bg-black/8 dark:hover:bg-white/10 text-muted-foreground transition-colors"
                title="Ver conversa"
              >
                <ExternalLink className="h-4 w-4" />
              </Link>
            )}
            {canDeleteCard && (
              <button
                onClick={() => { if (confirm('Remover este card?')) deleteMutation.mutate() }}
                className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/15 text-muted-foreground hover:text-red-500 transition-colors"
                title="Remover card"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-black/8 dark:hover:bg-white/10 text-muted-foreground transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-[1fr_220px]">

          {/* ── Left: main content ──────────────────────────────────────── */}
          <div className="px-6 py-5 space-y-6 min-w-0 overflow-hidden">

            {/* Descrição */}
            <section>
              <SectionLabel icon={<AlignLeft className="h-4 w-4" />}>Descrição</SectionLabel>
              <RichEditor
                value={localDesc ?? card.description ?? ''}
                onChange={setLocalDesc}
                onBlur={(html) => {
                  const clean = html === '<p></p>' ? null : html
                  if (clean !== card.description) patchMutation.mutate({ description: clean })
                }}
                placeholder="Adicione uma descrição detalhada..."
                minHeight={90}
              />
            </section>

            {/* Anexos */}
            <section>
              <SectionLabel icon={<Paperclip className="h-4 w-4" />}>Anexos</SectionLabel>
              <AttachmentsSection cardId={cardId} />
            </section>

            {/* Checklist */}
            <section>
              <SectionLabel icon={<ListTodo className="h-4 w-4" />}>
                Checklist {totalCount > 0 && `(${doneCount}/${totalCount})`}
              </SectionLabel>

              {totalCount > 0 && (
                <div className="flex items-center gap-2 mb-3 -mt-1">
                  <span className="text-[10px] text-muted-foreground tabular-nums w-6 text-right">{progress}%</span>
                  <div className="flex-1 bg-black/8 dark:bg-white/10 rounded-full h-2">
                    <div
                      className={cn('h-2 rounded-full transition-all duration-300', progress === 100 ? 'bg-emerald-500' : 'bg-primary')}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={checklist.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-0.5">
                    {checklist.map((item, index) => (
                      <SortableChecklistItem
                        key={item.id}
                        item={item}
                        onToggle={() => toggleItem(index)}
                        onRemove={() => removeItem(index)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              <div className="flex gap-2 mt-2">
                <input
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addItem() }}
                  placeholder="Novo item..."
                  className="flex-1 rounded-lg border border-black/10 dark:border-white/10 bg-black/3 dark:bg-white/5 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground/50"
                />
                <button
                  onClick={addItem}
                  disabled={!newItem.trim()}
                  className="px-2.5 py-1.5 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-sm disabled:opacity-40 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </section>

            {/* Tarefas */}
            <TasksSection cardId={cardId} />

            {/* Atividade / Comentários */}
            <section>
              <SectionLabel icon={<MessageSquare className="h-4 w-4" />}>Atividade</SectionLabel>

              {/* Input de novo comentário */}
              <div className="flex gap-3 items-start mb-4">
                <div className="h-8 w-8 rounded-full bg-primary/15 dark:bg-primary/25 flex items-center justify-center text-xs font-bold text-primary shrink-0 mt-0.5">
                  {creatorInitial}
                </div>
                <div className="flex-1 space-y-2">
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && comment.trim()) {
                        e.preventDefault()
                        commentMutation.mutate(comment)
                      }
                    }}
                    placeholder="Escrever um comentário..."
                    rows={comment ? 3 : 1}
                    className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-black/3 dark:bg-white/5 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none transition-all placeholder:text-muted-foreground/50"
                  />
                  {comment && (
                    <button
                      onClick={() => comment.trim() && commentMutation.mutate(comment)}
                      disabled={!comment.trim() || commentMutation.isPending}
                      className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50 transition-opacity"
                    >
                      Salvar
                    </button>
                  )}
                </div>
              </div>

              {/* Lista de comentários */}
              {card.comments.length === 0 ? (
                <p className="text-xs text-muted-foreground/50 italic pl-11">Nenhum comentário ainda</p>
              ) : (
                <div className="space-y-3">
                  {card.comments.map((c) => (
                    <div key={c.id} className="flex gap-3 items-start">
                      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold shrink-0 mt-0.5">
                        {String(c.userId ?? 'U')[0].toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <div className="rounded-lg bg-black/4 dark:bg-white/6 px-3 py-2">
                          <p className="text-sm whitespace-pre-wrap">{c.body}</p>
                        </div>
                        <p className="text-[10px] text-muted-foreground/60 mt-1 px-1">
                          {new Date(c.createdAt).toLocaleString('pt-BR')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Footer */}
            <p className="text-[10px] text-muted-foreground/50 border-t border-black/6 dark:border-white/6 pt-3">
              {card.creator
                ? <>Criado por <span className="font-medium text-muted-foreground/70">{card.creator.name ?? card.creator.email}</span></>
                : 'Criado pelo sistema'
              }
              {card.createdAt && (
                <> · {new Date(card.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}</>
              )}
            </p>
          </div>

          {/* ── Sidebar ─────────────────────────────────────────────────── */}
          <div className="py-5 px-3 border-l border-black/8 dark:border-white/8 space-y-5">

            {/* Prioridade */}
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1 px-1">
                <Flag className="h-3 w-3" /> Prioridade
              </p>
              <div className="space-y-0.5">
                {priorityOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => patchMutation.mutate({ priority: opt.value })}
                    className={cn(
                      'w-full text-left px-2 py-1.5 rounded-lg text-xs flex items-center gap-2 transition-colors',
                      card.priority === opt.value
                        ? 'bg-primary/12 ring-1 ring-primary/25 font-semibold'
                        : 'hover:bg-black/5 dark:hover:bg-white/8',
                    )}
                  >
                    <span className={cn('h-2 w-2 rounded-full shrink-0', opt.dot)} />
                    <span className={opt.color}>{opt.label}</span>
                    {card.priority === opt.value && <Check className="h-3 w-3 ml-auto text-primary" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Prazo */}
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1 px-1">
                <Calendar className="h-3 w-3" /> Prazo
              </p>
              <input
                type="date"
                value={card.dueDate ? card.dueDate.split('T')[0] : ''}
                onChange={(e) => patchMutation.mutate({ dueDate: e.target.value || null })}
                className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-black/3 dark:bg-white/5 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              {card.dueDate && (
                <button
                  onClick={() => patchMutation.mutate({ dueDate: null })}
                  className="text-[10px] text-muted-foreground hover:text-red-500 mt-1 px-1 transition-colors"
                >
                  Remover prazo
                </button>
              )}
            </div>

            {/* Empresa */}
            <EntityPicker
              label="Empresa"
              icon={<Building2 className="h-3 w-3" />}
              current={card.company}
              fetchOptions={async (q) => {
                const list = await apiFetch<Array<{ id: string; name: string; color: string }>>(`/companies`)
                const filtered = q ? list.filter(c => c.name.toLowerCase().includes(q.toLowerCase())) : list
                return filtered.slice(0, 50)
              }}
              onPick={(id) => patchMutation.mutate({ companyId: id })}
              onClear={() => patchMutation.mutate({ companyId: null })}
              displayCurrent={(c) => (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: c.color }} />
                  <span className="text-sm font-medium truncate">{c.name}</span>
                </div>
              )}
              placeholder="Buscar empresa..."
            />

            <MultiContactsPicker cardId={cardId} contacts={card.contacts} />
            <MultiAssigneesPicker cardId={cardId} boardId={card.column.boardId} assignees={card.assignees} />

            {card.conversationId && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1 px-1">
                  <MessageSquare className="h-3 w-3" /> Conversa
                </p>
                <Link
                  href={`/inbox/${card.conversationId}`}
                  className="flex items-center gap-1.5 text-xs text-primary hover:underline px-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  Abrir no Inbox
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

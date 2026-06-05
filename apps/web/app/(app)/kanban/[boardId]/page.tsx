'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import {
  Plus,
  GripVertical,
  X,
  ChevronDown,
  LayoutGrid,
  MoreVertical,
  Pencil,
  Trash2,
  Check,
  CheckCircle2,
  Circle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import CardModal from './CardModal'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { usePermission } from '@/lib/usePermission'
import { useAuthStore } from '@/store/auth'

// ── Types ─────────────────────────────────────────────────────────────────

export interface Card {
  id: string
  title: string
  description?: string | null
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  dueDate?: string | null
  position: number
  columnId: string
  contactId?: string | null
  conversationId?: string | null
  checklist?: { text: string; done: boolean }[] | null
  labels?: string[] | null
  contact?: { id: string; name: string | null; phone: string | null } | null
}

interface Column {
  id: string
  name: string
  position: number
  isDone?: boolean
  cards: Card[]
}

interface Board {
  id: string
  name: string
  ownerId: string | null
  columns: Column[]
}

interface BoardSummary {
  id: string
  name: string
  cardCount: number
}

// ── Priority helpers ──────────────────────────────────────────────────────

const priorityColor: Record<string, string> = {
  LOW: 'bg-slate-400',
  MEDIUM: 'bg-blue-500',
  HIGH: 'bg-orange-500',
  URGENT: 'bg-red-500',
}

const priorityLabel: Record<string, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  URGENT: 'Urgente',
}

/** Remove tags HTML e normaliza espaços/quebras pra preview de texto puro. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')        // <br> vira espaço
    .replace(/<\/p>\s*<p[^>]*>/gi, ' ')  // </p><p> vira espaço (separa parágrafos)
    .replace(/<[^>]+>/g, '')             // remove todas as outras tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

// ── SortableCard ─────────────────────────────────────────────────────────

function SortableCard({
  card,
  onClick,
}: {
  card: Card
  onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card', card },
  })

  const style = { transform: CSS.Transform.toString(transform), transition }
  const doneCount = card.checklist?.filter((i) => i.done).length ?? 0
  const totalCount = card.checklist?.length ?? 0

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'glass-card rounded-xl p-4 cursor-grab active:cursor-grabbing hover:border-primary/40 hover:shadow-md transition-all group',
        isDragging && 'opacity-60 scale-105 shadow-2xl ring-2 ring-primary/20',
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 opacity-0 group-hover:opacity-40 shrink-0">
          <GripVertical className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug">{card.title}</p>
          {card.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{stripHtml(card.description)}</p>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', priorityColor[card.priority])} />
            <span className="text-[10px] text-muted-foreground">{priorityLabel[card.priority]}</span>
            {card.dueDate && (
              <span className="text-[10px] text-muted-foreground">
                📅 {new Date(card.dueDate).toLocaleDateString('pt-BR')}
              </span>
            )}
            {totalCount > 0 && (
              <span className="text-[10px] text-muted-foreground">
                ✓ {doneCount}/{totalCount}
              </span>
            )}
            {card.contact && (
              <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded truncate max-w-[80px]">
                {card.contact.name ?? card.contact.phone}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Column (with droppable area for empty columns) ────────────────────────

const COLUMN_PREFIX = 'col::'

function KanbanColumn({
  column,
  allColumns,
  onAddCard,
  onCardClick,
  isAddingCard,
}: {
  column: Column
  allColumns: Column[]
  onAddCard: (columnId: string) => void
  onCardClick: (card: Card) => void
  isAddingCard: boolean
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const canCreateCard  = usePermission('cards.create')
  const canManageBoard = usePermission('boards.manage')
  const cardIds = column.cards.map((c) => c.id)
  const [editing, setEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState(column.name)
  const [menuOpen, setMenuOpen] = useState(false)

  // Drag horizontal da própria coluna (handle no header)
  const {
    attributes: colAttrs,
    listeners: colListeners,
    setNodeRef: setColRef,
    transform: colTransform,
    transition: colTransition,
    isDragging: colDragging,
  } = useSortable({
    id: `${COLUMN_PREFIX}${column.id}`,
    data: { type: 'column-handle', columnId: column.id },
  })

  // Drop zone pros cards
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `${COLUMN_PREFIX}${column.id}::cards`,
    data: { type: 'column', columnId: column.id },
  })

  const rename = useMutation({
    mutationFn: (name: string) => apiFetch(`/kanban/columns/${column.id}`, {
      method: 'PATCH', body: JSON.stringify({ name }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board'] })
      toast.success('Coluna renomeada')
      setEditing(false)
    },
    onError: () => toast.error('Erro ao renomear'),
  })

  const toggleDone = useMutation({
    mutationFn: (isDone: boolean) => apiFetch(`/kanban/columns/${column.id}`, {
      method: 'PATCH', body: JSON.stringify({ isDone }),
    }),
    onSuccess: (_d, isDone) => {
      queryClient.invalidateQueries({ queryKey: ['board'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
      toast.success(isDone ? 'Coluna marcada como concluída' : 'Coluna não conta mais como concluída')
    },
    onError: () => toast.error('Erro ao atualizar coluna'),
  })

  const remove = useMutation({
    mutationFn: ({ moveTo }: { moveTo?: string }) =>
      apiFetch(`/kanban/columns/${column.id}${moveTo ? `?moveCardsTo=${moveTo}` : ''}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board'] })
      toast.success('Coluna removida')
    },
    onError: (err: any) => {
      if (err?.body?.error === 'columnNotEmpty') {
        // Pede pro user escolher onde mover
        const others = allColumns.filter(c => c.id !== column.id)
        if (others.length === 0) {
          toast.error('Crie outra coluna antes para mover os cards')
          return
        }
        const targetName = prompt(
          `Coluna tem ${err.body.cards} card(s). Mover pra qual coluna?\n\nOpções: ${others.map(c => c.name).join(', ')}`,
          others[0].name,
        )
        if (!targetName) return
        const target = others.find(c => c.name === targetName)
        if (!target) { toast.error('Coluna não encontrada'); return }
        remove.mutate({ moveTo: target.id })
      } else {
        toast.error('Erro ao remover coluna')
      }
    },
  })

  const style = {
    transform: CSS.Transform.toString(colTransform),
    transition: colTransition,
    opacity: colDragging ? 0.4 : 1,
  }

  return (
    <div ref={setColRef} style={style} className="flex flex-col w-[300px] shrink-0 bg-accent/20 dark:bg-accent/10 backdrop-blur-sm border border-border/50 rounded-2xl">
      <div className="flex items-center justify-between gap-1 px-4 py-3 border-b border-border/30 bg-card/30 rounded-t-2xl">
        {/* Handle pra arrastar coluna */}
        <button
          {...colAttrs}
          {...colListeners}
          className="p-0.5 -ml-1 rounded text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing opacity-30 hover:opacity-100 transition-opacity"
          title="Arrastar coluna"
          onClick={(e) => e.stopPropagation()}>
          <GripVertical className="h-3.5 w-3.5" />
        </button>

        {editing ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={() => {
              const t = nameDraft.trim()
              if (t && t !== column.name) rename.mutate(t)
              else { setEditing(false); setNameDraft(column.name) }
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') { setEditing(false); setNameDraft(column.name) }
            }}
            className="flex-1 min-w-0 text-sm font-medium rounded border bg-card px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        ) : (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {column.isDone && (
              <span className="shrink-0" title="Coluna de conclusão — cards aqui não contam como demanda aberta">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              </span>
            )}
            <button
              onDoubleClick={() => setEditing(true)}
              className={cn(
                'font-medium text-sm truncate hover:text-primary transition-colors text-left',
                column.isDone && 'text-muted-foreground',
              )}
              title="Duplo-clique para renomear">
              {column.name}
            </button>
            <span className="text-xs text-muted-foreground bg-muted rounded-full px-1.5 py-0.5 shrink-0">
              {column.cards.length}
            </span>
          </div>
        )}

        <div className="flex items-center gap-0.5 shrink-0">
          {canCreateCard && (
            <button
              onClick={() => onAddCard(column.id)}
              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
              title="Adicionar card">
              <Plus className="h-4 w-4" />
            </button>
          )}

          {/* Menu de ações (renomear/remover) — só boards.manage */}
          {canManageBoard && (
            <div className="relative">
              <button
                onClick={() => setMenuOpen(v => !v)}
                onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
                className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                title="Mais ações">
                <MoreVertical className="h-4 w-4" />
              </button>
              {menuOpen && (
                <div 
                  onMouseDown={(e) => e.preventDefault()}
                  className="absolute right-0 top-full mt-1 z-30 bg-card border rounded-lg shadow-lg overflow-hidden w-40"
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      setTimeout(() => setEditing(true), 10);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent text-left">
                    <Pencil className="h-3 w-3" /> Renomear
                  </button>
                  <button
                    onClick={() => { toggleDone.mutate(!column.isDone); setMenuOpen(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent text-left border-t">
                    {column.isDone
                      ? <><Circle className="h-3 w-3" /> Não é mais conclusão</>
                      : <><CheckCircle2 className="h-3 w-3 text-emerald-500" /> Marcar como concluído</>}
                  </button>
                  <button
                    onClick={async () => {
                      setMenuOpen(false)
                      if (column.cards.length === 0) {
                        const ok = await confirm({
                          type: 'danger',
                          title: `Remover coluna "${column.name}"?`,
                          message: 'A coluna está vazia. Esta ação não pode ser desfeita.',
                          confirmLabel: 'Remover',
                        })
                        if (ok) remove.mutate({})
                      } else {
                        // Tem cards — fluxo de "mover pra onde?" é tratado pelo onError da mutation
                        remove.mutate({})
                      }
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-destructive/10 text-destructive text-left border-t">
                    <Trash2 className="h-3 w-3" /> Remover coluna
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        <div
          ref={setDropRef}
          className={cn(
            'flex-1 px-2 pb-2 space-y-2 overflow-y-auto transition-colors',
            isOver && column.cards.length === 0 && 'bg-primary/5 rounded-lg',
          )}
          style={{ minHeight: 56 }}
        >
          {column.cards.map((card) => (
            <SortableCard key={card.id} card={card} onClick={() => onCardClick(card)} />
          ))}
        </div>
      </SortableContext>

      {isAddingCard && (
        <QuickAddCard columnId={column.id} onDone={() => onAddCard('')} />
      )}
    </div>
  )
}

// "+ Adicionar coluna" no fim do board
function AddColumnButton({ boardId }: { boardId: string }) {
  const queryClient = useQueryClient()
  const canManage = usePermission('boards.manage')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  if (!canManage) return null

  const create = useMutation({
    mutationFn: () => apiFetch('/kanban/columns', {
      method: 'POST',
      body: JSON.stringify({ boardId, name: name.trim() }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board', boardId] })
      toast.success('Coluna criada')
      setName(''); setAdding(false)
    },
    onError: () => toast.error('Erro ao criar coluna'),
  })

  if (!adding) {
    return (
      <button onClick={() => setAdding(true)}
        className="flex items-center justify-center gap-2 w-[300px] shrink-0 h-14 rounded-2xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-primary/5 text-sm font-medium text-muted-foreground hover:text-primary transition-all">
        <Plus className="h-5 w-5" /> Adicionar coluna
      </button>
    )
  }
  return (
    <div className="w-72 shrink-0 bg-muted/40 rounded-xl p-2 space-y-2">
      <input
        autoFocus value={name} onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && name.trim()) create.mutate()
          if (e.key === 'Escape') { setName(''); setAdding(false) }
        }}
        placeholder="Nome da coluna"
        className="w-full rounded border bg-card px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
      />
      <div className="flex items-center gap-1">
        <button onClick={() => name.trim() && create.mutate()}
          disabled={!name.trim() || create.isPending}
          className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-semibold bg-primary text-primary-foreground disabled:opacity-50">
          <Check className="h-3 w-3" /> Criar
        </button>
        <button onClick={() => { setName(''); setAdding(false) }}
          className="px-2 py-1.5 rounded text-xs text-muted-foreground hover:bg-accent">
          Cancelar
        </button>
      </div>
    </div>
  )
}

// ── Quick add card inline ─────────────────────────────────────────────────

function QuickAddCard({
  columnId,
  onDone,
}: {
  columnId: string
  onDone: () => void
}) {
  const [title, setTitle] = useState('')
  const queryClient = useQueryClient()
  const { boardId } = useParams<{ boardId: string }>()
  const canCreate = usePermission('cards.create')

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch('/kanban/cards', { method: 'POST', body: JSON.stringify({ columnId, title }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board', boardId] })
      onDone()
    },
    onError: () => toast.error('Erro ao criar card'),
  })

  if (!canCreate) { onDone(); return null }

  return (
    <div className="px-2 pb-2">
      <div className="bg-card border rounded-lg p-2 space-y-2">
        <textarea
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); title.trim() && mutation.mutate() }
            if (e.key === 'Escape') onDone()
          }}
          placeholder="Título do card..."
          rows={2}
          className="w-full resize-none text-sm bg-transparent focus:outline-none"
        />
        <div className="flex gap-1.5">
          <button
            onClick={() => title.trim() && mutation.mutate()}
            disabled={!title.trim() || mutation.isPending}
            className="px-3 py-1 text-xs rounded bg-primary text-primary-foreground disabled:opacity-50"
          >
            Adicionar
          </button>
          <button onClick={onDone} className="p-1 rounded hover:bg-accent text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Board actions (renomear, deletar) ─────────────────────────────────────

function BoardActions({ boardId, boardName, isOwner }: { boardId: string; boardName: string; isOwner: boolean }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const canManage = usePermission('boards.manage')
  const [menuOpen, setMenuOpen] = useState(false)

  // Só dono ou quem tem boards.manage pode renomear/deletar. Senão, menu nem aparece.
  if (!isOwner && !canManage) return null

  const rename = useMutation({
    mutationFn: (name: string) => apiFetch(`/kanban/boards/${boardId}`, {
      method: 'PATCH', body: JSON.stringify({ name }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board', boardId] })
      queryClient.invalidateQueries({ queryKey: ['boards'] })
      toast.success('Board renomeado')
    },
    onError: () => toast.error('Erro ao renomear'),
  })

  const remove = useMutation({
    mutationFn: () => apiFetch(`/kanban/boards/${boardId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['boards'] })
      toast.success('Board removido')
      router.push('/kanban')
    },
    onError: () => toast.error('Erro ao remover'),
  })

  const handleDelete = async () => {
    setMenuOpen(false)
    // Busca impacto: quantos cards, anexos, comentários, tarefas vão sumir
    let impact: { columns: number; cards: number; attachments: number; comments: number; tasks: number } | null = null
    try {
      impact = await apiFetch(`/kanban/boards/${boardId}/deletion-impact`)
    } catch { /* ignora — segue com confirmação genérica */ }

    const details: string[] = []
    if (impact) {
      if (impact.columns > 0)     details.push(`${impact.columns} coluna${impact.columns > 1 ? 's' : ''}`)
      if (impact.cards > 0)       details.push(`${impact.cards} card${impact.cards > 1 ? 's' : ''}`)
      if (impact.attachments > 0) details.push(`${impact.attachments} arquivo${impact.attachments > 1 ? 's' : ''} anexado${impact.attachments > 1 ? 's' : ''}`)
      if (impact.comments > 0)    details.push(`${impact.comments} comentário${impact.comments > 1 ? 's' : ''}`)
      if (impact.tasks > 0)       details.push(`${impact.tasks} tarefa${impact.tasks > 1 ? 's' : ''}`)
    }

    const totalImpact = impact ? impact.cards + impact.attachments + impact.comments + impact.tasks : 0

    const ok = await confirm({
      type: 'danger',
      title: `Remover board "${boardName}"?`,
      message: totalImpact > 0
        ? 'Esta ação é permanente. Você vai apagar:'
        : 'Esta ação é permanente.',
      details: details.length > 0 ? details : undefined,
      warning: 'Arquivos anexados ficam no disco mas não serão mais acessíveis pelo app. Mensagens da conversa de origem permanecem.',
      confirmLabel: 'Sim, remover board',
      cancelLabel: 'Cancelar',
      // Pra boards com muito conteúdo, pede digitar o nome
      ...(totalImpact > 20 && { requireTypedConfirmation: boardName }),
    })
    if (ok) remove.mutate()
  }

  const handleRename = async () => {
    setMenuOpen(false)
    const name = prompt('Novo nome do board:', boardName)
    if (name && name.trim() && name.trim() !== boardName) rename.mutate(name.trim())
  }

  return (
    <div className="relative ml-auto">
      <button
        onClick={() => setMenuOpen(v => !v)}
        onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
        className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
        title="Ações do board">
        <MoreVertical className="h-4 w-4" />
      </button>
      {menuOpen && (
        <div 
          onMouseDown={(e) => e.preventDefault()}
          className="absolute right-0 top-full mt-1 z-30 bg-card border rounded-lg shadow-lg overflow-hidden w-44"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
              setTimeout(handleRename, 10);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent text-left">
            <Pencil className="h-3 w-3" /> Renomear board
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
              setTimeout(handleDelete, 10);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-destructive/10 text-destructive text-left border-t">
            <Trash2 className="h-3 w-3" /> Remover board
          </button>
        </div>
      )}
    </div>
  )
}

// ── Board switcher dropdown ────────────────────────────────────────────────

function BoardSwitcher({ currentBoardId, currentName }: { currentBoardId: string; currentName: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const { data: boards = [] } = useQuery({
    queryKey: ['boards'],
    queryFn: () => apiFetch<BoardSummary[]>('/kanban/boards'),
  })

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-semibold hover:bg-accent transition-colors"
      >
        {currentName}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-20 min-w-48 bg-popover border rounded-lg shadow-lg py-1 overflow-hidden">
            {boards.map((b) => (
              <button
                key={b.id}
                onClick={() => { setOpen(false); router.push(`/kanban/${b.id}`) }}
                className={cn(
                  'w-full flex items-center justify-between gap-4 px-3 py-2 text-sm hover:bg-accent text-left',
                  b.id === currentBoardId && 'font-medium text-primary',
                )}
              >
                <span className="truncate">{b.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">{b.cardCount}</span>
              </button>
            ))}
            <div className="border-t my-1" />
            <button
              onClick={() => { setOpen(false); router.push('/kanban') }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-muted-foreground"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Ver todos os boards
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Board page ────────────────────────────────────────────────────────────

export default function BoardPage() {
  const { boardId } = useParams<{ boardId: string }>()
  const queryClient = useQueryClient()
  const canEditCard = usePermission('cards.edit')
  const canManageBoard = usePermission('boards.manage')
  const currentUserId = useAuthStore(s => s.user?.sub) ?? null

  const [activeCard, setActiveCard] = useState<Card | null>(null)
  const [selectedCard, setSelectedCard] = useState<Card | null>(null)
  const [addingToColumn, setAddingToColumn] = useState<string | null>(null)
  const [localBoard, setLocalBoard] = useState<Board | null>(null)

  // Always-fresh ref so drag handlers can read latest state without stale closure
  const localBoardRef = useRef<Board | null>(null)
  // Snapshot do columnId original no início do drag — NÃO usar draggedCard.columnId
  // porque o objeto é reativo (atualiza quando setLocalBoard re-renderiza o card)
  const dragOriginRef = useRef<{ cardId: string; columnId: string; position: number } | null>(null)
  // Prevents server data from overwriting optimistic state while drag is in flight
  const isDraggingRef = useRef(false)

  const { data: board, isLoading } = useQuery<Board>({
    queryKey: ['board', boardId],
    queryFn: () => apiFetch<Board>(`/kanban/boards/${boardId}`),
  })

  // Sync server data → local state only when NOT dragging / mutating
  useEffect(() => {
    if (board && !isDraggingRef.current) {
      setLocalBoard(board)
      localBoardRef.current = board
    }
  }, [board])

  const displayBoard = localBoard ?? board

  // Reorder de colunas (envia array com IDs na nova ordem)
  const reorderColumnsMutation = useMutation({
    mutationFn: (columnIds: string[]) =>
      apiFetch(`/kanban/boards/${boardId}/columns/reorder`, {
        method: 'POST', body: JSON.stringify({ columnIds }),
      }),
    onSettled: () => { isDraggingRef.current = false },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['board', boardId] }),
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['board', boardId] })
      toast.error('Erro ao reordenar colunas')
    },
  })

  const moveMutation = useMutation({
    mutationFn: ({ cardId, columnId, position }: { cardId: string; columnId: string; position: number }) =>
      apiFetch<{ ok: boolean; card?: { id: string; columnId: string; position: number } }>(
        `/kanban/cards/${cardId}/move`,
        { method: 'POST', body: JSON.stringify({ columnId, position: Math.max(0, position) }) },
      ),
    onSettled: () => {
      isDraggingRef.current = false
    },
    onSuccess: () => {
      // Re-sincroniza com servidor pra garantir consistência (caso outro user moveu também)
      queryClient.invalidateQueries({ queryKey: ['board', boardId] })
    },
    onError: (err: any) => {
      console.error('[kanban] erro ao mover card:', err)
      queryClient.invalidateQueries({ queryKey: ['board', boardId] })
      const detail = err?.body?.message ?? err?.message ?? 'erro desconhecido'
      toast.error(`Erro ao mover card: ${detail}`)
    },
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    isDraggingRef.current = true
    const data = event.active.data.current as any
    // Drag de coluna (handle) — sem activeCard pra DragOverlay
    if (data?.type === 'column-handle') return
    const card = data?.card as Card | undefined
    if (card) {
      // Snapshot da origem ANTES de qualquer mutation em onDragOver
      dragOriginRef.current = {
        cardId: card.id,
        columnId: card.columnId,
        position: card.position,
      }
    }
    if (card) setActiveCard(card)
  }, [])

  // Move card between columns optimistically during drag
  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event
    if (!over || !localBoardRef.current) return

    const activeData = active.data.current as any
    if (activeData?.type === 'column-handle') return  // colunas tratam no DragEnd
    const draggedCard = activeData?.card as Card | undefined
    if (!draggedCard) return

    const overId = String(over.id)

    // Find target column and insert index
    let targetColId: string | undefined
    let insertAtIndex: number | undefined

    if (overId.startsWith(COLUMN_PREFIX)) {
      // Hovering over column area — strip prefix and optional ::cards suffix
      const suffix = overId.slice(COLUMN_PREFIX.length)
      const colonIdx = suffix.indexOf('::')
      targetColId = colonIdx === -1 ? suffix : suffix.slice(0, colonIdx)
      // insertAtIndex undefined → append to end
    } else {
      // Hovering over a card — find its column and exact index
      for (const col of localBoardRef.current.columns) {
        const idx = col.cards.findIndex((c) => c.id === overId)
        if (idx !== -1) {
          targetColId = col.id
          insertAtIndex = idx
          break
        }
      }
    }

    if (!targetColId) return

    // Find current column of the dragged card in local state
    let currentColId: string | undefined
    for (const col of localBoardRef.current.columns) {
      if (col.cards.some((c) => c.id === draggedCard.id)) {
        currentColId = col.id
        break
      }
    }

    // Only act on cross-column moves
    if (!currentColId || currentColId === targetColId) return

    // Move card to target column at the hovered position (or end if hovering column area)
    setLocalBoard((prev) => {
      if (!prev) return prev
      const cols = prev.columns.map((col) => ({
        ...col,
        cards: col.cards.filter((c) => c.id !== draggedCard.id),
      }))
      const targetCol = cols.find((c) => c.id === targetColId)
      if (!targetCol) return prev
      const movedCard = { ...draggedCard, columnId: targetColId }
      if (insertAtIndex !== undefined) {
        targetCol.cards.splice(insertAtIndex, 0, movedCard)
      } else {
        targetCol.cards.push(movedCard)
      }
      const next = { ...prev, columns: cols }
      localBoardRef.current = next
      return next
    })
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveCard(null)
      const { active, over } = event
      const activeData = active.data.current as any

      // ─── Reorder de coluna ──────────────────────────────────────────────
      if (activeData?.type === 'column-handle') {
        isDraggingRef.current = false
        if (!canManageBoard) { toast.error('Sem permissão pra reordenar colunas'); return }
        if (!over || !localBoardRef.current) return
        const overData = over.data.current as any
        // Só reordena se soltou sobre outra coluna (não sobre um card)
        if (overData?.type !== 'column-handle') return

        const fromColId = activeData.columnId as string
        const toColId = overData.columnId as string
        if (fromColId === toColId) return

        const cols = localBoardRef.current.columns
        const fromIdx = cols.findIndex(c => c.id === fromColId)
        const toIdx = cols.findIndex(c => c.id === toColId)
        if (fromIdx === -1 || toIdx === -1) return

        const newOrder = arrayMove(cols, fromIdx, toIdx)
        setLocalBoard(prev => {
          if (!prev) return prev
          const next = { ...prev, columns: newOrder }
          localBoardRef.current = next
          return next
        })
        reorderColumnsMutation.mutate(newOrder.map(c => c.id))
        return
      }

      // ─── Reorder/move de card (lógica original) ─────────────────────────
      const origin = dragOriginRef.current
      dragOriginRef.current = null

      if (!canEditCard) {
        toast.error('Sem permissão pra mover cards')
        queryClient.invalidateQueries({ queryKey: ['board', boardId] })
        return
      }
      if (!localBoardRef.current || !origin) return

      const draggedCardId = String(active.id)
      const board = localBoardRef.current

      // Onde o card ESTÁ AGORA no localBoard (após onDragOver)
      let finalColId: string | null = null
      let finalIdx = -1
      for (const col of board.columns) {
        const idx = col.cards.findIndex((c) => c.id === draggedCardId)
        if (idx !== -1) {
          finalColId = col.id
          finalIdx = idx
          break
        }
      }
      if (!finalColId) return  // card sumiu do board? abortar

      // Cross-column move — compara contra a ORIGEM snapshotted (não o draggedCard reativo)
      if (finalColId !== origin.columnId) {
        let targetPosition = finalIdx

        // Refine position: if dropped over a specific card, compute exact slot via arrayMove
        if (over) {
          const overId = String(over.id)
          if (!overId.startsWith(COLUMN_PREFIX) && overId !== draggedCardId) {
            const col = board.columns.find((c) => c.id === finalColId)
            if (col) {
              const fromIdx = col.cards.findIndex((c) => c.id === draggedCardId)
              const toIdx = col.cards.findIndex((c) => c.id === overId)
              if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
                const newCards = arrayMove(col.cards, fromIdx, toIdx)
                targetPosition = newCards.findIndex((c) => c.id === draggedCardId)
                setLocalBoard((prev) => {
                  if (!prev) return prev
                  const cols = prev.columns.map((c) =>
                    c.id === finalColId ? { ...c, cards: newCards } : c,
                  )
                  const next = { ...prev, columns: cols }
                  localBoardRef.current = next
                  return next
                })
              }
            }
          }
        }

        moveMutation.mutate({ cardId: draggedCardId, columnId: finalColId, position: targetPosition })
        return
      }

      // Same-column reorder — determinar target position pelo 'over'
      if (!over || active.id === over.id) return
      const overId = String(over.id)

      const col = board.columns.find((c) => c.id === finalColId)
      if (!col) return

      const fromIdx = col.cards.findIndex((c) => c.id === draggedCardId)
      const toIdx = col.cards.findIndex((c) => c.id === overId)
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return

      // Reorder within column
      const newCards = [...col.cards]
      const [removed] = newCards.splice(fromIdx, 1)
      newCards.splice(toIdx, 0, removed)
      newCards.forEach((c, i) => { c.position = i })

      setLocalBoard((prev) => {
        if (!prev) return prev
        const cols = prev.columns.map((c) => (c.id === finalColId ? { ...c, cards: newCards } : c))
        const next = { ...prev, columns: cols }
        localBoardRef.current = next
        return next
      })

      moveMutation.mutate({ cardId: draggedCardId, columnId: finalColId, position: toIdx })
    },
    [moveMutation, reorderColumnsMutation, canEditCard, canManageBoard, queryClient, boardId],
  )

  if (isLoading || !displayBoard) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Carregando board...
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-card shrink-0">
          <BoardSwitcher currentBoardId={boardId} currentName={displayBoard.name} />
          <span className="text-xs text-muted-foreground">
            {displayBoard.columns.reduce((n, c) => n + c.cards.length, 0)} cards
          </span>
          <BoardActions boardId={boardId} boardName={displayBoard.name} isOwner={displayBoard.ownerId === currentUserId} />
        </div>

        {/* Board */}
        <div className="flex-1 overflow-x-auto">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <div className="flex gap-4 p-6 h-full items-start">
              <SortableContext
                items={displayBoard.columns.map(c => `${COLUMN_PREFIX}${c.id}`)}
                strategy={horizontalListSortingStrategy}>
                {displayBoard.columns.map((col) => (
                  <KanbanColumn
                    key={col.id}
                    column={col}
                    allColumns={displayBoard.columns}
                    onAddCard={(colId) => setAddingToColumn(colId || null)}
                    onCardClick={(card) => setSelectedCard(card)}
                    isAddingCard={addingToColumn === col.id}
                  />
                ))}
              </SortableContext>
              <AddColumnButton boardId={boardId} />
            </div>

            <DragOverlay>
              {activeCard && (
                <div className="bg-card border rounded-lg p-3 shadow-xl w-72 opacity-95 rotate-1">
                  <p className="text-sm font-medium">{activeCard.title}</p>
                  {activeCard.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{stripHtml(activeCard.description)}</p>
                  )}
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>
      </div>

      {selectedCard && (
        <CardModal
          cardId={selectedCard.id}
          boardId={boardId}
          onClose={() => setSelectedCard(null)}
        />
      )}
    </>
  )
}

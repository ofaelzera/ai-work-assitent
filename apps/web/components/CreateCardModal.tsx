'use client'

import { useState, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { X, Kanban, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatTime, formatDate } from '@/lib/date'

interface Message {
  id: string
  body: string
  direction: 'INBOUND' | 'OUTBOUND'
  sentAt: string
  attachments?: { type: string }[] | null
}

interface Board { id: string; name: string }
interface Column { id: string; name: string }
interface BoardDetail { columns: Column[] }

interface CreateCardModalProps {
  conversationId: string
  contactId?: string | null
  contactName?: string | null
  messages: Message[]
  onClose: () => void
  onCreated?: () => void
}

export default function CreateCardModal({
  conversationId,
  contactId,
  contactName,
  messages,
  onClose,
  onCreated,
}: CreateCardModalProps) {
  const [title, setTitle] = useState('')
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string>>(new Set())
  const [selectedBoardId, setSelectedBoardId] = useState<string>('')
  const [selectedColumnId, setSelectedColumnId] = useState<string>('')
  const [priority, setPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'>('MEDIUM')
  const [showAllMessages, setShowAllMessages] = useState(false)

  // Pre-select last 3 inbound messages
  useEffect(() => {
    const inbound = messages.filter((m) => m.direction === 'INBOUND').slice(-3)
    setSelectedMsgIds(new Set(inbound.map((m) => m.id)))
    // Pre-fill title from contact
    if (contactName) setTitle(`Atender ${contactName}`)
  }, [])

  const { data: boards = [] } = useQuery({
    queryKey: ['boards'],
    queryFn: () => apiFetch<Board[]>('/kanban/boards'),
  })

  const { data: boardDetail } = useQuery({
    queryKey: ['board-columns', selectedBoardId],
    queryFn: () => apiFetch<BoardDetail>(`/kanban/boards/${selectedBoardId}`),
    enabled: !!selectedBoardId,
  })

  // Auto-select first board/column
  useEffect(() => {
    if (boards.length && !selectedBoardId) setSelectedBoardId(boards[0].id)
  }, [boards])

  useEffect(() => {
    if (boardDetail?.columns.length && !selectedColumnId) {
      setSelectedColumnId(boardDetail.columns[0].id)
    }
  }, [boardDetail])

  const createMutation = useMutation({
    mutationFn: async () => {
      // Constrói descrição a partir das mensagens selecionadas.
      // Para mensagens com mídia, indica que o arquivo está anexado abaixo.
      const selected = messages.filter((m) => selectedMsgIds.has(m.id))
      const descLines = selected.map((m) => {
        const dir = m.direction === 'INBOUND' ? '← ' : '→ '
        const time = new Date(m.sentAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
        const mediaType = m.attachments?.[0]?.type
        const text = mediaType
          ? `📎 ${m.body || `[${mediaType}]`} <em>(arquivo anexado abaixo)</em>`
          : m.body
        return `<p><strong>${dir}</strong> <em>${time}</em><br/>${text}</p>`
      })
      const description = descLines.length ? descLines.join('') : null

      // 1) Cria o card
      const card = await apiFetch<{ id: string }>('/kanban/cards', {
        method: 'POST',
        body: JSON.stringify({
          columnId: selectedColumnId,
          title: title.trim(),
          description,
          priority,
          conversationId,
          contactId: contactId ?? undefined,
        }),
      })

      // 2) Anexa as mídias das mensagens selecionadas (best-effort: falha não bloqueia)
      const mediaMsgs = selected.filter(m => m.attachments?.[0]?.type)
      const attachResults = await Promise.allSettled(
        mediaMsgs.map(m =>
          apiFetch(`/kanban/cards/${card.id}/attachments/from-message`, {
            method: 'POST',
            body: JSON.stringify({ messageId: m.id }),
          }),
        ),
      )
      const failed = attachResults.filter(r => r.status === 'rejected').length
      return { card, totalMedia: mediaMsgs.length, failed }
    },
    onSuccess: (result) => {
      if (result.totalMedia > 0) {
        const ok = result.totalMedia - result.failed
        if (result.failed === 0) toast.success(`Card criado com ${ok} arquivo(s) anexado(s)`)
        else toast.warning(`Card criado — ${ok}/${result.totalMedia} arquivos anexados (${result.failed} expiraram no WhatsApp)`)
      } else {
        toast.success('Card criado no Kanban!')
      }
      onCreated?.()
      onClose()
    },
    onError: () => toast.error('Erro ao criar card'),
  })

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const toggleMsg = (id: string) => {
    setSelectedMsgIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const displayMessages = showAllMessages ? messages : messages.slice(-10)
  const hiddenCount = messages.length - 10

  const priorityOptions = [
    { value: 'LOW', label: 'Baixa', color: 'text-slate-500' },
    { value: 'MEDIUM', label: 'Média', color: 'text-blue-500' },
    { value: 'HIGH', label: 'Alta', color: 'text-orange-500' },
    { value: 'URGENT', label: 'Urgente', color: 'text-red-500' },
  ] as const

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Kanban className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-sm">Criar card no Kanban</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Título */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
              Título *
            </label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="O que precisa ser feito?"
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Board + Coluna */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
                Board
              </label>
              <select
                value={selectedBoardId}
                onChange={(e) => { setSelectedBoardId(e.target.value); setSelectedColumnId('') }}
                className="w-full rounded-md border bg-transparent px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
                Coluna
              </label>
              <select
                value={selectedColumnId}
                onChange={(e) => setSelectedColumnId(e.target.value)}
                className="w-full rounded-md border bg-transparent px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {boardDetail?.columns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Prioridade */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
              Prioridade
            </label>
            <div className="flex gap-2">
              {priorityOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPriority(opt.value)}
                  className={cn(
                    'flex-1 py-1.5 rounded-md border text-xs font-medium transition-colors',
                    priority === opt.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'hover:bg-accent',
                    opt.color,
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Seleção de mensagens */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Contexto da conversa
              </label>
              <span className="text-[10px] text-muted-foreground">
                {selectedMsgIds.size} selecionada{selectedMsgIds.size !== 1 ? 's' : ''}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground mb-2">
              Selecione as mensagens que explicam o que precisa ser feito. Elas vão para a descrição do card.
            </p>

            <div className="rounded-lg border divide-y overflow-hidden">
              {hiddenCount > 0 && !showAllMessages && (
                <button
                  onClick={() => setShowAllMessages(true)}
                  className="w-full px-3 py-2 text-xs text-muted-foreground hover:bg-accent flex items-center justify-center gap-1"
                >
                  <ChevronUp className="h-3 w-3" />
                  Ver {hiddenCount} mensagen{hiddenCount !== 1 ? 's' : ''} anterior{hiddenCount !== 1 ? 'es' : ''}
                </button>
              )}

              {displayMessages.map((msg) => {
                const isMedia = msg.attachments?.[0]?.type
                const selected = selectedMsgIds.has(msg.id)
                return (
                  <button
                    key={msg.id}
                    onClick={() => toggleMsg(msg.id)}
                    className={cn(
                      'w-full text-left px-3 py-2 flex items-start gap-2.5 transition-colors',
                      selected ? 'bg-primary/5' : 'hover:bg-accent/50',
                    )}
                  >
                    <div className={cn(
                      'mt-0.5 h-4 w-4 rounded border shrink-0 flex items-center justify-center transition-colors',
                      selected ? 'bg-primary border-primary' : 'border-muted-foreground/30',
                    )}>
                      {selected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={cn(
                          'text-[10px] font-medium',
                          msg.direction === 'INBOUND' ? 'text-blue-500' : 'text-muted-foreground',
                        )}>
                          {msg.direction === 'INBOUND' ? '← Recebida' : '→ Enviada'}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatTime(msg.sentAt)}
                        </span>
                      </div>
                      <p className="text-xs text-foreground line-clamp-2 leading-snug">
                        {isMedia ? `[${isMedia}]` : msg.body}
                      </p>
                    </div>
                  </button>
                )
              })}

              {messages.length === 0 && (
                <p className="px-3 py-4 text-xs text-center text-muted-foreground">
                  Nenhuma mensagem na conversa
                </p>
              )}
            </div>

            {selectedMsgIds.size > 0 && (
              <div className="mt-1.5 flex justify-between">
                <button
                  onClick={() => setSelectedMsgIds(new Set())}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Desmarcar todas
                </button>
                <button
                  onClick={() => setSelectedMsgIds(new Set(messages.map((m) => m.id)))}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Selecionar todas
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!title.trim() || !selectedColumnId || createMutation.isPending}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 flex items-center gap-2"
          >
            {createMutation.isPending ? (
              <>Criando...</>
            ) : (
              <><Kanban className="h-3.5 w-3.5" /> Criar card</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

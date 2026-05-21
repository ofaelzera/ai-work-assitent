'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { X, CalendarPlus, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CalendarAccount {
  id: string
  email: string
  provider: string
}

interface CreateEventModalProps {
  contactId?: string | null
  contactName?: string | null
  conversationId?: string | null
  messageId?: string | null
  initialTitle?: string
  initialDescription?: string
  onClose: () => void
  onCreated?: () => void
}

/** datetime-local: YYYY-MM-DDTHH:mm — amanhã na próxima hora cheia */
function defaultStartLocal(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function plusOneHour(local: string): string {
  if (!local) return ''
  const d = new Date(local)
  d.setHours(d.getHours() + 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function CreateEventModal({
  contactId,
  contactName,
  conversationId,
  messageId,
  initialTitle = '',
  initialDescription = '',
  onClose,
  onCreated,
}: CreateEventModalProps) {
  const router = useRouter()
  const [title, setTitle] = useState(initialTitle.slice(0, 80))
  const [description, setDescription] = useState(initialDescription)
  // 'local' = só na agenda interna; id de conta = sincroniza com Google daquele usuário
  const [accountId, setAccountId] = useState<string>('local')
  const [startAt, setStartAt] = useState(defaultStartLocal())
  const [endAt, setEndAt] = useState(plusOneHour(defaultStartLocal()))

  const { data: accounts = [] } = useQuery<CalendarAccount[]>({
    queryKey: ['calendar-accounts'],
    queryFn: () => apiFetch('/calendar/accounts'),
  })

  // Auto-seleciona primeira conta Google quando disponível (caso o user prefira sync)
  useEffect(() => {
    if (accountId === 'local' && accounts.length > 0) setAccountId(accounts[0].id)
  }, [accounts, accountId])

  // Mantém endAt >= startAt + 1h se user mudar startAt
  useEffect(() => {
    if (startAt && (!endAt || new Date(endAt) <= new Date(startAt))) {
      setEndAt(plusOneHour(startAt))
    }
  }, [startAt, endAt])

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch('/calendar/events', {
        method: 'POST',
        body: JSON.stringify({
          // Só envia accountId quando NÃO é 'local' — sem ele, backend cria evento só local
          ...(accountId && accountId !== 'local' && { accountId }),
          title: title.trim(),
          ...(description.trim() && { description: description.trim() }),
          startAt: new Date(startAt).toISOString(),
          endAt: new Date(endAt).toISOString(),
          ...(contactId && { contactId }),
          ...(conversationId && { conversationId }),
          ...(messageId && { messageId }),
        }),
      }),
    onSuccess: () => {
      toast.success('Evento criado no Google Calendar')
      onCreated?.()
      onClose()
    },
    onError: (err: any) => {
      console.error('[CreateEventModal] erro POST /calendar/events:', err)
      const detail = err?.body?.message ?? err?.message ?? 'Erro desconhecido'
      toast.error(`Erro ao criar evento: ${detail}`)
    },
  })

  const canSubmit =
    title.trim().length > 0 &&
    startAt &&
    endAt &&
    new Date(endAt) > new Date(startAt) &&
    !createMutation.isPending

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card rounded-xl shadow-2xl w-full max-w-md flex flex-col"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <CalendarPlus className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold text-sm">Novo evento</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {(contactName || conversationId) && (
            <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Vinculado à conversa com <strong className="text-foreground">{contactName ?? 'conversa atual'}</strong>
            </div>
          )}


          <div className="space-y-1.5">
            <label className="text-xs font-medium">Título *</label>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Ex: Reunião com cliente"
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Salvar em</label>
            <select
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
              <option value="local">📌 Apenas agenda local (sem sincronizar)</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>📧 {a.email} (Google)</option>
              ))}
            </select>
            {accounts.length === 0 && (
              <button
                type="button"
                onClick={() => { onClose(); router.push('/calendar') }}
                className="text-[11px] text-primary hover:underline flex items-center gap-1 mt-1">
                <ExternalLink className="h-3 w-3" /> Conectar Google Calendar para sincronizar
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Início *</label>
              <input
                type="datetime-local"
                value={startAt}
                onChange={e => setStartAt(e.target.value)}
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Fim *</label>
              <input
                type="datetime-local"
                value={endAt}
                onChange={e => setEndAt(e.target.value)}
                min={startAt}
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Descrição</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Detalhes do evento (opcional)"
              rows={3}
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end items-center gap-2 px-5 py-4 border-t shrink-0">
          {!canSubmit && !createMutation.isPending && (
            <span className="text-xs text-muted-foreground mr-auto">
              {accounts.length === 0
                ? 'Conecte uma conta de calendário primeiro'
                : !title.trim() ? 'Preencha o título'
                : !startAt || !endAt ? 'Preencha início e fim'
                : new Date(endAt) <= new Date(startAt) ? 'Fim deve ser depois do início'
                : 'Preencha todos os campos obrigatórios'}
            </span>
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
                if (accounts.length === 0) toast.error('Conecte uma conta Google Calendar em Agenda primeiro')
                else if (!title.trim()) toast.error('Preencha o título')
                else if (!accountId) toast.error('Selecione um calendário')
                else toast.error('Verifique os campos obrigatórios')
                return
              }
              createMutation.mutate()
            }}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground transition-opacity',
              !canSubmit && 'opacity-60',
            )}>
            {createMutation.isPending ? 'Criando...' : 'Criar evento'}
          </button>
        </div>
      </div>
    </div>
  )
}

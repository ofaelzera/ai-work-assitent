'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, getAccessToken } from '@/lib/api'
import { useSSE } from '@/lib/sse'
import { usePresence, presenceLabel } from '@/lib/usePresence'
import {
  Send, Paperclip, FileText, Music, Video, Image as ImageIcon, X,
  ZoomIn, Download, Kanban, Phone, Mail, Reply,
  Check, CheckCheck, Sparkles, CheckCircle2, RotateCcw, Clock3, UserRound, ChevronDown,
  LogIn, LogOut, AlertCircle, Plus, ListTodo, CalendarPlus, FolderOpen, Save, History,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatTime, formatDate } from '@/lib/date'
import { formatPhone, isInternalId } from '@/lib/phone'
import { toast } from 'sonner'
import CreateCardModal from '@/components/CreateCardModal'
import CreateTaskModal from '@/components/CreateTaskModal'
import CreateEventModal from '@/components/CreateEventModal'
import LibraryPickerModal from '@/components/LibraryPickerModal'
import SaveToLibraryModal from '@/components/SaveToLibraryModal'
import { ConversationTimelineModal } from '@/components/ConversationTimelineModal'
import { useAuthStore } from '@/store/auth'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333'

// ─── Cores por remetente ──────────────────────────────────────────────────────
const SENDER_COLORS = [
  '#7c3aed','#0284c7','#16a34a','#d97706','#dc2626',
  '#db2777','#0891b2','#65a30d','#ea580c','#7c3aed',
]
export function senderColor(id: string) {
  let h = 0; for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h)
  return SENDER_COLORS[Math.abs(h) % SENDER_COLORS.length]
}
export function initials(s: string) {
  if (!s.trim()) return '?'
  const p = s.trim().split(/\s+/)
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase()
}

// ─── Tipos ────────────────────────────────────────────────────────────────────
export interface MediaAttachment {
  type: 'image' | 'audio' | 'video' | 'document' | 'sticker'
  mimetype: string
  caption?: string
  filename?: string
  seconds?: number
  key?: { id: string; remoteJid: string; fromMe: boolean }
}

export interface Message {
  id: string
  externalId?: string | null
  body: string
  direction: 'INBOUND' | 'OUTBOUND'
  sentAt: string
  fromContactId: string | null
  fromUserId: string | null
  attachments?: MediaAttachment[] | null
  fromContact?: { id: string; name: string | null; phone: string | null } | null
  deliveryStatus?: string | null
  quotedMsgId?: string | null
  quotedBody?: string | null
  quotedSender?: string | null
}

export interface Contact {
  id: string; name: string | null; phone: string | null; email: string | null
  metadata?: { avatarUrl?: string } | null; companyId?: string | null
}

export interface ConversationInfo {
  id: string; externalId: string; isGroup: boolean; subject: string | null
  status: 'OPEN' | 'WAITING' | 'RESOLVED'
  firstResponseAt: string | null
  resolvedAt: string | null
  triageCount: number
  folder?: string | null
  assigneeId?: string | null
  assignee?: { id: string; name: string | null; email: string } | null
  contact: Contact | null
  channel: {
    id: string; type: string; label: string; signature?: string | null
    settings?: { imapFolders?: string[] } | null
  }
}

// ─── Status de entrega ────────────────────────────────────────────────────────
function DeliveryStatus({ status }: { status?: string | null }) {
  if (!status || status === 'PENDING') return <Check className="h-3 w-3 opacity-50" />
  if (status === 'SENT') return <Check className="h-3 w-3 opacity-70" />
  if (status === 'DELIVERED') return <CheckCheck className="h-3 w-3 opacity-70" />
  if (status === 'READ' || status === 'PLAYED') return <CheckCheck className="h-3 w-3 text-sky-400" />
  return null
}

// ─── Bolha de citação ─────────────────────────────────────────────────────────
function QuoteBubble({ quotedBody, quotedSender, color }: { quotedBody: string; quotedSender?: string | null; color?: string }) {
  return (
    <div className="mb-1.5 rounded-lg overflow-hidden border-l-[3px]"
      style={{ borderColor: color ?? '#7c3aed', background: 'rgba(0,0,0,0.06)' }}>
      <div className="px-2.5 py-1.5">
        {quotedSender && (
          <p className="text-[11px] font-semibold mb-0.5" style={{ color: color ?? '#7c3aed' }}>
            {quotedSender}
          </p>
        )}
        <p className="text-xs opacity-80 line-clamp-2 leading-snug">{quotedBody}</p>
      </div>
    </div>
  )
}

// ─── Media helpers ────────────────────────────────────────────────────────────
function useMediaBlob(msgId: string, enabled: boolean) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<false | 'expired' | 'error'>(false)
  useEffect(() => {
    if (!enabled) return
    let objectUrl: string
    fetch(`${API_URL}/messages/${msgId}/media`, {
      headers: { Authorization: `Bearer ${getAccessToken()}` },
    })
      .then(async (r) => {
        if (r.status === 410) { setError('expired'); return }
        if (!r.ok) { setError('error'); return }
        const blob = await r.blob()
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })
      .catch(() => setError('error'))
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [msgId, enabled])
  return { src, error }
}

function MediaModal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center" onClick={onClose}>
      <div className="relative max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute -top-9 right-0 text-white/80 hover:text-white"><X className="h-5 w-5" /></button>
        {children}
      </div>
    </div>
  )
}

function ExpiredMedia({ type }: { type: string }) {
  return <div className="flex items-center gap-1.5 opacity-50 italic"><span className="text-xs">🕐</span><span className="text-xs">{type} expirada</span></div>
}

function MediaImage({ msgId, caption }: { msgId: string; caption?: string }) {
  const { src, error } = useMediaBlob(msgId, true)
  const [modal, setModal] = useState(false)
  if (error === 'expired') return <ExpiredMedia type="Imagem" />
  if (error) return <p className="text-xs opacity-60 italic">Erro ao carregar imagem</p>
  return (
    <>
      <div className="relative group cursor-pointer" onClick={() => src && setModal(true)}>
        {src ? <img src={src} alt="imagem" className="max-w-[240px] rounded-lg object-cover" />
          : <div className="w-48 h-32 bg-black/10 rounded-lg animate-pulse" />}
        {src && (
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded-lg transition flex items-center justify-center">
            <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition" />
          </div>
        )}
      </div>
      {caption && <p className="text-sm whitespace-pre-wrap mt-1">{caption}</p>}
      {modal && src && (
        <MediaModal onClose={() => setModal(false)}>
          <img src={src} alt="imagem" className="max-h-[85vh] max-w-[85vw] rounded-lg object-contain" />
          <a href={src} download className="absolute -top-9 right-8 text-white/80 hover:text-white" onClick={e => e.stopPropagation()}>
            <Download className="h-5 w-5" />
          </a>
        </MediaModal>
      )}
    </>
  )
}

function AudioPlayer({ msgId, seconds }: { msgId: string; seconds?: number }) {
  const { src, error } = useMediaBlob(msgId, true)
  if (error === 'expired') return <ExpiredMedia type="Áudio" />
  if (error) return <p className="text-xs opacity-60 italic">Erro ao carregar áudio</p>
  return (
    <div className="flex items-center gap-2" style={{ minWidth: 200 }}>
      <Music className="h-4 w-4 shrink-0 opacity-60" />
      {src ? <audio controls src={src} className="h-8 flex-1" style={{ minWidth: 160 }} />
        : <div className="h-8 flex-1 bg-black/10 rounded-full animate-pulse" />}
      {seconds != null && <span className="text-[10px] opacity-60 shrink-0">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>}
    </div>
  )
}

function VideoPlayer({ msgId, caption }: { msgId: string; caption?: string }) {
  const { src, error } = useMediaBlob(msgId, true)
  if (error === 'expired') return <ExpiredMedia type="Vídeo" />
  if (error) return <p className="text-xs opacity-60 italic">Erro ao carregar vídeo</p>
  return (
    <div>
      {src ? <video src={src} controls className="max-w-[280px] rounded-lg" />
        : <div className="w-48 h-28 bg-black/10 rounded-lg animate-pulse" />}
      {caption && <p className="text-sm whitespace-pre-wrap mt-1">{caption}</p>}
    </div>
  )
}

function DocumentBubble({ msgId, filename, mimetype }: { msgId: string; filename?: string; mimetype: string }) {
  const [modal, setModal] = useState(false)
  const { src, error } = useMediaBlob(msgId, modal)
  const isPdf = mimetype === 'application/pdf' || filename?.toLowerCase().endsWith('.pdf')
  const handleDownload = async () => {
    try {
      const r = await fetch(`${API_URL}/messages/${msgId}/media`, { headers: { Authorization: `Bearer ${getAccessToken()}` } })
      if (r.status === 410) { toast.error('Mídia expirada'); return }
      if (!r.ok) throw new Error()
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = filename ?? 'arquivo'; a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Erro ao baixar arquivo') }
  }
  if (error === 'expired') return <ExpiredMedia type="Documento" />
  return (
    <div className="flex items-center gap-2 min-w-[160px]">
      <FileText className="h-8 w-8 shrink-0 opacity-70" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{filename ?? 'Documento'}</p>
        <p className="text-xs opacity-60 uppercase">{mimetype.split('/')[1] ?? 'arquivo'}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {isPdf && <button onClick={() => setModal(true)} className="opacity-70 hover:opacity-100"><ZoomIn className="h-4 w-4" /></button>}
        <button onClick={handleDownload} className="opacity-70 hover:opacity-100"><Download className="h-4 w-4" /></button>
      </div>
      {modal && isPdf && src && (
        <MediaModal onClose={() => setModal(false)}>
          <iframe src={src} className="w-[80vw] h-[85vh] rounded-lg bg-white" title="PDF" />
        </MediaModal>
      )}
    </div>
  )
}

function MediaBubble({ msg }: { msg: Message }) {
  const att = msg.attachments?.[0]
  if (!att) return <p className="whitespace-pre-wrap break-words text-sm">{msg.body}</p>
  if (att.type === 'image' || att.type === 'sticker') return <MediaImage msgId={msg.id} caption={att.caption} />
  if (att.type === 'audio') return <AudioPlayer msgId={msg.id} seconds={att.seconds} />
  if (att.type === 'video') return <VideoPlayer msgId={msg.id} caption={att.caption} />
  if (att.type === 'document') return <DocumentBubble msgId={msg.id} filename={att.filename} mimetype={att.mimetype} />
  return <p className="whitespace-pre-wrap break-words text-sm">{msg.body}</p>
}

function groupByDate(messages: Message[]) {
  const groups: { date: string; messages: Message[] }[] = []
  let lastDate = ''
  for (const msg of messages) {
    const date = formatDate(msg.sentAt)
    if (date !== lastDate) { groups.push({ date, messages: [] }); lastDate = date }
    groups[groups.length - 1].messages.push(msg)
  }
  return groups
}

// ─── Modal: Anexar mídia de mensagem a um Card ───────────────────────────────
function AttachToCardModal({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const [boardId, setBoardId] = useState('')
  const [cardSearch, setCardSearch] = useState('')
  const [selectedCardId, setSelectedCardId] = useState('')

  const { data: boards = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['boards-list'],
    queryFn: () => apiFetch<{ id: string; name: string }[]>('/kanban/boards'),
  })

  const { data: boardDetail } = useQuery<{
    columns: { id: string; name: string; cards: { id: string; title: string }[] }[]
  }>({
    queryKey: ['board-detail', boardId],
    queryFn: () => apiFetch<{ columns: { id: string; name: string; cards: { id: string; title: string }[] }[] }>(`/kanban/boards/${boardId}`),
    enabled: !!boardId,
  })

  const allCards = boardDetail?.columns?.flatMap(c => c.cards.map(card => ({ ...card, columnName: c.name }))) ?? []
  const filteredCards = cardSearch
    ? allCards.filter(c => c.title.toLowerCase().includes(cardSearch.toLowerCase()))
    : allCards

  const attachMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>(`/kanban/cards/${selectedCardId}/attachments/from-message`, {
        method: 'POST',
        body: JSON.stringify({ messageId }),
      }),
    onSuccess: () => {
      toast.success('Mídia anexada ao card!')
      onClose()
    },
    onError: (e: Error) => {
      const msg = e.message.includes('410') || e.message.toLowerCase().includes('expir')
        ? 'Mídia expirada no WhatsApp — não é mais possível baixar'
        : e.message
      toast.error(msg)
    },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl w-[420px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Kanban className="h-4 w-4 text-primary" /> Anexar ao Card
          </h2>
          <button onClick={onClose}><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>

        <div className="flex flex-col gap-3 p-4 overflow-y-auto">
          {/* Board */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Board</label>
            <select
              value={boardId}
              onChange={e => { setBoardId(e.target.value); setSelectedCardId('') }}
              className="w-full rounded-md border px-3 py-1.5 text-sm bg-background"
            >
              <option value="">Selecione um board...</option>
              {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>

          {/* Card search */}
          {boardId && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Buscar card</label>
              <input
                value={cardSearch}
                onChange={e => setCardSearch(e.target.value)}
                placeholder="Digite o título do card..."
                className="w-full rounded-md border px-3 py-1.5 text-sm bg-background"
              />
            </div>
          )}

          {/* Card list */}
          {boardId && (
            <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
              {filteredCards.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">Nenhum card encontrado</p>
              )}
              {filteredCards.map(card => (
                <button
                  key={card.id}
                  onClick={() => setSelectedCardId(card.id === selectedCardId ? '' : card.id)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left border transition-colors',
                    selectedCardId === card.id
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-transparent hover:bg-muted',
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <p className="truncate">{card.title}</p>
                    <p className="text-[11px] text-muted-foreground">{card.columnName}</p>
                  </div>
                  {selectedCardId === card.id && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md border hover:bg-muted">Cancelar</button>
          <button
            onClick={() => attachMutation.mutate()}
            disabled={!selectedCardId || attachMutation.isPending}
            className="px-4 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {attachMutation.isPending ? 'Anexando...' : 'Anexar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Card de ticket no histórico do contato ──────────────────────────────────
function HistoryTicket({ conv, isCurrent }: { conv: any; isCurrent: boolean }) {
  const [open, setOpen] = useState(false)
  const lastMsg = conv.messages?.[0]
  const assigneeLabel = conv.assignee?.name ?? conv.assignee?.email ?? null

  const { data: detail } = useQuery({
    queryKey: ['conversation-history-detail', conv.id],
    queryFn: () => apiFetch<{ messages: any[] }>(`/conversations/${conv.id}/messages?limit=200`),
    enabled: open,
    staleTime: 30_000,
  })

  return (
    <div className={cn('rounded-xl border text-xs overflow-hidden',
      isCurrent ? 'border-primary/40 bg-primary/5' : 'bg-card')}>
      <button
        onClick={() => !isCurrent && setOpen(o => !o)}
        disabled={isCurrent}
        className={cn('w-full p-3 space-y-1 text-left',
          !isCurrent && 'hover:bg-accent/40 transition-colors cursor-pointer')}>
        <div className="flex items-center gap-2">
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium',
            conv.status === 'RESOLVED'
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
              : conv.status === 'WAITING'
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
              : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400')}>
            {conv.status === 'RESOLVED' ? 'Finalizado' : conv.status === 'WAITING' ? 'Aguardando' : 'Em aberto'}
          </span>
          {isCurrent && <span className="text-[10px] text-primary font-medium">atual</span>}
          <span className="text-muted-foreground ml-auto">
            {new Date(conv.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
          </span>
          {!isCurrent && (
            <ChevronDown className={cn('h-3 w-3 text-muted-foreground transition-transform', open && 'rotate-180')} />
          )}
        </div>
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1 truncate">
            <UserRound className="h-3 w-3 shrink-0" />
            {assigneeLabel ?? <span className="italic">não atribuída</span>}
          </span>
          <span>{conv._count?.messages ?? 0} msg</span>
        </div>
        {lastMsg && !open && (
          <p className="text-muted-foreground truncate">
            {lastMsg.direction === 'OUTBOUND' ? 'Você: ' : ''}{lastMsg.body}
          </p>
        )}
        {conv.resolvedAt && (
          <p className="text-muted-foreground/60 text-[10px]">
            Finalizado em {new Date(conv.resolvedAt).toLocaleDateString('pt-BR')}
          </p>
        )}
      </button>

      {open && !isCurrent && (
        <div className="border-t bg-muted/20 max-h-64 overflow-y-auto px-3 py-2 space-y-1.5">
          {!detail && <p className="text-[11px] text-muted-foreground text-center py-3">Carregando mensagens...</p>}
          {detail && detail.messages.length === 0 && (
            <p className="text-[11px] text-muted-foreground text-center py-3">Sem mensagens</p>
          )}
          {detail?.messages.map((m: any) => {
            const isOutbound = m.direction === 'OUTBOUND'
            const senderLabel = isOutbound ? 'Você' : (m.fromContact?.name ?? 'Cliente')
            return (
              <div key={m.id} className={cn('flex flex-col gap-0.5', isOutbound ? 'items-end' : 'items-start')}>
                <div className={cn('max-w-[85%] rounded-lg px-2.5 py-1.5 text-[11px] break-words',
                  isOutbound ? 'bg-primary/15 text-foreground' : 'bg-card border')}>
                  {m.body || <span className="italic text-muted-foreground">(sem texto)</span>}
                </div>
                <span className="text-[9px] text-muted-foreground px-1">
                  {senderLabel} · {new Date(m.sentAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Drawer de edição de contato ──────────────────────────────────────────────
function ContactDrawer({ contact, onClose, onSave, currentConvId }: {
  contact: Contact; onClose: () => void; onSave: (data: Partial<Contact>) => void; currentConvId?: string
}) {
  const queryClient = useQueryClient()
  const rawPhone = contact.phone
  const phoneIsId = rawPhone ? isInternalId(rawPhone) : false
  const [name, setName] = useState(contact.name ?? '')
  const [phone, setPhone] = useState(phoneIsId ? '' : (rawPhone ?? ''))
  const [email, setEmail] = useState(contact.email ?? '')
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'info' | 'history'>('info')
  const [avatarUrl, setAvatarUrl] = useState<string | null>((contact.metadata as any)?.avatarUrl ?? null)
  const [syncingAvatar, setSyncingAvatar] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await apiFetch<{ avatarUrl: string }>(`/contacts/${contact.id}/avatar`, { method: 'POST', body: form })
      setAvatarUrl(res.avatarUrl)
      queryClient.invalidateQueries({ queryKey: ['conversation'] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      toast.success('Foto atualizada!')
    } catch {
      toast.error('Erro ao fazer upload da foto')
    }
    e.target.value = ''
  }

  const handleSyncAvatar = async () => {
    setSyncingAvatar(true)
    try {
      const res = await apiFetch<{ avatarUrl: string }>(`/contacts/${contact.id}/sync-avatar`, { method: 'POST' })
      setAvatarUrl(res.avatarUrl)
      queryClient.invalidateQueries({ queryKey: ['conversation'] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      toast.success('Foto sincronizada com o WhatsApp!')
    } catch (err: any) {
      toast.error(err?.message ?? 'Não foi possível buscar a foto do WhatsApp')
    } finally {
      setSyncingAvatar(false)
    }
  }

  const { data: historyData } = useQuery({
    queryKey: ['contact-history', contact.id],
    queryFn: () => apiFetch<{ conversations: any[] }>(`/contacts/${contact.id}/conversations`),
    enabled: tab === 'history',
  })

  const handleSave = () => {
    setSaving(true)
    onSave({ name: name || undefined, phone: phone || undefined, email: email || undefined })
  }

  const displayLabel = contact.name || (!phoneIsId && rawPhone ? formatPhone(rawPhone) : null) || contact.email || 'Sem nome'

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="ml-auto w-80 h-full bg-card border-l shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <h3 className="font-semibold text-sm">Contato</h3>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-accent text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex border-b shrink-0">
          {(['info', 'history'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={cn('flex-1 py-2 text-xs font-medium transition-colors',
                tab === t ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground')}>
              {t === 'info' ? 'Informações' : 'Histórico'}
            </button>
          ))}
        </div>
        {tab === 'info' ? (
          <>
            <div className="flex flex-col items-center gap-2 py-5 border-b">
              {/* Avatar clicável para upload */}
              <div className="relative group">
                <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
                <button
                  onClick={() => avatarInputRef.current?.click()}
                  className="relative h-20 w-20 rounded-full overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary"
                  title="Clique para trocar a foto">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={displayLabel} className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-2xl font-bold text-white"
                      style={{ background: senderColor(contact.id) }}>
                      {initials(displayLabel)}
                    </div>
                  )}
                  {/* Overlay no hover */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="text-white text-[10px] font-semibold text-center leading-tight px-1">Trocar foto</span>
                  </div>
                </button>
              </div>
              <p className="font-semibold text-sm">{displayLabel}</p>
              {!phoneIsId && rawPhone && <p className="text-xs text-muted-foreground">{formatPhone(rawPhone)}</p>}
              {/* Botão sincronizar avatar do WhatsApp */}
              {!phoneIsId && rawPhone && (
                <button
                  onClick={handleSyncAvatar}
                  disabled={syncingAvatar}
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground border rounded-full px-2.5 py-1 transition-colors disabled:opacity-50"
                  title="Buscar foto do WhatsApp">
                  <span className="text-[11px]">📱</span>
                  {syncingAvatar ? 'Buscando...' : 'Sincronizar foto do WhatsApp'}
                </button>
              )}
            </div>
            <div className="px-4 py-3 border-b space-y-2 text-sm">
              {!phoneIsId && rawPhone && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-4 w-4 shrink-0" />{formatPhone(rawPhone)}
                </div>
              )}
              {contact.email && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-4 w-4 shrink-0" />{contact.email}
                </div>
              )}
              {phoneIsId && rawPhone && (
                <div className="flex items-start gap-2 text-muted-foreground/60 text-xs">
                  <span className="shrink-0 mt-0.5">ID WA:</span>
                  <span className="font-mono break-all">{rawPhone}</span>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Editar</p>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Nome</label>
                <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Nome completo"
                  className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  Telefone {phoneIsId && <span className="text-amber-500">(número real não disponível via API)</span>}
                </label>
                <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="5544999999999"
                  className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
                {phoneIsId && <p className="text-[11px] text-muted-foreground">Digite o número real com DDI (ex: 5544999581292)</p>}
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@exemplo.com"
                  className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
            </div>
            <div className="px-4 py-3 border-t shrink-0">
              <button onClick={handleSave} disabled={saving}
                className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
                {saving ? 'Salvando...' : 'Salvar alterações'}
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Tickets anteriores
              </p>
              {!historyData ? (
                <p className="text-xs text-muted-foreground">Carregando...</p>
              ) : historyData.conversations.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum histórico encontrado</p>
              ) : (
                <div className="space-y-2">
                  {historyData.conversations.map((c: any) => (
                    <HistoryTicket key={c.id} conv={c} isCurrent={c.id === currentConvId} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Barra de reply ───────────────────────────────────────────────────────────
interface ReplyState { msgId: string; body: string; sender: string; color?: string }

function ReplyBar({ reply, onCancel }: { reply: ReplyState; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-t bg-muted/30">
      <div className="flex-1 rounded-lg overflow-hidden border-l-[3px] bg-card px-2.5 py-1.5 min-w-0"
        style={{ borderColor: reply.color ?? '#7c3aed' }}>
        <p className="text-[11px] font-semibold truncate" style={{ color: reply.color ?? '#7c3aed' }}>
          {reply.sender}
        </p>
        <p className="text-xs text-muted-foreground truncate">{reply.body}</p>
      </div>
      <button onClick={onCancel} className="p-1 rounded hover:bg-accent text-muted-foreground shrink-0">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

// ─── Suggest Reply ────────────────────────────────────────────────────────────
function SuggestReplyButton({ conversationId, onSelect }: { conversationId: string; onSelect: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<{ label: string; text: string }[]>([])

  const fetchSuggestions = async () => {
    setLoading(true)
    setOpen(true)
    try {
      const res = await apiFetch<{ suggestions: { label: string; text: string }[] }>(
        `/conversations/${conversationId}/suggest-reply`, { method: 'POST' },
      )
      setSuggestions(res.suggestions)
    } catch {
      toast.error('Erro ao sugerir resposta')
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        onClick={fetchSuggestions}
        title="Sugerir resposta com IA"
        className="p-2.5 rounded-xl border hover:bg-accent text-muted-foreground hover:text-primary transition-colors"
      >
        <Sparkles className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute bottom-12 right-0 w-80 bg-popover border rounded-xl shadow-xl z-20 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
            <span className="text-xs font-semibold flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-primary" /> Sugestões IA
            </span>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {loading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">Gerando sugestões...</div>
          ) : (
            <div className="divide-y">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => { onSelect(s.text); setOpen(false) }}
                  className="w-full text-left px-3 py-2.5 hover:bg-accent transition-colors"
                >
                  <p className="text-[10px] font-semibold text-primary mb-0.5">{s.label}</p>
                  <p className="text-xs text-foreground leading-relaxed">{s.text}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Chip de atribuição de conversa ──────────────────────────────────────────
/**
 * Chip read-only que mostra o atendente atual da conversa.
 * Por segurança, a atribuição NÃO pode ser alterada inline aqui — o caminho
 * canônico é:
 *   • "Assumir atendimento" (quando livre)
 *   • "Encaminhar"          (transferir pra outro)
 *   • "Devolver à fila"     (sair sem repassar)
 *   • Admin pode tomar via banner "Supervisionando..."
 * Isso evita atribuição acidental e mantém audit trail (releasedFrom).
 */
export function AssigneeChip({ assignee }: {
  conversationId?: string  // mantido na assinatura por compat — não usado
  assignee?: { id: string; name: string | null; email: string } | null
}) {
  if (!assignee) {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 border bg-muted/40 text-muted-foreground">
        <UserRound className="h-3 w-3 shrink-0" />
        <span>Sem atendente</span>
      </span>
    )
  }
  const label = assignee.name ?? assignee.email.split('@')[0]
  return (
    <span
      className="flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 border bg-primary/10 border-primary/20 text-primary"
      title={`Em atendimento por ${assignee.name ?? assignee.email}`}
    >
      <UserRound className="h-3 w-3 shrink-0" />
      <span className="max-w-[120px] truncate">{label}</span>
    </span>
  )
}

// ─── WhatsApp View ────────────────────────────────────────────────────────────
// ─── Modal: Encaminhar para atendente ────────────────────────────────────────
function ForwardConversationModal({
  conversationId,
  currentAssigneeId,
  onClose,
  onDone,
}: {
  conversationId: string
  currentAssigneeId?: string | null
  onClose: () => void
  onDone: () => void
}) {
  const [selectedUserId, setSelectedUserId] = useState('')
  const [note, setNote] = useState('')

  const { data: users = [] } = useQuery<{ id: string; name: string | null; email: string }[]>({
    queryKey: ['users'],
    queryFn: () => apiFetch('/users'),
    staleTime: 60_000,
  })

  const otherUsers = users.filter(u => u.id !== currentAssigneeId)

  const forwardMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/conversations/${conversationId}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ assigneeId: selectedUserId }),
      }),
    onSuccess: () => {
      const name = users.find(u => u.id === selectedUserId)?.name ?? 'atendente'
      toast.success(`Conversa encaminhada para ${name}`)
      onDone()
    },
    onError: () => toast.error('Erro ao encaminhar conversa'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-xl shadow-xl border w-full max-w-sm mx-4 p-5 space-y-4">
        <div>
          <h3 className="font-semibold text-base">Encaminhar conversa</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Selecione o atendente que irá assumir esta conversa.</p>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Atendente</label>
          <div className="space-y-1 max-h-48 overflow-y-auto border rounded-lg p-1">
            {otherUsers.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-3">Nenhum outro atendente disponível</p>
            )}
            {otherUsers.map(u => (
              <button
                key={u.id}
                onClick={() => setSelectedUserId(u.id)}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-md text-sm transition-colors',
                  selectedUserId === u.id
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'hover:bg-accent',
                )}
              >
                {u.name ?? u.email}
                {u.name && <span className="ml-1.5 text-xs opacity-60">{u.email}</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nota (opcional)</label>
          <textarea
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            rows={2}
            placeholder="Ex: Cliente aguarda retorno sobre proposta..."
            value={note}
            onChange={e => setNote(e.target.value)}
          />
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => forwardMutation.mutate()}
            disabled={!selectedUserId || forwardMutation.isPending}
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {forwardMutation.isPending ? 'Encaminhando...' : 'Encaminhar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Devolver à Fila ───────────────────────────────────────────────────
function ReleaseConversationModal({
  conversationId,
  onClose,
  onDone,
}: {
  conversationId: string
  onClose: () => void
  onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const releaseMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/conversations/${conversationId}/release`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => { toast.success('Conversa devolvida à fila'); onDone() },
    onError: () => toast.error('Erro ao devolver à fila'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-xl shadow-xl border w-full max-w-sm mx-4 p-5 space-y-4">
        <div>
          <h3 className="font-semibold text-base">Devolver à fila</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Informe o motivo para devolver esta conversa à fila.</p>
        </div>
        <textarea
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          rows={3}
          placeholder="Ex: Aguardando retorno do financeiro..."
          value={reason}
          onChange={e => setReason(e.target.value)}
          autoFocus
        />
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => releaseMutation.mutate()}
            disabled={reason.trim().length < 3 || releaseMutation.isPending}
            className="px-3 py-1.5 text-sm rounded-md bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors">
            {releaseMutation.isPending ? 'Devolvendo...' : 'Devolver à fila'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface Props {
  conversationId: string
  conv: ConversationInfo
  messages: Message[]
  isLoading: boolean
}

export default function WhatsappView({ conversationId, conv, messages, isLoading }: Props) {
  const queryClient = useQueryClient()
  const currentUser = useAuthStore(s => s.user)
  const [text, setText] = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const [showCardModal, setShowCardModal] = useState(false)
  const [showTaskModal, setShowTaskModal] = useState<{ initialTitle?: string; messageId?: string } | null>(null)
  const [showEventModal, setShowEventModal] = useState<{ initialTitle?: string; messageId?: string } | null>(null)
  const [showLibraryPicker, setShowLibraryPicker] = useState(false)
  const [saveToLibraryMsg, setSaveToLibraryMsg] = useState<{ id: string; filename?: string } | null>(null)
  const [showCreateMenu, setShowCreateMenu] = useState(false)
  const [showContact, setShowContact] = useState(false)
  const [showRelease, setShowRelease] = useState(false)
  const [showForward, setShowForward] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)
  const [attachMessageId, setAttachMessageId] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<ReplyState | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const presenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isComposing = useRef(false)

  // Envia "composing" para o WhatsApp quando o agente digita
  const sendComposing = useCallback(() => {
    if (conv.channel.type !== 'WHATSAPP') return
    if (!isComposing.current) {
      isComposing.current = true
      apiFetch(`/conversations/${conversationId}/presence`, {
        method: 'POST', body: JSON.stringify({ presence: 'composing' }),
      }).catch(() => {})
    }
    // Para de "digitando" após 4s sem teclar
    if (presenceTimer.current) clearTimeout(presenceTimer.current)
    presenceTimer.current = setTimeout(() => {
      isComposing.current = false
      apiFetch(`/conversations/${conversationId}/presence`, {
        method: 'POST', body: JSON.stringify({ presence: 'paused' }),
      }).catch(() => {})
    }, 4_000)
  }, [conversationId, conv.channel.type])

  // Para de "digitando" quando a mensagem é enviada
  const stopComposing = useCallback(() => {
    if (presenceTimer.current) clearTimeout(presenceTimer.current)
    if (isComposing.current && conv.channel.type === 'WHATSAPP') {
      isComposing.current = false
      apiFetch(`/conversations/${conversationId}/presence`, {
        method: 'POST', body: JSON.stringify({ presence: 'paused' }),
      }).catch(() => {})
    }
  }, [conversationId, conv.channel.type])

  useEffect(() => () => { if (presenceTimer.current) clearTimeout(presenceTimer.current) }, [])

  const sendMutation = useMutation({
    mutationFn: (payload: { text: string; quotedMsgId?: string; quotedBody?: string; quotedSender?: string }) =>
      apiFetch<Message>(`/conversations/${conversationId}/messages`, {
        method: 'POST', body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      setText(''); setReplyTo(null)
    },
  })

  const sendMediaMutation = useMutation({
    mutationFn: ({ file, caption }: { file: File; caption: string }) => {
      const form = new FormData(); form.append('file', file); if (caption) form.append('caption', caption)
      return apiFetch<Message>(`/conversations/${conversationId}/messages/media`, { method: 'POST', body: form })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      setPendingFile(null); setCaption('')
    },
    onError: () => toast.error('Erro ao enviar mídia'),
  })

  const statusMutation = useMutation({
    mutationFn: (status: 'OPEN' | 'WAITING' | 'RESOLVED') =>
      apiFetch(`/conversations/${conversationId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: (_data, status) => {
      // Optimistic local — UI atualiza na hora
      queryClient.setQueryData<any>(['conversation', conversationId], (old: any) => {
        if (!old?.conversation) return old
        return {
          ...old,
          conversation: {
            ...old.conversation,
            status,
            resolvedAt: status === 'RESOLVED' ? new Date().toISOString() : null,
          },
        }
      })
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      toast.success(status === 'RESOLVED' ? 'Conversa finalizada!' : 'Status atualizado!')
    },
    onError: () => toast.error('Erro ao atualizar status'),
  })

  const claimMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; assigneeId: string; claimedAt: string; assignee: { id: string; name: string; email: string } }>(
        `/conversations/${conversationId}/claim`,
        { method: 'POST' },
      ),
    onSuccess: (data) => {
      // Atualiza cache imediato — não espera o refetch pra re-renderizar
      queryClient.setQueryData<any>(['conversation', conversationId], (old: any) => {
        if (!old?.conversation) return old
        return {
          ...old,
          conversation: {
            ...old.conversation,
            assigneeId: data.assigneeId,
            claimedAt: data.claimedAt,
            assignee: data.assignee,
          },
        }
      })
      // Invalida em background pra trazer dados completos (releasedFrom, etc)
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      toast.success('Você assumiu esta conversa!')
    },
    onError: (err: any) => {
      const assigneeName = (err?.body as any)?.assignee?.name ?? 'outro atendente'
      toast.error(`Conversa assumida por ${assigneeName}`)
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
    },
  })

  const updateContactMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch(`/contacts/${conv?.contact?.id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      setShowContact(false)
      toast.success('Contato atualizado!')
    },
    onError: () => toast.error('Erro ao atualizar contato'),
  })

  const [lastSSEEvent, setLastSSEEvent] = useState<{ type: string; payload: unknown } | null>(null)

  useSSE((event) => {
    setLastSSEEvent(event)

    if (event.type === 'message.received' && (event.payload as any)?.conversationId === conversationId) {
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    }

    if (
      (event.type === 'conversation.claimed' || event.type === 'conversation.released') &&
      (event.payload as any)?.conversationId === conversationId
    ) {
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    }

    // Atualiza ícone de entrega diretamente no cache — sem refetch
    if (event.type === 'message.delivery') {
      const { externalId, deliveryStatus } = event.payload as { externalId: string; deliveryStatus: string; conversationId: string }
      queryClient.setQueryData(
        ['conversation', conversationId],
        (old: any) => {
          if (!old?.messages) return old
          return {
            ...old,
            messages: old.messages.map((m: any) =>
              m.externalId === externalId ? { ...m, deliveryStatus } : m
            ),
          }
        },
      )
    }
  })

  const presence = usePresence(conversationId, lastSSEEvent)
  const presenceTxt = presenceLabel(presence)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Foca o input ao iniciar reply
  useEffect(() => {
    if (replyTo) textareaRef.current?.focus()
  }, [replyTo])

  // ── Write guard computeds ──────────────────────────────────────────────────
  const isAdmin = currentUser?.role === 'ADMIN'
  const myId = currentUser?.sub
  const isUnassigned = !conv.assigneeId
  const isMyConv = conv.assigneeId === myId
  const isOtherConv = !isUnassigned && !isMyConv
  // Só pode escrever se for o assignee atual.
  // ADMIN consegue VER conversas de outros e usar ações (finalizar, assumir, transferir)
  // mas precisa assumir pra digitar — evita responder em nome de outro sem querer.
  const canSend = isMyConv

  const isGroup = conv.isGroup
  const rawPhone = conv.contact?.phone ?? null
  const phoneIsId = rawPhone ? isInternalId(rawPhone) : false
  const contactName =
    conv.contact?.name ??
    (rawPhone && !phoneIsId ? formatPhone(rawPhone) : null) ??
    conv.subject ??
    conv.externalId ?? '...'

  const groups = groupByDate(messages)

  const handleSend = () => {
    if (!canSend) return  // guard: não pode enviar sem assumir
    if (pendingFile) { sendMediaMutation.mutate({ file: pendingFile, caption }); return }
    const trimmed = text.trim()
    if (!trimmed || sendMutation.isPending) return
    stopComposing()
    sendMutation.mutate({
      text: trimmed,
      ...(replyTo && {
        quotedMsgId: replyTo.msgId,
        quotedBody: replyTo.body,
        quotedSender: replyTo.sender,
      }),
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
    if (e.key === 'Escape' && replyTo) setReplyTo(null)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (file) setPendingFile(file); e.target.value = ''
  }

  const fileIcon = (file: File) => {
    if (file.type.startsWith('image/')) return <ImageIcon className="h-4 w-4" />
    if (file.type.startsWith('video/')) return <Video className="h-4 w-4" />
    if (file.type.startsWith('audio/')) return <Music className="h-4 w-4" />
    return <FileText className="h-4 w-4" />
  }

  // Rastreia último remetente para agrupar consecutivas
  let lastSenderId = ''

  return (
    <>
      <div className="flex flex-col h-full">
        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-card shrink-0 z-10">
          <button onClick={() => conv.contact && setShowContact(true)}
            className={cn('shrink-0', conv.contact && 'cursor-pointer hover:opacity-80 transition-opacity')}
            disabled={!conv.contact}>
            {!isGroup && conv.contact?.metadata?.avatarUrl ? (
              <img
                src={conv.contact.metadata.avatarUrl}
                alt={contactName}
                className="h-10 w-10 rounded-full object-cover"
                onError={e => {
                  // Se falhar, esconde a imagem e deixa o fallback colorido aparecer
                  const img = e.target as HTMLImageElement
                  img.style.display = 'none'
                  img.nextElementSibling?.classList.remove('hidden')
                }}
              />
            ) : null}
            <div
              className={cn(
                'h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold text-white overflow-hidden',
                !isGroup && conv.contact?.metadata?.avatarUrl && 'hidden',
              )}
              style={{ background: conv.contact ? senderColor(conv.contact.id) : '#64748b' }}>
              {isGroup
                ? <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
                : initials(contactName)}
            </div>
          </button>

          <button
            className={cn('flex-1 min-w-0 text-left', conv.contact && 'cursor-pointer hover:opacity-80 transition-opacity')}
            onClick={() => conv.contact && setShowContact(true)}
            disabled={!conv.contact}>
            <p className="font-semibold text-sm truncate">{contactName}</p>
            {presenceTxt ? (
              <p className="text-xs text-emerald-500 font-medium truncate flex items-center gap-1">
                <span className="inline-flex gap-0.5 items-end h-3">
                  <span className="w-0.5 bg-emerald-500 rounded-full animate-[bounce_1s_infinite_0ms]" style={{ height: '60%' }} />
                  <span className="w-0.5 bg-emerald-500 rounded-full animate-[bounce_1s_infinite_150ms]" style={{ height: '100%' }} />
                  <span className="w-0.5 bg-emerald-500 rounded-full animate-[bounce_1s_infinite_300ms]" style={{ height: '60%' }} />
                </span>
                {presenceTxt}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground truncate">
                📱 {conv.channel.label}
                {rawPhone && !phoneIsId && <span className="ml-1.5">{formatPhone(rawPhone)}</span>}
              </p>
            )}
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Badge de status */}
            {conv.status === 'RESOLVED' ? (
              <span className="hidden sm:flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="h-3 w-3" /> Finalizada
              </span>
            ) : conv.status === 'WAITING' ? (
              <span className="hidden sm:flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                <Clock3 className="h-3 w-3" /> Aguardando
              </span>
            ) : null}

            <AssigneeChip conversationId={conversationId} assignee={conv.assignee} />
            <button
              onClick={() => setShowTimeline(true)}
              className="flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
              title="Histórico de auditoria">
              <History className="h-3.5 w-3.5" /> Histórico
            </button>
            {/* Encaminhar + Devolver — só quem tem a conversa (ou admin) */}
            {(isMyConv || isAdmin) && conv.assigneeId && (
              <>
                <button
                  onClick={() => setShowForward(true)}
                  className="flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium text-blue-600 border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                  title="Encaminhar para outro atendente">
                  <LogIn className="h-3.5 w-3.5 rotate-180" /> Encaminhar
                </button>
                <button
                  onClick={() => setShowRelease(true)}
                  className="flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium text-amber-600 border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                  title="Devolver à fila">
                  <LogOut className="h-3.5 w-3.5" /> Devolver
                </button>
              </>
            )}
            {/* Dropdown "+ Criar..." (Card / Tarefa / Evento) */}
            <div className="relative">
              <button
                onClick={() => setShowCreateMenu(v => !v)}
                onBlur={() => setTimeout(() => setShowCreateMenu(false), 200)}
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                <Plus className="h-3.5 w-3.5" /> Criar
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
              {showCreateMenu && (
                <div className="absolute right-0 top-full mt-1 z-30 bg-card border rounded-lg shadow-lg overflow-hidden w-48">
                  <button
                    onMouseDown={() => { setShowCardModal(true); setShowCreateMenu(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent text-left">
                    <Kanban className="h-3.5 w-3.5 text-violet-500" />
                    <div>
                      <p className="font-medium">Card no Kanban</p>
                      <p className="text-[10px] text-muted-foreground">Adicionar a um board</p>
                    </div>
                  </button>
                  <button
                    onMouseDown={() => { setShowTaskModal({}); setShowCreateMenu(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent text-left border-t">
                    <ListTodo className="h-3.5 w-3.5 text-blue-500" />
                    <div>
                      <p className="font-medium">Tarefa / Lembrete</p>
                      <p className="text-[10px] text-muted-foreground">Com data e responsável</p>
                    </div>
                  </button>
                  <button
                    onMouseDown={() => { setShowEventModal({}); setShowCreateMenu(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent text-left border-t">
                    <CalendarPlus className="h-3.5 w-3.5 text-emerald-500" />
                    <div>
                      <p className="font-medium">Evento no Calendário</p>
                      <p className="text-[10px] text-muted-foreground">Sincroniza com Google</p>
                    </div>
                  </button>
                </div>
              )}
            </div>
            {conv.status === 'RESOLVED' ? (
              <button
                onClick={() => statusMutation.mutate('OPEN')}
                disabled={statusMutation.isPending}
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                title="Reabrir conversa">
                <RotateCcw className="h-3.5 w-3.5" /> Reabrir
              </button>
            ) : (
              <button
                onClick={() => statusMutation.mutate('RESOLVED')}
                disabled={statusMutation.isPending}
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400 transition-colors disabled:opacity-50"
                title="Finalizar atendimento">
                <CheckCircle2 className="h-3.5 w-3.5" /> Finalizar
              </button>
            )}
          </div>
        </div>

        {/* ── Banner: conversa na fila (sem atribuição) ── */}
        {isUnassigned && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 shrink-0">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-200 flex-1">
              Esta conversa está na fila, sem atendente.
            </p>
            <button
              onClick={() => claimMutation.mutate()}
              disabled={claimMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1 text-sm font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-60 transition-colors shrink-0">
              <LogIn className="h-3.5 w-3.5" />
              {claimMutation.isPending ? 'Assumindo...' : 'Assumir atendimento'}
            </button>
          </div>
        )}

        {/* ── Banner: em atendimento por outro (MEMBER ou ADMIN supervisionando) ── */}
        {isOtherConv && !isAdmin && (
          <div className="flex items-center gap-3 px-4 py-2 bg-muted/60 border-b shrink-0">
            <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="text-sm text-muted-foreground">
              Em atendimento por <strong>{conv.assignee?.name ?? conv.assignee?.email ?? 'outro atendente'}</strong>.
              Você está em modo de leitura.
            </p>
          </div>
        )}

        {/* ── Banner: ADMIN supervisionando — pode finalizar/assumir/transferir, mas não digitar ── */}
        {isOtherConv && isAdmin && (
          <div className="flex items-center gap-3 px-4 py-2 bg-blue-50/60 dark:bg-blue-950/20 border-b border-blue-200 dark:border-blue-800 shrink-0">
            <AlertCircle className="h-4 w-4 text-blue-500 shrink-0" />
            <p className="text-sm text-blue-700 dark:text-blue-300">
              Supervisionando conversa de <strong>{conv.assignee?.name ?? conv.assignee?.email}</strong>.
              Para responder, assuma o atendimento.
            </p>
          </div>
        )}

        {/* ── Área de mensagens com padrão de fundo ── */}
        <div
          className="flex-1 overflow-y-auto px-4 py-3 space-y-0.5 relative"
          style={{
            backgroundColor: 'hsl(var(--accent)/0.4)',
            backgroundImage: `radial-gradient(circle, hsl(var(--foreground)/0.06) 1px, transparent 1px)`,
            backgroundSize: '20px 20px',
          }}
        >
          {isLoading && <div className="text-center text-sm text-muted-foreground py-8">Carregando...</div>}

          {groups.map((group) => (
            <div key={group.date}>
              {/* Separador de data */}
              <div className="flex justify-center my-3">
                <span className="text-[11px] text-muted-foreground bg-card/90 backdrop-blur-sm px-3 py-0.5 rounded-full border shadow-sm">
                  {group.date}
                </span>
              </div>

              {group.messages.map((msg, i) => {
                const isOut = msg.direction === 'OUTBOUND'
                const senderId = msg.fromContactId ?? (isOut ? '__me' : '__unknown')
                const isFirstOfSender = senderId !== lastSenderId
                lastSenderId = senderId

                // Nome do remetente em grupos
                const senderName = isGroup && !isOut && isFirstOfSender
                  ? (msg.fromContact?.name
                    || (msg.fromContact?.phone ? formatPhone(msg.fromContact.phone) : null)
                    || 'Desconhecido')
                  : null

                const bubbleColor = senderName ? senderColor(senderId) : undefined

                // Quote do remetente (para mostrar a cor correta na bolha de citação)
                const quotedColor = msg.quotedSender
                  ? senderColor(msg.quotedSender)
                  : (isOut ? senderColor('__me') : bubbleColor)

                return (
                  <div
                    key={msg.id}
                    className={cn(
                      'group flex items-end gap-1.5 mb-0.5',
                      isOut ? 'justify-end' : 'justify-start',
                      isFirstOfSender && i > 0 && 'mt-2',
                    )}
                  >
                    {/* Avatar do remetente em grupos (inbound) */}
                    {isGroup && !isOut && (
                      <div className="shrink-0 mb-0.5">
                        {isFirstOfSender
                          ? (
                            <div
                              className="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                              style={{ background: senderColor(senderId) }}
                            >
                              {initials(senderName ?? 'D')}
                            </div>
                          )
                          : <div className="h-7 w-7" />
                        }
                      </div>
                    )}

                    {/* Bolha */}
                    <div className="relative max-w-[72%]">
                      {/* Botões de ação (hover) */}
                      <div className={cn(
                        'absolute top-1 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10',
                        isOut ? '-left-8' : '-right-8',
                      )}>
                        <button
                          onClick={() => setReplyTo({
                            msgId: msg.externalId ?? msg.id,
                            body: msg.body,
                            sender: senderName ?? (isOut ? 'Você' : contactName),
                            color: bubbleColor ?? (isOut ? '#6366f1' : undefined),
                          })}
                          className="p-1 rounded-full bg-card border shadow-sm text-muted-foreground hover:text-foreground"
                          title="Responder"
                        >
                          <Reply className="h-3 w-3" />
                        </button>
                        {msg.attachments?.length ? (
                          <>
                            <button
                              onClick={() => setAttachMessageId(msg.id)}
                              className="p-1 rounded-full bg-card border shadow-sm text-muted-foreground hover:text-primary"
                              title="Anexar ao Card"
                            >
                              <Kanban className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => setSaveToLibraryMsg({
                                id: msg.id,
                                filename: (msg.attachments?.[0] as any)?.filename ?? undefined,
                              })}
                              className="p-1 rounded-full bg-card border shadow-sm text-muted-foreground hover:text-amber-500"
                              title="Salvar nos meus arquivos"
                            >
                              <Save className="h-3 w-3" />
                            </button>
                          </>
                        ) : null}
                        <button
                          onClick={() => setShowTaskModal({
                            initialTitle: (msg.body ?? '').slice(0, 80),
                            messageId: msg.id,
                          })}
                          className="p-1 rounded-full bg-card border shadow-sm text-muted-foreground hover:text-blue-500"
                          title="Criar tarefa a partir desta mensagem"
                        >
                          <ListTodo className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => setShowEventModal({
                            initialTitle: (msg.body ?? '').slice(0, 80),
                            messageId: msg.id,
                          })}
                          className="p-1 rounded-full bg-card border shadow-sm text-muted-foreground hover:text-emerald-500"
                          title="Criar evento a partir desta mensagem"
                        >
                          <CalendarPlus className="h-3 w-3" />
                        </button>
                      </div>

                      {/* Detecta mensagem de sistema (welcome/closing automáticos) */}
                      {(() => {
                        const sysKind = (msg.attachments?.[0] as any)?.kind as string | undefined
                        const isSystemMsg = sysKind === 'channel-welcome' || sysKind === 'agent-welcome' || sysKind === 'closing'
                        const sysLabel =
                          sysKind === 'channel-welcome' ? '🤖 Boas-vindas (auto)'
                          : sysKind === 'agent-welcome' ? '✨ Apresentação (auto)'
                          : sysKind === 'closing' ? '✅ Finalização (auto)'
                          : null
                        return (
                          <>
                            <div className={cn(
                              'rounded-2xl px-3 py-1.5',
                              isOut
                                ? isSystemMsg
                                  ? 'bg-primary/60 text-primary-foreground rounded-br-sm border border-primary-foreground/20'
                                  : 'bg-primary text-primary-foreground rounded-br-sm'
                                : 'bg-card border rounded-bl-sm shadow-sm',
                            )}>
                              {sysLabel && (
                                <p className="text-[10px] font-medium opacity-80 mb-1 italic">{sysLabel}</p>
                              )}
                              {/* Nome do remetente (grupos) */}
                              {senderName && (
                                <p className="text-[11px] font-semibold mb-0.5" style={{ color: bubbleColor }}>
                                  {senderName}
                                </p>
                              )}

                        {/* Mensagem citada */}
                        {msg.quotedBody && (
                          <QuoteBubble
                            quotedBody={msg.quotedBody}
                            quotedSender={msg.quotedSender}
                            color={quotedColor}
                          />
                        )}

                              <MediaBubble msg={msg} />

                              {/* Hora + status */}
                              <div className={cn(
                                'flex items-center justify-end gap-0.5 mt-0.5',
                                isOut ? 'text-primary-foreground/70' : 'text-muted-foreground',
                              )}>
                                <span className="text-[10px] leading-none">{formatTime(msg.sentAt)}</span>
                                {isOut && <DeliveryStatus status={msg.deliveryStatus} />}
                              </div>
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}

          {messages.length === 0 && !isLoading && (
            <div className="text-center text-sm text-muted-foreground py-8">Nenhuma mensagem ainda</div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* ── Reply bar ── */}
        {replyTo && <ReplyBar reply={replyTo} onCancel={() => setReplyTo(null)} />}

        {/* ── Preview arquivo ── */}
        {pendingFile && (
          <div className="px-4 py-2 border-t bg-muted/40">
            <div className="flex items-center gap-2 mb-2">
              {fileIcon(pendingFile)}
              <span className="text-sm truncate flex-1">{pendingFile.name}</span>
              <span className="text-xs text-muted-foreground">{(pendingFile.size / 1024).toFixed(0)} KB</span>
              <button onClick={() => setPendingFile(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            {pendingFile.type.startsWith('image/') && (
              <img src={URL.createObjectURL(pendingFile)} alt="preview" className="max-h-32 rounded-lg mb-2 object-contain" />
            )}
            <input value={caption} onChange={e => setCaption(e.target.value)}
              placeholder="Legenda (opcional)..."
              className="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              onKeyDown={handleKeyDown} />
          </div>
        )}

        {/* ── Input / CTA ── */}
        {/* Caso 1: conversa sem atribuição — qualquer um precisa assumir primeiro */}
        {isUnassigned ? (
          <div className="border-t bg-muted/20 px-4 py-4 shrink-0 flex flex-col items-center gap-2">
            <p className="text-sm text-muted-foreground">Assuma a conversa para poder responder</p>
            <button
              onClick={() => claimMutation.mutate()}
              disabled={claimMutation.isPending}
              className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-amber-500 text-white rounded-xl hover:bg-amber-600 disabled:opacity-60 transition-colors shadow-sm">
              <LogIn className="h-4 w-4" />
              {claimMutation.isPending ? 'Assumindo...' : 'Assumir atendimento'}
            </button>
          </div>
        ) : isOtherConv ? (
          /* Caso 2: em atendimento por outro — leitura + opção de assumir.
             Vale tanto pra MEMBER quanto pra ADMIN: pra digitar precisa assumir,
             evita responder em nome de outro sem querer. ADMIN ainda tem os
             botões "Finalizar / Encaminhar / Devolver" no header. */
          <div className="border-t bg-muted/20 px-4 py-4 shrink-0 flex flex-col items-center gap-2">
            <p className="text-sm text-muted-foreground text-center">
              Em atendimento por <strong>{conv.assignee?.name ?? conv.assignee?.email ?? 'outro atendente'}</strong>
            </p>
            {isAdmin ? (
              <button
                onClick={() => claimMutation.mutate()}
                disabled={claimMutation.isPending}
                className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-amber-500 text-white rounded-xl hover:bg-amber-600 disabled:opacity-60 transition-colors shadow-sm">
                <LogIn className="h-4 w-4" />
                {claimMutation.isPending ? 'Assumindo...' : 'Assumir atendimento'}
              </button>
            ) : (
              <p className="text-xs text-muted-foreground/70">Você está em modo leitura</p>
            )}
          </div>
        ) : (
          /* Caso 3: minha conversa — input normal */
          <div className="px-4 py-3 border-t bg-card shrink-0">
            <input ref={fileInputRef} type="file"
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt"
              className="hidden" onChange={handleFileSelect} />
            <div className="flex items-end gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-2.5 rounded-xl border hover:bg-accent text-muted-foreground shrink-0"
                title="Anexar arquivo da máquina">
                <Paperclip className="h-4 w-4" />
              </button>
              <button
                onClick={() => setShowLibraryPicker(true)}
                className="p-2.5 rounded-xl border hover:bg-accent text-muted-foreground shrink-0"
                title="Anexar dos meus arquivos">
                <FolderOpen className="h-4 w-4" />
              </button>
              {!pendingFile && (
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={e => { setText(e.target.value); if (e.target.value) sendComposing() }}
                  onKeyDown={handleKeyDown}
                  placeholder="Digite uma mensagem..."
                  rows={1}
                  className="flex-1 resize-none rounded-xl border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring max-h-32"
                  style={{ minHeight: '40px' }}
                />
              )}
              {pendingFile && <div className="flex-1" />}
              <SuggestReplyButton conversationId={conversationId} onSelect={t => { setText(t ?? ''); setTimeout(() => textareaRef.current?.focus(), 50) }} />
              <button onClick={handleSend}
                disabled={pendingFile ? sendMediaMutation.isPending : !(text ?? '').trim() || sendMutation.isPending}
                className="rounded-xl bg-primary text-primary-foreground p-2.5 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed shrink-0">
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {showCardModal && (
        <CreateCardModal
          conversationId={conversationId}
          contactId={conv.contact?.id}
          contactName={conv.contact?.name ?? conv.contact?.phone ?? undefined}
          messages={messages}
          onClose={() => setShowCardModal(false)}
        />
      )}

      {showTaskModal && (
        <CreateTaskModal
          contactId={conv.contact?.id ?? null}
          contactName={conv.contact?.name ?? conv.contact?.phone ?? null}
          conversationId={conversationId}
          messageId={showTaskModal.messageId}
          initialTitle={showTaskModal.initialTitle}
          onClose={() => setShowTaskModal(null)}
        />
      )}

      {showEventModal && (
        <CreateEventModal
          contactId={conv.contact?.id ?? null}
          contactName={conv.contact?.name ?? conv.contact?.phone ?? null}
          conversationId={conversationId}
          messageId={showEventModal.messageId}
          initialTitle={showEventModal.initialTitle}
          onClose={() => setShowEventModal(null)}
        />
      )}

      {showLibraryPicker && (
        <LibraryPickerModal
          conversationId={conversationId}
          onClose={() => setShowLibraryPicker(false)}
          onSent={() => {
            queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
            queryClient.invalidateQueries({ queryKey: ['conversations'] })
          }}
        />
      )}

      {saveToLibraryMsg && (
        <SaveToLibraryModal
          messageId={saveToLibraryMsg.id}
          suggestedFilename={saveToLibraryMsg.filename}
          onClose={() => setSaveToLibraryMsg(null)}
        />
      )}

      {showContact && conv.contact && (
        <ContactDrawer
          contact={conv.contact}
          onClose={() => setShowContact(false)}
          onSave={data => updateContactMutation.mutate(data)}
          currentConvId={conversationId}
        />
      )}

      {attachMessageId && (
        <AttachToCardModal
          messageId={attachMessageId}
          onClose={() => setAttachMessageId(null)}
        />
      )}

      {showRelease && (
        <ReleaseConversationModal
          conversationId={conversationId}
          onClose={() => setShowRelease(false)}
          onDone={() => {
            setShowRelease(false)
            // Optimistic: limpa assignee local pra UI alternar pra banner "Em fila"
            queryClient.setQueryData<any>(['conversation', conversationId], (old: any) => {
              if (!old?.conversation) return old
              return {
                ...old,
                conversation: { ...old.conversation, assigneeId: null, assignee: null, claimedAt: null },
              }
            })
            queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
            queryClient.invalidateQueries({ queryKey: ['conversations'] })
          }}
        />
      )}

      {showForward && (
        <ForwardConversationModal
          conversationId={conversationId}
          currentAssigneeId={conv.assigneeId}
          onClose={() => setShowForward(false)}
          onDone={() => {
            setShowForward(false)
            queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
            queryClient.invalidateQueries({ queryKey: ['conversations'] })
          }}
        />
      )}

      {showTimeline && (
        <ConversationTimelineModal
          conversationId={conversationId}
          onClose={() => setShowTimeline(false)}
        />
      )}
    </>
  )
}

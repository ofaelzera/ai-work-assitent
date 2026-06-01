'use client'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { apiFetch, getAccessToken } from '@/lib/api'
import { useSSE } from '@/lib/sse'
import { usePresence, presenceLabel } from '@/lib/usePresence'
import {
  Send, Paperclip, FileText, Music, Video, Image as ImageIcon, X,
  ZoomIn, Download, Kanban, Phone, Mail, Reply,
  Check, CheckCheck, Sparkles, CheckCircle2, RotateCcw, Clock3, UserRound, ChevronDown,
  LogIn, LogOut, AlertCircle, Plus, ListTodo, CalendarPlus, FolderOpen, Save, History, MoreVertical, ChevronRight,
  Smile, Trash2, Pencil, MapPin, Contact, BarChart2, Shield, ShieldOff, Mic
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatTime, formatDate } from '@/lib/date'
import { formatPhone, isInternalId } from '@/lib/phone'
import { maskPhone } from '@/lib/masks'
import { renderWhatsappText, stripWhatsappMarks, WhatsappText, MentionProvider } from '@/lib/whatsappText'
import { useMentionResolver } from '@/lib/useMentionResolver'
import { toast } from 'sonner'
import CreateCardModal from '@/components/CreateCardModal'
import CreateTaskModal from '@/components/CreateTaskModal'
import CreateEventModal from '@/components/CreateEventModal'
import LibraryPickerModal from '@/components/LibraryPickerModal'
import SaveToLibraryModal from '@/components/SaveToLibraryModal'
import { ConversationTimelineModal } from '@/components/ConversationTimelineModal'
import { useAuthStore } from '@/store/auth'
import { ChatInput } from '@/components/ChatInput'
import { GroupPanel } from './GroupPanel'
import { getApiUrl } from '@/lib/runtime-config'

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

export interface MessageReaction {
  emoji: string
  senderId: string
  senderName?: string
  fromMe: boolean
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
  fromContact?: { id: string; name: string | null; phone: string | null; metadata?: { avatarUrl?: string | null } | null } | null
  fromUser?: { id: string; name: string | null; email: string; settings?: { avatarUrl?: string | null } | null } | null
  deliveryStatus?: string | null
  quotedMsgId?: string | null
  quotedBody?: string | null
  quotedSender?: string | null
  metadata?: { reactions?: MessageReaction[]; deleted?: boolean; edited?: boolean } | null
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
  companyId?: string | null
  company?: { id: string; name: string; color: string } | null
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
    fetch(`${getApiUrl()}/messages/${msgId}/media`, {
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
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    // Trava scroll do body enquanto modal aberto
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', h)
      document.body.style.overflow = prev
    }
  }, [onClose])

  if (!mounted) return null
  // Portal pro document.body — escapa qualquer stacking context / transform de ancestrais
  return createPortal(
    <div
      className="fixed inset-0 bg-black/85 flex items-center justify-center p-6"
      style={{ zIndex: 9999 }}
      onClick={onClose}
    >
      <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-white/90 hover:text-white p-1 rounded-full hover:bg-white/10"
          title="Fechar (Esc)"
        >
          <X className="h-5 w-5" />
        </button>
        {children}
      </div>
    </div>,
    document.body,
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
      {caption && <p className="text-sm whitespace-pre-wrap mt-1"><WhatsappText text={caption} /></p>}
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
      {caption && <p className="text-sm whitespace-pre-wrap mt-1"><WhatsappText text={caption} /></p>}
    </div>
  )
}

function DocumentBubble({ msgId, filename, mimetype }: { msgId: string; filename?: string; mimetype: string }) {
  const [modal, setModal] = useState(false)
  const { src, error } = useMediaBlob(msgId, modal)
  const isPdf = mimetype === 'application/pdf' || filename?.toLowerCase().endsWith('.pdf')
  const handleDownload = async () => {
    try {
      const r = await fetch(`${getApiUrl()}/messages/${msgId}/media`, { headers: { Authorization: `Bearer ${getAccessToken()}` } })
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
  if (!att) return <p className="whitespace-pre-wrap break-words text-sm"><WhatsappText text={msg.body} /></p>
  if (att.type === 'image' || att.type === 'sticker') return <MediaImage msgId={msg.id} caption={att.caption} />
  if (att.type === 'audio') return <AudioPlayer msgId={msg.id} seconds={att.seconds} />
  if (att.type === 'video') return <VideoPlayer msgId={msg.id} caption={att.caption} />
  if (att.type === 'document') return <DocumentBubble msgId={msg.id} filename={att.filename} mimetype={att.mimetype} />
  return <p className="whitespace-pre-wrap break-words text-sm"><WhatsappText text={msg.body} /></p>
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
            {lastMsg.direction === 'OUTBOUND' ? 'Você: ' : ''}{stripWhatsappMarks(lastMsg.body)}
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
                <input value={maskPhone(phone)} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} placeholder="+55 (44) 99999-9999"
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
function SuggestReplyButton({ conversationId, draft, onSelect }: { conversationId: string; draft?: string; onSelect: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<{ label: string; text: string }[]>([])

  const { data: settings } = useQuery<{ aiSuggestReplyEnabled?: boolean }>({
    queryKey: ['workspace-settings'],
    queryFn: () => apiFetch('/workspace/settings'),
    staleTime: 1000 * 60 * 5, // 5 min cache
  })

  if (settings && settings.aiSuggestReplyEnabled === false) {
    return null
  }

  const fetchSuggestions = async () => {
    setLoading(true)
    setOpen(true)
    try {
      const res = await apiFetch<{ suggestions: { label: string; text: string }[] }>(
        `/conversations/${conversationId}/suggest-reply`, { 
          method: 'POST',
          body: JSON.stringify(draft?.trim() ? { draft: draft.trim() } : {})
        },
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
  assignee?: { id: string; name: string | null; email: string; settings?: { avatarUrl?: string | null } | null } | null
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
  const avatarUrl = assignee.settings?.avatarUrl
  const ini = ((assignee.name ?? assignee.email).trim()[0] ?? '?').toUpperCase()
  return (
    <span
      className="flex items-center gap-1.5 text-[11px] font-medium rounded-full pl-0.5 pr-2 py-0.5 border bg-primary/10 border-primary/20 text-primary"
      title={`Em atendimento por ${assignee.name ?? assignee.email}`}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt={label} className="h-5 w-5 rounded-full object-cover shrink-0" />
      ) : (
        <span className="h-5 w-5 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-[9px] font-semibold text-white shrink-0">
          {ini}
        </span>
      )}
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
  const [mode, setMode] = useState<'user' | 'team'>('user')
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [note, setNote] = useState('')

  const { data: users = [] } = useQuery<{ id: string; name: string | null; email: string }[]>({
    queryKey: ['users'],
    queryFn: () => apiFetch('/users'),
    staleTime: 60_000,
  })

  const { data: teams = [] } = useQuery<{ id: string; name: string; color: string; slug: string }[]>({
    queryKey: ['teams', 'opt'],
    queryFn: () => apiFetch('/teams/options'),
    staleTime: 60_000,
  })

  const otherUsers = users.filter(u => u.id !== currentAssigneeId)

  const forwardMutation = useMutation({
    mutationFn: () => {
      if (mode === 'team') {
        return apiFetch(`/conversations/${conversationId}/transfer-to-team`, {
          method: 'POST',
          body: JSON.stringify({
            teamId: selectedTeamId,
            ...(note.trim() && { note: note.trim() }),
          }),
        })
      }
      return apiFetch(`/conversations/${conversationId}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({
          assigneeId: selectedUserId,
          ...(note.trim() && { note: note.trim() }),
        }),
      })
    },
    onSuccess: () => {
      if (mode === 'team') {
        const team = teams.find(t => t.id === selectedTeamId)
        toast.success(`Conversa enviada para o setor ${team?.name ?? ''}`)
      } else {
        const name = users.find(u => u.id === selectedUserId)?.name ?? 'atendente'
        toast.success(`Conversa enviada para a fila de ${name}`)
      }
      onDone()
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao encaminhar'),
  })

  const canSubmit = mode === 'user' ? !!selectedUserId : !!selectedTeamId

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-xl shadow-xl border w-full max-w-sm mx-4 p-5 space-y-4">
        <div>
          <h3 className="font-semibold text-base">Encaminhar conversa</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            {mode === 'team'
              ? 'A conversa vai para a fila do setor — qualquer membro pode assumir.'
              : 'A conversa vai para a fila do atendente — ele precisa clicar em "Assumir".'}
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-muted rounded-lg text-xs">
          <button onClick={() => setMode('user')}
            className={cn('flex-1 px-2 py-1.5 rounded font-medium transition',
              mode === 'user' ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground')}>
            Atendente
          </button>
          <button onClick={() => setMode('team')}
            className={cn('flex-1 px-2 py-1.5 rounded font-medium transition',
              mode === 'team' ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground')}>
            Setor
          </button>
        </div>

        {mode === 'user' ? (
          <div className="space-y-2">
            <div className="space-y-1 max-h-48 overflow-y-auto border rounded-lg p-1">
              {otherUsers.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-3">Nenhum outro atendente disponível</p>
              )}
              {otherUsers.map(u => (
                <button key={u.id} onClick={() => setSelectedUserId(u.id)}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-md text-sm transition-colors',
                    selectedUserId === u.id ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-accent',
                  )}>
                  {u.name ?? u.email}
                  {u.name && <span className="ml-1.5 text-xs opacity-60">{u.email}</span>}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="space-y-1 max-h-48 overflow-y-auto border rounded-lg p-1">
              {teams.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-3">Nenhum setor cadastrado</p>
              )}
              {teams.map(t => (
                <button key={t.id} onClick={() => setSelectedTeamId(t.id)}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-2',
                    selectedTeamId === t.id ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-accent',
                  )}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        )}

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
            disabled={!canSubmit || forwardMutation.isPending}
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {forwardMutation.isPending ? 'Enviando…' : 'Encaminhar'}
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
  const router = useRouter()
  const queryClient = useQueryClient()
  const currentUser = useAuthStore(s => s.user)
  // Resolve menções @<ID> nas mensagens visíveis (PN/LID → nome do contato)
  const mentionResolver = useMentionResolver(messages.map(m => m.body))
  const [text, setText] = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const [showCardModal, setShowCardModal] = useState(false)
  const [showTaskModal, setShowTaskModal] = useState<{ initialTitle?: string; messageId?: string } | null>(null)
  const [showEventModal, setShowEventModal] = useState<{ initialTitle?: string; messageId?: string } | null>(null)
  const [showLibraryPicker, setShowLibraryPicker] = useState(false)
  const [saveToLibraryMsg, setSaveToLibraryMsg] = useState<{ id: string; filename?: string } | null>(null)
  const [showCreateMenu, setShowCreateMenu] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showContact, setShowContact] = useState(false)
  const [showGroupPanel, setShowGroupPanel] = useState(false)
  const [showRelease, setShowRelease] = useState(false)
  const [showForward, setShowForward] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)
  const [attachMessageId, setAttachMessageId] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<ReplyState | null>(null)
  const [reactingMsgId, setReactingMsgId] = useState<string | null>(null)
  const [editingMsg, setEditingMsg] = useState<{ id: string; text: string; prefix?: string } | null>(null)
  const [showLocationModal, setShowLocationModal] = useState(false)
  const [showContactModal, setShowContactModal] = useState(false)
  const [showPollModal, setShowPollModal] = useState(false)
  const [isBlocked, setIsBlocked] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const presenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isComposing = useRef(false)

  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      }

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        const file = new File([audioBlob], 'audio.webm', { type: 'audio/webm' })
        sendMediaMutation.mutate({ file, caption: '', voiceNote: true })
        stream.getTracks().forEach(track => track.stop())
      }

      mediaRecorder.start()
      setIsRecording(true)
      setRecordingTime(0)
    } catch (error) {
      console.error('Erro ao acessar microfone', error)
      toast.error('Não foi possível acessar o microfone')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.onstop = () => {
        mediaRecorderRef.current?.stream.getTracks().forEach(track => track.stop())
      }
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      setRecordingTime(0)
    }
  }

  useEffect(() => {
    let interval: NodeJS.Timeout
    if (isRecording) {
      interval = setInterval(() => setRecordingTime(t => t + 1), 1000)
    }
    return () => clearInterval(interval)
  }, [isRecording])

  const { data: quickReplies = [] } = useQuery<{ id: string; shortcut: string; title: string | null; body: string }[]>({
    queryKey: ['quick-replies'],
    queryFn: () => apiFetch('/quick-replies'),
    staleTime: 60_000,
  })

  const { data: wsSettings } = useQuery<{ companyAddress?: string; razaoSocial?: string }>({
    queryKey: ['workspace-settings'],
    queryFn: () => apiFetch('/workspace/settings'),
    staleTime: 1000 * 60 * 5,
  })

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
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    },
  })

  const sendMediaMutation = useMutation({
    mutationFn: ({ file, caption, voiceNote }: { file: File; caption: string; voiceNote?: boolean }) => {
      const form = new FormData(); form.append('file', file); if (caption) form.append('caption', caption)
      if (voiceNote) form.append('voiceNote', 'true')
      return apiFetch<Message>(`/conversations/${conversationId}/messages/media`, { method: 'POST', body: form })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      setPendingFile(null); setCaption('')
    },
    onError: () => toast.error('Erro ao enviar mídia'),
  })

  const reactionMutation = useMutation({
    mutationFn: ({ messageId, reaction }: { messageId: string; reaction: string }) =>
      apiFetch(`/conversations/${conversationId}/messages/${messageId}/reaction`, {
        method: 'POST',
        body: JSON.stringify({ reaction }),
      }),
    onSuccess: () => {
      setReactingMsgId(null)
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
    },
    onError: () => toast.error('Erro ao enviar reação'),
  })

  const deleteMsgMutation = useMutation({
    mutationFn: (messageId: string) =>
      apiFetch(`/conversations/${conversationId}/messages/${messageId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
      toast.success('Mensagem apagada')
    },
    onError: () => toast.error('Erro ao apagar mensagem'),
  })

  const editMsgMutation = useMutation({
    mutationFn: ({ messageId, text }: { messageId: string; text: string }) =>
      apiFetch(`/conversations/${conversationId}/messages/${messageId}`, {
        method: 'PATCH', body: JSON.stringify({ text }),
      }),
    onSuccess: (_data, { messageId, text }) => {
      setEditingMsg(null)
      queryClient.setQueryData(['conversation', conversationId], (old: any) => {
        if (!old?.messages) return old
        return {
          ...old,
          messages: old.messages.map((m: any) =>
            m.id === messageId ? { ...m, body: text, metadata: { ...(m.metadata ?? {}), edited: true } } : m,
          ),
        }
      })
    },
    onError: () => toast.error('Erro ao editar mensagem'),
  })

  const blockMutation = useMutation({
    mutationFn: (action: 'block' | 'unblock') =>
      apiFetch(`/conversations/${conversationId}/block`, {
        method: 'PATCH', body: JSON.stringify({ action }),
      }),
    onSuccess: (_data, action) => {
      setIsBlocked(action === 'block')
      toast.success(action === 'block' ? 'Contato bloqueado' : 'Contato desbloqueado')
    },
    onError: () => toast.error('Erro ao alterar bloqueio'),
  })

  const sendLocationMutation = useMutation({
    mutationFn: (data: { latitude: number; longitude: number; name?: string; address?: string }) =>
      apiFetch(`/conversations/${conversationId}/send/location`, {
        method: 'POST', body: JSON.stringify(data),
      }),
    onSuccess: () => {
      setShowLocationModal(false)
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
      toast.success('Localização enviada')
    },
    onError: () => toast.error('Erro ao enviar localização'),
  })

  const sendContactMutation = useMutation({
    mutationFn: (data: { fullName: string; phoneNumber: string; organization?: string }) =>
      apiFetch(`/conversations/${conversationId}/send/contact`, {
        method: 'POST', body: JSON.stringify(data),
      }),
    onSuccess: () => {
      setShowContactModal(false)
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
      toast.success('Contato enviado')
    },
    onError: () => toast.error('Erro ao enviar contato'),
  })

  const sendPollMutation = useMutation({
    mutationFn: (data: { name: string; values: string[]; selectableCount?: number }) =>
      apiFetch(`/conversations/${conversationId}/send/poll`, {
        method: 'POST', body: JSON.stringify(data),
      }),
    onSuccess: () => {
      setShowPollModal(false)
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
      toast.success('Enquete enviada')
    },
    onError: () => toast.error('Erro ao enviar enquete'),
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
      if (status === 'RESOLVED') {
        router.push('/inbox')
      }
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
      window.dispatchEvent(new CustomEvent('chat:claim', { detail: 'mine' }))
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

    if (event.type === 'message.updated' && (event.payload as any)?.conversationId === conversationId) {
      const { messageId, reactions } = event.payload as any
      queryClient.setQueryData(
        ['conversation', conversationId],
        (old: any) => {
          if (!old?.messages) return old
          return {
            ...old,
            messages: old.messages.map((m: any) =>
              m.id === messageId ? { ...m, metadata: { ...(m.metadata ?? {}), reactions } } : m,
            ),
          }
        },
      )
    }

    if (event.type === 'message.deleted' && (event.payload as any)?.conversationId === conversationId) {
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
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

  // Rola até o fim ao trocar de conversa (instantâneo) — usa scrollTop direto no
  // container, mais confiável que scrollIntoView quando mídias carregam depois e
  // empurram o conteúdo. Retentativas curtas cobrem imagens/áudios com lazy-load.
  useEffect(() => {
    const jump = () => {
      const el = scrollContainerRef.current
      if (el) el.scrollTop = el.scrollHeight
      else bottomRef.current?.scrollIntoView({ block: 'end' })
    }
    jump()
    const timers = [50, 150, 350, 700].map(d => setTimeout(jump, d))
    return () => timers.forEach(clearTimeout)
  }, [conversationId])

  // Mensagens novas (durante a conversa aberta): rolagem suave até o fim.
  useEffect(() => {
    const timer = setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }, 100)
    return () => clearTimeout(timer)
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
    
    // Optimistic UI updates
    stopComposing()
    setText('')
    setReplyTo(null)
    setTimeout(() => {
      textareaRef.current?.focus()
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }, 100)
    
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
          <button onClick={() => isGroup ? setShowGroupPanel(true) : conv.contact && setShowContact(true)}
            className={cn('shrink-0', (isGroup || conv.contact) && 'cursor-pointer hover:opacity-80 transition-opacity')}
            disabled={!isGroup && !conv.contact}
            title={isGroup ? 'Detalhes do grupo' : undefined}>
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
            className={cn('flex-1 min-w-0 text-left', (isGroup || conv.contact) && 'cursor-pointer hover:opacity-80 transition-opacity')}
            onClick={() => isGroup ? setShowGroupPanel(true) : conv.contact && setShowContact(true)}
            disabled={!isGroup && !conv.contact}
            title={isGroup ? 'Detalhes do grupo' : undefined}>
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

            {/* Ações principais sempre visíveis */}
            <div className="flex items-center gap-1.5 ml-1 border-l pl-3 border-border/50">
              <div className="relative">
                <button
                  onClick={() => setShowCreateMenu(v => !v)}
                  onBlur={() => setTimeout(() => setShowCreateMenu(false), 200)}
                  className="flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  title="Criar tarefa, evento ou card">
                  <Plus className="h-4 w-4" />
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

              {/* Botão Finalizar em destaque solid */}
              {conv.status === 'RESOLVED' ? (
                <button
                  onClick={() => statusMutation.mutate('OPEN')}
                  disabled={statusMutation.isPending}
                  className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
                  title="Reabrir conversa">
                  <RotateCcw className="h-3.5 w-3.5" /> Reabrir
                </button>
              ) : (
                <button
                  onClick={() => statusMutation.mutate('RESOLVED')}
                  disabled={statusMutation.isPending}
                  className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 shadow-sm"
                  title="Finalizar atendimento">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Finalizar
                </button>
              )}

              {/* Mais opções (Histórico, Encaminhar, Devolver) */}
              <div className="relative">
                <button
                  onClick={() => setShowMoreMenu(v => !v)}
                  onBlur={() => setTimeout(() => setShowMoreMenu(false), 200)}
                  className="flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  title="Mais opções">
                  <MoreVertical className="h-4 w-4" />
                </button>
                {showMoreMenu && (
                  <div className="absolute right-0 top-full mt-1 z-30 bg-card border rounded-lg shadow-lg overflow-hidden w-48 py-1">
                    <button
                      onMouseDown={() => { setShowTimeline(true); setShowMoreMenu(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent text-left text-muted-foreground hover:text-foreground">
                      <History className="h-3.5 w-3.5" />
                      <span className="font-medium">Histórico da conversa</span>
                    </button>
                    {conv.channel.type === 'WHATSAPP' && !conv.isGroup && (
                      <>
                        <div className="h-px bg-border my-1" />
                        <button
                          onMouseDown={() => { blockMutation.mutate(isBlocked ? 'unblock' : 'block'); setShowMoreMenu(false) }}
                          className={cn(
                            'w-full flex items-center gap-2 px-3 py-2 text-xs text-left',
                            isBlocked
                              ? 'hover:bg-green-50 dark:hover:bg-green-900/20 text-green-600 dark:text-green-400'
                              : 'hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400',
                          )}
                        >
                          {isBlocked ? <ShieldOff className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
                          <span className="font-medium">{isBlocked ? 'Desbloquear contato' : 'Bloquear contato'}</span>
                        </button>
                      </>
                    )}
                    {(isMyConv || isAdmin) && conv.assigneeId && (
                      <>
                        <div className="h-px bg-border my-1" />
                        <button
                          onMouseDown={() => { setShowForward(true); setShowMoreMenu(false) }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-left">
                          <LogIn className="h-3.5 w-3.5 rotate-180" />
                          <span className="font-medium">Encaminhar</span>
                        </button>
                        <button
                          onMouseDown={() => { setShowRelease(true); setShowMoreMenu(false) }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-amber-50 dark:hover:bg-amber-900/20 text-amber-600 dark:text-amber-400 text-left">
                          <LogOut className="h-3.5 w-3.5" />
                          <span className="font-medium">Devolver à fila</span>
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Banner: conversa na fila (sem atribuição) ── */}
        {isUnassigned && conv.status !== 'RESOLVED' && (
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
        {isOtherConv && !isAdmin && conv.status !== 'RESOLVED' && (
          <div className="flex items-center gap-3 px-4 py-2 bg-muted/60 border-b shrink-0">
            <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="text-sm text-muted-foreground">
              Em atendimento por <strong>{conv.assignee?.name ?? conv.assignee?.email ?? 'outro atendente'}</strong>.
              Você está em modo de leitura.
            </p>
          </div>
        )}

        {/* ── Banner: ADMIN supervisionando — pode finalizar/assumir/transferir, mas não digitar ── */}
        {isOtherConv && isAdmin && conv.status !== 'RESOLVED' && (
          <div className="flex items-center gap-3 px-4 py-2 bg-blue-50/60 dark:bg-blue-950/20 border-b border-blue-200 dark:border-blue-800 shrink-0">
            <AlertCircle className="h-4 w-4 text-blue-500 shrink-0" />
            <p className="text-sm text-blue-700 dark:text-blue-300">
              Supervisionando conversa de <strong>{conv.assignee?.name ?? conv.assignee?.email}</strong>.
              Para responder, assuma o atendimento.
            </p>
          </div>
        )}

        {/* ── Área de mensagens com padrão de fundo ── */}
        <MentionProvider resolver={mentionResolver}>
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto px-4 py-3 space-y-0.5 relative"
          style={{
            backgroundColor: 'var(--chat-bg)',
            backgroundImage: `radial-gradient(circle, hsl(var(--foreground)/0.06) 1px, transparent 1px)`,
            backgroundSize: '20px 20px',
          }}
        >
          {isLoading && <div className="text-center text-sm text-muted-foreground py-8">Carregando...</div>}

          {useMemo(() => {
            const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏']
            let lastSenderId = ''
            return groups.map((group) => (
            <div key={group.date}>
              {/* Separador de data */}
              <div className="flex justify-center my-3">
                <span className="text-[11px] text-muted-foreground bg-card/90 backdrop-blur-sm px-3 py-0.5 rounded-full border shadow-sm">
                  {group.date}
                </span>
              </div>

              {group.messages.map((msg, i) => {
                // Eventos internos (transferência, notas) — renderizados como
                // divisor centralizado, não como bolha de chat.
                const att = msg.attachments?.[0] as any
                const intKind = typeof att?.kind === 'string' && att.kind.startsWith('internal-')
                  ? att.kind.replace('internal-', '')
                  : null
                if (intKind === 'transfer') {
                  return (
                    <div key={msg.id} className="flex items-center justify-center my-3 animate-slide-up">
                      <div className="max-w-[80%] bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl px-3 py-2 text-xs text-amber-800 dark:text-amber-300 shadow-sm">
                        <div className="flex items-center gap-1.5 font-semibold mb-1">
                          <ChevronRight className="h-3 w-3" />
                          Encaminhamento
                          <span className="ml-auto text-[10px] font-normal opacity-70">
                            {formatTime(msg.sentAt)}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.body}</p>
                      </div>
                    </div>
                  )
                }
                if (intKind === 'claim' || intKind === 'release') {
                  return (
                    <div key={msg.id} className="flex items-center justify-center my-3 animate-slide-up">
                      <div className="flex items-center gap-2 max-w-[80%]">
                        <div className="flex-1 h-px bg-border" />
                        <span className="text-[11px] text-muted-foreground font-medium px-2 py-0.5 rounded-full bg-muted/60">
                          {msg.body} · {formatTime(msg.sentAt)}
                        </span>
                        <div className="flex-1 h-px bg-border" />
                      </div>
                    </div>
                  )
                }

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
                      'group flex items-end gap-1.5 mb-0.5 animate-slide-up',
                      isOut ? 'justify-end' : 'justify-start',
                      isFirstOfSender && i > 0 && 'mt-2',
                    )}
                  >
                    {/* Avatar do remetente em grupos (inbound) */}
                    {isGroup && !isOut && (
                      <div className="shrink-0 mb-0.5">
                        {isFirstOfSender
                          ? (
                            msg.fromContact?.metadata?.avatarUrl ? (
                              <img
                                src={msg.fromContact.metadata.avatarUrl}
                                alt={senderName ?? 'Contato'}
                                title={senderName ?? undefined}
                                className="h-7 w-7 rounded-full object-cover"
                              />
                            ) : (
                              <div
                                className="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                                style={{ background: senderColor(senderId) }}
                                title={senderName ?? undefined}
                              >
                                {initials(senderName ?? 'D')}
                              </div>
                            )
                          )
                          : <div className="h-7 w-7" />
                        }
                      </div>
                    )}

                    {/* Bolha */}
                    {/* Avatar do atendente (outbound) */}
                    {isOut && msg.fromUser && (
                      <div className="shrink-0 mb-0.5 order-2">
                        {isFirstOfSender ? (
                          msg.fromUser.settings?.avatarUrl ? (
                            <img
                              src={msg.fromUser.settings.avatarUrl}
                              alt={msg.fromUser.name ?? msg.fromUser.email}
                              title={`Enviado por ${msg.fromUser.name ?? msg.fromUser.email}`}
                              className="h-7 w-7 rounded-full object-cover"
                            />
                          ) : (
                            <div
                              className="h-7 w-7 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-[10px] font-bold text-white"
                              title={`Enviado por ${msg.fromUser.name ?? msg.fromUser.email}`}
                            >
                              {((msg.fromUser.name ?? msg.fromUser.email).trim()[0] ?? '?').toUpperCase()}
                            </div>
                          )
                        ) : <div className="h-7 w-7" />}
                      </div>
                    )}

                    <div className="relative max-w-[72%]">
                      {/* Toolbar de ações (hover) — pílula horizontal sobre o balão */}
                      <div className={cn(
                        'absolute -top-3 z-30 flex items-center gap-0.5 rounded-full border bg-card shadow-md px-1 py-0.5',
                        'opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all',
                        'pointer-events-none group-hover:pointer-events-auto',
                        reactingMsgId === msg.id && 'opacity-100 translate-y-0 pointer-events-auto',
                        isOut ? 'right-1' : 'left-1',
                      )}>
                        <button
                          onClick={() => setReplyTo({
                            msgId: msg.externalId ?? msg.id,
                            body: msg.body,
                            sender: senderName ?? (isOut ? 'Você' : contactName),
                            color: bubbleColor ?? (isOut ? '#6366f1' : undefined),
                          })}
                          className="p-1 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                          title="Responder"
                        >
                          <Reply className="h-3 w-3" />
                        </button>
                        {msg.attachments?.length ? (
                          <>
                            <button
                              onClick={() => setAttachMessageId(msg.id)}
                              className="p-1 rounded-full text-muted-foreground hover:bg-accent hover:text-primary transition-colors"
                              title="Anexar ao Card"
                            >
                              <Kanban className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => setSaveToLibraryMsg({
                                id: msg.id,
                                filename: (msg.attachments?.[0] as any)?.filename ?? undefined,
                              })}
                              className="p-1 rounded-full text-muted-foreground hover:bg-accent hover:text-amber-500 transition-colors"
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
                          className="p-1 rounded-full text-muted-foreground hover:bg-accent hover:text-blue-500 transition-colors"
                          title="Criar tarefa a partir desta mensagem"
                        >
                          <ListTodo className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => setShowEventModal({
                            initialTitle: (msg.body ?? '').slice(0, 80),
                            messageId: msg.id,
                          })}
                          className="p-1 rounded-full text-muted-foreground hover:bg-accent hover:text-emerald-500 transition-colors"
                          title="Criar evento a partir desta mensagem"
                        >
                          <CalendarPlus className="h-3 w-3" />
                        </button>
                        {/* Reação */}
                        <div className="relative">
                          <button
                            onClick={(e) => { e.stopPropagation(); setReactingMsgId(v => v === msg.id ? null : msg.id) }}
                            className="p-1 rounded-full text-muted-foreground hover:bg-accent hover:text-amber-500 transition-colors"
                            title="Reagir"
                          >
                            <Smile className="h-3 w-3" />
                          </button>
                          {reactingMsgId === msg.id && (
                            <>
                              <div className="fixed inset-0 z-30" onClick={() => setReactingMsgId(null)} />
                              <div
                                className={cn(
                                  'absolute bottom-full mb-1 z-40 flex items-center gap-0.5 rounded-full border bg-card shadow-xl px-1.5 py-1',
                                  isOut ? 'right-0' : 'left-0',
                                )}
                              >
                                {REACTION_EMOJIS.map(emoji => (
                                  <button
                                    key={emoji}
                                    onClick={() => reactionMutation.mutate({ messageId: msg.id, reaction: emoji })}
                                    className="text-base hover:scale-125 transition-transform p-0.5"
                                    title={emoji}
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                        {/* Editar + Deletar mensagem (própria ou admin) */}
                        {(msg.direction === 'OUTBOUND' && msg.fromUserId === myId) || isAdmin ? (
                          <>
                            <button
                              onClick={() => {
                                const match = msg.body.match(/^\*.*?\*\n/)
                                const prefix = match ? match[0] : ''
                                const textWithoutPrefix = match ? msg.body.substring(prefix.length) : msg.body
                                setEditingMsg({ id: msg.id, text: textWithoutPrefix, prefix })
                              }}
                              className="p-1 rounded-full text-muted-foreground hover:bg-accent hover:text-blue-500 transition-colors"
                              title="Editar mensagem"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => { if (confirm('Apagar esta mensagem para todos?')) deleteMsgMutation.mutate(msg.id) }}
                              className="p-1 rounded-full text-muted-foreground hover:bg-accent hover:text-red-500 transition-colors"
                              title="Apagar para todos"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </>
                        ) : null}
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
                                'flex items-center justify-end gap-1 mt-0.5',
                                isOut ? 'text-primary-foreground/70' : 'text-muted-foreground',
                              )}>
                                {msg.metadata?.edited && (
                                  <span className="text-[9px] italic opacity-70">editada</span>
                                )}
                                <span className="text-[10px] leading-none">{formatTime(msg.sentAt)}</span>
                                {isOut && <DeliveryStatus status={msg.deliveryStatus} />}
                              </div>
                            </div>
                            {/* Editor inline */}
                            {editingMsg?.id === msg.id && (
                              <div className="mt-1">
                                <textarea
                                  autoFocus
                                  value={editingMsg.text}
                                  onChange={e => setEditingMsg(v => v ? { ...v, text: e.target.value } : null)}
                                  className="w-full rounded-md border bg-card px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                                  rows={3}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                      e.preventDefault()
                                      if (editingMsg.text.trim()) editMsgMutation.mutate({ messageId: msg.id, text: (editingMsg.prefix || '') + editingMsg.text.trim() })
                                    }
                                    if (e.key === 'Escape') setEditingMsg(null)
                                  }}
                                />
                                <div className="flex justify-end gap-2 mt-1">
                                  <button onClick={() => setEditingMsg(null)} className="text-xs text-muted-foreground hover:text-foreground">Cancelar</button>
                                  <button
                                    onClick={() => { if (editingMsg.text.trim()) editMsgMutation.mutate({ messageId: msg.id, text: (editingMsg.prefix || '') + editingMsg.text.trim() }) }}
                                    disabled={editMsgMutation.isPending}
                                    className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded disabled:opacity-50"
                                  >Salvar</button>
                                </div>
                              </div>
                            )}
                            {/* Reações */}
                            {(() => {
                              const rxns = msg.metadata?.reactions ?? []
                              if (!rxns.length) return null
                              const grouped = rxns.reduce<Record<string, number>>((acc, r) => {
                                acc[r.emoji] = (acc[r.emoji] ?? 0) + 1
                                return acc
                              }, {})
                              return (
                                <div className={cn('flex gap-0.5 mt-0.5', isOut ? 'justify-end' : 'justify-start')}>
                                  {Object.entries(grouped).map(([emoji, count]) => (
                                    <span
                                      key={emoji}
                                      className="inline-flex items-center gap-0.5 rounded-full bg-card border shadow-sm px-1.5 py-0.5 text-sm leading-none"
                                    >
                                      {emoji}
                                      {count > 1 && <span className="text-[10px] text-muted-foreground font-medium">{count}</span>}
                                    </span>
                                  ))}
                                </div>
                              )
                            })()}
                          </>
                        )
                      })()}
                    </div>
                  </div>
                )
              })}
            </div>
          ))
          }, [groups, isGroup, contactName, reactingMsgId, myId, isAdmin, editingMsg, editMsgMutation.isPending])}

          {messages.length === 0 && !isLoading && (
            <div className="text-center text-sm text-muted-foreground py-8">Nenhuma mensagem ainda</div>
          )}
          <div ref={bottomRef} />
        </div>
        </MentionProvider>

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
        {conv.status === 'RESOLVED' ? (
          <div className="border-t bg-muted/20 px-4 py-4 shrink-0 flex flex-col items-center gap-2">
            <p className="text-sm text-muted-foreground text-center">
              Esta conversa foi finalizada. Reabra para enviar novas mensagens.
            </p>
          </div>
        ) : isUnassigned ? (
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
          <div className="px-4 py-3 bg-card shrink-0">
            <input ref={fileInputRef} type="file"
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt"
              className="hidden" onChange={handleFileSelect} />
            <div className="w-full">
              {!pendingFile && !isRecording && (
                <ChatInput
                  value={text}
                  onChange={setText}
                  onSend={handleSend}
                  onTyping={sendComposing}
                  disabled={sendMediaMutation.isPending}
                  inputRef={textareaRef}
                  quickReplies={quickReplies}
                  leftToolbarActions={
                    <>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                        title="Anexar arquivo da máquina">
                        <Paperclip className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setShowLibraryPicker(true)}
                        className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                        title="Anexar dos meus arquivos">
                        <FolderOpen className="h-4 w-4" />
                      </button>
                      {conv.channel.type === 'WHATSAPP' && (
                        <>
                          <button
                            onClick={() => setShowLocationModal(true)}
                            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-emerald-500 transition-colors"
                            title="Enviar localização">
                            <MapPin className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setShowContactModal(true)}
                            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-blue-500 transition-colors"
                            title="Enviar contato">
                            <Contact className="h-4 w-4" />
                          </button>
                          {isGroup && (
                            <button
                              onClick={() => setShowPollModal(true)}
                              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-violet-500 transition-colors"
                              title="Criar enquete (apenas grupos)">
                              <BarChart2 className="h-4 w-4" />
                            </button>
                          )}
                        </>
                      )}
                    </>
                  }
                  bottomRightActions={
                    <>
                      <SuggestReplyButton 
                        conversationId={conversationId} 
                        draft={text}
                        onSelect={t => { setText(t ?? ''); setTimeout(() => textareaRef.current?.focus(), 50) }} 
                      />
                      {(text ?? '').trim() ? (
                        <button 
                          onClick={handleSend}
                          disabled={sendMutation.isPending}
                          className="rounded-full bg-primary text-primary-foreground p-2 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-transform active:scale-95 flex items-center justify-center">
                          <Send className="h-4 w-4" />
                        </button>
                      ) : (
                        <button 
                          onClick={startRecording}
                          disabled={sendMediaMutation.isPending}
                          className="rounded-full bg-muted text-muted-foreground p-2 hover:bg-accent hover:text-foreground shadow-sm transition-transform active:scale-95 flex items-center justify-center disabled:opacity-50">
                          <Mic className="h-4 w-4" />
                        </button>
                      )}
                    </>
                  }
                />
              )}
              {isRecording && (
                <div className="flex-1 flex items-center justify-between px-4 py-3 bg-red-50/50 border border-red-100 rounded-xl">
                  <div className="flex items-center gap-3 text-red-500">
                    <div className="relative flex items-center justify-center">
                      <Mic className="h-5 w-5 animate-pulse" />
                      <div className="absolute inset-0 bg-red-500 rounded-full animate-ping opacity-20" />
                    </div>
                    <span className="text-sm font-medium tabular-nums">
                      Gravando... {Math.floor(recordingTime / 60).toString().padStart(2, '0')}:{(recordingTime % 60).toString().padStart(2, '0')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={cancelRecording} className="p-2 hover:bg-red-100 rounded-full transition-colors text-red-600 shadow-sm" title="Cancelar">
                      <Trash2 className="h-5 w-5" />
                    </button>
                    <button onClick={stopRecording} className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-full transition-colors shadow-sm" title="Enviar">
                      <Send className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              )}
              {pendingFile && (
                <div className="flex items-end gap-2">
                  <div className="flex-1" />
                  <button onClick={handleSend}
                    disabled={sendMediaMutation.isPending}
                    className="rounded-full bg-primary text-primary-foreground p-3 hover:bg-primary/90 shadow-sm transition-transform active:scale-95 flex items-center justify-center">
                    <Send className="h-5 w-5" />
                  </button>
                </div>
              )}
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

      {showGroupPanel && (
        <GroupPanel
          conversationId={conversationId}
          groupAvatarUrl={conv.contact?.metadata?.avatarUrl ?? null}
          currentCompanyId={conv.companyId ?? conv.company?.id ?? null}
          onClose={() => setShowGroupPanel(false)}
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
            router.push('/inbox')
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
            router.push('/inbox')
          }}
        />
      )}

      {showTimeline && (
        <ConversationTimelineModal
          conversationId={conversationId}
          onClose={() => setShowTimeline(false)}
        />
      )}

      {/* Modal: Enviar Localização */}
      {showLocationModal && (
        <LocationModal
          onClose={() => setShowLocationModal(false)}
          onSend={(data) => sendLocationMutation.mutate(data)}
          isPending={sendLocationMutation.isPending}
          companyAddress={wsSettings?.companyAddress}
          companyName={wsSettings?.razaoSocial}
        />
      )}

      {/* Modal: Enviar Contato */}
      {showContactModal && (
        <ContactCardModal
          onClose={() => setShowContactModal(false)}
          onSend={(data) => sendContactMutation.mutate(data)}
          isPending={sendContactMutation.isPending}
        />
      )}

      {/* Modal: Criar Enquete */}
      {showPollModal && (
        <PollModal
          onClose={() => setShowPollModal(false)}
          onSend={(data) => sendPollMutation.mutate(data)}
          isPending={sendPollMutation.isPending}
        />
      )}
    </>
  )
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// ── Modal: Localização ────────────────────────────────────────────────────────
function LocationModal({ onClose, onSend, isPending, companyAddress, companyName }: {
  onClose: () => void
  onSend: (data: { latitude: number; longitude: number; name?: string; address?: string }) => void
  isPending: boolean
  companyAddress?: string
  companyName?: string
}) {
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'loading' | 'error'>('idle')

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  function useCurrentLocation() {
    if (!navigator.geolocation) { setGpsStatus('error'); return }
    setGpsStatus('loading')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6))
        setLng(pos.coords.longitude.toFixed(6))
        setGpsStatus('idle')
      },
      () => setGpsStatus('error'),
      { timeout: 10000 },
    )
  }

  function useCompanyAddress() {
    if (companyAddress) setAddress(companyAddress)
    if (companyName) setName(companyName)
  }

  const canSend = lat.trim() && lng.trim() && !isNaN(parseFloat(lat)) && !isNaN(parseFloat(lng))

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-emerald-500" />
            <h2 className="font-semibold text-sm">Enviar localização</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>

        {/* GPS */}
        <button
          type="button"
          onClick={useCurrentLocation}
          disabled={gpsStatus === 'loading'}
          className="w-full flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
        >
          <MapPin className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          {gpsStatus === 'loading' ? 'Obtendo localização...' : 'Usar localização atual (GPS)'}
        </button>
        {gpsStatus === 'error' && (
          <p className="text-xs text-destructive">Não foi possível obter localização. Verifique as permissões do navegador.</p>
        )}

        {/* Endereço da empresa */}
        {companyAddress && (
          <button
            type="button"
            onClick={useCompanyAddress}
            className="w-full flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Contact className="h-3.5 w-3.5 text-blue-500 shrink-0" />
            <span className="truncate text-left">Usar endereço da empresa: {companyAddress}</span>
          </button>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Latitude *</label>
            <input value={lat} onChange={e => setLat(e.target.value)} placeholder="-23.5505"
              className="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Longitude *</label>
            <input value={lng} onChange={e => setLng(e.target.value)} placeholder="-46.6333"
              className="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Nome do local</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Nossa loja"
            className="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Endereço</label>
          <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Rua, número, cidade"
            className="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-md text-sm hover:bg-accent">Cancelar</button>
          <button
            onClick={() => canSend && onSend({ latitude: parseFloat(lat), longitude: parseFloat(lng), name: name || undefined, address: address || undefined })}
            disabled={!canSend || isPending}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >{isPending ? 'Enviando...' : 'Enviar'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Modal: Contato (vCard) ────────────────────────────────────────────────────
function ContactCardModal({ onClose, onSend, isPending }: {
  onClose: () => void
  onSend: (data: { fullName: string; phoneNumber: string; organization?: string }) => void
  isPending: boolean
}) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<{ id: string; name: string; phone: string; organization?: string } | null>(null)
  const debouncedSearch = useDebounce(search, 300)

  const { data, isFetching } = useQuery<{
    items: Array<{ id: string; name: string | null; phone: string | null; company?: { name: string } | null }>
  }>({
    queryKey: ['contacts-search', debouncedSearch],
    queryFn: () => apiFetch(`/contacts?q=${encodeURIComponent(debouncedSearch)}&excludeLid=true&limit=20`),
    staleTime: 30_000,
  })

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const contacts = (data?.items ?? []).filter(c => c.name && c.phone)

  function handleSend() {
    if (!selected) return
    onSend({ fullName: selected.name, phoneNumber: selected.phone, organization: selected.organization })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Contact className="h-4 w-4 text-blue-500" />
            <h2 className="font-semibold text-sm">Enviar contato</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="relative">
          <input
            autoFocus
            value={search}
            onChange={e => { setSearch(e.target.value); setSelected(null) }}
            placeholder="Buscar contato pelo nome ou telefone..."
            className="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm pr-8 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {isFetching && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">...</span>
          )}
        </div>

        {/* Lista de resultados */}
        <div className="max-h-48 overflow-y-auto space-y-0.5 rounded-md border bg-muted/30">
          {contacts.length === 0 && !isFetching && (
            <p className="text-xs text-muted-foreground text-center py-4">
              {search ? 'Nenhum contato encontrado' : 'Digite para buscar'}
            </p>
          )}
          {contacts.map(c => {
            const org = c.company?.name
            const isSelected = selected?.id === c.id
            const avatarUrl = (c as any).metadata?.avatarUrl
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelected({ id: c.id, name: c.name!, phone: c.phone!, organization: org })}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent transition-colors text-sm',
                  isSelected && 'bg-primary/10 text-primary',
                )}
              >
                <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium shrink-0 overflow-hidden">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={c.name!} className="h-full w-full object-cover" />
                  ) : (
                    initials(c.name!)
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{c.phone}{org ? ` · ${org}` : ''}</p>
                </div>
                {isSelected && <span className="text-primary text-xs shrink-0">✓</span>}
              </button>
            )
          })}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-md text-sm hover:bg-accent">Cancelar</button>
          <button
            onClick={handleSend}
            disabled={!selected || isPending}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >{isPending ? 'Enviando...' : 'Enviar'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Modal: Enquete ────────────────────────────────────────────────────────────
function PollModal({ onClose, onSend, isPending }: {
  onClose: () => void
  onSend: (data: { name: string; values: string[]; selectableCount?: number }) => void
  isPending: boolean
}) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [multiSelect, setMultiSelect] = useState(false)

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const validOptions = options.filter(o => o.trim())
  const canSend = question.trim() && validOptions.length >= 2

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart2 className="h-4 w-4 text-violet-500" />
            <h2 className="font-semibold text-sm">Criar enquete</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Pergunta *</label>
          <input autoFocus value={question} onChange={e => setQuestion(e.target.value)} placeholder="Qual é sua preferência?"
            className="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground block">Opções * (mín. 2)</label>
          {options.map((opt, i) => (
            <div key={i} className="flex gap-1">
              <input
                value={opt}
                onChange={e => setOptions(v => v.map((o, j) => j === i ? e.target.value : o))}
                placeholder={`Opção ${i + 1}`}
                className="flex-1 rounded-md border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {options.length > 2 && (
                <button onClick={() => setOptions(v => v.filter((_, j) => j !== i))}
                  className="p-1.5 rounded hover:bg-accent text-muted-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          {options.length < 12 && (
            <button onClick={() => setOptions(v => [...v, ''])}
              className="text-xs text-primary hover:underline">+ Adicionar opção</button>
          )}
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={multiSelect} onChange={e => setMultiSelect(e.target.checked)}
            className="rounded" />
          <span className="text-xs text-muted-foreground">Permitir múltiplas respostas</span>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-md text-sm hover:bg-accent">Cancelar</button>
          <button
            onClick={() => canSend && onSend({ name: question.trim(), values: validOptions, selectableCount: multiSelect ? validOptions.length : 1 })}
            disabled={!canSend || isPending}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >{isPending ? 'Enviando...' : 'Enviar'}</button>
        </div>
      </div>
    </div>
  )
}

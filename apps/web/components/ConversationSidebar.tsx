'use client'

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useRouter, usePathname } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { useAuthStore } from '@/store/auth'
import { usePermission } from '@/lib/usePermission'
import { useSSE } from '@/lib/sse'
import { presenceLabel, type PresenceState } from '@/lib/usePresence'
import { stripWhatsappMarks } from '@/lib/whatsappText'
import {
  MessageSquare, Search, Star, Users, Mic, Image, FileText,
  Video, Paperclip, SquarePen, Archive, ArchiveRestore, Folder, Inbox, ChevronRight,
} from 'lucide-react'
import NewConversationModal from '@/components/NewConversationModal'
import ComposeNewEmailModal from '@/components/ComposeNewEmailModal'
import { cn } from '@/lib/utils'
import { formatPhone, isInternalId } from '@/lib/phone'
import { buildFolderTree, prettyFolderLabel, type FolderNode } from '@/lib/imap-folders'

type Filter = 'all' | 'queue' | 'mine' | 'others' | 'unread' | 'favorites' | 'groups' | 'archived' | 'resolved'
type View = 'conversations' | 'email'

interface Channel {
  id: string
  type: 'WHATSAPP' | 'GMAIL' | 'IMAP_SMTP'
  label: string
  settings?: { imapFolders?: string[] } | null
}

interface Attachment { type?: string; mimetype?: string }

interface Conversation {
  id: string
  externalId: string
  isGroup: boolean
  favorite: boolean
  archived: boolean
  status: 'OPEN' | 'WAITING' | 'RESOLVED'
  subject: string | null
  unreadCount: number
  lastMessageAt: string | null
  assigneeId: string | null
  assignee: { id: string; name: string; email: string } | null
  contact: {
    id: string; name: string | null; phone: string | null; email?: string | null
    metadata?: { avatarUrl?: string } | null
    company?: { id: string; name: string; color: string } | null
  } | null
  channel: { id: string; type: string; label: string }
  messages: Array<{ body: string; sentAt: string; direction: string; attachments?: Attachment[] | null }>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatConvTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

// ─── Channel badge ────────────────────────────────────────────────────────────
function ChannelBadge({ type }: { type: string }) {
  if (type === 'WHATSAPP') return (
    <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold shadow-sm" style={{ background: '#25D366' }}>W</span>
  )
  if (type === 'GMAIL') return (
    <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold shadow-sm" style={{ background: '#EA4335' }}>G</span>
  )
  return (
    <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold shadow-sm bg-blue-500">@</span>
  )
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
const AVATAR_COLORS = ['bg-violet-500','bg-blue-500','bg-green-500','bg-amber-500','bg-rose-500','bg-cyan-500','bg-orange-500','bg-teal-500','bg-pink-500','bg-indigo-500']
function stringToColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h); return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length] }
function initials(name: string) { const p = name.trim().split(/\s+/); return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase() }

function Avatar({ name, isGroup, avatarUrl, channelType }: { name: string; isGroup: boolean; avatarUrl?: string | null; channelType: string }) {
  const colorClass = stringToColor(name)
  return (
    <div className="relative shrink-0">
      {avatarUrl && (
        <img src={avatarUrl} alt={name} className="h-11 w-11 rounded-full object-cover"
          onError={(e) => { e.currentTarget.style.display = 'none'; const f = e.currentTarget.parentElement?.querySelector('.avatar-fallback') as HTMLElement; if (f) f.style.display = 'flex' }}
        />
      )}
      <div className={cn('avatar-fallback h-11 w-11 rounded-full items-center justify-center text-white text-sm font-semibold', colorClass, avatarUrl ? 'hidden' : 'flex')}>
        {isGroup ? <Users className="h-5 w-5" /> : initials(name)}
      </div>
      <ChannelBadge type={channelType} />
    </div>
  )
}

// ─── Preview de última mensagem ───────────────────────────────────────────────
function MessagePreview({ msg, direction }: { msg: Conversation['messages'][0]; direction: string }) {
  const att = msg.attachments?.[0]
  const type = att?.type ?? att?.mimetype ?? ''
  let preview: React.ReactNode = stripWhatsappMarks(msg.body) || ''
  if (type.startsWith('image') || type === 'image') preview = <><Image className="h-3 w-3 inline-block mr-1" />Foto</>
  else if (type.startsWith('audio') || type === 'audio' || type === 'ptt') preview = <><Mic className="h-3 w-3 inline-block mr-1" />Áudio</>
  else if (type.startsWith('video') || type === 'video') preview = <><Video className="h-3 w-3 inline-block mr-1" />Vídeo</>
  else if (type.startsWith('application') || type === 'document') preview = <><FileText className="h-3 w-3 inline-block mr-1" />Documento</>
  else if (type === 'sticker') preview = <><Paperclip className="h-3 w-3 inline-block mr-1" />Sticker</>
  return (
    <p className="text-xs text-muted-foreground truncate flex items-center gap-0.5">
      {direction === 'OUTBOUND' && <span className="shrink-0 mr-0.5">Você: </span>}
      <span className="truncate">{preview}</span>
    </p>
  )
}

// ─── Item de conversa (WhatsApp) ──────────────────────────────────────────────
function ConversationItem({ conv, active, onClick, onFavorite, onArchive, presenceTxt, onClaim, canArchive }: {
  conv: Conversation; active: boolean
  onClick: () => void
  onFavorite: (e: React.MouseEvent) => void
  onArchive: (e: React.MouseEvent) => void
  presenceTxt?: string | null
  onClaim?: (e: React.MouseEvent) => void
  canArchive: boolean
}) {
  const phone = conv.contact?.phone
  // Se o "phone" é um ID interno do WhatsApp (15+ dígitos), não usa como displayName
  const phoneDisplay = phone && !isInternalId(phone) ? formatPhone(phone) : null

  // Para grupos: prioriza subject (nome real do grupo), depois JID limpo, nunca nome do remetente
  // Para DMs: prioriza nome do contato, depois telefone, depois subject (email), depois externalId
  const displayName = conv.isGroup
    ? (conv.subject ?? `Grupo ${conv.externalId.replace('@g.us', '').slice(-6)}`)
    : (conv.contact?.name && conv.contact.name !== phone
        ? conv.contact.name
        : phoneDisplay
          ?? conv.subject
          ?? conv.externalId.replace('@s.whatsapp.net', '').replace('@g.us', ''))

  const lastMsg = conv.messages[0]
  const hasUnread = conv.unreadCount > 0
  const company = conv.contact?.company

  return (
    <div
      role="button" tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      className={cn(
        'group w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors relative cursor-pointer select-none',
        active ? 'bg-primary/8' : 'hover:bg-accent/60',
        conv.archived && 'opacity-60',
      )}
    >
      {active && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary rounded-r" />}

      <Avatar name={displayName} isGroup={conv.isGroup} avatarUrl={(conv.contact?.metadata as any)?.avatarUrl} channelType={conv.channel.type} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className={cn('text-sm truncate', hasUnread ? 'font-semibold' : 'font-medium')}>
              {displayName}
            </p>
            {company && (
              <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full text-white leading-none"
                style={{ background: company.color }}>
                {company.name.slice(0, 12)}
              </span>
            )}
            {/* Badge "em atendimento" — só relevante para ADMIN que vê conversas de outros */}
            {conv.assignee && (
              <span
                className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 leading-none"
                title={`Em atendimento por ${conv.assignee.name ?? conv.assignee.email}`}>
                @{(conv.assignee.name ?? conv.assignee.email).split(' ')[0].slice(0, 10)}
              </span>
            )}
          </div>
          <span className={cn('text-[11px] shrink-0', hasUnread ? 'text-primary font-medium' : 'text-muted-foreground')}>
            {formatConvTime(conv.lastMessageAt)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-1">
          <div className="min-w-0 flex-1">
            {presenceTxt
              ? <p className="text-xs text-emerald-500 font-medium truncate">{presenceTxt}</p>
              : lastMsg
                ? <MessagePreview msg={lastMsg} direction={lastMsg.direction} />
                : <p className="text-xs text-muted-foreground">Sem mensagens</p>}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {/* Botão "Assumir" — aparece no hover quando não atribuída */}
            {!conv.assigneeId && onClaim && (
              <button onClick={onClaim}
                className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-amber-600 shrink-0"
                title="Assumir atendimento">
                Assumir
              </button>
            )}
            {/* Arquivar — só visível para ADMIN */}
            {canArchive && (
              <button onClick={onArchive}
                className="p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                title={conv.archived ? 'Desarquivar' : 'Arquivar'}>
                {conv.archived
                  ? <ArchiveRestore className="h-3 w-3" />
                  : <Archive className="h-3 w-3" />}
              </button>
            )}
            {/* Favorito */}
            <button onClick={onFavorite}
              className={cn('p-0.5 rounded transition-opacity', conv.favorite ? 'opacity-100 text-amber-400' : 'opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-amber-400')}>
              <Star className={cn('h-3 w-3', conv.favorite && 'fill-amber-400')} />
            </button>
            {!conv.assigneeId && !onClaim && (
              <span className="text-[9px] font-semibold text-amber-600 bg-amber-100 dark:bg-amber-950 dark:text-amber-400 rounded px-1 py-0.5 shrink-0">
                Na fila
              </span>
            )}
            {conv.unreadCount > 0 && (
              <span className="text-[10px] font-bold bg-primary text-primary-foreground rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Item de email (visual diferente do WhatsApp) ─────────────────────────────
function EmailItem({ conv, active, onClick, onFavorite, onArchive, canArchive }: {
  conv: Conversation; active: boolean
  onClick: () => void
  onFavorite: (e: React.MouseEvent) => void
  onArchive: (e: React.MouseEvent) => void
  canArchive: boolean
}) {
  // Email: sender = contact.name, subject = conv.subject (primary), body = preview (tertiary)
  const senderName = conv.contact?.name?.trim() || conv.contact?.email || '(remetente desconhecido)'
  const subject = (conv.subject ?? '').trim() || '(sem assunto)'
  const lastMsg = conv.messages[0]
  const preview = (lastMsg?.body ?? '').replace(/\s+/g, ' ').trim()
  const hasUnread = conv.unreadCount > 0

  return (
    <div
      role="button" tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      className={cn(
        'group w-full text-left px-3 py-2.5 flex flex-col gap-0.5 transition-colors relative cursor-pointer select-none border-b border-border/40',
        active ? 'bg-primary/8' : 'hover:bg-accent/40',
        conv.archived && 'opacity-60',
      )}
    >
      {active && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary rounded-r" />}

      {/* Linha 1: sender + tempo */}
      <div className="flex items-center justify-between gap-2">
        <p className={cn('text-sm truncate flex-1', hasUnread ? 'font-bold' : 'font-medium')}>
          {senderName}
        </p>
        <span className={cn('text-[11px] shrink-0', hasUnread ? 'text-primary font-semibold' : 'text-muted-foreground')}>
          {formatConvTime(conv.lastMessageAt)}
        </span>
      </div>

      {/* Linha 2: assunto */}
      <p className={cn('text-[13px] truncate', hasUnread ? 'text-foreground font-medium' : 'text-foreground/80')}>
        {subject}
      </p>

      {/* Linha 3: preview + ações */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground truncate flex-1">
          {preview || '(sem preview)'}
        </p>
        <div className="flex items-center gap-0.5 shrink-0">
          {canArchive && (
            <button onClick={onArchive}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
              title={conv.archived ? 'Desarquivar' : 'Arquivar'}>
              {conv.archived ? <ArchiveRestore className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
            </button>
          )}
          <button onClick={onFavorite}
            className={cn('p-0.5 rounded transition-opacity', conv.favorite ? 'opacity-100 text-amber-400' : 'opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-amber-400')}>
            <Star className={cn('h-3 w-3', conv.favorite && 'fill-amber-400')} />
          </button>
          {hasUnread && (
            <span className="text-[10px] font-bold bg-primary text-primary-foreground rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
              {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Abas ─────────────────────────────────────────────────────────────────────
const TABS: { label: string; value: Filter }[] = [
  { label: 'Fila',    value: 'queue' },
  { label: 'Minhas',  value: 'mine' },
  { label: 'Outros',  value: 'others' },   // só visível para ADMIN
  { label: 'Todas',   value: 'all' },
  { label: 'Não lidas', value: 'unread' },
  { label: 'Fav',     value: 'favorites' },
  { label: 'Resolv.', value: 'resolved' },
  { label: 'Grupos',  value: 'groups' },
  { label: 'Arquivo', value: 'archived' },
]
// Labels alternativos completos (mostrados em hover via title)
const TAB_TITLES: Record<Filter, string> = {
  queue:     'Fila — conversas sem atribuição',
  all:       'Todas as conversas',
  mine:      'Minhas conversas',
  others:    'Em atendimento por outros atendentes (supervisão)',
  unread:    'Não lidas',
  favorites: 'Favoritos',
  resolved:  'Finalizados',
  groups:    'Grupos',
  archived:  'Arquivados',
}

// ─── Árvore de pastas IMAP ────────────────────────────────────────────────────
function FolderTreeButton({ label, icon, active, onClick, depth = 0 }: {
  label: string; icon?: React.ReactNode; active: boolean; onClick: () => void; depth?: number
}) {
  return (
    <button
      onClick={onClick}
      style={{ paddingLeft: 8 + depth * 14 }}
      className={cn(
        'w-full flex items-center gap-1.5 py-1 pr-2 rounded-md text-[12px] truncate transition-colors',
        active ? 'bg-primary/12 text-primary font-medium' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}>
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )
}

function FolderNodeButton({ node, active, onPick, depth, channelId }: {
  node: FolderNode
  active: { channelId: string; folder: string } | null
  onPick: (folder: string) => void
  depth: number
  channelId: string
}) {
  const [expanded, setExpanded] = useState(true)
  const isActive = active?.channelId === channelId && active.folder === node.path
  const hasChildren = node.children.length > 0
  const Icon = /^(INBOX|Caixa)/i.test(node.label) ? Inbox : Folder

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md mx-1 transition-colors cursor-pointer',
          isActive ? 'bg-primary/12 text-primary' : 'text-foreground/80 hover:bg-accent',
        )}
        style={{ paddingLeft: 4 + depth * 12 }}
        onClick={() => onPick(node.path)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(v => !v) }}
            className="p-0.5 rounded hover:bg-foreground/5 shrink-0"
          >
            <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <Icon className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')} />
        <span className={cn('truncate text-[13px] py-1.5 pr-2 flex-1', isActive && 'font-medium')}>
          {prettyFolderLabel(node.label)}
        </span>
      </div>
      {hasChildren && expanded && (
        <div>
          {node.children.map(child => (
            <FolderNodeButton
              key={`${channelId}:${child.path}`}
              node={child}
              active={active}
              onPick={onPick}
              depth={depth + 1}
              channelId={channelId}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ChannelFolderTree({ channel, active, onPick }: {
  channel: Channel
  active: { channelId: string; folder: string } | null
  onPick: (folder: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const folders = channel.settings?.imapFolders ?? []
  const tree = useMemo(() => buildFolderTree(folders), [folders])

  return (
    <div>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-1.5 py-1.5 px-2 text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground font-semibold transition-colors">
        <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
        <span className="truncate flex-1 text-left">{channel.label}</span>
      </button>
      {expanded && (
        <div className="space-y-px pb-1">
          {tree.length > 0 ? (
            tree.map(node => (
              <FolderNodeButton
                key={`${channel.id}:${node.path}`}
                node={node}
                active={active}
                onPick={onPick}
                depth={0}
                channelId={channel.id}
              />
            ))
          ) : (
            <p className="text-[11px] text-muted-foreground italic pl-6 py-1">
              Sincronize o canal para ver as pastas
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Sidebar principal ────────────────────────────────────────────────────────
export default function ConversationSidebar({ view = 'conversations' }: { view?: View } = {}) {
  const router = useRouter()
  const pathname = usePathname()
  const queryClient = useQueryClient()
  const currentUser = useAuthStore(s => s.user)
  const isAdmin = currentUser?.role === 'ADMIN'
  const canArchivePerm = usePermission('conversations.archive')
  const [search, setSearch] = useState('')
  // Default: "Minhas" — atendente vê o próprio trabalho primeiro.
  // Auto-fallback pra "Fila" mais abaixo se "Minhas" vier vazio na primeira carga.
  const [filter, setFilter] = useState<Filter>('mine')
  const [autoSwitched, setAutoSwitched] = useState(false)
  const [showNewConv, setShowNewConv] = useState(false)
  const [showComposeEmail, setShowComposeEmail] = useState(false)
  // Modo email: pasta IMAP selecionada (null = todas)
  const [activeFolder, setActiveFolder] = useState<{ channelId: string; folder: string } | null>(null)

  // Quando troca de view (Conversas <-> Email), reseta os filtros locais.
  // Default: "Minhas" — atendente vê o próprio trabalho. Auto-fallback pra Fila
  // mais abaixo se "Minhas" vier vazio.
  useEffect(() => {
    setSearch('')
    setFilter('mine')
    setActiveFolder(null)
    setAutoSwitched(false)  // permite re-rodar o fallback ao trocar de view
  }, [view])
  // Map de conversationId → presença atual (expira via timeout)
  const [presenceMap, setPresenceMap] = useState<Record<string, PresenceState>>({})
  const presenceTimers = useState<Record<string, ReturnType<typeof setTimeout>>>(() => ({}))[0]

  // Detecta conversa ativa pela URL (/inbox/[id])
  const activeId = pathname.match(/^\/inbox\/([^/]+)$/)?.[1] ?? null

  // Canais disponíveis (pra árvore de pastas IMAP no modo email)
  const { data: channels = [] } = useQuery({
    queryKey: ['channels'],
    queryFn: () => apiFetch<Channel[]>('/channels'),
    enabled: view === 'email',
    staleTime: 60_000,
  })
  const emailChannels = channels.filter(c => c.type === 'GMAIL' || c.type === 'IMAP_SMTP')

  const claimMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/conversations/${id}/claim`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['conversations'] }),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['conversations', view, filter, search, activeFolder],
    queryFn: () => {
      // 'mine'/'queue'/'others' são meta-filtros que viram filter=all + assigneeId=*
      const isMeta = filter === 'mine' || filter === 'queue' || filter === 'others'
      const apiFilter = isMeta ? 'all' : filter
      const params = new URLSearchParams({ filter: apiFilter })
      if (filter === 'mine') params.set('assigneeId', 'me')
      if (filter === 'queue') params.set('assigneeId', 'unassigned')
      if (filter === 'others') params.set('assigneeId', 'others')
      if (search) params.set('q', search)
      if (view === 'email') {
        params.set('channelTypeIn', 'GMAIL,IMAP_SMTP')
        if (activeFolder) {
          params.set('channelId', activeFolder.channelId)
          params.set('folder', activeFolder.folder)
        }
      } else {
        params.set('excludeChannelType', 'GMAIL,IMAP_SMTP')
      }
      return apiFetch<{ conversations: Conversation[]; queueCount: number }>(`/conversations?${params}`)
    },
    refetchInterval: 30_000,
  })

  const queueCount = data?.queueCount ?? 0

  // Auto-fallback: na primeira carga, se "Minhas" estiver vazia e tiver gente na fila,
  // já joga o atendente direto pra Fila pra ele assumir alguém.
  // Roda só uma vez por sessão (autoSwitched flag) e não bloqueia se o user já trocou de aba.
  useEffect(() => {
    if (autoSwitched) return
    if (isLoading) return
    if (view !== 'conversations') return
    if (filter !== 'mine') return
    const minhasVazia = (data?.conversations ?? []).length === 0
    if (minhasVazia && queueCount > 0) {
      setFilter('queue')
    }
    setAutoSwitched(true)
  }, [isLoading, data, queueCount, filter, view, autoSwitched])

  const favMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/conversations/${id}/favorite`, { method: 'PATCH' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['conversations'] }),
  })

  const archiveMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/conversations/${id}/archive`, { method: 'PATCH' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['conversations'] }),
  })

  useSSE((event) => {
    if (
      event.type === 'message.received' ||
      event.type === 'conversation.status_changed' ||
      event.type === 'conversation.claimed' ||
      event.type === 'conversation.released'
    ) {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    }

    if (event.type === 'presence.update') {
      const p = event.payload as { conversationId: string | null; presence: PresenceState }
      if (!p.conversationId) return

      const { conversationId, presence } = p

      // Limpa timer anterior se houver
      if (presenceTimers[conversationId]) clearTimeout(presenceTimers[conversationId])

      if (presence === 'composing' || presence === 'recording') {
        setPresenceMap(prev => ({ ...prev, [conversationId]: presence }))
        // Remove automaticamente após 8 s
        presenceTimers[conversationId] = setTimeout(() => {
          setPresenceMap(prev => {
            const next = { ...prev }
            delete next[conversationId]
            return next
          })
        }, 8_000)
      } else {
        // "paused", "available", "unavailable" → remove o indicador
        setPresenceMap(prev => {
          const next = { ...prev }
          delete next[conversationId]
          return next
        })
      }
    }
  })

  const conversations = data?.conversations ?? []

  const handleClick = (conv: Conversation) => {
    // Preserva ?view=email na URL pra evitar flicker do auto-detect no layout
    const url = view === 'email'
      ? `/inbox/${conv.id}?view=email`
      : `/inbox/${conv.id}`
    router.push(url)
    // Marca como lida otimisticamente em TODAS as queries de conversations cacheadas
    if (conv.unreadCount > 0) {
      queryClient.setQueriesData<{ conversations?: Conversation[] }>(
        { queryKey: ['conversations'] },
        (old) => old
          ? { ...old, conversations: old.conversations?.map(c => c.id === conv.id ? { ...c, unreadCount: 0 } : c) }
          : old,
      )
    }
  }

  const headerTitle = view === 'email' ? 'Email' : 'Conversas'

  // Filtra abas:
  //  • "Grupos" e "Fila" só fazem sentido em Conversas (WhatsApp)
  //  • "Todas", "Outros" e "Arquivo" são restritas a ADMIN
  const visibleTabs = (view === 'email'
    ? TABS.filter(t => t.value !== 'groups' && t.value !== 'queue')
    : TABS
  ).filter(t => isAdmin || (t.value !== 'all' && t.value !== 'archived' && t.value !== 'others'))

  return (
    <div className="w-[300px] flex-shrink-0 border-r flex flex-col bg-card">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-base font-semibold">{headerTitle}</h2>
          {view === 'conversations' && (
            <button onClick={() => setShowNewConv(true)}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="Nova conversa">
              <SquarePen className="h-4 w-4" />
            </button>
          )}
          {view === 'email' && (
            <button onClick={() => setShowComposeEmail(true)}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="Novo email">
              <SquarePen className="h-4 w-4" />
            </button>
          )}
        </div>
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar"
            className="w-full rounded-full border bg-accent/50 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
        {/* Tabs — flex-wrap em vez de scroll horizontal pra nada cortar */}
        <div className="flex flex-wrap gap-1 pt-0.5">
          {visibleTabs.map((tab) => {
            const isQueueTab = tab.value === 'queue'
            const showBadge = isQueueTab && queueCount > 0
            return (
              <button
                key={tab.value}
                onClick={() => setFilter(tab.value)}
                title={TAB_TITLES[tab.value]}
                className={cn(
                  'shrink-0 text-[11px] py-1 px-2 rounded-full font-medium transition-colors flex items-center gap-1',
                  filter === tab.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent',
                )}>
                {tab.label}
                {showBadge && (
                  <span className={cn(
                    'inline-flex items-center justify-center text-[10px] font-bold rounded-full min-w-[16px] h-[16px] px-1 leading-none',
                    filter === tab.value
                      ? 'bg-primary-foreground text-primary'
                      : 'bg-amber-500 text-white',
                  )}>
                    {queueCount > 99 ? '99+' : queueCount}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Árvore de pastas IMAP (apenas no modo email) */}
      {view === 'email' && emailChannels.length > 0 && (
        <div className="border-b py-1.5 px-1 max-h-60 overflow-y-auto bg-muted/20">
          <FolderTreeButton
            label="Todas as pastas"
            icon={<Inbox className="h-3.5 w-3.5" />}
            active={!activeFolder}
            onClick={() => setActiveFolder(null)}
          />
          {emailChannels.map(ch => (
            <ChannelFolderTree
              key={ch.id}
              channel={ch}
              active={activeFolder}
              onPick={(folder) => setActiveFolder({ channelId: ch.id, folder })}
            />
          ))}
        </div>
      )}

      {/* Lista */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && <div className="p-4 text-center text-sm text-muted-foreground">Carregando...</div>}

        {!isLoading && conversations.length === 0 && (
          <div className="p-8 text-center space-y-2">
            <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground">
              {search ? 'Nenhuma conversa encontrada'
                : filter === 'queue' ? 'Fila vazia — nenhuma conversa aguardando'
                : filter === 'mine' ? 'Nenhuma conversa atribuída a você'
                : filter === 'others' ? 'Nenhum atendente com conversas em aberto no momento'
                : filter === 'unread' ? 'Nenhuma não lida'
                : filter === 'favorites' ? 'Nenhum favorito'
                : filter === 'groups' ? 'Nenhum grupo'
                : filter === 'archived' ? 'Nenhuma arquivada'
                : view === 'email' ? 'Nenhum email ainda'
                : 'Nenhuma conversa ainda'}
            </p>
            {!search && filter === 'all' && (
              <p className="text-xs text-muted-foreground">
                Em <a href="/admin/channels" className="text-primary hover:underline">Admin → Canais</a> clique em ↓ para sincronizar
              </p>
            )}
          </div>
        )}

        {conversations.map((conv) => (
          view === 'email' ? (
            <EmailItem
              key={conv.id}
              conv={conv}
              active={activeId === conv.id}
              onClick={() => handleClick(conv)}
              onFavorite={(e) => { e.stopPropagation(); favMutation.mutate(conv.id) }}
              onArchive={(e) => { e.stopPropagation(); archiveMutation.mutate(conv.id) }}
              canArchive={canArchivePerm}
            />
          ) : (
            <ConversationItem
              key={conv.id}
              conv={conv}
              active={activeId === conv.id}
              onClick={() => handleClick(conv)}
              onFavorite={(e) => { e.stopPropagation(); favMutation.mutate(conv.id) }}
              onArchive={(e) => { e.stopPropagation(); archiveMutation.mutate(conv.id) }}
              canArchive={canArchivePerm}
              presenceTxt={presenceLabel(presenceMap[conv.id] ?? null)}
              onClaim={!conv.assigneeId && (conv.status === 'OPEN' || conv.status === 'WAITING') ? (e) => { e.stopPropagation(); claimMutation.mutate(conv.id) } : undefined}
            />
          )
        ))}
      </div>

      {showNewConv && (
        <NewConversationModal
          onClose={() => setShowNewConv(false)}
          onCreated={(id) => {
            queryClient.invalidateQueries({ queryKey: ['conversations'] })
            router.push(`/inbox/${id}`)
          }}
        />
      )}

      {showComposeEmail && (
        <ComposeNewEmailModal
          onClose={() => setShowComposeEmail(false)}
          onSent={(id) => {
            queryClient.invalidateQueries({ queryKey: ['conversations'] })
            router.push(`/inbox/${id}?view=email`)
          }}
        />
      )}
    </div>
  )
}

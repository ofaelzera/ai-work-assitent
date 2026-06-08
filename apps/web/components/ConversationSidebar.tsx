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
  Video, Paperclip, SquarePen, Archive, ArchiveRestore, Folder, Inbox, ChevronRight, UsersRound,
} from 'lucide-react'
import NewConversationModal from '@/components/NewConversationModal'
import CreateGroupModal from '@/components/CreateGroupModal'
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
  type?: 'EXTERNAL' | 'DIRECT' | 'GROUP'
  name?: string | null
  isGroup: boolean
  favorite: boolean
  archived: boolean
  status: 'OPEN' | 'WAITING' | 'RESOLVED'
  subject: string | null
  unreadCount: number
  unreadForMe?: boolean
  lastMessageAt: string | null
  assigneeId: string | null
  assignee: { id: string; name: string; email: string } | null
  eligibleAssigneeIds: string[] | null
  eligibleAssignees: Array<{ id: string; name: string | null; email: string }> | null
  lastQueuedAt: string | null
  contact: {
    id: string; name: string | null; phone: string | null; email?: string | null
    metadata?: { avatarUrl?: string } | null
    company?: { id: string; name: string; color: string } | null
  } | null
  company?: { id: string; name: string; color: string } | null // vínculo direto (grupos)
  team?: { id: string; name: string; slug: string; color: string; icon: string | null } | null
  channel: { id: string; type: string; label: string }
  participants?: Array<{ userId: string; user: { id: string; name: string; email: string } }>
  messages: Array<{ body: string; sentAt: string; direction: string; attachments?: Attachment[] | null; fromUserId?: string | null }>
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

/**
 * Formata tempo de espera relativo (compacto, estilo "5min", "2h", "3d").
 * Usado pra mostrar há quanto tempo uma conversa está na fila.
 */
function formatWaitTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'agora'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

// ─── Channel badge ────────────────────────────────────────────────────────────
function ChannelBadge({ type }: { type: string }) {
  if (type === 'WHATSAPP') return (
    <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold shadow-sm" style={{ background: '#25D366' }}>W</span>
  )
  if (type === 'GMAIL') return (
    <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold shadow-sm" style={{ background: '#EA4335' }}>G</span>
  )
  if (type === 'INTERNAL') return (
    <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold shadow-sm bg-emerald-500" title="Chat interno">I</span>
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
function ConversationItem({ conv, active, currentUserId, onClick, onFavorite, onArchive, presenceTxt, onClaim, canArchive }: {
  conv: Conversation; active: boolean
  currentUserId: string
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

  // Chat interno: nome do grupo ou nome do outro participante (DM)
  const isInternal = conv.channel.type === 'INTERNAL'
  const internalName = isInternal
    ? conv.type === 'GROUP'
      ? (conv.name ?? 'Grupo')
      : (conv.participants?.find((p) => !!p.user)?.user.name ?? 'Conversa')
    : null

  // Para grupos: prioriza subject (nome real do grupo), depois JID limpo, nunca nome do remetente
  // Para DMs: prioriza nome do contato, depois telefone, depois subject (email), depois externalId
  const displayName = internalName
    ?? (conv.isGroup
      ? (conv.subject ?? `Grupo ${conv.externalId.replace('@g.us', '').slice(-6)}`)
      : (conv.contact?.name && conv.contact.name !== phone
          ? conv.contact.name
          : phoneDisplay
            ?? conv.subject
            ?? conv.externalId.replace('@s.whatsapp.net', '').replace('@g.us', '')))

  const lastMsg = conv.messages[0]
  // Não-lida do ponto de vista deste usuário (fallback ao global se backend antigo)
  const hasUnread = conv.unreadForMe ?? conv.unreadCount > 0
  // Para grupos, a empresa pode estar diretamente na conversa (não no contato)
  const company = conv.company ?? conv.contact?.company

  // Conv na fila restrita a alguém específico (não eu) → mostra "Aguardando @X"
  const isOnQueue = !conv.assigneeId && (conv.status === 'OPEN' || conv.status === 'WAITING')
  const eligible = conv.eligibleAssignees ?? []
  const restrictedToOthers = isOnQueue
    && eligible.length > 0
    && !eligible.some(u => u.id === currentUserId)

  // Tempo aguardando na fila
  const waitingFor = isOnQueue && conv.lastQueuedAt ? formatWaitTime(conv.lastQueuedAt) : null

  return (
    <div
      role="button" tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      className={cn(
        'group w-full text-left px-3 py-2.5 flex items-start gap-3 transition-colors relative cursor-pointer select-none',
        active ? 'bg-primary/8' : 'hover:bg-accent/60',
        conv.archived && 'opacity-60',
      )}
    >
      {active && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary rounded-r" />}

      <Avatar 
        name={displayName} 
        isGroup={conv.isGroup} 
        avatarUrl={conv.isGroup ? ((conv.contact?.metadata as any)?.avatarUrl ?? (conv as any).metadata?.avatarUrl) : (conv.contact?.metadata as any)?.avatarUrl} 
        channelType={conv.channel.type} 
      />

      <div className="flex-1 min-w-0">
        {/* Linha 1: ícone de grupo + nome (linha própria, sem disputar com badges) + horário */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 min-w-0">
            {conv.isGroup && (
              <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Grupo" />
            )}
            <p className={cn('text-sm truncate', hasUnread ? 'font-semibold' : 'font-medium')}>
              {displayName}
            </p>
          </div>
          <span className={cn('text-[11px] shrink-0', hasUnread ? 'text-primary font-medium' : 'text-muted-foreground')}>
            {formatConvTime(conv.lastMessageAt)}
          </span>
        </div>

        {/* Linha 2: prévia da última mensagem + ações/contador */}
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <div className="min-w-0 flex-1">
            {presenceTxt
              ? <p className="text-xs text-emerald-500 font-medium truncate">{presenceTxt}</p>
              : lastMsg
                ? <MessagePreview msg={lastMsg} direction={lastMsg.direction} />
                : <p className="text-xs text-muted-foreground truncate">Sem mensagens</p>}
          </div>
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

        {/* Linha 3: metadados — empresa, setor, atendente, fila, canal (trunca sozinha) */}
        {(company || conv.team || conv.assignee || isOnQueue || conv.channel.label) && (
          <div className="flex items-center gap-1 mt-1 overflow-hidden">
            {company && (
              <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full text-white leading-none max-w-[96px] truncate"
                style={{ background: company.color }} title={company.name}>
                {company.name}
              </span>
            )}
            {conv.team && (
              <span
                className="shrink-0 inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full leading-none"
                style={{ background: `${conv.team.color}20`, color: conv.team.color }}
                title={`Setor: ${conv.team.name}`}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: conv.team.color }} />
                {conv.team.name}
              </span>
            )}
            {conv.assignee && (
              <span
                className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 leading-none"
                title={`Em atendimento por ${conv.assignee.name ?? conv.assignee.email}`}>
                @{(conv.assignee.name ?? conv.assignee.email).split(' ')[0].slice(0, 12)}
              </span>
            )}
            {isOnQueue && (
              restrictedToOthers && eligible.length > 0 ? (
                <span
                  className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 leading-none"
                  title={`Fila restrita a ${eligible.map(u => u.name ?? u.email).join(', ')}`}>
                  Aguardando @{(eligible[0].name ?? eligible[0].email).split(' ')[0].slice(0, 10)}{eligible.length > 1 && ` +${eligible.length - 1}`}
                </span>
              ) : (
                <span className="shrink-0 text-[9px] font-semibold text-amber-600 bg-amber-100 dark:bg-amber-950 dark:text-amber-400 rounded-full px-1.5 py-0.5 leading-none"
                  title={waitingFor ? `Na fila há ${waitingFor}` : 'Na fila'}>
                  Na fila{waitingFor && ` · ⏱${waitingFor}`}
                </span>
              )
            )}
            <span className="shrink-0 text-[9px] font-medium text-muted-foreground/70 max-w-[80px] truncate ml-auto" title={conv.channel.label}>
              {conv.channel.label}
            </span>
          </div>
        )}
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
  const hasUnread = conv.unreadForMe ?? conv.unreadCount > 0

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
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [showComposeEmail, setShowComposeEmail] = useState(false)
  // Modo email: pasta IMAP selecionada (null = todas)
  const [activeFolder, setActiveFolder] = useState<{ channelId: string; folder: string } | null>(null)
  // Filtro por canal (null = todos os canais da view atual)
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  // Filtro por setor/team (null = todos)
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)

  // Times dos quais o usuário é membro (pra mostrar como filtros)
  const { data: myTeams = [] } = useQuery<{ id: string; name: string; color: string; slug: string }[]>({
    queryKey: ['teams', 'mine'],
    queryFn: () => apiFetch('/teams/mine'),
    staleTime: 60_000,
  })

  // Quando troca de view (Conversas <-> Email), reseta os filtros locais.
  // Default: "Minhas" — atendente vê o próprio trabalho. Auto-fallback pra Fila
  // mais abaixo se "Minhas" vier vazio.
  useEffect(() => {
    setSearch('')
    setFilter('mine')
    setActiveFolder(null)
    setSelectedChannelId(null)
    setAutoSwitched(false)  // permite re-rodar o fallback ao trocar de view
  }, [view])
  // Map de conversationId → presença atual (expira via timeout)
  const [presenceMap, setPresenceMap] = useState<Record<string, PresenceState>>({})
  const presenceTimers = useState<Record<string, ReturnType<typeof setTimeout>>>(() => ({}))[0]

  // Detecta conversa ativa pela URL (/inbox/[id])
  const activeId = pathname.match(/^\/inbox\/([^/]+)$/)?.[1] ?? null

  // Canais disponíveis (filtro de canal e árvore de pastas IMAP no modo email)
  const { data: channels = [] } = useQuery({
    queryKey: ['channels'],
    queryFn: () => apiFetch<Channel[]>('/channels'),
    staleTime: 60_000,
  })
  const emailChannels = channels.filter(c => c.type === 'GMAIL' || c.type === 'IMAP_SMTP')
  // Canais visíveis no filtro: WhatsApp na view de conversas, Email na view de email
  const filterableChannels = view === 'email'
    ? emailChannels
    : channels.filter(c => c.type === 'WHATSAPP')

  useEffect(() => {
    const handleClaim = (e: Event) => {
      const ce = e as CustomEvent
      if (ce.detail === 'mine') setFilter('mine')
    }
    window.addEventListener('chat:claim', handleClaim)
    return () => window.removeEventListener('chat:claim', handleClaim)
  }, [])

  const claimMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/conversations/${id}/claim`, { method: 'POST' }),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      setFilter('mine')
      const url = view === 'email' ? `/inbox/${id}?view=email` : `/inbox/${id}`
      router.push(url)
    },
  })

  const { data, isLoading } = useQuery({
    queryKey: ['conversations', view, filter, search, activeFolder, selectedChannelId, selectedTeamId],
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
      // Filtro por canal (sobrescreve activeFolder.channelId se ambos estiverem setados)
      if (selectedChannelId) params.set('channelId', selectedChannelId)
      if (selectedTeamId) params.set('teamId', selectedTeamId)
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
    if (event.type === 'message.received') {
      const payload = event.payload as any
      queryClient.setQueriesData<{ conversations: Conversation[], queueCount: number }>({ queryKey: ['conversations'] }, (old) => {
        if (!old?.conversations) return old
        const convIndex = old.conversations.findIndex((c) => c.id === payload.conversationId)
        if (convIndex > -1) {
          const conv = old.conversations[convIndex]
          const updatedConv = {
            ...conv,
            unreadCount: payload.direction === 'INBOUND' ? conv.unreadCount + 1 : conv.unreadCount,
            unreadForMe: payload.direction === 'INBOUND' ? true : conv.unreadForMe,
            lastMessageAt: new Date().toISOString(),
            messages: [
              {
                id: payload.messageId,
                body: payload.body,
                direction: payload.direction,
                sentAt: new Date().toISOString(),
                attachments: [],
              },
              ...conv.messages,
            ],
          }
          const newConversations = [...old.conversations]
          newConversations.splice(convIndex, 1)
          newConversations.unshift(updatedConv)
          return { ...old, conversations: newConversations }
        }
        return old
      })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    } else if (
      event.type === 'conversation.read' ||
      event.type === 'conversation.status_changed' ||
      event.type === 'conversation.claimed' ||
      event.type === 'conversation.released' ||
      event.type === 'conversation.assigned'
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
    // Marca como lida otimisticamente (só pra mim) em TODAS as queries cacheadas.
    // Não zera unreadCount global — só o flag por usuário, pra fila seguir pros outros.
    if (conv.unreadForMe ?? conv.unreadCount > 0) {
      queryClient.setQueriesData<{ conversations?: Conversation[] }>(
        { queryKey: ['conversations'] },
        (old) => old
          ? { ...old, conversations: old.conversations?.map(c => c.id === conv.id ? { ...c, unreadForMe: false } : c) }
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

  const uniqueChannelsInList = useMemo(() => {
    if (!conversations) return new Set<string>()
    return new Set(conversations.map(c => c.channel.id))
  }, [conversations])

  const showChannelFilter = filterableChannels.length >= 2 && (uniqueChannelsInList.size > 1 || selectedChannelId !== null)

  return (
    <div className="w-[300px] flex-shrink-0 border-r flex flex-col bg-card">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-base font-semibold">{headerTitle}</h2>
          {view === 'conversations' && (
            <div className="flex items-center gap-0.5">
              <button onClick={() => setShowCreateGroup(true)}
                className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                title="Criar grupo no WhatsApp">
                <UsersRound className="h-4 w-4" />
              </button>
              <button onClick={() => setShowNewConv(true)}
                className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                title="Nova conversa">
                <SquarePen className="h-4 w-4" />
              </button>
            </div>
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
        {/* Tabs — scroll horizontal elegante */}
        <div className="flex overflow-x-auto no-scrollbar gap-1.5 pt-2 pb-2 px-1 -mx-1 mask-edges">
          {visibleTabs.map((tab) => {
            const isQueueTab = tab.value === 'queue'
            const showBadge = isQueueTab && queueCount > 0
            const isActive = filter === tab.value
            return (
              <button
                key={tab.value}
                onClick={() => setFilter(tab.value)}
                title={TAB_TITLES[tab.value]}
                className={cn(
                  'shrink-0 text-[11px] py-1.5 px-3 rounded-full font-medium transition-all duration-200 flex items-center gap-1.5 border',
                  isActive
                    ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                    : 'bg-accent/30 text-muted-foreground border-transparent hover:bg-accent hover:text-foreground',
                )}>
                {tab.label}
                {showBadge && (
                  <span className={cn(
                    'inline-flex items-center justify-center text-[10px] font-bold rounded-full min-w-[16px] h-[16px] px-1 leading-none',
                    isActive
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

      {/* Filtro por setor — só aparece se o usuário pertence a 2+ setores */}
      {view === 'conversations' && myTeams.length >= 2 && (
        <div className="flex overflow-x-auto no-scrollbar gap-1.5 px-3 py-1.5 border-b bg-muted/10 mask-edges">
          <button
            onClick={() => setSelectedTeamId(null)}
            title="Todos os setores"
            className={cn(
              'shrink-0 text-[11px] py-1 px-2.5 rounded-full font-medium transition-all duration-200 border',
              selectedTeamId === null
                ? 'bg-primary/15 text-primary border-primary/40'
                : 'bg-transparent text-muted-foreground border-transparent hover:bg-accent hover:text-foreground',
            )}>
            Todos setores
          </button>
          {myTeams.map((t) => {
            const isActive = selectedTeamId === t.id
            return (
              <button key={t.id}
                onClick={() => setSelectedTeamId(isActive ? null : t.id)}
                title={t.name}
                className={cn(
                  'shrink-0 text-[11px] py-1 px-2.5 rounded-full font-medium transition-all duration-200 border flex items-center gap-1.5',
                  isActive
                    ? 'bg-primary/15 text-primary border-primary/40'
                    : 'bg-transparent text-muted-foreground border-transparent hover:bg-accent hover:text-foreground',
                )}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.color }} />
                {t.name}
              </button>
            )
          })}
        </div>
      )}

      {/* Filtro por canal — só aparece se houver 2+ canais na view atual */}
      {showChannelFilter && (
        <div className="flex overflow-x-auto no-scrollbar gap-1.5 px-3 py-1.5 border-b bg-muted/10 mask-edges">
          <button
            onClick={() => setSelectedChannelId(null)}
            title="Todos os canais"
            className={cn(
              'shrink-0 text-[11px] py-1 px-2.5 rounded-full font-medium transition-all duration-200 border',
              selectedChannelId === null
                ? 'bg-primary/15 text-primary border-primary/40'
                : 'bg-transparent text-muted-foreground border-transparent hover:bg-accent hover:text-foreground',
            )}>
            Todos os canais
          </button>
          {filterableChannels.map(ch => {
            const isActive = selectedChannelId === ch.id
            return (
              <button
                key={ch.id}
                onClick={() => setSelectedChannelId(isActive ? null : ch.id)}
                title={ch.label}
                className={cn(
                  'shrink-0 text-[11px] py-1 px-2.5 rounded-full font-medium transition-all duration-200 border max-w-[140px] truncate',
                  isActive
                    ? 'bg-primary/15 text-primary border-primary/40'
                    : 'bg-transparent text-muted-foreground border-transparent hover:bg-accent hover:text-foreground',
                )}>
                {ch.label}
              </button>
            )
          })}
        </div>
      )}

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
              currentUserId={currentUser?.sub ?? ''}
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

      {showCreateGroup && (
        <CreateGroupModal
          onClose={() => setShowCreateGroup(false)}
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

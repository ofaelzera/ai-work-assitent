'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import {
  fetchMessages,
  fetchRoom,
  markRead,
  sendMessage,
  sendMedia,
  emitTyping,
  roomDisplayName,
  type ChatMessage,
} from '@/lib/chat'
import { apiFetch, getAccessToken } from '@/lib/api'
import { useAuthStore } from '@/store/auth'
import { useSSE } from '@/lib/sse'
import { renderWhatsappText } from '@/lib/whatsappText'
import { cn } from '@/lib/utils'
import {
  Send, Paperclip, X,
  Image as ImageIcon, FileText, Mic, Video, Download, FolderOpen,
} from 'lucide-react'
import { UserAvatar } from './UserAvatar'
import { usePresenceMap } from './usePresenceMap'
import LibraryPickerModal from '@/components/LibraryPickerModal'
import { ChatInput } from '@/components/ChatInput'
import { getApiUrl } from '@/lib/runtime-config'
import { saveBlob } from '@/lib/saveFile'
import { isDesktop } from '@/lib/desktop'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

interface InternalAttachment {
  type: 'image' | 'video' | 'audio' | 'document'
  mimetype: string
  filename: string
  storageKey?: string
  sizeBytes?: number
}

function useChatMediaBlob(msgId: string, enabled: boolean) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let objectUrl: string
    let aborted = false
    fetch(`${getApiUrl()}/chat/messages/${msgId}/media`, {
      headers: { Authorization: `Bearer ${getAccessToken()}` },
    })
      .then(async (r) => {
        if (!r.ok) { setError(true); return }
        const blob = await r.blob()
        if (aborted) return
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })
      .catch(() => setError(true))
    return () => {
      aborted = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [msgId, enabled])
  return { src, error }
}

function formatMsgTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function formatDateDivider(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Hoje'
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

export function ChatView({ roomId }: { roomId: string }) {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const [input, setInput] = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map())
  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const lastTypingEmitRef = useRef<number>(0)
  const typingStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onlineSet = usePresenceMap()

  const { data: room } = useQuery({
    queryKey: ['chat', 'room', roomId],
    queryFn: () => fetchRoom(roomId),
  })

  const { data: quickReplies = [] } = useQuery<{ id: string; shortcut: string; title: string | null; body: string }[]>({
    queryKey: ['quick-replies'],
    queryFn: () => apiFetch('/quick-replies'),
    staleTime: 60_000,
  })

  const { data, refetch } = useQuery({
    queryKey: ['chat', 'messages', roomId],
    queryFn: () => fetchMessages(roomId),
  })

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [data?.messages?.length])

  useEffect(() => {
    if (!data?.messages?.length) return
    const last = data.messages[data.messages.length - 1]
    if (last.fromUserId !== user?.sub) {
      markRead(roomId, last.id).then(() => {
        qc.invalidateQueries({ queryKey: ['chat', 'rooms'] })
        qc.invalidateQueries({ queryKey: ['chat', 'unread-total'] })
      })
    }
  }, [roomId, data?.messages?.length])

  useSSE((ev) => {
    if (ev.type === 'chat.message.new') {
      const payload = ev.payload as { conversationId: string }
      if (payload.conversationId === roomId) refetch()
    }
    if (ev.type === 'chat.typing') {
      const p = ev.payload as { conversationId: string; userId: string; userName: string; action: 'start' | 'stop' }
      if (p.conversationId !== roomId || p.userId === user?.sub) return
      const ex = typingTimeoutsRef.current.get(p.userId)
      if (ex) clearTimeout(ex)
      if (p.action === 'stop') {
        setTypingUsers((m) => {
          const next = new Map(m); next.delete(p.userId); return next
        })
        typingTimeoutsRef.current.delete(p.userId)
      } else {
        setTypingUsers((m) => {
          const next = new Map(m); next.set(p.userId, p.userName); return next
        })
        const t = setTimeout(() => {
          setTypingUsers((m) => {
            const next = new Map(m); next.delete(p.userId); return next
          })
          typingTimeoutsRef.current.delete(p.userId)
        }, 4000)
        typingTimeoutsRef.current.set(p.userId, t)
      }
    }
  })

  const send = useMutation({
    mutationFn: () => sendMessage(roomId, input.trim()),
    onSuccess: () => {
      setInput('')
      refetch()
      qc.invalidateQueries({ queryKey: ['chat', 'rooms'] })
    },
  })

  const sendMediaMutation = useMutation({
    mutationFn: ({ file, caption }: { file: File; caption: string }) =>
      sendMedia(roomId, file, caption),
    onSuccess: () => {
      setPendingFile(null)
      setInput('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      refetch()
      qc.invalidateQueries({ queryKey: ['chat', 'rooms'] })
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (send.isPending || sendMediaMutation.isPending) return
    if (pendingFile) {
      sendMediaMutation.mutate({ file: pendingFile, caption: input.trim() })
      return
    }
    if (!input.trim()) return
    void emitTyping(roomId, 'stop').catch(() => {})
    if (typingStopTimeoutRef.current) clearTimeout(typingStopTimeoutRef.current)
    lastTypingEmitRef.current = 0
    send.mutate()
  }

  const messages = data?.messages ?? []
  const title = room ? roomDisplayName(room as any, user?.sub ?? '') : '...'
  const typingNames = Array.from(typingUsers.values())

  const other = room?.type === 'DIRECT'
    ? room.participants.find((p: any) => p.userId !== user?.sub)
    : null
  const headerAvatarUrl = other?.user?.settings?.avatarUrl ?? null
  const headerOnline = other ? onlineSet.has(other.userId) : undefined

  const subtitle = (() => {
    if (room?.type === 'GROUP') return `${room.participants.length} participantes`
    if (other) return headerOnline ? 'online' : 'offline'
    return 'Chat interno'
  })()

  // Agrupar por dia para divisor
  const groupedMessages: Array<{ divider: string } | ChatMessage> = []
  let lastDate = ''
  messages.forEach((m) => {
    const dateLabel = formatDateDivider(m.sentAt)
    if (dateLabel !== lastDate) {
      groupedMessages.push({ divider: dateLabel })
      lastDate = dateLabel
    }
    groupedMessages.push(m)
  })

  return (
    <div className="flex-1 flex flex-col bg-accent/10">
      {/* Header */}
      <div className="border-b border-border bg-card px-4 py-3 flex items-center gap-3">
        <UserAvatar
          name={title}
          avatarUrl={headerAvatarUrl}
          isGroup={room?.type === 'GROUP'}
          online={headerOnline}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{title}</p>
          <p className="text-xs text-muted-foreground truncate">
            {typingNames.length > 0
              ? `${typingNames.join(', ')} digitando...`
              : subtitle}
          </p>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-medium">
          Interno
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {messages.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-12">
            Envie a primeira mensagem!
          </div>
        )}
        {groupedMessages.map((item, idx) => {
          if ('divider' in item) {
            return (
              <div key={`div-${idx}`} className="flex justify-center py-2">
                <span className="text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full bg-card/80 text-muted-foreground">
                  {item.divider}
                </span>
              </div>
            )
          }
          const m = item
          const isMine = m.fromUserId === user?.sub
          // Mostra autor em grupos quando muda quem fala
          const prev = idx > 0 ? groupedMessages[idx - 1] : null
          const prevAuthor = prev && !('divider' in prev) ? prev.fromUserId : null
          const showAuthor =
            !isMine && room?.type === 'GROUP' && prevAuthor !== m.fromUserId
          return (
            <Bubble
              key={m.id}
              msg={m}
              isMine={isMine}
              showAuthor={showAuthor}
            />
          )
        })}
      </div>

      {/* Composer no mesmo padrão do Inbox (ChatInput compartilhado) */}
      <div className="border-t border-border bg-card p-3 space-y-2">
        {/* Preview do anexo antes de enviar */}
        {pendingFile && (
          <div className="flex items-center gap-3 p-2 rounded-md border border-border bg-accent/40">
            {pendingFile.type.startsWith('image/') ? (
              <img
                src={URL.createObjectURL(pendingFile)}
                alt="preview"
                className="h-14 w-14 rounded object-cover shrink-0"
              />
            ) : (
              <div className="h-14 w-14 rounded bg-card flex items-center justify-center shrink-0">
                {pendingFile.type.startsWith('video/') ? <Video className="h-6 w-6" />
                  : pendingFile.type.startsWith('audio/') ? <Mic className="h-6 w-6" />
                  : <FileText className="h-6 w-6" />}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">{pendingFile.name}</p>
              <p className="text-[10px] text-muted-foreground">
                {formatBytes(pendingFile.size)} · {pendingFile.type || 'arquivo'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setPendingFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
              title="Remover anexo"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) setPendingFile(f)
          }}
        />

        <ChatInput
          value={input}
          onChange={(v) => {
            setInput(v)
            // typing emit (mantém debounce de antes)
            const now = Date.now()
            if (now - lastTypingEmitRef.current > 1500) {
              lastTypingEmitRef.current = now
              void emitTyping(roomId, 'start').catch(() => {})
            }
            if (typingStopTimeoutRef.current) clearTimeout(typingStopTimeoutRef.current)
            typingStopTimeoutRef.current = setTimeout(() => {
              void emitTyping(roomId, 'stop').catch(() => {})
              lastTypingEmitRef.current = 0
            }, 1800)
          }}
          onSend={() => handleSubmit({ preventDefault: () => {} } as any)}
          disabled={send.isPending || sendMediaMutation.isPending}
          placeholder={pendingFile ? 'Legenda (opcional)...' : 'Digite uma mensagem...'}
          inputRef={composerRef}
          quickReplies={quickReplies}
          leftToolbarActions={
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                title="Anexar do computador"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setLibraryOpen(true)}
                className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                title="Enviar dos meus arquivos"
              >
                <FolderOpen className="h-4 w-4" />
              </button>
            </>
          }
          bottomRightActions={
            <button
              type="button"
              onClick={() => handleSubmit({ preventDefault: () => {} } as any)}
              disabled={
                (!input.trim() && !pendingFile) ||
                send.isPending ||
                sendMediaMutation.isPending
              }
              className="h-9 w-9 rounded-full bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90 flex items-center justify-center transition"
              title="Enviar"
            >
              <Send className="h-4 w-4" />
            </button>
          }
        />
      </div>

      {libraryOpen && (
        <LibraryPickerModal
          conversationId={roomId}
          variant="chat"
          onClose={() => setLibraryOpen(false)}
          onSent={() => {
            refetch()
            qc.invalidateQueries({ queryKey: ['chat', 'rooms'] })
          }}
        />
      )}
    </div>
  )
}

function Bubble({
  msg,
  isMine,
  showAuthor,
}: {
  msg: ChatMessage
  isMine: boolean
  showAuthor: boolean
}) {
  const avatarUrl = msg.fromUser?.settings?.avatarUrl ?? null
  const authorName = msg.fromUser?.name ?? ''
  const attachments = (msg.attachments as InternalAttachment[] | null) ?? []
  const hasAttachment = attachments.length > 0
  const showBody = msg.body && msg.body !== `[${attachments[0]?.type}]`
  return (
    <div className={cn('flex gap-2', isMine ? 'justify-end' : 'justify-start')}>
      {!isMine && (
        <div className="self-end mb-4">
          {showAuthor ? (
            <UserAvatar name={authorName || '?'} avatarUrl={avatarUrl} size="sm" />
          ) : (
            <div className="h-8 w-8" />
          )}
        </div>
      )}
      <div className={cn('max-w-[68%] space-y-0.5')}>
        {showAuthor && !isMine && authorName && (
          <p className="text-[11px] font-semibold text-primary px-1">{authorName}</p>
        )}
        <div
          className={cn(
            'rounded-2xl text-sm whitespace-pre-wrap break-words shadow-sm overflow-hidden',
            isMine
              ? 'bg-primary text-primary-foreground rounded-br-sm'
              : 'bg-card text-foreground rounded-bl-sm',
          )}
        >
          {hasAttachment && (
            <AttachmentInline
              msgId={msg.id}
              att={attachments[0]}
              isMine={isMine}
            />
          )}
          {showBody && (
            <div className={cn('px-3 py-2', hasAttachment && 'pt-1.5')}>
              {renderWhatsappText(msg.body)}
            </div>
          )}
        </div>
        <p
          className={cn(
            'text-[10px] text-muted-foreground px-1 flex items-center gap-1',
            isMine ? 'justify-end' : 'justify-start',
          )}
        >
          {formatMsgTime(msg.sentAt)}
          {isMine && (
            <span className={cn(msg.reads && msg.reads.length > 0 ? 'text-blue-500' : 'text-muted-foreground')}>
              ✓✓
            </span>
          )}
        </p>
      </div>
    </div>
  )
}

function AttachmentInline({
  msgId,
  att,
  isMine,
}: {
  msgId: string
  att: InternalAttachment
  isMine: boolean
}) {
  // Carrega imagens/vídeos inline. Documentos viram um cartão clicável que abre num modal/aba.
  const isInline = att.type === 'image' || att.type === 'video' || att.type === 'audio'
  const { src, error } = useChatMediaBlob(msgId, isInline)

  function openDoc() {
    const token = getAccessToken()
    fetch(`${getApiUrl()}/chat/messages/${msgId}/media`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.blob())
      .then((blob) => {
        // No desktop o webview não abre blob em nova janela — salva em Downloads.
        if (isDesktop()) {
          void saveBlob(blob, att.filename ?? 'arquivo')
          return
        }
        const url = URL.createObjectURL(blob)
        window.open(url, '_blank', 'noopener')
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      })
  }

  if (att.type === 'image') {
    return (
      <div className="bg-black/5 dark:bg-black/30">
        {error ? (
          <div className="h-32 w-64 flex items-center justify-center text-xs opacity-70">
            Erro ao carregar
          </div>
        ) : !src ? (
          <div className="h-32 w-64 animate-pulse bg-muted/40" />
        ) : (
          <a href={src} target="_blank" rel="noopener noreferrer">
            <img src={src} alt={att.filename} className="max-h-80 w-auto object-contain" />
          </a>
        )}
      </div>
    )
  }

  if (att.type === 'video') {
    return (
      <div className="bg-black">
        {!src ? (
          <div className="h-40 w-64 animate-pulse bg-muted/40" />
        ) : (
          <video src={src} controls className="max-h-80 w-full" />
        )}
      </div>
    )
  }

  if (att.type === 'audio') {
    return (
      <div className="px-3 py-2">
        {!src ? (
          <div className="h-10 w-56 animate-pulse bg-muted/40 rounded" />
        ) : (
          <audio src={src} controls className="w-56" />
        )}
      </div>
    )
  }

  // Documento — cartão clicável
  return (
    <button
      type="button"
      onClick={openDoc}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 w-full text-left transition',
        isMine ? 'hover:bg-primary-foreground/10' : 'hover:bg-accent',
      )}
      title="Abrir arquivo"
    >
      <div
        className={cn(
          'h-10 w-10 rounded-md flex items-center justify-center shrink-0',
          isMine ? 'bg-primary-foreground/15' : 'bg-muted',
        )}
      >
        <FileText className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">{att.filename}</p>
        <p className={cn('text-[10px]', isMine ? 'opacity-80' : 'text-muted-foreground')}>
          {att.sizeBytes ? formatBytes(att.sizeBytes) : att.mimetype}
        </p>
      </div>
      <Download className={cn('h-4 w-4 shrink-0', isMine ? 'opacity-80' : 'text-muted-foreground')} />
    </button>
  )
}

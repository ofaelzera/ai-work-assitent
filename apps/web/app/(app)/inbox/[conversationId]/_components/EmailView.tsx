'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { useSSE } from '@/lib/sse'
import { useRouter } from 'next/navigation'
import {
  Reply, ReplyAll, Forward, ChevronDown, ChevronUp,
  Paperclip, Send, X, Kanban, FileText, Download,
  UploadCloud, Trash2, FolderInput, Inbox, Folder, FolderPlus, ChevronRight, Plus,
} from 'lucide-react'
import { buildFolderTree, prettyFolderLabel, type FolderNode } from '@/lib/imap-folders'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/date'
import { toast } from 'sonner'
import CreateCardModal from '@/components/CreateCardModal'
import RichEditor from '@/components/RichEditor'
import type { ConversationInfo, Message, Contact } from './WhatsappView'
import { AssigneeChip } from './WhatsappView'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatEmailDate(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: 'short',
    ...(!sameYear && { year: 'numeric' }),
    hour: '2-digit', minute: '2-digit',
  })
}

function initials(s: string) {
  if (!s.trim()) return '?'
  const p = s.trim().split(/\s+/)
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase()
}

const AVATAR_COLORS = [
  '#7c3aed','#0284c7','#16a34a','#d97706','#dc2626',
  '#db2777','#0891b2','#65a30d','#ea580c',
]
function avatarColor(s: string) {
  let h = 0; for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

// ─── HTML Body (iframe sandboxado) ────────────────────────────────────────────
function HtmlBody({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(200)

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    const doc = iframe.contentDocument || iframe.contentWindow?.document
    if (!doc) return

    doc.open()
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
      <style>
        * { box-sizing: border-box; }
        body { margin:0; padding:8px 12px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
          font-size:14px; line-height:1.6; color:#1a1a1a; background:transparent;
          overflow-x:hidden; word-wrap:break-word; }
        img { max-width:100%; height:auto; }
        a { color:#6366f1; }
        pre,code { font-size:12px; overflow-x:auto; }
        blockquote { margin:8px 0; padding:4px 12px; border-left:3px solid #e2e8f0; color:#64748b; }
        table { border-collapse:collapse; max-width:100%; }
        td,th { padding:4px 8px; border:1px solid #e2e8f0; }
      </style></head><body>${html}</body></html>`)
    doc.close()

    const resize = () => {
      const body = doc.body
      if (body) setHeight(body.scrollHeight + 16)
    }
    resize()
    const t = setTimeout(resize, 300)
    return () => clearTimeout(t)
  }, [html])

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-same-origin"
      className="w-full border-0"
      style={{ height, minHeight: 80 }}
      title="Corpo do email"
    />
  )
}

// ─── Texto simples com suporte a citações ─────────────────────────────────────
function TextBody({ text }: { text: string }) {
  const [showQuoted, setShowQuoted] = useState(false)

  // Separa conteúdo principal de linhas citadas (começa com >)
  const lines = text.split('\n')
  const mainLines: string[] = []
  const quotedLines: string[] = []
  let inQuote = false

  for (const line of lines) {
    if (line.trimStart().startsWith('>')) {
      inQuote = true
      quotedLines.push(line)
    } else if (inQuote && line.trim() === '') {
      quotedLines.push(line)
    } else {
      mainLines.push(line)
    }
  }

  const hasQuoted = quotedLines.length > 0

  return (
    <div className="text-sm text-foreground/90 leading-relaxed">
      <div className="whitespace-pre-wrap break-words">
        {mainLines.join('\n')}
      </div>
      {hasQuoted && (
        <div className="mt-3">
          <button
            onClick={() => setShowQuoted(v => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <span className="inline-flex gap-0.5">
              <span className="w-1 h-1 rounded-full bg-current" />
              <span className="w-1 h-1 rounded-full bg-current" />
              <span className="w-1 h-1 rounded-full bg-current" />
            </span>
            {showQuoted ? 'Ocultar histórico' : 'Mostrar histórico'}
          </button>
          {showQuoted && (
            <div className="pl-3 border-l-2 border-muted-foreground/30 text-muted-foreground text-xs whitespace-pre-wrap">
              {quotedLines.map(l => l.replace(/^>\s?/, '')).join('\n')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Modal: mover conversa pra outra pasta IMAP ───────────────────────────────
function FolderTreeRow({ node, picked, currentFolder, onPick, depth }: {
  node: FolderNode
  picked: string | null
  currentFolder?: string | null
  onPick: (path: string) => void
  depth: number
}) {
  const [expanded, setExpanded] = useState(true)
  const isPicked = picked === node.path
  const isCurrent = currentFolder === node.path
  const hasChildren = node.children.length > 0
  const Icon = /^(INBOX|Caixa)/i.test(node.label) ? Inbox : Folder

  return (
    <div>
      <button
        onClick={() => !isCurrent && onPick(node.path)}
        disabled={isCurrent}
        style={{ paddingLeft: 8 + depth * 16 }}
        className={cn(
          'w-full flex items-center gap-1.5 pr-2 py-1.5 text-sm rounded-md transition-colors text-left',
          isCurrent && 'opacity-40 cursor-not-allowed',
          isPicked && 'bg-primary/10 text-primary font-medium',
          !isPicked && !isCurrent && 'hover:bg-accent',
        )}>
        {hasChildren ? (
          <span
            onClick={(e) => { e.stopPropagation(); setExpanded(v => !v) }}
            className="p-0.5 rounded hover:bg-foreground/10 shrink-0 cursor-pointer">
            <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
          </span>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate flex-1">{prettyFolderLabel(node.label)}</span>
        {isCurrent && <span className="text-[10px] text-muted-foreground">atual</span>}
      </button>
      {hasChildren && expanded && (
        <div>
          {node.children.map(child => (
            <FolderTreeRow
              key={child.path}
              node={child}
              picked={picked}
              currentFolder={currentFolder}
              onPick={onPick}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function MoveToFolderModal({ conversationId, channelId, channelSettings, currentFolder, onClose, onMoved }: {
  conversationId: string
  channelId: string
  channelSettings: { imapFolders?: string[] } | null
  currentFolder?: string | null
  onClose: () => void
  onMoved: () => void
}) {
  const queryClient = useQueryClient()
  const folders = channelSettings?.imapFolders ?? []
  const tree = buildFolderTree(folders)

  const [picked, setPicked] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  async function handleCreate() {
    const name = newFolderName.trim()
    if (!name) return
    setCreating(true)
    try {
      const result = await apiFetch<{ folders: string[] }>(`/channels/${channelId}/folders`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      })
      // Atualiza o cache de canais (que alimenta a árvore do sidebar) em background
      queryClient.invalidateQueries({ queryKey: ['channels'] })
      // Auto-seleciona a nova pasta — descobre o path canônico que o servidor devolveu
      const created = result.folders.find(f => f === name || f.endsWith(`.${name}`) || f.endsWith(`/${name}`))
      if (created) setPicked(created)
      setNewFolderName('')
      setShowNewFolder(false)
      toast.success(`Pasta "${name}" criada`)
    } catch (err: any) {
      toast.error(err?.message ?? 'Erro ao criar pasta')
    } finally {
      setCreating(false)
    }
  }

  async function handleMove() {
    if (!picked) return
    setMoving(true)
    try {
      await apiFetch(`/conversations/${conversationId}/move-to-folder`, {
        method: 'POST',
        body: JSON.stringify({ toFolder: picked }),
      })
      toast.success(`Movido para "${prettyFolderLabel(picked.split(/[./]/).pop() ?? picked)}"`)
      onMoved()
      onClose()
    } catch (err: any) {
      toast.error(err?.message ?? 'Erro ao mover')
    } finally {
      setMoving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="modal-surface rounded-xl shadow-2xl w-full max-w-sm flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <FolderInput className="h-4 w-4" /> Mover para pasta
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto p-2 min-h-[200px]">
          {tree.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Sincronize o canal para listar pastas
            </p>
          ) : (
            <div className="space-y-px">
              {tree.map(node => (
                <FolderTreeRow
                  key={node.path}
                  node={node}
                  picked={picked}
                  currentFolder={currentFolder}
                  onPick={setPicked}
                  depth={0}
                />
              ))}
            </div>
          )}
        </div>

        {/* Inline new folder form / button */}
        {showNewFolder ? (
          <div className="px-3 pt-2 pb-3 border-t bg-muted/30">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
              Nome da nova pasta
            </label>
            <div className="flex items-center gap-2 mt-1">
              <input
                autoFocus
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                placeholder="ex: Clientes"
                className="flex-1 rounded-md border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
              <button
                onClick={handleCreate}
                disabled={!newFolderName.trim() || creating}
                className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50">
                {creating ? '...' : 'Criar'}
              </button>
              <button
                onClick={() => { setShowNewFolder(false); setNewFolderName('') }}
                className="p-1 rounded hover:bg-accent text-muted-foreground" title="Cancelar">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5">
              Será criada no servidor IMAP. Use ponto pra criar subpastas (ex: <span className="font-mono">INBOX.Clientes</span>).
            </p>
          </div>
        ) : (
          <button
            onClick={() => setShowNewFolder(true)}
            className="px-3 py-2 border-t flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <FolderPlus className="h-3.5 w-3.5" />
            Nova pasta
          </button>
        )}

        {/* Footer */}
        <div className="flex gap-2 justify-end px-5 py-4 border-t shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-accent">Cancelar</button>
          <button onClick={handleMove} disabled={!picked || moving}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
            {moving ? 'Movendo...' : 'Mover'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Card de email individual ─────────────────────────────────────────────────
interface EmailItemProps {
  msg: Message
  isLast: boolean
  conv: ConversationInfo
}

function EmailItem({ msg, isLast, conv }: EmailItemProps) {
  const [expanded, setExpanded] = useState(isLast)

  const isOut = msg.direction === 'OUTBOUND'
  const senderName = isOut ? 'Você' : (conv.contact?.name ?? conv.contact?.email ?? 'Remetente')
  const senderEmail = isOut ? null : conv.contact?.email
  const color = avatarColor(isOut ? '__me' : (conv.contact?.id ?? senderName))
  const bodyHtml = (msg as any).bodyHtml as string | null | undefined
  const preview = msg.body.split('\n').find(l => l.trim())?.slice(0, 100) ?? ''
  const attachments: Array<{ type: string; filename?: string; mimetype: string }> = (msg.attachments as any) ?? []

  return (
    <div className={cn(
      'border rounded-xl bg-card transition-all',
      expanded ? 'shadow-md' : 'shadow-none',
      isLast && !expanded && 'ring-1 ring-primary/20',
    )}>
      {/* Header clicável */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/40 transition-colors rounded-xl"
      >
        <div
          className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
          style={{ background: color }}
        >
          {initials(senderName)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">{senderName}</span>
            {senderEmail && (
              <span className="text-xs text-muted-foreground hidden sm:block">&lt;{senderEmail}&gt;</span>
            )}
            {isOut && (
              <span className="text-[10px] bg-primary/10 text-primary rounded-full px-1.5 py-0.5 font-medium">Enviado</span>
            )}
          </div>
          {!expanded && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{preview}</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-2">
          {attachments.length > 0 && <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />}
          <span className="text-xs text-muted-foreground whitespace-nowrap">{formatEmailDate(msg.sentAt)}</span>
          {expanded
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {/* Corpo expandido */}
      {expanded && (
        <div className="px-4 pb-4">
          {isOut && conv.contact?.email && (
            <p className="text-xs text-muted-foreground mb-3">
              <span className="font-medium">Para:</span> {conv.contact.email}
            </p>
          )}
          <div className="border-t mb-4" />

          {bodyHtml
            ? <HtmlBody html={bodyHtml} />
            : <TextBody text={msg.body} />
          }

          {attachments.length > 0 && (
            <div className="mt-4 pt-3 border-t">
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                <Paperclip className="h-3 w-3" /> {attachments.length} anexo{attachments.length > 1 ? 's' : ''}
              </p>
              <div className="flex flex-wrap gap-2">
                {attachments.map((att, i) => (
                  <div key={i} className="flex items-center gap-1.5 rounded-lg border bg-muted/40 px-3 py-1.5 text-xs">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="truncate max-w-[160px]">{att.filename ?? 'Arquivo'}</span>
                    <Download className="h-3 w-3 text-muted-foreground ml-1" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Área de redação ──────────────────────────────────────────────────────────
type ComposeMode = 'reply' | 'replyAll' | 'forward' | null

interface AttachedFile { file: File; id: string }

interface ComposeAreaProps {
  conversationId: string
  conv: ConversationInfo
  mode: ComposeMode
  lastMessage: Message | null
  onClose: () => void
  onSent: () => void
}

function ComposeArea({ conversationId, conv, mode, lastMessage, onClose, onSent }: ComposeAreaProps) {
  const signature = conv.channel.signature
  const signatureHtml = signature
    ? `<p></p><p>--</p>${signature.split('\n').map(l => `<p>${l || '<br>'}</p>`).join('')}`
    : ''
  const [html, setHtml] = useState(signatureHtml)
  const [toEmail, setToEmail] = useState(mode === 'forward' ? '' : (conv.contact?.email ?? ''))
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [sending, setSending] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)

  // Texto simples do HTML (para o campo `text` obrigatório no backend)
  const toPlainText = (h: string) =>
    h.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').trim()

  const handleSend = async () => {
    const plain = toPlainText(html)
    if (!plain && attachedFiles.length === 0) return
    if (!toEmail && mode === 'forward') { toast.error('Informe o destinatário'); return }

    setSending(true)
    try {
      await apiFetch(`/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          text: plain || '(sem texto)',
          html: html || undefined,
        }),
      })
      onSent()
      onClose()
    } catch (err: any) {
      toast.error(err?.message ?? 'Erro ao enviar email')
    } finally {
      setSending(false)
    }
  }

  // Drag & drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(true)
  }, [])
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!dropZoneRef.current?.contains(e.relatedTarget as Node)) setIsDragging(false)
  }, [])
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    setAttachedFiles(prev => [...prev, ...files.map(f => ({ file: f, id: crypto.randomUUID() }))])
  }, [])
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    setAttachedFiles(prev => [...prev, ...files.map(f => ({ file: f, id: crypto.randomUUID() }))])
    e.target.value = ''
  }
  const removeFile = (id: string) => setAttachedFiles(prev => prev.filter(f => f.id !== id))

  const modeLabel = mode === 'reply' ? 'Responder' : mode === 'replyAll' ? 'Responder a todos' : 'Encaminhar'

  return (
    <div
      ref={dropZoneRef}
      className={cn(
        'border rounded-xl bg-card shadow-md transition-colors',
        isDragging && 'border-primary border-2 bg-primary/5',
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-primary">
            <UploadCloud className="h-10 w-10" />
            <p className="text-sm font-medium">Solte para anexar</p>
          </div>
        </div>
      )}

      {/* Cabeçalho */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b">
        <span className="text-sm font-semibold">{modeLabel}</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Campo Para (forward ou mostra destinatário fixo) */}
      <div className="flex items-center gap-2 px-4 py-2 border-b text-sm">
        <span className="text-muted-foreground font-medium w-8 shrink-0">Para:</span>
        {mode === 'forward'
          ? <input
              value={toEmail}
              onChange={e => setToEmail(e.target.value)}
              placeholder="destinatario@email.com"
              className="flex-1 bg-transparent focus:outline-none text-sm"
            />
          : <span className="text-foreground/80">
              {conv.contact?.name && <span className="font-medium">{conv.contact.name} </span>}
              {conv.contact?.email && <span className="text-muted-foreground">&lt;{conv.contact.email}&gt;</span>}
            </span>
        }
      </div>

      {/* Editor rico */}
      <div className="px-2 py-2">
        <RichEditor
          value={html}
          onChange={setHtml}
          placeholder={mode === 'forward' ? 'Adicione uma mensagem...' : 'Escreva sua resposta...'}
          minHeight={140}
          className="border-0 shadow-none"
        />
      </div>

      {/* Citação da mensagem anterior (reply) */}
      {lastMessage && mode !== 'forward' && (
        <div className="mx-4 mb-3 pl-3 border-l-2 border-muted-foreground/30">
          <p className="text-[11px] text-muted-foreground mb-1">
            Em {formatEmailDate(lastMessage.sentAt)}, {lastMessage.direction === 'INBOUND'
              ? (conv.contact?.name ?? conv.contact?.email ?? 'remetente')
              : 'você'} escreveu:
          </p>
          <p className="text-xs text-muted-foreground/80 line-clamp-3 italic">
            {lastMessage.body.split('\n').find(l => l.trim())?.slice(0, 200) ?? ''}
          </p>
        </div>
      )}

      {/* Arquivos anexados */}
      {attachedFiles.length > 0 && (
        <div className="px-4 pb-2 flex flex-wrap gap-2">
          {attachedFiles.map(({ file, id }) => (
            <div key={id} className="flex items-center gap-1.5 rounded-lg border bg-muted/40 px-2.5 py-1.5 text-xs">
              <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate max-w-[120px]">{file.name}</span>
              <span className="text-muted-foreground/60 shrink-0">
                {(file.size / 1024).toFixed(0)} KB
              </span>
              <button onClick={() => removeFile(id)} className="ml-0.5 text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Rodapé */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t bg-muted/20 rounded-b-xl">
        <div className="flex items-center gap-1">
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileInput} />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-1.5 rounded hover:bg-accent text-muted-foreground transition-colors"
            title="Anexar arquivo"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <span className="text-xs text-muted-foreground ml-1 hidden sm:block">
            Ou arraste arquivos aqui
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden sm:block">Ctrl+Enter para enviar</span>
          <button
            onClick={handleSend}
            disabled={sending}
            className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="h-3.5 w-3.5" />
            {sending ? 'Enviando...' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Email View ───────────────────────────────────────────────────────────────
interface Props {
  conversationId: string
  conv: ConversationInfo
  messages: Message[]
  isLoading: boolean
}

export default function EmailView({ conversationId, conv, messages, isLoading }: Props) {
  const queryClient = useQueryClient()
  const [composeMode, setComposeMode] = useState<ComposeMode>(null)
  const [showCardModal, setShowCardModal] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useSSE((event) => {
    if (event.type === 'message.received' && (event.payload as any)?.conversationId === conversationId) {
      const payload = event.payload as any
      queryClient.setQueryData(['conversation', conversationId], (old: any) => {
        if (!old?.messages) return old
        if (old.messages.some((m: any) => m.id === payload.messageId)) return old
        
        return {
          ...old,
          messages: [
            ...old.messages,
            {
              id: payload.messageId,
              body: payload.body,
              direction: payload.direction,
              sentAt: new Date().toISOString(),
              fromContactId: payload.contactId,
            }
          ],
          conversation: {
            ...old.conversation,
            lastMessageAt: new Date().toISOString()
          }
        }
      })
      if (document.hasFocus()) {
        queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
      }
    }
  })

  useEffect(() => {
    if (composeMode) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }
  }, [composeMode])

  const handleSent = () => {
    queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
    queryClient.invalidateQueries({ queryKey: ['conversations'] })
  }

  const subject = conv.subject ?? messages[0]?.body?.split('\n')[0]?.slice(0, 80) ?? '(sem assunto)'
  const contactName = conv.contact?.name ?? conv.contact?.email ?? 'Remetente'
  const color = avatarColor(conv.contact?.id ?? contactName)
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null

  // Estado de modais e ações
  const router = useRouter()
  const [showMoveModal, setShowMoveModal] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!confirm('Excluir esta conversa? Será movida para a lixeira no servidor IMAP.')) return
    setDeleting(true)
    try {
      await apiFetch(`/conversations/${conversationId}/email`, { method: 'DELETE' })
      toast.success('Conversa excluída')
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      router.push('/inbox?view=email')
    } catch (err: any) {
      toast.error(err?.message ?? 'Erro ao excluir')
      setDeleting(false)
    }
  }

  return (
    <>
      <div className="flex flex-col h-full">
        {/* ── Header com assunto + ações ── */}
        <div className="px-6 py-4 border-b bg-card shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold truncate">{subject}</h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <div className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                  style={{ background: color }}>
                  {initials(contactName)}
                </div>
                <span className="text-sm text-muted-foreground">
                  {contactName}
                  {conv.contact?.email && (
                    <span className="ml-1 opacity-60">&lt;{conv.contact.email}&gt;</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  · {messages.length} mensagen{messages.length !== 1 ? 's' : ''}
                </span>
                {conv.folder && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground inline-flex items-center gap-1">
                    <Folder className="h-2.5 w-2.5" />
                    {conv.folder === 'INBOX' ? 'Caixa de entrada' : conv.folder}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <AssigneeChip conversationId={conversationId} assignee={conv.assignee} />
              <button
                onClick={() => setShowMoveModal(true)}
                title="Mover para outra pasta"
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                <FolderInput className="h-3.5 w-3.5" /> Mover
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                title="Excluir conversa (move pra lixeira IMAP)"
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-red-50 hover:border-red-200 hover:text-red-600 dark:hover:bg-red-950/20 text-muted-foreground transition-colors disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" /> {deleting ? 'Excluindo...' : 'Excluir'}
              </button>
              <button
                onClick={() => setShowCardModal(true)}
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                <Kanban className="h-3.5 w-3.5" /> Criar card
              </button>
            </div>
          </div>
        </div>

        {/* ── Thread ── */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-2">
            {isLoading && (
              <div className="text-center text-sm text-muted-foreground py-8">Carregando...</div>
            )}

            {messages.map((msg, i) => (
              <EmailItem
                key={msg.id}
                msg={msg}
                conv={conv}
                isLast={i === messages.length - 1}
              />
            ))}

            {messages.length === 0 && !isLoading && (
              <div className="text-center text-sm text-muted-foreground py-8">Nenhuma mensagem ainda</div>
            )}

            {/* Botões de ação ou área de redação */}
            {!composeMode && messages.length > 0 && (
              <div className="flex items-center gap-2 pt-3">
                <button
                  onClick={() => setComposeMode('reply')}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
                >
                  <Reply className="h-4 w-4" /> Responder
                </button>
                <button
                  onClick={() => setComposeMode('replyAll')}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ReplyAll className="h-4 w-4" /> Responder a todos
                </button>
                <button
                  onClick={() => setComposeMode('forward')}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Forward className="h-4 w-4" /> Encaminhar
                </button>
              </div>
            )}

            {composeMode && (
              <ComposeArea
                conversationId={conversationId}
                conv={conv}
                mode={composeMode}
                lastMessage={lastMessage}
                onClose={() => setComposeMode(null)}
                onSent={handleSent}
              />
            )}

            <div ref={bottomRef} />
          </div>
        </div>
      </div>

      {showCardModal && (
        <CreateCardModal
          conversationId={conversationId}
          contactId={conv.contact?.id}
          contactName={conv.contact?.name ?? conv.contact?.email ?? undefined}
          messages={messages}
          onClose={() => setShowCardModal(false)}
        />
      )}

      {showMoveModal && (
        <MoveToFolderModal
          conversationId={conversationId}
          channelId={conv.channel.id}
          channelSettings={conv.channel.settings ?? null}
          currentFolder={conv.folder}
          onClose={() => setShowMoveModal(false)}
          onMoved={() => {
            queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
            queryClient.invalidateQueries({ queryKey: ['conversations'] })
          }}
        />
      )}
    </>
  )
}

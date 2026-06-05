'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { X, Send, Mail } from 'lucide-react'
import RichEditor from '@/components/RichEditor'

interface Channel {
  id: string
  type: 'WHATSAPP' | 'GMAIL' | 'IMAP_SMTP'
  label: string
  status: string
}

export default function ComposeNewEmailModal({ onClose, onSent }: {
  onClose: () => void
  onSent: (conversationId: string) => void
}) {
  const { data: channels = [] } = useQuery({
    queryKey: ['channels'],
    queryFn: () => apiFetch<Channel[]>('/channels'),
  })
  const emailChannels = channels.filter(c => c.type === 'GMAIL' || c.type === 'IMAP_SMTP')

  const [channelId, setChannelId] = useState<string>('')
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [html, setHtml] = useState('')
  const [sending, setSending] = useState(false)

  // Auto-seleciona o primeiro canal de email se ainda não escolhido
  const effectiveChannelId = channelId || emailChannels[0]?.id || ''

  const toPlainText = (h: string) =>
    h.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').trim()

  async function handleSend() {
    if (!effectiveChannelId) { toast.error('Configure um canal de email primeiro'); return }
    if (!to.trim()) { toast.error('Informe o destinatário'); return }
    if (!subject.trim()) { toast.error('Informe um assunto'); return }
    const text = toPlainText(html)
    if (!text) { toast.error('Escreva o conteúdo do email'); return }

    setSending(true)
    try {
      const result = await apiFetch<{ conversationId: string }>('/email/compose', {
        method: 'POST',
        body: JSON.stringify({ channelId: effectiveChannelId, to: to.trim(), subject, text, html }),
      })
      toast.success('Email enviado!')
      onSent(result.conversationId)
      onClose()
    } catch (err: any) {
      toast.error(err?.message ?? 'Erro ao enviar')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="modal-surface rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Mail className="h-4 w-4" /> Novo email
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* De: select de canal (esconde se só tiver 1) */}
          {emailChannels.length > 1 && (
            <div className="flex items-center gap-2 px-4 py-2 border-b text-sm">
              <span className="text-muted-foreground font-medium w-16 shrink-0">De:</span>
              <select
                value={effectiveChannelId}
                onChange={e => setChannelId(e.target.value)}
                className="flex-1 bg-transparent focus:outline-none text-sm">
                {emailChannels.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Para */}
          <div className="flex items-center gap-2 px-4 py-2 border-b text-sm">
            <span className="text-muted-foreground font-medium w-16 shrink-0">Para:</span>
            <input
              value={to}
              onChange={e => setTo(e.target.value)}
              placeholder="destinatario@email.com"
              autoFocus
              className="flex-1 bg-transparent focus:outline-none text-sm"
            />
          </div>

          {/* Assunto */}
          <div className="flex items-center gap-2 px-4 py-2 border-b text-sm">
            <span className="text-muted-foreground font-medium w-16 shrink-0">Assunto:</span>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Assunto do email"
              className="flex-1 bg-transparent focus:outline-none text-sm"
            />
          </div>

          {/* Editor */}
          <div className="px-2 py-2">
            <RichEditor
              value={html}
              onChange={setHtml}
              placeholder="Escreva sua mensagem..."
              minHeight={240}
              className="border-0 shadow-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 justify-end px-5 py-4 border-t shrink-0">
          {emailChannels.length === 0 && (
            <p className="flex-1 text-xs text-amber-600 dark:text-amber-400">
              Configure um canal de email em Admin → Canais
            </p>
          )}
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-accent">Cancelar</button>
          <button
            onClick={handleSend}
            disabled={sending || emailChannels.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
            <Send className="h-3.5 w-3.5" />
            {sending ? 'Enviando...' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  )
}

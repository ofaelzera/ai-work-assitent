'use client'

import { useRef, useState } from 'react'
import { Bold, Italic, Strikethrough, Code, List, Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { renderWhatsappText } from '@/lib/whatsappText'

/**
 * Editor de mensagem WhatsApp: textarea + barra com a formatação suportada pelo
 * WhatsApp (negrito *, itálico _, riscado ~, mono `, lista) e preview ao vivo
 * reutilizando o mesmo renderizador do inbox (lib/whatsappText).
 */
export function WhatsAppEditor({
  value, onChange, placeholder, minHeight = 130,
}: { value: string; onChange: (v: string) => void; placeholder?: string; minHeight?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [showPreview, setShowPreview] = useState(false)

  function wrap(marker: string) {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = value.slice(start, end) || 'texto'
    const next = value.slice(0, start) + marker + selected + marker + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + marker.length, start + marker.length + selected.length)
    })
  }

  function prefixLines() {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const before = value.slice(0, start)
    const sel = value.slice(start, end) || 'item'
    const bulleted = sel.split('\n').map((l) => (l.startsWith('• ') ? l : `• ${l}`)).join('\n')
    onChange(before + bulleted + value.slice(end))
    requestAnimationFrame(() => el.focus())
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b bg-muted/30">
        <ToolBtn title="Negrito (*texto*)" onClick={() => wrap('*')}><Bold className="h-4 w-4" /></ToolBtn>
        <ToolBtn title="Itálico (_texto_)" onClick={() => wrap('_')}><Italic className="h-4 w-4" /></ToolBtn>
        <ToolBtn title="Riscado (~texto~)" onClick={() => wrap('~')}><Strikethrough className="h-4 w-4" /></ToolBtn>
        <ToolBtn title="Monoespaçado (`texto`)" onClick={() => wrap('`')}><Code className="h-4 w-4" /></ToolBtn>
        <ToolBtn title="Lista com marcadores" onClick={prefixLines}><List className="h-4 w-4" /></ToolBtn>
        <div className="flex-1" />
        <ToolBtn title={showPreview ? 'Ocultar prévia' : 'Ver prévia'} onClick={() => setShowPreview((s) => !s)} active={showPreview}>
          {showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </ToolBtn>
      </div>
      {showPreview ? (
        <div className="px-3 py-2 text-sm whitespace-pre-wrap break-words bg-card" style={{ minHeight }}>
          {value.trim() ? renderWhatsappText(value) : <span className="text-muted-foreground">Prévia vazia…</span>}
        </div>
      ) : (
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ minHeight }}
          className="w-full bg-transparent px-3 py-2 text-sm focus:outline-none resize-y"
        />
      )}
    </div>
  )
}

function ToolBtn({ title, onClick, active, children }: { title: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      className={cn('p-1.5 rounded transition-colors', active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
    >
      {children}
    </button>
  )
}

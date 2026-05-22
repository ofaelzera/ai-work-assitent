'use client'

import { useRef, useEffect } from 'react'
import { Bold, Italic, Strikethrough, Code, Send } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onTyping?: () => void
  disabled?: boolean
  placeholder?: string
}

export function ChatInput({ value, onChange, onSend, onTyping, disabled, placeholder = 'Digite uma mensagem...' }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [value])

  const insertFormat = (prefix: string, suffix: string = prefix) => {
    const el = textareaRef.current
    if (!el) return

    const start = el.selectionStart
    const end = el.selectionEnd
    const selectedText = value.substring(start, end)
    
    // Se não tem texto selecionado, apenas insere os marcadores e coloca o cursor no meio
    const newText = value.substring(0, start) + prefix + selectedText + suffix + value.substring(end)
    onChange(newText)

    // Foca novamente e ajusta o cursor
    setTimeout(() => {
      el.focus()
      if (selectedText) {
        // Se tinha texto, coloca o cursor depois de tudo
        el.setSelectionRange(end + prefix.length + suffix.length, end + prefix.length + suffix.length)
      } else {
        // Se não tinha, coloca no meio dos marcadores
        el.setSelectionRange(start + prefix.length, start + prefix.length)
      }
    }, 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (value.trim() && !disabled) {
        onSend()
      }
    }
  }

  return (
    <div className="flex flex-col bg-card border rounded-xl shadow-soft overflow-hidden transition-all focus-within:ring-2 focus-within:ring-primary/40">
      {/* Formatação nativa de WhatsApp (markdown simples) */}
      <div className="flex items-center gap-1 bg-muted/30 px-2 py-1.5 border-b">
        <button
          onClick={() => insertFormat('*')}
          disabled={disabled}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          title="Negrito (*texto*)"
        >
          <Bold className="h-4 w-4" />
        </button>
        <button
          onClick={() => insertFormat('_')}
          disabled={disabled}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          title="Itálico (_texto_)"
        >
          <Italic className="h-4 w-4" />
        </button>
        <button
          onClick={() => insertFormat('~')}
          disabled={disabled}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          title="Riscado (~texto~)"
        >
          <Strikethrough className="h-4 w-4" />
        </button>
        <div className="w-px h-4 bg-border mx-1" />
        <button
          onClick={() => insertFormat('```')}
          disabled={disabled}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          title="Código (```código```)"
        >
          <Code className="h-4 w-4" />
        </button>
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          if (e.target.value && onTyping) onTyping()
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full resize-none bg-transparent px-3 py-2.5 text-[15px] leading-relaxed focus:outline-none placeholder:text-muted-foreground/60 max-h-40 overflow-y-auto"
        rows={1}
      />
    </div>
  )
}

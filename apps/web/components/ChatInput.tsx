'use client'

import { useRef, useEffect, useState } from 'react'
import { Bold, Italic, Strikethrough, Code, Smile } from 'lucide-react'
import { cn } from '@/lib/utils'
import EmojiPicker, { Theme } from 'emoji-picker-react'
import { useTheme } from 'next-themes'

export interface QuickReply {
  id: string
  shortcut: string
  title: string | null
  body: string
}

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onTyping?: () => void
  disabled?: boolean
  placeholder?: string
  leftToolbarActions?: React.ReactNode
  bottomRightActions?: React.ReactNode
  inputRef?: React.RefObject<HTMLTextAreaElement>
  quickReplies?: QuickReply[]
}

export function ChatInput({
  value,
  onChange,
  onSend,
  onTyping,
  disabled,
  placeholder = 'Digite uma mensagem...',
  leftToolbarActions,
  bottomRightActions,
  inputRef,
  quickReplies = [],
}: ChatInputProps) {
  const internalRef = useRef<HTMLTextAreaElement>(null)
  const textareaRef = inputRef || internalRef
  const emojiRef = useRef<HTMLDivElement>(null)
  const slashMenuRef = useRef<HTMLDivElement>(null)
  const [showEmoji, setShowEmoji] = useState(false)
  const [slashMatches, setSlashMatches] = useState<QuickReply[]>([])
  const [slashIndex, setSlashIndex] = useState(0)
  const { resolvedTheme } = useTheme()

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [value])

  // Click outside to close emoji picker
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(event.target as Node)) {
        setShowEmoji(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Detecta /atalho no início do texto e filtra respostas rápidas
  useEffect(() => {
    const match = value.match(/^\/(\w*)$/)
    if (match && quickReplies.length > 0) {
      const typed = match[1].toLowerCase()
      const filtered = quickReplies.filter(qr =>
        qr.shortcut.toLowerCase().startsWith(typed)
      )
      setSlashMatches(filtered)
      setSlashIndex(0)
    } else {
      setSlashMatches([])
    }
  }, [value, quickReplies])

  const applyQuickReply = (qr: QuickReply) => {
    onChange(qr.body)
    setSlashMatches([])
    setTimeout(() => {
      textareaRef.current?.focus()
      const len = qr.body.length
      textareaRef.current?.setSelectionRange(len, len)
    }, 0)
  }

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

  const insertEmoji = (emojiData: any) => {
    const el = textareaRef.current
    if (!el) return

    const start = el.selectionStart
    const end = el.selectionEnd
    const newText = value.substring(0, start) + emojiData.emoji + value.substring(end)
    onChange(newText)

    setTimeout(() => {
      el.focus()
      const newPos = start + emojiData.emoji.length
      el.setSelectionRange(newPos, newPos)
    }, 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMatches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashIndex(i => (i + 1) % slashMatches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIndex(i => (i - 1 + slashMatches.length) % slashMatches.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        applyQuickReply(slashMatches[slashIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSlashMatches([])
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (value.trim() && !disabled) {
        onSend()
      }
    }
  }

  return (
    <div className="flex flex-col bg-card border border-border/80 rounded-2xl shadow-sm overflow-visible transition-all focus-within:ring-2 focus-within:ring-primary/40 focus-within:border-primary/50 relative">
      {/* Popup de respostas rápidas (slash menu) */}
      {slashMatches.length > 0 && (
        <div
          ref={slashMenuRef}
          className="absolute bottom-full mb-2 left-0 right-0 z-50 rounded-xl border bg-card shadow-lg overflow-hidden"
        >
          <div className="px-3 py-2 border-b bg-muted/30">
            <p className="text-xs text-muted-foreground font-medium">Respostas rápidas · <kbd className="font-mono text-[10px] bg-muted px-1 rounded">↑↓</kbd> navegar · <kbd className="font-mono text-[10px] bg-muted px-1 rounded">Enter</kbd> ou <kbd className="font-mono text-[10px] bg-muted px-1 rounded">Tab</kbd> para inserir</p>
          </div>
          <div className="max-h-52 overflow-y-auto">
            {slashMatches.map((qr, i) => (
              <button
                key={qr.id}
                onMouseDown={e => { e.preventDefault(); applyQuickReply(qr) }}
                onMouseEnter={() => setSlashIndex(i)}
                className={cn(
                  'w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors',
                  i === slashIndex ? 'bg-primary/10' : 'hover:bg-muted/40',
                )}
              >
                <span className="shrink-0 mt-0.5 font-mono text-sm font-semibold text-primary min-w-[80px]">/{qr.shortcut}</span>
                <div className="flex-1 min-w-0">
                  {qr.title && <p className="text-xs font-medium truncate">{qr.title}</p>}
                  <p className="text-xs text-muted-foreground line-clamp-1">{qr.body}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Barra superior de ferramentas */}
      <div className="flex items-center gap-1 bg-muted/20 px-2 py-1.5 border-b border-border/50 relative rounded-t-2xl">
        {leftToolbarActions && (
          <>
            {leftToolbarActions}
            <div className="w-px h-4 bg-border mx-1" />
          </>
        )}
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
        <div className="w-px h-4 bg-border mx-1" />
        
        <div ref={emojiRef} className="relative">
          <button
            onClick={() => setShowEmoji((prev) => !prev)}
            disabled={disabled}
            className={cn(
              "p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50",
              showEmoji && "bg-accent text-foreground"
            )}
            title="Emoticons"
          >
            <Smile className="h-4 w-4" />
          </button>
          
          {showEmoji && (
            <div className="absolute bottom-full mb-2 left-0 z-50 shadow-2xl">
              <EmojiPicker
                onEmojiClick={insertEmoji}
                theme={resolvedTheme === 'dark' ? Theme.DARK : Theme.LIGHT}
                searchPlaceHolder="Buscar emoji..."
                lazyLoadEmojis={true}
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex items-end pr-1.5 pb-1.5">
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
          spellCheck
          lang="pt-BR"
          autoCorrect="on"
          autoCapitalize="sentences"
          className="flex-1 w-full resize-none bg-transparent px-3 pt-3 pb-2 text-[15px] leading-relaxed focus:outline-none placeholder:text-muted-foreground/60 max-h-40 overflow-y-auto"
          rows={1}
        />
        {bottomRightActions && (
          <div className="shrink-0 flex items-center gap-1.5 pb-1">
            {bottomRightActions}
          </div>
        )}
      </div>
    </div>
  )
}

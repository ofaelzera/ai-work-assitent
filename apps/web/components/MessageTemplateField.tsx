'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Eye, Variable } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TemplateVar { key: string; label: string; example: string }

interface Props {
  label: string
  helperText?: string
  value: string
  onChange: (next: string) => void
  onBlur?: () => void
  placeholder?: string
  rows?: number
}

/**
 * Textarea pra mensagens-template (welcome, closing).
 * Inclui:
 *   • Lista clicável de variáveis (insere no cursor)
 *   • Preview com valores fictícios
 *   • Contador de caracteres
 */
export default function MessageTemplateField({
  label,
  helperText,
  value,
  onChange,
  onBlur,
  placeholder,
  rows = 4,
}: Props) {
  const [showPreview, setShowPreview] = useState(false)
  const [showVars, setShowVars] = useState(false)

  const { data: variables = [] } = useQuery<TemplateVar[]>({
    queryKey: ['template-variables'],
    queryFn: () => apiFetch('/templates/variables'),
    staleTime: Infinity,
  })

  const insert = (token: string) => {
    onChange(value + (value.endsWith(' ') || value === '' ? '' : ' ') + token + ' ')
    setShowVars(false)
  }

  /** Preview com valores fictícios */
  const previewValues: Record<string, string> = Object.fromEntries(variables.map(v => [v.key.slice(1, -1).toLowerCase(), v.example]))
  const preview = value.replace(/\{(\w+)\}/g, (full, k) => previewValues[k.toLowerCase()] ?? full)

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium">{label}</label>
        <div className="flex items-center gap-2">
          <button type="button"
            onClick={() => setShowVars(v => !v)}
            className={cn('flex items-center gap-1 text-[11px] transition-colors',
              showVars ? 'text-primary' : 'text-muted-foreground hover:text-foreground')}>
            <Variable className="h-3 w-3" /> Variáveis
          </button>
          {value.trim() && (
            <button type="button"
              onClick={() => setShowPreview(v => !v)}
              className={cn('flex items-center gap-1 text-[11px] transition-colors',
                showPreview ? 'text-primary' : 'text-muted-foreground hover:text-foreground')}>
              <Eye className="h-3 w-3" /> {showPreview ? 'Editar' : 'Preview'}
            </button>
          )}
        </div>
      </div>

      {showVars && variables.length > 0 && (
        <div className="rounded-lg border bg-muted/30 p-2.5 grid grid-cols-2 gap-1">
          {variables.map(v => (
            <button key={v.key} type="button"
              onClick={() => insert(v.key)}
              className="flex flex-col items-start gap-0.5 px-2 py-1 rounded text-left hover:bg-accent transition-colors">
              <code className="text-[11px] text-primary font-mono">{v.key}</code>
              <span className="text-[10px] text-muted-foreground truncate w-full">{v.label}</span>
            </button>
          ))}
        </div>
      )}

      {showPreview ? (
        <div className="rounded-lg border bg-card px-3 py-2 text-sm min-h-[88px] whitespace-pre-wrap">
          {preview || <span className="text-muted-foreground italic">Preview vazio</span>}
        </div>
      ) : (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          rows={rows}
          maxLength={2000}
          className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
        />
      )}

      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        {helperText && <span className="italic">{helperText}</span>}
        <span className="ml-auto">{value.length}/2000</span>
      </div>
    </div>
  )
}

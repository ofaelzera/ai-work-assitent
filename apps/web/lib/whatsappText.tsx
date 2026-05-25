import React, { createContext, useContext } from 'react'

// Context opcional pra evitar prop-drilling do resolver em árvores grandes de mensagens
const MentionContext = createContext<ResolveMention | undefined>(undefined)
export function MentionProvider({ resolver, children }: { resolver: ResolveMention | undefined; children: React.ReactNode }) {
  return <MentionContext.Provider value={resolver}>{children}</MentionContext.Provider>
}

/**
 * Renderiza texto no estilo do WhatsApp:
 *   *texto*    → negrito
 *   _texto_    → itálico
 *   ~texto~    → riscado
 *   `texto`    → monospace
 *   ```bloco```→ bloco de código
 *   @<dígitos> → menção (resolvida via callback opcional `resolveMention`)
 *
 * Os marcadores são removidos da saída. Não-formatado fica como texto puro,
 * preservando quebras de linha (use junto com `whitespace-pre-wrap`).
 *
 * Heurísticas (mesmas do WhatsApp Web):
 *   • abertura deve estar precedida de início/espaço/quebra
 *   • fechamento deve estar seguido de fim/espaço/quebra/pontuação
 *   • dentro do par não pode haver outro marcador idêntico
 */

type Token =
  | { type: 'text'; value: string }
  | { type: 'mention'; id: string }
  | { type: 'bold' | 'italic' | 'strike' | 'mono' | 'codeblock'; children: Token[] }

const RULES: { type: 'bold' | 'italic' | 'strike' | 'mono' | 'codeblock'; marker: string }[] = [
  { type: 'codeblock', marker: '```' },
  { type: 'bold',      marker: '*' },
  { type: 'italic',    marker: '_' },
  { type: 'strike',    marker: '~' },
  { type: 'mono',      marker: '`' },
]

function isBoundaryBefore(text: string, i: number): boolean {
  if (i === 0) return true
  const c = text[i - 1]
  return /\s|[\n([{<>"']/.test(c)
}

function isBoundaryAfter(text: string, i: number): boolean {
  if (i >= text.length) return true
  const c = text[i]
  return /\s|[\n)\]}.,!?;:"'<>]/.test(c)
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    let matched = false

    // Menção: @<dígitos> precedido por boundary (5+ dígitos para evitar falsos positivos como "@1")
    if (text[i] === '@' && isBoundaryBefore(text, i)) {
      const start = i + 1
      let j = start
      while (j < text.length && /\d/.test(text[j])) j++
      const id = text.slice(start, j)
      if (id.length >= 5) {
        tokens.push({ type: 'mention', id })
        i = j
        matched = true
      }
    }

    if (!matched) {
      for (const rule of RULES) {
        const { marker, type } = rule
        if (text.startsWith(marker, i) && isBoundaryBefore(text, i)) {
          const startContent = i + marker.length
          let j = startContent
          while (j < text.length) {
            if (text.startsWith(marker, j) && isBoundaryAfter(text, j + marker.length)) {
              const inner = text.slice(startContent, j)
              if (inner.length > 0) {
                tokens.push({ type, children: tokenize(inner) })
                i = j + marker.length
                matched = true
              }
              break
            }
            j++
          }
          if (matched) break
        }
      }
    }

    if (!matched) {
      const last = tokens[tokens.length - 1]
      if (last && last.type === 'text') last.value += text[i]
      else tokens.push({ type: 'text', value: text[i] })
      i++
    }
  }
  return tokens
}

export type ResolveMention = (id: string) => string | null | undefined

function renderTokens(tokens: Token[], resolveMention: ResolveMention | undefined, keyPrefix = ''): React.ReactNode[] {
  return tokens.map((t, i) => {
    const k = `${keyPrefix}${i}`
    if (t.type === 'text') return <React.Fragment key={k}>{t.value}</React.Fragment>
    if (t.type === 'mention') {
      const resolved = resolveMention?.(t.id)
      const label = resolved ?? t.id
      return (
        <span
          key={k}
          title={resolved ? `WhatsApp ID: ${t.id}` : 'Contato desconhecido'}
          className={resolved
            ? 'inline-flex items-baseline font-medium text-primary cursor-default'
            : 'inline-flex items-baseline text-muted-foreground cursor-help'}
        >
          @{label}
        </span>
      )
    }
    const children = renderTokens(t.children, resolveMention, `${k}.`)
    switch (t.type) {
      case 'bold':      return <strong key={k}>{children}</strong>
      case 'italic':    return <em key={k}>{children}</em>
      case 'strike':    return <s key={k}>{children}</s>
      case 'mono':      return <code key={k} className="px-1 rounded bg-black/10 dark:bg-white/10 text-[0.9em] font-mono">{children}</code>
      case 'codeblock': return <pre key={k} className="block rounded bg-black/10 dark:bg-white/10 p-2 text-[0.85em] font-mono whitespace-pre-wrap">{children}</pre>
    }
  })
}

/**
 * Componente que renderiza texto WhatsApp consumindo o resolver do MentionContext.
 * Preferível ao `renderWhatsappText` quando se está dentro de um <MentionProvider>.
 */
export function WhatsappText({ text }: { text: string | null | undefined }) {
  const resolver = useContext(MentionContext)
  if (!text) return null
  return <>{renderTokens(tokenize(text), resolver)}</>
}

export function renderWhatsappText(
  text: string | null | undefined,
  resolveMention?: ResolveMention,
): React.ReactNode {
  if (!text) return null
  return renderTokens(tokenize(text), resolveMention)
}

/**
 * Strip plano dos marcadores (sem JSX). Útil pra previews, notificações, etc.
 * `*Rafael:*` → `Rafael:`
 * `@123456 oi` → `@123456 oi` (mantém o @ID como está)
 */
export function stripWhatsappMarks(text: string | null | undefined, resolveMention?: ResolveMention): string {
  if (!text) return ''
  function walk(tokens: Token[]): string {
    return tokens.map((t) => {
      if (t.type === 'text') return t.value
      if (t.type === 'mention') {
        const resolved = resolveMention?.(t.id)
        return `@${resolved ?? t.id}`
      }
      return walk(t.children)
    }).join('')
  }
  return walk(tokenize(text))
}

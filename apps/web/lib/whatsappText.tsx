import React from 'react'

/**
 * Renderiza texto no estilo do WhatsApp:
 *   *texto*    → negrito
 *   _texto_    → itálico
 *   ~texto~    → riscado
 *   `texto`    → monospace
 *   ```bloco```→ bloco de código
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
  | { type: 'bold' | 'italic' | 'strike' | 'mono' | 'codeblock'; children: Token[] }

const RULES: { type: Exclude<Token['type'], 'text'>; marker: string }[] = [
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
    for (const rule of RULES) {
      const { marker, type } = rule
      if (text.startsWith(marker, i) && isBoundaryBefore(text, i)) {
        // procura fechamento
        const startContent = i + marker.length
        let j = startContent
        while (j < text.length) {
          if (text.startsWith(marker, j) && isBoundaryAfter(text, j + marker.length)) {
            // achou par válido
            const inner = text.slice(startContent, j)
            // não pode ser vazio
            if (inner.length > 0) {
              tokens.push({ type, children: tokenize(inner) })
              i = j + marker.length
              matched = true
            }
            break
          }
          // pula linha quebra? para `*` e `_` o WhatsApp permite multi-linha
          j++
        }
        if (matched) break
      }
    }
    if (!matched) {
      // adiciona char como texto (mesclando com último texto)
      const last = tokens[tokens.length - 1]
      if (last && last.type === 'text') last.value += text[i]
      else tokens.push({ type: 'text', value: text[i] })
      i++
    }
  }
  return tokens
}

function renderTokens(tokens: Token[], keyPrefix = ''): React.ReactNode[] {
  return tokens.map((t, i) => {
    const k = `${keyPrefix}${i}`
    if (t.type === 'text') return <React.Fragment key={k}>{t.value}</React.Fragment>
    const children = renderTokens(t.children, `${k}.`)
    switch (t.type) {
      case 'bold':      return <strong key={k}>{children}</strong>
      case 'italic':    return <em key={k}>{children}</em>
      case 'strike':    return <s key={k}>{children}</s>
      case 'mono':      return <code key={k} className="px-1 rounded bg-black/10 dark:bg-white/10 text-[0.9em] font-mono">{children}</code>
      case 'codeblock': return <pre key={k} className="block rounded bg-black/10 dark:bg-white/10 p-2 text-[0.85em] font-mono whitespace-pre-wrap">{children}</pre>
    }
  })
}

export function renderWhatsappText(text: string | null | undefined): React.ReactNode {
  if (!text) return null
  return renderTokens(tokenize(text))
}

/**
 * Strip plano dos marcadores (sem JSX). Útil pra previews, notificações, etc.
 * `*Rafael:*` → `Rafael:`
 */
export function stripWhatsappMarks(text: string | null | undefined): string {
  if (!text) return ''
  function walk(tokens: Token[]): string {
    return tokens.map((t) => t.type === 'text' ? t.value : walk(t.children)).join('')
  }
  return walk(tokenize(text))
}

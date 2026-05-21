/**
 * Helpers para parse e exibição de pastas IMAP.
 * IMAP costuma usar "." ou "/" como separador (ex: "INBOX.Archive", "Trabalho/Clientes").
 */

export interface FolderNode {
  path: string             // path completo, ex: "INBOX.Drafts"
  label: string            // só o segmento atual, ex: "Drafts"
  children: FolderNode[]
}

/** Detecta o separador predominante numa lista de paths IMAP. */
export function detectSeparator(paths: string[]): '.' | '/' {
  const dotCount = paths.filter(p => p.includes('.')).length
  const slashCount = paths.filter(p => p.includes('/')).length
  return slashCount > dotCount ? '/' : '.'
}

/**
 * Constrói uma árvore hierárquica a partir de paths IMAP planos.
 * Cria nós sintéticos pros ancestrais que não aparecem na lista.
 * Ordena INBOX/Caixa de entrada primeiro, depois alfabético.
 */
export function buildFolderTree(paths: string[]): FolderNode[] {
  if (paths.length === 0) return []
  const sep = detectSeparator(paths)

  const byPath = new Map<string, FolderNode>()

  function ensureNode(path: string): FolderNode {
    if (byPath.has(path)) return byPath.get(path)!
    const segments = path.split(sep).filter(Boolean)
    const label = segments[segments.length - 1] ?? path
    const node: FolderNode = { path, label, children: [] }
    byPath.set(path, node)
    return node
  }

  // Cria todos os nós (incluindo ancestrais sintéticos)
  for (const p of paths) {
    const segments = p.split(sep).filter(Boolean)
    for (let i = 0; i < segments.length; i++) {
      ensureNode(segments.slice(0, i + 1).join(sep))
    }
  }

  // Liga pais a filhos
  const roots: FolderNode[] = []
  for (const node of byPath.values()) {
    const segments = node.path.split(sep).filter(Boolean)
    if (segments.length === 1) {
      roots.push(node)
    } else {
      const parentPath = segments.slice(0, -1).join(sep)
      const parent = byPath.get(parentPath)
      if (parent && !parent.children.includes(node)) parent.children.push(node)
      else if (!parent) roots.push(node)
    }
  }

  function sortRec(nodes: FolderNode[]): FolderNode[] {
    const sorted = [...nodes].sort((a, b) => {
      const aInbox = /^(INBOX|Caixa)/i.test(a.label)
      const bInbox = /^(INBOX|Caixa)/i.test(b.label)
      if (aInbox && !bInbox) return -1
      if (bInbox && !aInbox) return 1
      return a.label.localeCompare(b.label, 'pt-BR')
    })
    for (const n of sorted) n.children = sortRec(n.children)
    return sorted
  }

  return sortRec(roots)
}

/** Tradução amigável de nomes comuns de pastas IMAP em inglês. */
export function prettyFolderLabel(raw: string): string {
  if (raw === 'INBOX') return 'Caixa de entrada'
  const map: Record<string, string> = {
    'Sent':           'Enviados',
    'Drafts':         'Rascunhos',
    'Trash':          'Lixeira',
    'Junk':           'Spam',
    'Spam':           'Spam',
    'Archive':        'Arquivados',
    'Deleted':        'Excluídos',
    'Deleted Items':  'Excluídos',
    'Modelo Emails':  'Modelos',
    'Fixados':        'Fixados',
  }
  return map[raw] ?? raw
}

/**
 * Acha todos os "leaves" (descendentes) numa subárvore — útil quando precisamos
 * decidir se um nó intermediário tem filhos (chevron expansível).
 */
export function flattenLeaves(node: FolderNode): FolderNode[] {
  if (node.children.length === 0) return [node]
  return node.children.flatMap(flattenLeaves)
}

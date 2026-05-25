import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './api'

/**
 * Extrai todos os IDs de menção (@<dígitos>) de uma lista de textos.
 * IDs com menos de 5 dígitos são ignorados para evitar falsos positivos.
 */
function extractMentionIds(texts: (string | null | undefined)[]): string[] {
  const ids = new Set<string>()
  const re = /(?:^|[\s\n([{<>"'])@(\d{5,})/g
  for (const t of texts) {
    if (!t) continue
    let m: RegExpExecArray | null
    while ((m = re.exec(t)) !== null) ids.add(m[1])
  }
  return Array.from(ids)
}

/**
 * Hook que resolve IDs de menção (PN/LID do WhatsApp) para nomes de contato.
 *
 * Recebe uma lista de textos (corpo de mensagens), extrai os IDs únicos
 * e busca no backend de uma vez só. O resolver retornado pode ser passado
 * direto pra `renderWhatsappText(text, resolveMention)`.
 */
export function useMentionResolver(texts: (string | null | undefined)[]) {
  const ids = useMemo(() => extractMentionIds(texts), [texts])
  const idsKey = useMemo(() => ids.slice().sort().join(','), [ids])

  const { data } = useQuery<Record<string, string>>({
    queryKey: ['mention-resolver', idsKey],
    queryFn: () =>
      apiFetch<Record<string, string>>('/contacts/resolve-mentions', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
    enabled: ids.length > 0,
    staleTime: 60_000,
  })

  return useMemo(() => {
    const map = data ?? {}
    return (id: string): string | null => map[id] ?? null
  }, [data])
}

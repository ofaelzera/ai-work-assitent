/**
 * Parsing/normalização de JIDs do WhatsApp e telefones em geral.
 *
 * Tipos de JID que recebemos do Evolution API:
 *   - PN (Phone Number):  "554488297245@s.whatsapp.net" → telefone real
 *   - LID (Linked ID):    "29773334077682@lid"          → ID opaco (privacidade WhatsApp 2024+)
 *   - Group:              "1234567890-1234@g.us"        → conversa de grupo
 *
 * Regra brasileira (DDI 55):
 *   - 13 dígitos: 55 + DDD(2) + 9(1) + número(8) — formato moderno
 *   - 12 dígitos: 55 + DDD(2) + número(8) — sem o 9; inserimos
 *   - 11 dígitos: DDD(2) + 9(1) + número(8) — sem DDI; adicionamos 55
 *   - 10 dígitos: DDD(2) + número(8) — sem DDI e sem 9
 */

export type JidKind = 'pn' | 'lid' | 'group' | 'unknown'

export interface ParsedJid {
  kind: JidKind
  /** PN normalizado — só preenchido quando kind === 'pn' */
  phone?: string
  /** ID opaco do WhatsApp — só preenchido quando kind === 'lid' */
  lid?: string
  /** ID do grupo (sem @g.us) — só preenchido quando kind === 'group' */
  groupId?: string
  /** Raw original como recebido */
  raw: string
}

/** Retorna true se o JID termina com `@lid` (formato opaco). */
export function isLidJid(raw: string): boolean {
  return typeof raw === 'string' && raw.endsWith('@lid')
}

/** Retorna true se o JID é PN (`@s.whatsapp.net` ou só dígitos sem sufixo @lid/@g.us). */
export function isPnJid(raw: string): boolean {
  if (typeof raw !== 'string') return false
  if (raw.endsWith('@s.whatsapp.net') || raw.endsWith('@c.us')) return true
  if (raw.includes('@')) return false
  return /^\d+$/.test(raw)
}

/** Retorna true se for JID de grupo (`@g.us`). */
export function isGroupJid(raw: string): boolean {
  return typeof raw === 'string' && raw.endsWith('@g.us')
}

/**
 * Heurística para detectar se uma string de dígitos parece um LID em vez de um telefone real.
 * Útil pro backfill da migration: contatos onde o "phone" salvo na verdade é um LID.
 *
 * Critérios (todos precisam falhar pra considerar PN):
 *   - 13 dígitos começando com 55 + DDD válido (11–99) → PN BR
 *   - 12 dígitos começando com 55 → PN BR (formato antigo)
 *   - 10–11 dígitos puros → provável PN local
 *   - 7–15 dígitos com prefixo internacional plausível → PN
 *
 * Caso contrário (ex: 14 dígitos sem padrão BR, ou 15+ dígitos) → LID.
 */
export function isLidLikely(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false
  const len = digits.length

  // Padrões claros de PN
  if (len === 13 && digits.startsWith('55')) {
    const ddd = parseInt(digits.slice(2, 4), 10)
    if (ddd >= 11 && ddd <= 99) return false // PN BR moderno
  }
  if (len === 12 && digits.startsWith('55')) return false // PN BR antigo
  if (len === 10 || len === 11) return false // PN local sem DDI
  // E.164 internacional típico: 8–15 dígitos
  if (len >= 8 && len <= 13) return false

  // 14+ dígitos sem padrão BR, ou strings claramente fora do range E.164 → LID
  return true
}

function normalizeBrPn(digits: string): string {
  if (digits.startsWith('55')) {
    if (digits.length === 13) return digits
    if (digits.length === 12) return digits.slice(0, 4) + '9' + digits.slice(4)
  }
  if (!digits.startsWith('55')) {
    if (digits.length === 11) return '55' + digits
    if (digits.length === 10) return '55' + digits.slice(0, 2) + '9' + digits.slice(2)
  }
  return digits
}

/**
 * Parsing principal — sempre prefira esta função sobre `normalizePhone()`.
 * Retorna o tipo do JID e o valor canônico apropriado para cada categoria.
 */
export function parseJid(raw: string): ParsedJid {
  if (typeof raw !== 'string' || !raw) {
    return { kind: 'unknown', raw: String(raw ?? '') }
  }

  // Grupo
  if (isGroupJid(raw)) {
    return { kind: 'group', groupId: raw.slice(0, -'@g.us'.length), raw }
  }

  // LID — devolve o ID opaco como está (sem normalizar como telefone)
  if (isLidJid(raw)) {
    const lid = raw.slice(0, -'@lid'.length).replace(/\D/g, '')
    return { kind: 'lid', lid, raw }
  }

  // PN — strip do sufixo conhecido + normalização BR
  let body = raw
  if (body.endsWith('@s.whatsapp.net')) body = body.slice(0, -'@s.whatsapp.net'.length)
  else if (body.endsWith('@c.us')) body = body.slice(0, -'@c.us'.length)
  else if (body.includes('@')) {
    // sufixo @ desconhecido — não é PN nem LID nem grupo
    return { kind: 'unknown', raw }
  }

  const digits = body.replace(/\D/g, '')
  if (!digits) return { kind: 'unknown', raw }

  // Se os dígitos parecerem LID (15+, ou 14 sem padrão BR), tratamos como LID puro sem sufixo
  if (isLidLikely(digits)) {
    return { kind: 'lid', lid: digits, raw }
  }

  return { kind: 'pn', phone: normalizeBrPn(digits), raw }
}

/**
 * @deprecated Prefira `parseJid()` — esta função existe só para compatibilidade.
 * Lança erro se receber um LID, para forçar o refator dos call-sites.
 */
export function normalizePhone(raw: string): string {
  const parsed = parseJid(raw)
  if (parsed.kind === 'lid') {
    throw new Error(`normalizePhone() recebeu um JID LID ("${raw}") — use parseJid() em vez disso`)
  }
  if (parsed.kind === 'group') {
    // Para grupos, devolvemos o id sem @g.us — comportamento antigo
    return parsed.groupId ?? raw
  }
  if (parsed.kind === 'pn' && parsed.phone) return parsed.phone
  // unknown → devolve dígitos como fallback
  return raw.replace(/\D/g, '') || raw
}

/** Verifica se dois números/JIDs representam o mesmo contato (PN). */
export function phonesMatch(a: string, b: string): boolean {
  const pa = parseJid(a)
  const pb = parseJid(b)
  if (pa.kind === 'pn' && pb.kind === 'pn') return pa.phone === pb.phone
  if (pa.kind === 'lid' && pb.kind === 'lid') return pa.lid === pb.lid
  return false
}

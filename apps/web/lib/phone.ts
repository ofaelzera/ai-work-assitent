/**
 * Formata número de telefone para exibição.
 * - Brasileiro (55 + DDD + 9 dígitos): (11) 91234-5678
 * - Brasileiro (55 + DDD + 8 dígitos): (11) 1234-5678
 * - Internacional reconhecível: +55 11 99999-9999
 * - ID interno do WhatsApp (15+ dígitos): mostra apenas os últimos 8 com reticências
 */
export function formatPhone(phone: string): string {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')

  // IDs internos do WhatsApp/Meta (15+ dígitos) — não são números reais
  // Exemplo: 147510718943390, 208885818359934
  if (digits.length >= 15) {
    return `···${digits.slice(-8)}`
  }

  // Brasileiro com DDI 55: 12 ou 13 dígitos
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    const local = digits.slice(2)
    const ddd = local.slice(0, 2)
    const num = local.slice(2)
    if (num.length === 9) return `(${ddd}) ${num.slice(0, 5)}-${num.slice(5)}`
    if (num.length === 8) return `(${ddd}) ${num.slice(0, 4)}-${num.slice(4)}`
  }

  // Número local sem DDI (10–11 dígitos)
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  }

  // Internacional (12–14 dígitos): +CC NNNNNNNNNN
  if (digits.length >= 12) {
    return `+${digits.slice(0, 2)} ${digits.slice(2)}`
  }

  return phone
}

/** Retorna true se o "telefone" parece ser um ID interno do WhatsApp, não um número real */
export function isInternalId(phone: string): boolean {
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 15
}

/**
 * Formata um LID (Linked ID — ID opaco do WhatsApp) para exibição compacta.
 * Retorna `LID·1234` mostrando os últimos 4 dígitos.
 */
export function formatLid(lid: string | null | undefined): string {
  if (!lid) return ''
  const digits = String(lid).replace(/\D/g, '')
  return digits ? `LID·${digits.slice(-4)}` : ''
}

/**
 * Tipo do telefone do contato — espelha o enum `PhoneType` do backend.
 */
export type PhoneType = 'PN' | 'LID' | 'UNKNOWN'

/**
 * Decide o que mostrar como "telefone" do contato:
 *   - PN com phone:    formatPhone(phone)
 *   - LID:             formatLid(lid)  → "LID·1234"
 *   - Sem nada:        ''
 */
export function displayPhone(contact: { phone?: string | null; lid?: string | null; phoneType?: PhoneType | null }): string {
  if (contact.phoneType === 'LID' || (!contact.phone && contact.lid)) {
    return formatLid(contact.lid)
  }
  return contact.phone ? formatPhone(contact.phone) : ''
}

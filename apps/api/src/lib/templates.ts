/**
 * Interpolação de templates pra mensagens automáticas (welcome, closing, etc.)
 *
 * Variáveis suportadas (case-insensitive nas chaves):
 *   {cliente}    — nome do contato
 *   {atendente}  — nome do user atribuído (vazio se ninguém)
 *   {canal}      — label do canal (ex: "WhatsApp Comercial")
 *   {empresa}    — nome da empresa vinculada ao contato (vazio se não tiver)
 *   {data}       — DD/MM/YYYY (timezone de São Paulo)
 *   {hora}       — HH:MM
 *   {protocolo}  — últimos 6 chars do conversation.id em MAIÚSCULAS (ex: "X4F2A1")
 *
 * Uso:
 *   interpolateMessage("Olá {cliente}, sou {atendente}", { cliente: 'Bruno', atendente: 'Rafael' })
 *   → "Olá Bruno, sou Rafael"
 *
 * Variáveis não fornecidas viram string vazia (não aparece "{cliente}" literal pro user final).
 * Resiliente a templates curtos, vazios ou null.
 */

export interface TemplateContext {
  cliente?: string | null
  atendente?: string | null
  canal?: string | null
  empresa?: string | null
  protocolo?: string | null
  /** Override pra testes — quando omitido usa Date.now() em America/Sao_Paulo */
  now?: Date
}

const TZ = 'America/Sao_Paulo'

function formatDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' })
}
function formatTime(d: Date): string {
  return d.toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
}

/** Extrai protocolo dos últimos 6 chars do id (maiúsculas). */
export function shortProtocol(conversationId: string): string {
  return conversationId.slice(-6).toUpperCase()
}

export function interpolateMessage(template: string | null | undefined, ctx: TemplateContext): string {
  if (!template) return ''
  const now = ctx.now ?? new Date()
  const values: Record<string, string> = {
    cliente:   (ctx.cliente   ?? '').trim(),
    atendente: (ctx.atendente ?? '').trim(),
    canal:     (ctx.canal     ?? '').trim(),
    empresa:   (ctx.empresa   ?? '').trim(),
    protocolo: (ctx.protocolo ?? '').trim(),
    data:      formatDate(now),
    hora:      formatTime(now),
  }
  return template.replace(/\{(\w+)\}/g, (full, key: string) => {
    const lowerKey = key.toLowerCase()
    return values[lowerKey] ?? full   // mantém literal se a chave for desconhecida (ajuda a debugar)
  })
}

/** Lista de variáveis pra UI mostrar como ajuda. */
export const AVAILABLE_TEMPLATE_VARIABLES: Array<{ key: string; label: string; example: string }> = [
  { key: '{cliente}',   label: 'Nome do contato',           example: 'Bruno Silva' },
  { key: '{atendente}', label: 'Nome do atendente',         example: 'Rafael Ferreira' },
  { key: '{canal}',     label: 'Nome do canal',             example: 'WhatsApp Comercial' },
  { key: '{empresa}',   label: 'Empresa do contato',        example: 'Positiva' },
  { key: '{data}',      label: 'Data atual (DD/MM/YYYY)',   example: '20/05/2026' },
  { key: '{hora}',      label: 'Hora atual (HH:MM)',        example: '14:35' },
  { key: '{protocolo}', label: 'Protocolo da conversa',     example: 'X4F2A1' },
]

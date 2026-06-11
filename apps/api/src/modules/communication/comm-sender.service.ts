import { getChannelConfig, getSmtpConfig, getMetaConfig } from '../channels/channels.service.js'
import { getClientForChannel } from '../evolution-servers/evolution-servers.service.js'
import { makeMetaClient } from '../channels/meta.client.js'
import { sendEmail, type EmailAttachment } from '../channels/email.client.js'
import { readAttachment, attachmentAbsolutePath } from './comm-attachments.service.js'
import type { ResolvedChannel } from './comm-channel.resolver.js'

export interface OutboundAttachment {
  filename: string
  mimeType: string
  storageKey: string
}

export interface SendInput {
  to: string
  subject?: string | null
  body: string
  attachments: OutboundAttachment[]
}

export interface SendResult {
  externalId?: string
}

/** image | video | audio | document a partir do mime-type. */
function mediaTypeFromMime(mime: string): 'image' | 'video' | 'audio' | 'document' {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'document'
}

/** Normaliza destinatário WhatsApp: aceita número cru ou jid completo. */
function waRecipient(to: string): string {
  return to.includes('@') ? to : to.replace(/\D/g, '')
}

/** Detecta se o conteúdo já é HTML (campanhas/mensagens de e-mail usam editor rico). */
function looksLikeHtml(s: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(s)
}

/** Fallback de texto puro a partir de HTML (para o multipart `text` do e-mail). */
function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Envia uma mensagem através do canal físico já resolvido, reusando os clientes
 * existentes (Evolution / Meta / SMTP). Lança em caso de falha — o worker trata
 * retry/backoff e logging.
 */
export async function sendThroughChannel(channel: ResolvedChannel, input: SendInput): Promise<SendResult> {
  switch (channel.type) {
    case 'WHATSAPP': {
      const { instanceName } = await getChannelConfig(channel.id)
      const client = await getClientForChannel(channel.id)
      const to = waRecipient(input.to)

      if (input.attachments.length === 0) {
        const res = await client.sendText(instanceName, to, input.body)
        return { externalId: res.key?.id }
      }

      // Com anexos: 1ª mídia carrega o texto como caption; demais vão em sequência.
      let lastId: string | undefined
      for (let i = 0; i < input.attachments.length; i++) {
        const att = input.attachments[i]
        const buffer = await readAttachment(att.storageKey)
        const caption = i === 0 ? input.body : ''
        const res = await client.sendMedia(
          instanceName,
          to,
          mediaTypeFromMime(att.mimeType),
          att.mimeType,
          caption,
          buffer.toString('base64'),
          att.filename,
        )
        lastId = res.key?.id
      }
      return { externalId: lastId }
    }

    case 'META_WHATSAPP': {
      const credentials = await getMetaConfig(channel.id)
      const client = makeMetaClient(credentials)
      const to = input.to.replace('@s.whatsapp.net', '').replace(/\D/g, '')
      // MVP: Meta envia texto. Anexos via Meta exigem upload de mídia (fase futura).
      const res = await client.sendWhatsAppText(to, input.body)
      return { externalId: res.messages?.[0]?.id }
    }

    case 'IMAP_SMTP':
    case 'GMAIL': {
      const cfg = await getSmtpConfig(channel.id)
      const emailAtts: EmailAttachment[] = input.attachments.map((a) => ({
        filename: a.filename,
        path: attachmentAbsolutePath(a.storageKey),
        contentType: a.mimeType,
      }))
      // E-mail: conteúdo rico vai como HTML, com fallback de texto puro.
      const isHtml = looksLikeHtml(input.body)
      const html = isHtml ? input.body : undefined
      const text = isHtml ? htmlToText(input.body) : input.body
      const messageId = await sendEmail(
        cfg,
        input.to,
        input.subject?.trim() || '(sem assunto)',
        text,
        html,
        undefined,
        emailAtts,
      )
      return { externalId: messageId }
    }

    default:
      throw new Error(`Tipo de canal não suportado para envio: ${channel.type}`)
  }
}

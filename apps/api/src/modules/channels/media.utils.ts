export type MediaType = 'image' | 'audio' | 'video' | 'document' | 'sticker'

export interface MediaAttachment {
  type: MediaType
  mimetype: string
  caption?: string
  filename?: string
  seconds?: number
  key: { id: string; remoteJid: string; fromMe: boolean }
}

export function extractMediaInfo(msg: any): MediaAttachment | null {
  const key = { id: msg.key?.id ?? '', remoteJid: msg.key?.remoteJid ?? '', fromMe: msg.key?.fromMe ?? false }

  if (msg?.message?.imageMessage) {
    return { type: 'image', mimetype: msg.message.imageMessage.mimetype ?? 'image/jpeg', caption: msg.message.imageMessage.caption, key }
  }
  if (msg?.message?.videoMessage) {
    return { type: 'video', mimetype: msg.message.videoMessage.mimetype ?? 'video/mp4', caption: msg.message.videoMessage.caption, seconds: msg.message.videoMessage.seconds, key }
  }
  if (msg?.message?.audioMessage) {
    return { type: 'audio', mimetype: msg.message.audioMessage.mimetype ?? 'audio/ogg; codecs=opus', seconds: msg.message.audioMessage.seconds, key }
  }
  if (msg?.message?.documentMessage) {
    return { type: 'document', mimetype: msg.message.documentMessage.mimetype ?? 'application/octet-stream', filename: msg.message.documentMessage.fileName, caption: msg.message.documentMessage.caption, key }
  }
  if (msg?.message?.documentWithCaptionMessage) {
    const doc = msg.message.documentWithCaptionMessage?.message?.documentMessage
    return { type: 'document', mimetype: doc?.mimetype ?? 'application/octet-stream', filename: doc?.fileName, caption: doc?.caption, key }
  }
  if (msg?.message?.stickerMessage) {
    return { type: 'sticker', mimetype: msg.message.stickerMessage.mimetype ?? 'image/webp', key }
  }

  return null
}

export function extractText(msg: any): string {
  return (
    msg?.message?.conversation ??
    msg?.message?.extendedTextMessage?.text ??
    msg?.message?.imageMessage?.caption ??
    msg?.message?.videoMessage?.caption ??
    msg?.message?.documentMessage?.caption ??
    msg?.message?.documentWithCaptionMessage?.message?.documentMessage?.caption ??
    null
  )
}

export function mediaTypeLabel(type: MediaType): string {
  const labels: Record<MediaType, string> = {
    image: '[imagem]',
    audio: '[áudio]',
    video: '[vídeo]',
    document: '[documento]',
    sticker: '[figurinha]',
  }
  return labels[type]
}

/**
 * Detecta "meta-mensagens" do WhatsApp que não são conteúdo de conversa:
 *   • reactionMessage    — emoji reagindo a outra msg
 *   • pollUpdateMessage  — voto em enquete (a enquete em si é outra msg)
 *   • protocolMessage    — sinais internos (delete, ephemeral, etc.)
 *   • senderKeyDistributionMessage — distribuição de chaves de grupo
 *
 * Devem ser ignoradas no ingest pra não poluírem o thread como "[mídia]".
 * Eventualmente podem ser usadas pra atualizar a msg original (não escopo agora).
 */
export function isMetaMessage(msg: any): { kind: string; reactionEmoji?: string; reactionTo?: string } | null {
  const m = msg?.message
  if (!m) return null
  if (m.reactionMessage) {
    return {
      kind: 'reaction',
      reactionEmoji: m.reactionMessage.text ?? undefined,
      reactionTo: m.reactionMessage.key?.id ?? undefined,
    }
  }
  if (m.pollUpdateMessage) return { kind: 'pollUpdate' }
  if (m.protocolMessage) return { kind: 'protocol' }
  if (m.senderKeyDistributionMessage && Object.keys(m).length === 1) return { kind: 'senderKey' }
  return null
}

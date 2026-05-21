import { env } from '../../config/env.js'

const BASE = env.EVOLUTION_SERVER_URL ?? ''
const KEY = env.EVOLUTION_API_KEY ?? ''

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', apikey: KEY },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Evolution API ${method} ${path} → ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export interface EvolutionInstance {
  instance: {
    instanceName: string
    instanceId: string
    status: string
    owner?: string
    profileName?: string
    profilePictureUrl?: string
  }
  qrcode?: { base64?: string; code?: string }
}

export interface EvolutionMessage {
  key: { remoteJid: string; fromMe: boolean; id: string; participant?: string }
  message?: { conversation?: string; extendedTextMessage?: { text: string }; imageMessage?: { caption?: string }; documentMessage?: { title?: string } }
  messageTimestamp: number
  pushName?: string
  messageType: string
}

export const evolutionClient = {
  createInstance(instanceName: string, webhookUrl: string) {
    return req<EvolutionInstance>('POST', '/instance/create', {
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
      webhook: {
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: [
          'MESSAGES_UPSERT',
          'MESSAGES_UPDATE',
          'CONNECTION_UPDATE',
          'QRCODE_UPDATED',
          'PRESENCE_UPDATE',
          'CONTACTS_UPSERT',
          'CONTACTS_UPDATE',
        ],
      },
      websocket: {
        enabled: true,
        events: [
          'MESSAGES_UPSERT',
          'MESSAGES_UPDATE',
          'CONNECTION_UPDATE',
          'PRESENCE_UPDATE',
          'CONTACTS_UPSERT',
          'CONTACTS_UPDATE',
        ],
      },
    })
  },

  updateInstanceWebhook(instanceName: string, webhookUrl: string) {
    return req<unknown>('PUT', `/webhook/set/${instanceName}`, {
      url: webhookUrl,
      byEvents: false,
      base64: false,
      enabled: true,
      events: [
        'MESSAGES_UPSERT',
        'MESSAGES_UPDATE',
        'CONNECTION_UPDATE',
        'QRCODE_UPDATED',
        'PRESENCE_UPDATE',
        'CONTACTS_UPSERT',
        'CONTACTS_UPDATE',
      ],
    })
  },

  updateInstanceWebsocket(instanceName: string) {
    return req<unknown>('PUT', `/websocket/set/${instanceName}`, {
      enabled: true,
      events: [
        'MESSAGES_UPSERT',
        'MESSAGES_UPDATE',
        'CONNECTION_UPDATE',
        'PRESENCE_UPDATE',
        'CONTACTS_UPSERT',
        'CONTACTS_UPDATE',
      ],
    })
  },

  fetchInstances() {
    return req<EvolutionInstance[]>('GET', '/instance/fetchInstances')
  },

  getInstance(instanceName: string) {
    return req<EvolutionInstance>('GET', `/instance/fetchInstances?instanceName=${instanceName}`)
  },

  connectInstance(instanceName: string) {
    return req<{ base64?: string; code?: string }>('GET', `/instance/connect/${instanceName}`)
  },

  deleteInstance(instanceName: string) {
    return req<void>('DELETE', `/instance/delete/${instanceName}`)
  },

  logoutInstance(instanceName: string) {
    return req<void>('DELETE', `/instance/logout/${instanceName}`)
  },

  sendText(instanceName: string, to: string, text: string, quoted?: { id: string; remoteJid: string; fromMe: boolean; body: string }) {
    return req<{ key: { id: string } }>('POST', `/message/sendText/${instanceName}`, {
      number: to,
      text,
      ...(quoted && {
        quoted: {
          key: { remoteJid: quoted.remoteJid, fromMe: quoted.fromMe, id: quoted.id },
          message: { conversation: quoted.body },
        },
      }),
    })
  },

  getMessages(instanceName: string, remoteJid: string, limit = 50) {
    return req<{ messages: { records: EvolutionMessage[] } }>('POST', `/chat/findMessages/${instanceName}`, {
      where: { key: { remoteJid } },
      limit,
    })
  },

  getMediaBase64(instanceName: string, messageKey: { id: string; remoteJid: string; fromMe: boolean }) {
    return req<{ base64: string; mimetype: string }>('POST', `/chat/getBase64FromMediaMessage/${instanceName}`, {
      message: { key: messageKey },
    })
  },

  sendMedia(instanceName: string, to: string, mediatype: string, mimetype: string, caption: string, base64: string, filename?: string) {
    return req<{ key: { id: string } }>('POST', `/message/sendMedia/${instanceName}`, {
      number: to,
      mediatype,
      mimetype,
      caption,
      media: base64,
      ...(filename && { fileName: filename }),
    })
  },

  fetchProfilePicture(instanceName: string, number: string) {
    return req<{ wuid: string; profilePictureUrl: string | null }>(
      'POST',
      `/chat/fetchProfilePictureUrl/${instanceName}`,
      { number },
    )
  },

  /**
   * Envia confirmação de leitura para mensagens recebidas.
   * Isso faz o "✓✓ azul" aparecer no celular do remetente.
   */
  markMessageAsRead(instanceName: string, remoteJid: string, messageIds: string[]) {
    return req<unknown>('POST', `/chat/markMessageAsRead/${instanceName}`, {
      readMessages: messageIds.map((id) => ({
        id,
        fromMe: false,
        remoteJid,
      })),
    })
  },

  /**
   * Busca metadados de um grupo WhatsApp (nome, descrição, participantes).
   * Retorna null se o grupo não for encontrado ou a instância não tiver acesso.
   */
  async fetchGroupInfo(instanceName: string, groupJid: string) {
    try {
      const result = await req<{ id: string; subject?: string; subjectOwner?: string; subjectTime?: number; desc?: string } | null>(
        'GET',
        `/group/findGroupInfos/${instanceName}?groupJid=${encodeURIComponent(groupJid)}`,
      )
      return result ?? null
    } catch {
      return null
    }
  },

  /**
   * Inscreve na presença de um contato/grupo.
   * Necessário para receber eventos presence.update via Socket.IO.
   * Deve ser chamado sempre que uma conversa é aberta.
   */
  subscribePresence(instanceName: string, remoteJid: string) {
    return req<unknown>('POST', `/chat/subscribePresence/${instanceName}`, {
      number: remoteJid,
    })
  },

  /**
   * Envia estado de digitação/gravação para o contato.
   * presence: 'composing' (digitando) | 'recording' (gravando) | 'paused' (parou)
   */
  sendPresence(instanceName: string, remoteJid: string, presence: 'composing' | 'recording' | 'paused') {
    return req<unknown>('POST', `/chat/sendPresence/${instanceName}`, {
      number: remoteJid,
      options: { presence, delay: 1200 },
    })
  },
}

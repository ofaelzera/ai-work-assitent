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
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
      },
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

  sendText(instanceName: string, to: string, text: string) {
    return req<{ key: { id: string } }>('POST', `/message/sendText/${instanceName}`, {
      number: to,
      text,
    })
  },

  getMessages(instanceName: string, remoteJid: string, limit = 50) {
    return req<{ messages: { records: EvolutionMessage[] } }>('POST', `/chat/findMessages/${instanceName}`, {
      where: { key: { remoteJid } },
      limit,
    })
  },
}

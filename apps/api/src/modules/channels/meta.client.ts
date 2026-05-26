import axios from 'axios'
import { logger } from '../../lib/logger.js'

export interface MetaCredentials {
  systemUserToken: string
  phoneNumberId?: string
  pageId?: string
  appId?: string
}

export class MetaClient {
  private api = axios.create({
    baseURL: 'https://graph.facebook.com/v19.0',
    headers: {
      Authorization: `Bearer ${this.credentials.systemUserToken}`,
      'Content-Type': 'application/json',
    },
  })

  constructor(private credentials: MetaCredentials) {}

  /**
   * Envia uma mensagem de texto via WhatsApp Oficial
   */
  async sendWhatsAppText(to: string, text: string) {
    if (!this.credentials.phoneNumberId) {
      throw new Error('Phone Number ID não configurado para envio de WhatsApp')
    }

    try {
      const response = await this.api.post(`/${this.credentials.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: text },
      })
      return response.data
    } catch (error: any) {
      logger.error({ error: error?.response?.data || error }, 'Erro ao enviar mensagem Meta WhatsApp')
      throw error
    }
  }

  /**
   * Marca uma mensagem como lida
   */
  async markAsRead(messageId: string) {
    if (!this.credentials.phoneNumberId) return

    try {
      await this.api.post(`/${this.credentials.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      })
    } catch (error: any) {
      logger.warn({ error: error?.response?.data || error }, 'Erro ao marcar mensagem como lida na Meta')
    }
  }

  /**
   * Baixa mídia do WhatsApp Oficial
   */
  async downloadMedia(mediaId: string): Promise<Buffer> {
    try {
      const { data } = await this.api.get(`/${mediaId}`)
      if (!data.url) throw new Error('URL da mídia não encontrada')

      const response = await axios.get(data.url, {
        headers: {
          Authorization: `Bearer ${this.credentials.systemUserToken}`,
        },
        responseType: 'arraybuffer',
      })
      return Buffer.from(response.data)
    } catch (error: any) {
      logger.error({ error: error?.response?.data || error }, 'Erro ao baixar mídia da Meta')
      throw error
    }
  }

  /**
   * Faz upload de uma mídia para os servidores da Meta e retorna o media_id
   */
  async uploadMedia(buffer: Buffer, mimetype: string, filename?: string): Promise<string> {
    if (!this.credentials.phoneNumberId) throw new Error('Phone Number ID não configurado')

    const form = new FormData()
    form.append('messaging_product', 'whatsapp')
    form.append('file', new Blob([buffer], { type: mimetype }), filename || 'file')

    try {
      const response = await this.api.post(`/${this.credentials.phoneNumberId}/media`, form, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })
      return response.data.id
    } catch (error: any) {
      logger.error({ error: error?.response?.data || error }, 'Erro no upload de mídia Meta')
      throw error
    }
  }

  /**
   * Envia uma mídia via WhatsApp
   */
  async sendWhatsAppMedia(to: string, type: 'image' | 'video' | 'audio' | 'document', mediaId: string, caption?: string, filename?: string) {
    if (!this.credentials.phoneNumberId) throw new Error('Phone Number ID não configurado')

    const payload: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type,
    }

    payload[type] = { id: mediaId }
    if (caption && type !== 'audio') payload[type].caption = caption
    if (filename && type === 'document') payload[type].filename = filename

    try {
      const response = await this.api.post(`/${this.credentials.phoneNumberId}/messages`, payload)
      return response.data
    } catch (error: any) {
      logger.error({ error: error?.response?.data || error }, 'Erro ao enviar mídia Meta WhatsApp')
      throw error
    }
  }
}

export function makeMetaClient(credentials: MetaCredentials) {
  return new MetaClient(credentials)
}

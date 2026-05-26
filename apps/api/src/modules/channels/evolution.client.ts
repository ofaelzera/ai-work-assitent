import { env } from '../../config/env.js'

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

export type EvolutionClient = ReturnType<typeof makeEvolutionClient>

export function makeEvolutionClient(baseUrl: string, apiKey: string) {
  async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Evolution API ${method} ${path} → ${res.status}: ${text}`)
    }
    return res.json() as Promise<T>
  }

  return {
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
      // Evolution v2 espera POST com payload `{ webhook: {...} }` (PUT foi removido)
      return req<unknown>('POST', `/webhook/set/${instanceName}`, {
        webhook: {
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
        },
      })
    },

    updateInstanceWebsocket(instanceName: string) {
      return req<unknown>('POST', `/websocket/set/${instanceName}`, {
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

    markMessageAsRead(instanceName: string, remoteJid: string, messageIds: string[]) {
      return req<unknown>('POST', `/chat/markMessageAsRead/${instanceName}`, {
        readMessages: messageIds.map((id) => ({
          id,
          fromMe: false,
          remoteJid,
        })),
      })
    },

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

    subscribePresence(instanceName: string, remoteJid: string) {
      return req<unknown>('POST', `/chat/subscribePresence/${instanceName}`, {
        number: remoteJid,
      })
    },

    sendPresence(instanceName: string, remoteJid: string, presence: 'composing' | 'recording' | 'paused') {
      return req<unknown>('POST', `/chat/sendPresence/${instanceName}`, {
        number: remoteJid,
        options: { presence, delay: 1200 },
      })
    },

    findChats(instanceName: string) {
      return req<any[]>('POST', `/chat/findChats/${instanceName}`, {})
    },

    // ── Group Controller ────────────────────────────────────────────────────
    /** Lista participantes de um grupo. */
    findGroupMembers(instanceName: string, groupJid: string) {
      return req<{ participants: Array<{ id: string; admin?: 'admin' | 'superadmin' | null }> }>(
        'GET',
        `/group/participants/${instanceName}?groupJid=${encodeURIComponent(groupJid)}`,
      )
    },

    /** Lista todos os grupos da instância. */
    fetchAllGroups(instanceName: string, getParticipants = false) {
      return req<any[]>(
        'GET',
        `/group/fetchAllGroups/${instanceName}?getParticipants=${getParticipants}`,
      )
    },

    /** Atualiza o nome (subject) do grupo. */
    updateGroupSubject(instanceName: string, groupJid: string, subject: string) {
      return req<unknown>('POST', `/group/updateGroupSubject/${instanceName}?groupJid=${encodeURIComponent(groupJid)}`, {
        subject,
      })
    },

    /** Atualiza a descrição do grupo. */
    updateGroupDescription(instanceName: string, groupJid: string, description: string) {
      return req<unknown>('POST', `/group/updateGroupDescription/${instanceName}?groupJid=${encodeURIComponent(groupJid)}`, {
        description,
      })
    },

    /** Atualiza a foto do grupo. `image` aceita URL ou data:image/...;base64,... */
    updateGroupPicture(instanceName: string, groupJid: string, image: string) {
      return req<unknown>('POST', `/group/updateGroupPicture/${instanceName}?groupJid=${encodeURIComponent(groupJid)}`, {
        image,
      })
    },

    /**
     * Atualiza membros do grupo.
     * action: 'add' | 'remove' | 'promote' | 'demote'
     * participants: array de números (com DDI, ex: 5511999999999)
     */
    updateGroupMembers(
      instanceName: string,
      groupJid: string,
      action: 'add' | 'remove' | 'promote' | 'demote',
      participants: string[],
    ) {
      return req<unknown>('POST', `/group/updateParticipant/${instanceName}?groupJid=${encodeURIComponent(groupJid)}`, {
        action,
        participants,
      })
    },

    /** Atualiza configuração do grupo (quem pode enviar, quem pode editar info, etc). */
    updateGroupSetting(
      instanceName: string,
      groupJid: string,
      action: 'announcement' | 'not_announcement' | 'locked' | 'unlocked',
    ) {
      return req<unknown>('POST', `/group/updateSetting/${instanceName}?groupJid=${encodeURIComponent(groupJid)}`, {
        action,
      })
    },

    /** Liga/desliga mensagens temporárias. `expiration` em segundos (0=off). */
    toggleEphemeral(instanceName: string, groupJid: string, expiration: 0 | 86400 | 604800 | 7776000) {
      return req<unknown>('POST', `/group/toggleEphemeral/${instanceName}?groupJid=${encodeURIComponent(groupJid)}`, {
        expiration,
      })
    },

    /** Sai do grupo. */
    leaveGroup(instanceName: string, groupJid: string) {
      return req<unknown>('DELETE', `/group/leaveGroup/${instanceName}?groupJid=${encodeURIComponent(groupJid)}`)
    },

    /** Cria um novo grupo. */
    createGroup(instanceName: string, subject: string, participants: string[], description?: string) {
      return req<{ id: string }>('POST', `/group/create/${instanceName}`, {
        subject,
        participants,
        ...(description && { description }),
      })
    },

    /** Pega o código de convite atual do grupo. */
    fetchInviteCode(instanceName: string, groupJid: string) {
      return req<{ inviteUrl: string; inviteCode: string }>(
        'GET',
        `/group/inviteCode/${instanceName}?groupJid=${encodeURIComponent(groupJid)}`,
      )
    },

    /** Revoga e gera novo código de convite. */
    revokeInviteCode(instanceName: string, groupJid: string) {
      return req<{ inviteUrl: string; inviteCode: string }>(
        'POST',
        `/group/revokeInviteCode/${instanceName}?groupJid=${encodeURIComponent(groupJid)}`,
        {},
      )
    },

    /** Envia link de convite do grupo para uma lista de números. */
    sendGroupInvite(instanceName: string, groupJid: string, description: string, numbers: string[]) {
      return req<unknown>('POST', `/group/sendInvite/${instanceName}`, {
        groupJid,
        description,
        numbers,
      })
    },

    /** Busca metadados de um grupo a partir do código de convite. */
    findGroupByInviteCode(instanceName: string, inviteCode: string) {
      return req<any>(
        'GET',
        `/group/inviteInfo/${instanceName}?inviteCode=${encodeURIComponent(inviteCode)}`,
      )
    },

    // ── Instances ───────────────────────────────────────────────────────────
    restartInstance(instanceName: string) {
      return req<void>('PUT', `/instance/restart/${instanceName}`)
    },

    // ── Chat Controller ─────────────────────────────────────────────────────
    /** Verifica se os números têm WhatsApp ativo. */
    checkIsWhatsApp(instanceName: string, numbers: string[]) {
      return req<Array<{ exists: boolean; jid: string; number: string }>>(
        'POST',
        `/chat/whatsappNumbers/${instanceName}`,
        { numbers },
      )
    },

    /** Envia reação a uma mensagem. reaction="" remove a reação. */
    sendReaction(instanceName: string, remoteJid: string, messageId: string, reaction: string) {
      return req<unknown>('POST', `/message/sendReaction/${instanceName}`, {
        key: { remoteJid, fromMe: false, id: messageId },
        reaction,
      })
    },

    /** Deleta mensagem para todos. */
    deleteMessage(instanceName: string, remoteJid: string, messageId: string, fromMe: boolean) {
      return req<unknown>('DELETE', `/chat/deleteMessageForEveryone/${instanceName}`, {
        id: messageId,
        fromMe,
        remoteJid,
      })
    },

    // ── Profile Settings ────────────────────────────────────────────────────
    updateProfileName(instanceName: string, name: string) {
      return req<unknown>('POST', `/profile/updateProfileName/${instanceName}`, { name })
    },

    updateProfileStatus(instanceName: string, status: string) {
      return req<unknown>('POST', `/profile/updateProfileStatus/${instanceName}`, { status })
    },

    updateProfilePicture(instanceName: string, picture: string) {
      return req<unknown>('PUT', `/profile/updateProfilePicture/${instanceName}`, { picture })
    },

    removeProfilePicture(instanceName: string) {
      return req<unknown>('DELETE', `/profile/removeProfilePicture/${instanceName}`)
    },

    fetchProfile(instanceName: string, number?: string) {
      return req<{ name?: string; status?: string; profilePictureUrl?: string; isBusiness?: boolean }>(
        'POST', `/profile/fetchProfile/${instanceName}`,
        number ? { number } : {},
      )
    },

    fetchBusinessProfile(instanceName: string, number?: string) {
      return req<unknown>('POST', `/profile/fetchBusinessProfile/${instanceName}`, number ? { number } : {})
    },

    fetchPrivacySettings(instanceName: string) {
      return req<{
        readreceipts?: string; profile?: string; status?: string
        online?: string; last?: string; groupadd?: string
      }>('GET', `/profile/fetchPrivacySettings/${instanceName}`)
    },

    updatePrivacySettings(instanceName: string, settings: {
      readreceipts?: string; profile?: string; status?: string
      online?: string; last?: string; groupadd?: string
    }) {
      return req<unknown>('PUT', `/profile/updatePrivacySettings/${instanceName}`, settings)
    },

    // ── Instance ──────────────────────────────────────────────────────────────
    setPresence(instanceName: string, presence: 'available' | 'unavailable') {
      return req<unknown>('POST', `/instance/setPresence/${instanceName}`, { presence })
    },

    // ── Send Message (extra types) ────────────────────────────────────────────
    sendLocation(instanceName: string, remoteJid: string, lat: number, lng: number, name?: string, address?: string) {
      return req<{ key?: { id: string } }>('POST', `/message/sendLocation/${instanceName}`, {
        number: remoteJid,
        latitude: lat,
        longitude: lng,
        name: name ?? '',
        address: address ?? '',
      })
    },

    sendContact(instanceName: string, remoteJid: string, contacts: Array<{
      fullName: string; waid: string; phoneNumber: string; organization?: string
    }>) {
      return req<{ key?: { id: string } }>('POST', `/message/sendContact/${instanceName}`, {
        number: remoteJid,
        contact: contacts.map(c => ({
          fullName: c.fullName,
          wuid: c.waid,
          phoneNumber: c.phoneNumber,
          organization: c.organization ?? '',
        })),
      })
    },

    sendPoll(instanceName: string, remoteJid: string, name: string, values: string[], selectableCount = 1) {
      return req<{ key?: { id: string } }>('POST', `/message/sendPoll/${instanceName}`, {
        number: remoteJid,
        pollMessage: { name, selectableCount, values },
      })
    },

    sendList(instanceName: string, remoteJid: string, payload: {
      title: string; description: string; footerText?: string; buttonText: string
      sections: Array<{ title: string; rows: Array<{ title: string; description?: string; rowId: string }> }>
    }) {
      return req<{ key?: { id: string } }>('POST', `/message/sendList/${instanceName}`, {
        number: remoteJid,
        listMessage: payload,
      })
    },

    sendButtons(instanceName: string, remoteJid: string, payload: {
      title?: string; description: string; footer?: string
      buttons: Array<{ type: 'reply'; displayText: string; id: string }>
    }) {
      return req<{ key?: { id: string } }>('POST', `/message/sendButtons/${instanceName}`, {
        number: remoteJid,
        buttonsMessage: payload,
      })
    },

    // ── Chat Controller (extras) ──────────────────────────────────────────────
    updateMessage(instanceName: string, remoteJid: string, messageId: string, text: string) {
      return req<unknown>('POST', `/chat/updateMessage/${instanceName}`, {
        number: remoteJid,
        key: { id: messageId, remoteJid, fromMe: true },
        text,
      })
    },

    updateBlockStatus(instanceName: string, number: string, status: 'block' | 'unblock') {
      return req<unknown>('PUT', `/chat/updateBlockStatus/${instanceName}`, { number, status })
    },

    markMessageAsUnread(instanceName: string, remoteJid: string, messageId: string, fromMe: boolean) {
      return req<unknown>('PUT', `/chat/markMessageAsUnread/${instanceName}`, {
        readMessages: [{ id: messageId, remoteJid, fromMe }],
      })
    },

    archiveChat(instanceName: string, remoteJid: string, archive: boolean) {
      return req<unknown>('PUT', `/chat/archiveChat/${instanceName}`, {
        chat: remoteJid,
        archive,
      })
    },

    findContacts(instanceName: string, where?: { id?: string; pushName?: string }) {
      return req<Array<{ id: string; pushName?: string; profilePictureUrl?: string }>>(
        'POST', `/chat/findContacts/${instanceName}`,
        { where: where ?? {} },
      )
    },
  }
}

// Fallback legado: client usando env vars (retrocompatibilidade)
export const evolutionClient = makeEvolutionClient(
  env.EVOLUTION_SERVER_URL ?? '',
  env.EVOLUTION_API_KEY ?? '',
)

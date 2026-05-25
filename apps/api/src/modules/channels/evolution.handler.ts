/**
 * evolution.handler.ts
 *
 * Lógica de processamento de eventos da Evolution API.
 * Chamado tanto pelo webhook HTTP quanto pelo cliente Socket.IO,
 * garantindo que localhost e produção usem exatamente o mesmo código.
 */
import { Queue } from 'bullmq'
import { redis } from '../../lib/redis.js'
import { prisma } from '../../lib/prisma.js'
import { logger } from '../../lib/logger.js'
import { decryptJson } from '../../lib/crypto.js'
import { eventBus } from '../../lib/eventBus.js'
import { parseJid } from '../../lib/phone.js'
import { mergeContacts } from '../contacts/merge.service.js'

export const ingestQueue = new Queue('ingestWhatsapp', { connection: redis })

// ─── Aprender JIDs do dono do canal (a partir de mensagens fromMe) ──────────
// Cache para não bater no banco a cada msg fromMe
const ownerLearnedCache = new Map<string, { phone?: string; lid?: string }>()

async function learnChannelOwner(channelId: string, primaryJid?: string, altJid?: string): Promise<void> {
  const parsed1 = primaryJid ? parseJid(primaryJid) : null
  const parsed2 = altJid ? parseJid(altJid) : null

  // Extrai o melhor PN e LID que conseguir
  const phone = parsed1?.kind === 'pn' ? parsed1.phone
    : parsed2?.kind === 'pn' ? parsed2.phone
    : undefined
  const lid = parsed1?.kind === 'lid' ? parsed1.lid
    : parsed2?.kind === 'lid' ? parsed2.lid
    : undefined

  if (!phone && !lid) return

  // Já aprendeu? Pula
  const cached = ownerLearnedCache.get(channelId)
  if (cached && cached.phone === phone && cached.lid === lid) return

  // Lê settings atual e atualiza só se houver mudança
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { settings: true } })
  const current = (channel?.settings as Record<string, unknown> | null) ?? {}
  const newOwner = {
    ...(typeof current.ownerPhone === 'string' ? { ownerPhone: current.ownerPhone } : {}),
    ...(typeof current.ownerLid === 'string' ? { ownerLid: current.ownerLid } : {}),
  } as { ownerPhone?: string; ownerLid?: string }
  let changed = false
  if (phone && newOwner.ownerPhone !== phone) { newOwner.ownerPhone = phone; changed = true }
  if (lid && newOwner.ownerLid !== lid) { newOwner.ownerLid = lid; changed = true }

  if (changed) {
    await prisma.channel.update({
      where: { id: channelId },
      data: { settings: { ...current, ...newOwner } },
    })
    logger.info({ channelId, ...newOwner }, 'Dono do canal descoberto')
  }
  ownerLearnedCache.set(channelId, { phone, lid })
}

// ─── Resolver channelId/workspaceId a partir do instanceName ─────────────────
// Cache simples em memória para evitar bater no banco a cada evento.
const instanceCache = new Map<string, { channelId: string; workspaceId: string }>()

export async function resolveInstance(
  instanceName: string,
): Promise<{ channelId: string; workspaceId: string } | null> {
  if (instanceCache.has(instanceName)) return instanceCache.get(instanceName)!

  const channels = await prisma.channel.findMany({
    where: { type: 'WHATSAPP', deletedAt: null },
  })

  for (const ch of channels) {
    try {
      const cfg = ch.config as { ciphertext: string; iv: string; authTag: string }
      const decrypted = decryptJson<{ instanceName: string }>(
        Buffer.from(cfg.ciphertext, 'base64'),
        Buffer.from(cfg.iv, 'base64'),
        Buffer.from(cfg.authTag, 'base64'),
      )
      if (decrypted.instanceName === instanceName) {
        const entry = { channelId: ch.id, workspaceId: ch.workspaceId }
        instanceCache.set(instanceName, entry)
        // TTL de 5 min para o cache
        setTimeout(() => instanceCache.delete(instanceName), 5 * 60 * 1000)
        return entry
      }
    } catch {
      // canal com config inválido — ignorar
    }
  }

  logger.warn({ instanceName }, 'Evento de instância não mapeada')
  return null
}

// ─── Handler principal ────────────────────────────────────────────────────────
/**
 * Processa um evento no formato padrão da Evolution API.
 * O payload é idêntico ao body do webhook POST.
 */
export async function handleEvolutionEvent(body: unknown): Promise<void> {
  const b = body as Record<string, unknown>
  const event = b?.event as string | undefined
  if (!event) return

  // ── messages.upsert ─────────────────────────────────────────────────────────
  if (event === 'messages.upsert') {
    const instanceName = b.instance as string
    if (!instanceName) return

    const resolved = await resolveInstance(instanceName)
    if (!resolved) return

    const { channelId, workspaceId } = resolved
    const messages = Array.isArray(b.data) ? b.data : [b.data]

    for (const msg of messages as Record<string, unknown>[]) {
      if (!(msg?.key as any)?.id) continue
      if ((msg?.key as any)?.fromMe) {
        // Mensagem enviada por nós: não armazenamos, mas aproveitamos para
        // aprender o LID/PN do dono do canal (usado para resolver self-mentions)
        const key = msg.key as any
        const remoteJid: string = key.remoteJid ?? ''
        const isGroup = remoteJid.endsWith('@g.us')
        if (isGroup && (key.participant || key.participantAlt)) {
          learnChannelOwner(channelId, key.participant, key.participantAlt).catch(() => {})
        }
        continue
      }

      await ingestQueue.add(
        'ingest',
        { channelId, workspaceId, message: msg },
        { jobId: `wa-${(msg.key as any).id}`, removeOnComplete: 100, removeOnFail: 50 },
      )
    }
  }

  // ── messages.update (status de entrega ✓✓ + auto-resolve ao ler no celular) ─
  if (event === 'messages.update') {

    // Evolution v2 envia estrutura PLANA com status como string
    // { keyId, fromMe, status: "SERVER_ACK"|"DELIVERY_ACK"|"READ"|"PLAYED", messageId }
    // Suporta também o formato antigo com array de { key, update }
    const updates = Array.isArray(b.data) ? b.data : [b.data]

    // Mapeia ambos os formatos para nosso enum
    const statusMap: Record<string, string> = {
      'ERROR':        'PENDING',
      'PENDING':      'PENDING',
      'SERVER_ACK':   'SENT',
      'DELIVERY_ACK': 'DELIVERED',
      'READ':         'READ',
      'PLAYED':       'PLAYED',
      '0': 'PENDING', '1': 'PENDING', '2': 'SENT',
      '3': 'DELIVERED', '4': 'READ', '5': 'PLAYED',
    }

    for (const upd of updates as Record<string, unknown>[]) {
      if (!upd) continue

      const externalId = (upd.keyId ?? (upd.key as any)?.id) as string | undefined
      if (!externalId) continue

      const rawStatus = upd.status ?? (upd.update as any)?.status
      const deliveryStatus = statusMap[String(rawStatus)]
      if (!deliveryStatus) continue

      const fromMe = !!upd.fromMe

      if (fromMe) {
        // ── Outbound: status de entrega (✓ → ✓✓ → ✓✓ azul) ────────────────────
        const updated = await prisma.message.findFirst({
          where: { externalId },
          select: { id: true, conversationId: true, workspaceId: true },
        })

        if (updated) {
          await prisma.message.update({
            where: { id: updated.id },
            data: { deliveryStatus },
          })

          await eventBus.emitAndPersist(updated.workspaceId, 'message.delivery', {
            messageId: updated.id,
            externalId,
            conversationId: updated.conversationId,
            deliveryStatus,
          })

          logger.debug({ externalId, deliveryStatus }, '[delivery] status atualizado')
        }
      } else if (deliveryStatus === 'READ' || deliveryStatus === 'PLAYED') {
        // ── Inbound: o USUÁRIO leu uma mensagem que recebeu (no celular dele) ──
        // Se o canal estiver com `autoResolveOnRead`, finalizamos a conversa.
        const msg = await prisma.message.findFirst({
          where: { externalId },
          select: {
            id: true, workspaceId: true,
            conversation: {
              select: {
                id: true, status: true, channelId: true,
                channel: { select: { settings: true } },
              },
            },
          },
        })

        if (!msg?.conversation) continue
        const settings = (msg.conversation.channel.settings as Record<string, unknown> | null) ?? {}
        if (!settings.autoResolveOnRead) continue
        if (msg.conversation.status === 'RESOLVED') continue

        await prisma.conversation.update({
          where: { id: msg.conversation.id },
          data: { status: 'RESOLVED', resolvedAt: new Date() },
        })

        await eventBus.emitAndPersist(msg.workspaceId, 'conversation.resolved', {
          conversationId: msg.conversation.id,
          reason: 'auto-read-on-device',
        })

        logger.info(
          { conversationId: msg.conversation.id, externalId },
          'Conversa auto-finalizada — usuário leu no dispositivo',
        )
      }
    }
  }

  // ── presence.update (digitando / gravando / online) ────────────────────────
  if (event === 'presence.update') {
    const data = b.data as {
      id: string
      presences: Record<string, { lastKnownPresence: string; lastSeen?: number | null }>
    } | null

    const jid = data?.id
    if (!jid || !data?.presences) return

    // Pega o primeiro (e geralmente único) estado de presença
    const presenceEntry = Object.values(data.presences)[0]
    const presence = presenceEntry?.lastKnownPresence as string | undefined
    if (!presence) return

    // Localiza a conversa pelo externalId (JID)
    const conversation = await prisma.conversation.findFirst({
      where: { externalId: jid },
      select: { id: true, workspaceId: true },
    })

    // Só emite se tiver workspace — sem ele o SSE não sabe para quem enviar
    if (conversation?.workspaceId) {
      await eventBus.emitAndPersist(conversation.workspaceId, 'presence.update', {
        jid,
        conversationId: conversation.id,
        presence,
      })
    }
  }

  // ── contacts.upsert / contacts.update ──────────────────────────────────────
  // Evolution emite esses eventos quando descobre/atualiza um contato.
  // Payload típico: { id: '5511...@s.whatsapp.net' | '...@lid', notify, name, profilePicUrl }
  // Quando um LID é resolvido para PN, podemos mesclar o contato LID-only no PN.
  if (event === 'contacts.upsert' || event === 'contacts.update') {
    const instanceName = b.instance as string
    if (!instanceName) return

    const resolved = await resolveInstance(instanceName)
    if (!resolved) return
    const { workspaceId } = resolved

    const contacts = Array.isArray(b.data) ? b.data : [b.data]
    for (const c of contacts as Record<string, unknown>[]) {
      const jid = (c?.id ?? c?.remoteJid) as string | undefined
      if (!jid) continue

      const parsed = parseJid(jid)
      const name = (c?.notify ?? c?.name ?? c?.pushName) as string | undefined
      const profilePicUrl = c?.profilePicUrl as string | undefined

      if (parsed.kind === 'pn' && parsed.phone) {
        // Existe contato com esse PN?
        let pnContact = await prisma.contact.findFirst({
          where: { workspaceId, phone: parsed.phone, mergedIntoId: null },
        })
        if (!pnContact) {
          pnContact = await prisma.contact.create({
            data: { workspaceId, phone: parsed.phone, phoneType: 'PN', name: name ?? null },
          })
        }

        // Se Evolution está nos dando o PN para um contato que conhecíamos só como LID,
        // o payload às vezes inclui também o LID. Tenta achar e mesclar.
        const otherLid = (c?.lid ?? c?.linkedId) as string | undefined
        if (otherLid) {
          const parsedLid = parseJid(typeof otherLid === 'string' ? otherLid : `${otherLid}@lid`)
          if (parsedLid.kind === 'lid' && parsedLid.lid) {
            const lidOnly = await prisma.contact.findFirst({
              where: { workspaceId, lid: parsedLid.lid, phone: null, mergedIntoId: null },
            })
            if (lidOnly && lidOnly.id !== pnContact.id) {
              await mergeContacts(lidOnly.id, pnContact.id)
              logger.info({ lidId: lidOnly.id, pnId: pnContact.id }, 'contacts.upsert: LID resolvido pra PN')
            }
            // Garante o lid no contato PN
            if (!pnContact.lid) {
              await prisma.contact.update({ where: { id: pnContact.id }, data: { lid: parsedLid.lid } })
            }
          }
        }

        // Atualiza nome/avatar quando o evento traz dado novo
        const update: Record<string, unknown> = {}
        if (name && !pnContact.name) update.name = name
        if (profilePicUrl) {
          const meta = (pnContact.metadata as Record<string, unknown> | null) ?? {}
          if (meta.avatarUrl !== profilePicUrl) {
            update.metadata = { ...meta, avatarUrl: profilePicUrl }
          }
        }
        if (Object.keys(update).length) {
          await prisma.contact.update({ where: { id: pnContact.id }, data: update })
        }
      } else if (parsed.kind === 'lid' && parsed.lid) {
        // Garante que existe um contato pra esse LID — mas não muito mais a fazer
        const exists = await prisma.contact.findFirst({
          where: { workspaceId, lid: parsed.lid, mergedIntoId: null },
        })
        if (!exists) {
          await prisma.contact.create({
            data: { workspaceId, lid: parsed.lid, phoneType: 'LID', name: name ?? null },
          })
        } else if (name && !exists.name) {
          await prisma.contact.update({ where: { id: exists.id }, data: { name } })
        }
      }
    }
  }

  // ── connection.update ───────────────────────────────────────────────────────
  if (event === 'connection.update') {
    const instanceName = b.instance as string
    const state = (b.data as any)?.state as string | undefined
    if (!instanceName || !state) return

    const resolved = await resolveInstance(instanceName)
    if (!resolved) return

    const status = state === 'open' ? 'CONNECTED' : 'DISCONNECTED'

    // Detecta transição DISCONNECTED → CONNECTED para auto-sync inteligente
    const prev = await prisma.channel.findUnique({
      where: { id: resolved.channelId },
      select: { status: true },
    })
    const justReconnected = status === 'CONNECTED' && prev?.status !== 'CONNECTED'

    await prisma.channel.update({
      where: { id: resolved.channelId },
      data: { status },
    })
    logger.info({ instanceName, status, justReconnected }, 'connection.update')

    // Auto-sync inteligente em background: pega mensagens perdidas e auto-resolve
    // conversas que o user já leu no celular durante o downtime.
    if (justReconnected) {
      setTimeout(() => {
        import('./sync.service.js').then(({ syncWhatsAppChannel }) =>
          syncWhatsAppChannel(resolved.channelId).catch((err) => {
            logger.warn({ err, channelId: resolved.channelId }, 'Auto-sync pós-reconexão falhou')
          }),
        )
      }, 3_000) // 3s de margem pra Evolution estabilizar antes de buscar chats
    }
  }
}

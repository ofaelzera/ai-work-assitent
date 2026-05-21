import { Worker } from 'bullmq'
import { classifyQueue } from './classifyMessage.worker.js'
import { redis } from '../lib/redis.js'
import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'
import { logger } from '../lib/logger.js'
import { extractText, extractMediaInfo, mediaTypeLabel, isMetaMessage } from '../modules/channels/media.utils.js'
import { evolutionClient } from '../modules/channels/evolution.client.js'
import { getChannelConfig } from '../modules/channels/channels.service.js'
import { env } from '../config/env.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseJid } from '../lib/phone.js'
import { mergeContacts } from '../modules/contacts/merge.service.js'

/**
 * Tenta baixar a mídia de uma mensagem WhatsApp e salva localmente.
 * Retorna o storageKey relativo se salvo com sucesso, ou null se falhar
 * (ex: mídia sem binary, quota excedida, etc.).
 */
async function downloadAndSaveMedia(
  workspaceId: string,
  channelId: string,
  mediaInfo: Awaited<ReturnType<typeof extractMediaInfo>>,
  msgId: string,
): Promise<string | null> {
  if (!mediaInfo) return null

  try {
    const { instanceName } = await getChannelConfig(channelId)
    const result = await evolutionClient.getMediaBase64(instanceName, mediaInfo.key)
    if (!result?.base64) return null

    const buffer = Buffer.from(result.base64, 'base64')
    const mimetype: string = result.mimetype ?? mediaInfo.mimetype
    const ext = mimetype.split('/')[1]?.split(';')[0] ?? 'bin'
    const filename = mediaInfo.filename ?? `${mediaInfo.type}-${msgId}.${ext}`

    const storageDir = path.join(env.STORAGE_PATH, workspaceId, 'media')
    await fs.mkdir(storageDir, { recursive: true })

    const storageKey = path.join(workspaceId, 'media', `${randomUUID()}-${filename}`)
    await fs.writeFile(path.join(env.STORAGE_PATH, storageKey), buffer)

    return storageKey
  } catch (err: any) {
    // Mídia sem binary (ex: sticker, localMediaPath vazio) — não é erro crítico
    logger.warn({ err: err?.message, msgId }, 'Não foi possível salvar mídia localmente — ignorado')
    return null
  }
}

export function startIngestWhatsappWorker() {
  const worker = new Worker(
    'ingestWhatsapp',
    async (job) => {
      const { channelId, workspaceId, message } = job.data as {
        channelId: string
        workspaceId: string
        message: any
      }

      // Carrega settings do canal e do workspace (canal sobrescreve global)
      const channelRecord = await prisma.channel.findUnique({
        where: { id: channelId },
        select: { settings: true, workspace: { select: { settings: true } } },
      })
      const channelSettings = (channelRecord?.settings as Record<string, unknown> | null) ?? {}
      const workspaceSettings = (channelRecord?.workspace?.settings as Record<string, unknown> | null) ?? {}

      const remoteJid: string = message.key?.remoteJid ?? ''
      const externalMsgId: string = message.key?.id ?? ''
      const isGroup = remoteJid.endsWith('@g.us')

      // Ignora mensagens de grupo se configurado no canal
      if (isGroup && channelSettings.ignoreGroups === true) return

      // Ignora meta-mensagens (reactionMessage, pollUpdate, protocolMessage, etc.)
      // — não são conteúdo de conversa, não devem aparecer como "[mídia]".
      const meta = isMetaMessage(message)
      if (meta) {
        logger.debug({ remoteJid, externalMsgId, metaKind: meta.kind }, 'Meta-msg WA ignorada')
        return
      }
      // Em grupos, Evolution às vezes manda `participantAlt` (PN real) + `participant` (LID).
      // Preferimos sempre o PN quando disponível.
      const senderPrimaryJid: string = isGroup ? (message.key?.participant ?? '') : remoteJid
      const senderAltJid: string = isGroup ? (message.key?.participantAlt ?? '') : ''
      const parsedPrimary = parseJid(senderPrimaryJid)
      const parsedAlt = senderAltJid ? parseJid(senderAltJid) : null
      // Escolhe a melhor identificação: PN sempre vence
      const parsedSender = parsedAlt?.kind === 'pn' ? parsedAlt : parsedPrimary
      // Mantemos referência ao LID quando disponível (pra auto-merge depois)
      const knownLid: string | null = parsedPrimary.kind === 'lid' ? (parsedPrimary.lid ?? null)
        : parsedAlt?.kind === 'lid' ? (parsedAlt.lid ?? null) : null

      const pushName: string = message.pushName ?? ''
      const mediaInfo = extractMediaInfo(message)
      const rawText = extractText(message)
      const body = rawText ?? (mediaInfo ? mediaTypeLabel(mediaInfo.type) : '[mídia]')
      const sentAt = new Date((message.messageTimestamp ?? Date.now() / 1000) * 1000)

      // Quoted message (reply/citação)
      const contextInfo = message.message?.extendedTextMessage?.contextInfo
        ?? message.message?.imageMessage?.contextInfo
        ?? message.message?.videoMessage?.contextInfo
        ?? message.message?.documentMessage?.contextInfo
        ?? null
      const quotedMsgId: string | null = contextInfo?.stanzaId ?? null
      const quotedBody: string | null = contextInfo?.quotedMessage?.conversation
        ?? contextInfo?.quotedMessage?.extendedTextMessage?.text
        ?? null
      const quotedParticipant: string | null = contextInfo?.participant ?? null
      const parsedQuoted = quotedParticipant ? parseJid(quotedParticipant) : null
      const quotedSender: string | null = parsedQuoted?.kind === 'pn'
        ? (parsedQuoted.phone ?? null)
        : parsedQuoted?.kind === 'lid' ? `lid:${parsedQuoted.lid}` : null

      // ── Upsert contact ────────────────────────────────────────────────────
      // Estratégia: procura primeiro por PN (se temos), depois por LID. Se achou um
      // LID-only mas agora descobrimos o PN, faz merge automático no contato PN.
      // mergedIntoId: null garante que nunca pegamos um contato já mesclado como primário.
      let contact = null
      if (parsedSender.kind === 'pn' && parsedSender.phone) {
        contact = await prisma.contact.findFirst({
          where: { workspaceId, phone: parsedSender.phone, mergedIntoId: null },
        })
        // Se descobrimos o PN agora e existe um contato LID-only com o mesmo LID, mescla
        if (contact && knownLid && !contact.lid) {
          await prisma.contact.update({ where: { id: contact.id }, data: { lid: knownLid } })
          contact.lid = knownLid
        }
        if (knownLid) {
          const lidOnly = await prisma.contact.findFirst({
            where: { workspaceId, lid: knownLid, phone: null, mergedIntoId: null },
          })
          if (lidOnly && (!contact || lidOnly.id !== contact.id)) {
            // Garante que existe um contato PN para receber o merge
            if (!contact) {
              contact = await prisma.contact.create({
                data: {
                  workspaceId,
                  phone: parsedSender.phone,
                  lid: knownLid,
                  phoneType: 'PN',
                  name: pushName || lidOnly.name,
                },
              })
            }
            await mergeContacts(lidOnly.id, contact.id)
            logger.info({ lidId: lidOnly.id, pnId: contact.id }, 'LID resolvido pra PN — auto-merge')
          }
        }
        if (!contact) {
          contact = await prisma.contact.create({
            data: {
              workspaceId,
              phone: parsedSender.phone,
              lid: knownLid,
              phoneType: 'PN',
              name: pushName || null,
            },
          })
        }
      } else if (parsedSender.kind === 'lid' && parsedSender.lid) {
        // Só temos LID — cria contato sem telefone, marcado como LID
        contact = await prisma.contact.findFirst({
          where: { workspaceId, lid: parsedSender.lid, mergedIntoId: null },
        })
        if (!contact) {
          contact = await prisma.contact.create({
            data: {
              workspaceId,
              lid: parsedSender.lid,
              phoneType: 'LID',
              name: pushName || null,
            },
          })
        }
      } else {
        // JID indecifrável — fallback: cria contato anônimo só pra não perder a mensagem
        contact = await prisma.contact.create({
          data: { workspaceId, phoneType: 'UNKNOWN', name: pushName || null },
        })
        logger.warn({ remoteJid, senderPrimaryJid }, 'JID irreconhecível ao ingerir mensagem WA')
      }

      // Atualiza o pushName se temos e o contato ainda não tinha nome
      if (pushName && !contact.name) {
        contact = await prisma.contact.update({
          where: { id: contact.id },
          data: { name: pushName },
        }) as typeof contact
      }

      // Busca conversa ATIVA (OPEN/WAITING) para este chat.
      let conversation = await prisma.conversation.findFirst({
        where: {
          channelId,
          externalId: remoteJid,
          workspaceId,
          status: { in: ['OPEN', 'WAITING'] },
        },
        orderBy: { createdAt: 'desc' },
      })

      // Se não tem ativa mas existe RESOLVED do mesmo chat, REABRE em vez de criar nova.
      // Modelo chat-contínuo: cliente respondendo após finalização reabre a mesma thread.
      // Regras:
      //  • Só msg INBOUND reabre (nossa OUTBOUND não)
      //  • Antes de reabrir, garante que a msg NÃO é duplicata (idempotência) —
      //    senão re-entregas do webhook reabririam convs sem necessidade
      if (!conversation) {
        const fromMe: boolean = message.key?.fromMe ?? false
        if (!fromMe) {
          const resolved = await prisma.conversation.findFirst({
            where: { channelId, externalId: remoteJid, workspaceId, status: 'RESOLVED', source: 'LIVE' },
            orderBy: { lastMessageAt: 'desc' },
          })
          if (resolved) {
            // Verifica se essa mesma mensagem já está salva (em qualquer conv desse chat)
            // — se sim, é re-entrega do webhook, não reabre nem processa.
            const alreadyExists = await prisma.message.findFirst({
              where: {
                externalId: externalMsgId,
                conversation: { channelId, externalId: remoteJid, workspaceId },
              },
              select: { id: true },
            })
            if (alreadyExists) {
              logger.info({ remoteJid, externalMsgId }, 'Msg duplicada ignorada (não reabre conv RESOLVED)')
              return
            }

            conversation = await prisma.conversation.update({
              where: { id: resolved.id },
              data: {
                status: 'OPEN',
                resolvedAt: null,
                reopenCount: { increment: 1 },
                lastMessageAt: sentAt,
                unreadCount: { increment: 1 },
              },
            })
            logger.info({ conversationId: conversation.id, remoteJid }, 'Conv RESOLVED reaberta (cliente respondeu)')
          }
        }
      }

      if (!conversation) {
        // Calcula assigneeId: canal sobrescreve workspace; workspace é fallback global
        let assigneeId: string | null = null
        // distributionMode: canal > workspace > 'all'
        const distMode = (channelSettings.distributionMode as string | undefined)
          ?? (workspaceSettings.distributionMode as string | undefined)
          ?? 'all'

        if (distMode === 'fixed') {
          // defaultAssigneeId: canal > workspace
          assigneeId = (channelSettings.defaultAssigneeId as string | null)
            ?? (workspaceSettings.defaultAssigneeId as string | null)
            ?? null
        } else if (distMode === 'round_robin') {
          // roundRobinUserIds: canal > workspace
          const userIds = (channelSettings.roundRobinUserIds as string[] | undefined)
            ?? (workspaceSettings.roundRobinUserIds as string[] | undefined)
            ?? []
          if (userIds.length > 0) {
            const lastIdx = typeof channelSettings.rrCursor === 'number' ? channelSettings.rrCursor : -1
            const nextIdx = (lastIdx + 1) % userIds.length
            assigneeId = userIds[nextIdx] ?? null
            // Persiste cursor no canal (fire-and-forget)
            prisma.channel.update({
              where: { id: channelId },
              data: { settings: { ...channelSettings, rrCursor: nextIdx } },
            }).catch(() => {})
          }
        }

        // Para grupos: tenta buscar o nome real do grupo via Evolution
        let groupSubject: string | null = null
        let shouldArchive = false
        if (isGroup) {
          if (channelSettings.archiveGroups === true) {
            shouldArchive = true
          }
          try {
            const { instanceName } = await getChannelConfig(channelId)
            const groupInfo = await evolutionClient.fetchGroupInfo(instanceName, remoteJid)
            groupSubject = groupInfo?.subject ?? null
          } catch {
            // Se falhar, deixa subject null — sidebar vai mostrar o JID limpo
          }
        }

        // Novo ticket — usa double-check para evitar race condition com sync simultâneo:
        // se entre o findFirst acima e o create outro processo já criou uma conv, reutiliza ela.
        conversation = await prisma.conversation.create({
          data: {
            workspaceId,
            channelId,
            contactId: isGroup ? null : contact.id,
            externalId: remoteJid,
            isGroup,
            subject: isGroup ? groupSubject : null,
            lastMessageAt: sentAt,
            status: 'OPEN',
            unreadCount: 1,
            archived: shouldArchive,
            ...(assigneeId && { assigneeId }),
          },
        }).catch(async () => {
          // Race condition: outro processo criou uma conv para o mesmo chat; reutiliza a existente
          const existing = await prisma.conversation.findFirst({
            where: { channelId, externalId: remoteJid, workspaceId, status: { in: ['OPEN', 'WAITING'] } },
            orderBy: { createdAt: 'asc' },
          })
          if (!existing) throw new Error(`Falha ao criar/encontrar conversa para ${remoteJid}`)
          return existing
        })
        logger.info({ conversationId: conversation.id, contactId: contact.id, assigneeId }, 'Novo ticket criado')
      } else {
        // Se a conversa está arquivada, a mensagem é salva silenciosamente:
        // NÃO bumpa unreadCount (badge fica em zero) e NÃO atualiza lastMessageAt
        // (não pula pro topo). Conversa segue invisível nas abas normais — só aparece em "Arquivo".
        const updateData: Record<string, unknown> = conversation.archived
          ? {}
          : {
              lastMessageAt: sentAt,
              unreadCount: { increment: 1 },
            }
        // Se é grupo sem subject válido, tenta buscar o nome do grupo em background
        if (isGroup && !conversation.subject) {
          try {
            const { instanceName: instName } = await getChannelConfig(channelId)
            const groupInfo = await evolutionClient.fetchGroupInfo(instName, remoteJid)
            if (groupInfo?.subject) updateData.subject = groupInfo.subject
          } catch {
            // ignora
          }
        }
        conversation = await prisma.conversation.update({
          where: { id: conversation.id },
          data: updateData,
        })
      }

      // Upsert message (idempotente pelo externalId)
      const existing = await prisma.message.findUnique({
        where: { conversationId_externalId: { conversationId: conversation.id, externalId: externalMsgId } },
      })
      if (existing) return // duplicado

      // Tenta salvar mídia localmente antes de persistir a mensagem
      // Isso garante que a mídia esteja disponível mesmo após expiração da CDN do WhatsApp
      let localStorageKey: string | null = null
      if (mediaInfo) {
        localStorageKey = await downloadAndSaveMedia(workspaceId, channelId, mediaInfo, externalMsgId)
      }

      // Monta attachment com storageKey local se disponível
      const attachmentPayload = mediaInfo
        ? [{ ...mediaInfo, storageKey: localStorageKey ?? undefined }] as any
        : undefined

      const msg = await prisma.message.create({
        data: {
          workspaceId,
          conversationId: conversation.id,
          direction: 'INBOUND',
          externalId: externalMsgId,
          fromContactId: contact.id,
          body,
          sentAt,
          attachments: attachmentPayload,
          quotedMsgId: quotedMsgId ?? null,
          quotedBody: quotedBody ?? null,
          quotedSender: quotedSender ?? null,
        },
      })

      logger.info(
        { messageId: msg.id, conversationId: conversation.id, hasLocalMedia: !!localStorageKey },
        'Mensagem WA ingerida',
      )

      await eventBus.emitAndPersist(workspaceId, 'message.received', {
        messageId: msg.id,
        conversationId: conversation.id,
        channelId,
        type: 'WHATSAPP',
      })

      // Enfileira triage de IA para mensagens inbound — pula em conversas arquivadas
      // (não queremos gastar tokens em chats que o usuário marcou como "ignorar")
      if (!conversation.archived) {
        await classifyQueue.add(
          'classify',
          { messageId: msg.id, conversationId: conversation.id, workspaceId },
          { jobId: `classify-${msg.id}`, removeOnComplete: 50, removeOnFail: 20 },
        )
      }
    },
    { connection: redis, concurrency: 5 },
  )

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'ingestWhatsapp worker falhou')
  })

  return worker
}

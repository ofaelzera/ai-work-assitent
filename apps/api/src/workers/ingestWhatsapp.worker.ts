import { Worker } from 'bullmq'
import { Prisma } from '@prisma/client'
import { redis } from '../lib/redis.js'
import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'
import { logger } from '../lib/logger.js'
import { extractText, extractMediaInfo, mediaTypeLabel, isMetaMessage } from '../modules/channels/media.utils.js'
import { getChannelConfig } from '../modules/channels/channels.service.js'
import { getClientForChannel } from '../modules/evolution-servers/evolution-servers.service.js'
import { env } from '../config/env.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseJid } from '../lib/phone.js'
import { mergeContacts } from '../modules/contacts/merge.service.js'
import { linkContactCompany } from '../modules/contacts/contact-company.service.js'
import { sendSystemMessage } from '../lib/systemMessages.js'
import { dedupChatConversations } from '../modules/messages/dedup.service.js'
import { routeNewConversation } from '../modules/messages/routing.service.js'

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
    const client = await getClientForChannel(channelId)
    const result = await client.getMediaBase64(instanceName, mediaInfo.key)
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
        if (meta.kind === 'reaction' && meta.reactionTo) {
          const targetMsg = await prisma.message.findFirst({
            where: { externalId: meta.reactionTo, workspaceId },
            select: { id: true, conversationId: true, metadata: true },
          })
          if (targetMsg) {
            const fromMe = message.key?.fromMe ?? false
            const senderJid = isGroup ? (message.key?.participant ?? remoteJid) : remoteJid
            const senderId = fromMe ? `channel:${channelId}` : senderJid
            const existingMeta = (targetMsg.metadata ?? {}) as any
            const existingReactions: any[] = existingMeta.reactions ?? []
            const filtered = existingReactions.filter((r: any) => r.senderId !== senderId)
            const newReactions = meta.reactionEmoji
              ? [...filtered, { emoji: meta.reactionEmoji, senderId, senderName: message.pushName ?? undefined, fromMe }]
              : filtered
            await prisma.message.update({
              where: { id: targetMsg.id },
              data: { metadata: { ...existingMeta, reactions: newReactions } },
            })
            logger.info({ messageId: targetMsg.id, reactions: newReactions }, 'Reação atualizada')
            await eventBus.emitAndPersist(workspaceId, 'message.updated', {
              messageId: targetMsg.id,
              conversationId: targetMsg.conversationId,
              reactions: newReactions,
            })
          }
        }
        logger.debug({ remoteJid, externalMsgId, metaKind: meta.kind }, 'Meta-msg WA processada')
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

      // Se não tem ativa, vamos criar uma nova.
      // Mas antes, verifica se essa mesma mensagem já está salva (em qualquer conv desse chat)
      // — se sim, é re-entrega do webhook de uma conversa finalizada, não cria nova nem processa.
      if (!conversation && externalMsgId) {
        const alreadyExists = await prisma.message.findFirst({
          where: {
            externalId: externalMsgId,
            conversation: { channelId, externalId: remoteJid, workspaceId },
          },
          select: { id: true },
        })
        if (alreadyExists) {
          logger.info({ remoteJid, externalMsgId }, 'Msg duplicada ignorada (não cria nova conv)')
          return
        }
      }

      if (!conversation) {
        // Aplica regra de roteamento. A conv vai pra FILA (assigneeId=null),
        // restrita aos usuários de `eligibleAssigneeIds` (ou pública se null).
        // O atendente precisa clicar Assumir — dispara boas-vindas + cronômetro.
        const route = await routeNewConversation({
          workspaceId,
          channelId,
          contactId: contact?.id ?? null,
          isGroup,
          messageBody: body ?? null,
          autoAssign: false,
        })

        // Para grupos: tenta buscar o nome real do grupo via Evolution
        let groupSubject: string | null = null
        let shouldArchive = false
        if (isGroup) {
          if (channelSettings.archiveGroups === true) {
            shouldArchive = true
          }
          try {
            const { instanceName } = await getChannelConfig(channelId)
            const groupClient = await getClientForChannel(channelId)
            const groupInfo = await groupClient.fetchGroupInfo(instanceName, remoteJid)
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
            lastQueuedAt: sentAt,
            ...(route.teamId && { teamId: route.teamId }),
            ...(route.eligibleAssigneeIds && { eligibleAssigneeIds: route.eligibleAssigneeIds }),
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
        logger.info(
          { conversationId: conversation.id, contactId: contact.id, eligible: route.eligibleAssigneeIds, source: route.source, distMode: route.distMode },
          'Novo ticket criado (na fila)',
        )

        // ── Flow automático (se houver) ────────────────────────────────────
        // Quando o canal/regra indica um flow inicial, ele substitui o welcome
        // estático: o flow é responsável por mandar mensagens, perguntas, etc.
        const fromMe: boolean = message.key?.fromMe ?? false
        if (route.flowId && !isGroup && !shouldArchive && !fromMe) {
          const { flowQueue } = await import('./flowExecutor.worker.js')
          await flowQueue.add('start', {
            kind: 'start',
            workspaceId,
            flowId: route.flowId,
            conversationId: conversation.id,
          })
        } else {
          // ── Welcome message do canal (comportamento legado) ───────────────
          const welcomeTpl = typeof channelSettings.welcomeMessage === 'string'
            ? channelSettings.welcomeMessage
            : ''
          if (welcomeTpl && !isGroup && !shouldArchive && !fromMe) {
            void sendSystemMessage({
              conversationId: conversation.id,
              template: welcomeTpl,
              kind: 'channel-welcome',
              userId: null,
            })
          }
        }
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
            const grpClient = await getClientForChannel(channelId)
            const groupInfo = await grpClient.fetchGroupInfo(instName, remoteJid)
            if (groupInfo?.subject) updateData.subject = groupInfo.subject
          } catch {
            // ignora
          }
        }
        conversation = await prisma.conversation.update({
          where: { id: conversation.id },
          data: updateData,
        })

        // Mensagem nova de entrada → limpa as leituras: a conversa volta a ser
        // "não lida" para todos os atendentes (badges/lista por usuário).
        const msgFromMe = message.key?.fromMe ?? false
        if (!conversation.archived && !msgFromMe) {
          await prisma.conversationRead.deleteMany({ where: { conversationId: conversation.id } })
        }
      }

      // RF04 (gancho leve): se a mensagem é de um grupo vinculado a uma empresa,
      // associa o remetente à empresa (N:N, source=GROUP_SYNC). Idempotente.
      // Só contatos com número real (PN) — LID não vincula.
      if (isGroup && conversation.companyId && contact.phoneType === 'PN' && contact.phone) {
        await linkContactCompany(contact.id, conversation.companyId, 'GROUP_SYNC').catch((err) =>
          logger.warn({ err, contactId: contact.id, companyId: conversation.companyId }, 'Falha ao vincular contato à empresa do grupo'),
        )
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
        contactId: contact?.id ?? null,
        senderName: pushName || contact?.name || contact?.phone || 'Cliente',
        channelId,
        channelType: 'WHATSAPP',
        conversationExternalId: conversation.externalId,
        body: msg.body ?? '',
        direction: 'INBOUND',
      })

      // Se a conv tem flow em WAITING_INPUT, enfileira pra processar a resposta
      const waitingExec = await prisma.flowExecution.findFirst({
        where: { conversationId: conversation.id, status: 'WAITING_INPUT' },
        select: { id: true },
      })
      if (waitingExec && body) {
        const { flowQueue } = await import('./flowExecutor.worker.js')
        await flowQueue.add('message', {
          kind: 'message',
          conversationId: conversation.id,
          messageBody: body,
        })
      }

      // ── Auto-dedup do chat ───────────────────────────────────────────────
      // Roda fire-and-forget no fim de cada ingest. Caminho rápido (0 ou 1 conv aberta)
      // custa só uma query indexada. Se detectar 2+ duplicatas (race entre webhooks),
      // mescla automaticamente — usuário nunca precisa apertar "Deduplicar".
      dedupChatConversations(workspaceId, channelId, remoteJid).catch(err =>
        logger.warn({ err, remoteJid }, 'Auto-dedup pós-ingest falhou (ignorada)'),
      )
    },
    { connection: redis, concurrency: 5 },
  )

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'ingestWhatsapp worker falhou')
  })

  return worker
}

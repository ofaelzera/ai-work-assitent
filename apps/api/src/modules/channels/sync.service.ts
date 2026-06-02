import { createHash } from 'node:crypto'
import { prisma } from '../../lib/prisma.js'
import { makeEvolutionClient, type EvolutionClient } from './evolution.client.js'
import { getClientForChannel, getServerCredentials } from '../evolution-servers/evolution-servers.service.js'
import { fetchImapMessages, listImapFolders } from './email.client.js'
import { eventBus } from '../../lib/eventBus.js'
import { logger } from '../../lib/logger.js'
import { decryptJson } from '../../lib/crypto.js'
import { extractText, extractMediaInfo, mediaTypeLabel, isMetaMessage } from './media.utils.js'
import { parseJid } from '../../lib/phone.js'
import { mergeContacts } from '../contacts/merge.service.js'

/** Converte um Message-ID longo (pode ter 300+ chars) em hash hex de 32 chars */
function threadHash(id: string): string {
  return createHash('md5').update(id).digest('hex')
}

/** Busca o nome real de um grupo WhatsApp via Evolution (fire-and-forget safe) */
async function fetchGroupSubject(client: EvolutionClient, instanceName: string, groupJid: string): Promise<string | null> {
  try {
    const info = await client.fetchGroupInfo(instanceName, groupJid)
    return info?.subject ?? null
  } catch {
    return null
  }
}

/** Busca e salva avatar do contato no WhatsApp (fire-and-forget, sem bloquear o sync) */
async function refreshContactAvatar(client: EvolutionClient, instanceName: string, contactId: string, phone: string) {
  try {
    const result = await client.fetchProfilePicture(instanceName, phone)
    if (result.profilePictureUrl) {
      const contact = await prisma.contact.findUnique({ where: { id: contactId } })
      const meta = (contact?.metadata as Record<string, unknown> | null) ?? {}
      await prisma.contact.update({
        where: { id: contactId },
        data: { metadata: { ...meta, avatarUrl: result.profilePictureUrl } },
      })
    }
  } catch {
    // Ignora erros (privacidade, contato sem foto, etc.)
  }
}

export interface SyncWhatsAppOptions {
  /** Quando true, importa também histórico antigo (mensagens anteriores à criação do canal)
   *  e cria conversas IMPORTED+RESOLVED dedicadas pra esse histórico.
   *  Quando false (default), só recupera mensagens novas perdidas (entram em convs LIVE). */
  importHistory?: boolean
}

export interface SyncWhatsAppResult {
  chats: number
  messages: number              // total compat (live + imported)
  messagesLive: number
  messagesImported: number
  newContacts: number
  newHistoricalConvs: number
  autoResolved: number          // convs LIVE OPEN fechadas porque o user leu no celular
  skipped: number
}

/** Upsert do contato sender de uma mensagem WA, com auto-merge LID→PN. */
async function upsertWaSender(
  workspaceId: string,
  pushName: string,
  sParsed: ReturnType<typeof parseJid>,
  sKnownLid: string | null,
): Promise<{ contact: { id: string } | null; created: boolean }> {
  let created = false
  let contact: { id: string; name: string | null } | null = null

  if (sParsed.kind === 'pn' && sParsed.phone) {
    contact = await prisma.contact.findFirst({
      where: { workspaceId, phone: sParsed.phone, mergedIntoId: null },
      select: { id: true, name: true },
    })
    if (sKnownLid) {
      const lidOnly = await prisma.contact.findFirst({
        where: { workspaceId, lid: sKnownLid, phone: null, mergedIntoId: null },
        select: { id: true, name: true },
      })
      if (lidOnly && (!contact || lidOnly.id !== contact.id)) {
        if (!contact) {
          contact = await prisma.contact.create({
            data: {
              workspaceId,
              phone: sParsed.phone,
              lid: sKnownLid,
              phoneType: 'PN',
              name: pushName || lidOnly.name,
              verified: false, // RF02: contato vindo da sincronização nasce não verificado
            },
            select: { id: true, name: true },
          })
          created = true
        }
        await mergeContacts(lidOnly.id, contact.id)
      }
    }
    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          workspaceId,
          phone: sParsed.phone,
          lid: sKnownLid,
          phoneType: 'PN',
          name: pushName || null,
          verified: false, // RF02
        },
        select: { id: true, name: true },
      })
      created = true
    }
  } else if (sParsed.kind === 'lid' && sParsed.lid) {
    contact = await prisma.contact.findFirst({
      where: { workspaceId, lid: sParsed.lid, mergedIntoId: null },
      select: { id: true, name: true },
    })
    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          workspaceId,
          lid: sParsed.lid,
          phoneType: 'LID',
          name: pushName || null,
          verified: false, // RF02
        },
        select: { id: true, name: true },
      })
      created = true
    }
  }

  return { contact: contact ? { id: contact.id } : null, created }
}

export async function syncWhatsAppChannel(
  channelId: string,
  opts: SyncWhatsAppOptions = {},
): Promise<SyncWhatsAppResult> {
  const importHistory = opts.importHistory ?? false

  const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } })

  const cfg = channel.config as { ciphertext: string; iv: string; authTag: string }
  const { instanceName } = decryptJson<{ instanceName: string }>(
    Buffer.from(cfg.ciphertext, 'base64'),
    Buffer.from(cfg.iv, 'base64'),
    Buffer.from(cfg.authTag, 'base64'),
  )

  // SMART SYNC: usa `unreadCount` de cada chat como source of truth.
  //   • unreadCount === 0  → user já leu (no celular/web) → conv vai pra IMPORTED RESOLVED.
  //                          Se já tinha LIVE OPEN, auto-resolve ela.
  //   • unreadCount  >  0  → genuinamente nova → cria LIVE OPEN (ou atualiza existente).
  //
  // `importHistory: true` força importar TODAS as mensagens (mesmo de chats já lidos),
  // para popular o ContactDrawer/Histórico de forma rica. Sem ele, chats lidos não importam
  // mensagens novas — só auto-resolvem a conv LIVE se existir.
  const isFirstSync = !channel.lastSyncedAt
  const startedAt = new Date()

  const client = await getClientForChannel(channelId)

  // 1. Buscar todos os chats da instância
  const chats = await client.findChats(instanceName)
  const counts = {
    messagesLive: 0,
    messagesImported: 0,
    newContacts: 0,
    newHistoricalConvs: 0,
    autoResolved: 0,   // convs LIVE OPEN fechadas porque user leu fora do app
    skipped: 0,
  }

  logger.info({ instanceName, chats: chats.length, importHistory, isFirstSync }, 'Sincronizando chats WA (smart)')

  // 2. Para cada chat
  for (const chat of chats) {
    const remoteJid: string = chat.remoteJid
    const isGroup = remoteJid.endsWith('@g.us')
    const pushName: string = chat.pushName ?? ''
    const parsed = parseJid(remoteJid)

    // ── Upsert contato raiz (DM) ────────────────────────────────────────────
    let rootContact: { id: string } | null = null
    if (!isGroup) {
      const where = parsed.kind === 'pn'
        ? { workspaceId: channel.workspaceId, phone: parsed.phone, mergedIntoId: null }
        : parsed.kind === 'lid'
        ? { workspaceId: channel.workspaceId, lid: parsed.lid, mergedIntoId: null }
        : null

      if (where) {
        const existing = await prisma.contact.findFirst({ where, select: { id: true, name: true, metadata: true } })
        if (!existing) {
          const created = await prisma.contact.create({
            data: parsed.kind === 'pn'
              ? { workspaceId: channel.workspaceId, phone: parsed.phone, phoneType: 'PN', name: pushName || null }
              : { workspaceId: channel.workspaceId, lid: parsed.lid, phoneType: 'LID', name: pushName || null },
            select: { id: true },
          })
          rootContact = created
          counts.newContacts++
          if (parsed.kind === 'pn' && parsed.phone) {
            void refreshContactAvatar(client, instanceName, created.id, parsed.phone)
          }
        } else {
          rootContact = { id: existing.id }
          // Só atualiza nome se atual está vazio/parece ID, e nunca sobrescreve nome humano
          const currName = existing.name ?? ''
          const nameIsPhoneOrId = !currName || /^\d+$/.test(currName) || currName === parsed.phone
          if (pushName && nameIsPhoneOrId) {
            await prisma.contact.update({ where: { id: existing.id }, data: { name: pushName } })
          }
          if (parsed.kind === 'pn' && parsed.phone && !(existing.metadata as any)?.avatarUrl) {
            void refreshContactAvatar(client, instanceName, existing.id, parsed.phone)
          }
        }
      } else {
        logger.warn({ remoteJid }, 'JID irreconhecível ao sincronizar chat WA — pulando contato')
      }
    }

    // ── Cursor: maior sentAt já salvo entre todas as convs deste chat ──────
    const maxAgg = await prisma.message.aggregate({
      _max: { sentAt: true },
      where: { conversation: { channelId, externalId: remoteJid } },
    })
    const cursorSentAt: Date | null = maxAgg._max.sentAt

    // ── Nome real do grupo (busca assíncrona, não bloqueia se falhar) ────────
    let groupSubject: string | null = null
    if (isGroup) {
      groupSubject = await fetchGroupSubject(client, instanceName, remoteJid)
    }

    // ── Conv LIVE ativa (se já existe) ─────────────────────────────────────
    // IMPORTANTE: a decisão de reabrir conv RESOLVED foi movida pra BAIXO,
    // após confirmar que há mensagem realmente nova (sentAt > cursor).
    // unreadCount do Evolution é "não marcou como lido", não significa "nova".
    let liveConv = await prisma.conversation.findFirst({
      where: { channelId, externalId: remoteJid, source: 'LIVE', status: { in: ['OPEN', 'WAITING'] } },
      orderBy: { createdAt: 'desc' },
    })
    let importedConv: typeof liveConv = null

    const remoteUnread: number = chat.unreadCount ?? 0
    const isReadElsewhere = remoteUnread === 0

    if (liveConv) {
      // Existe conv aberta → preserva e atualiza metadados
      await prisma.conversation.update({
        where: { id: liveConv.id },
        data: {
          lastMessageAt: chat.updatedAt ? new Date(chat.updatedAt) : undefined,
          unreadCount: remoteUnread,
        },
      })
    } else if (isReadElsewhere) {
      // Sem conv aberta + chat lido → auto-resolve IMPORTED se houver
      const importedToClose = await prisma.conversation.findFirst({
        where: { channelId, externalId: remoteJid, source: 'IMPORTED', status: { in: ['OPEN', 'WAITING'] } },
        orderBy: { createdAt: 'desc' },
      })
      if (importedToClose) {
        await prisma.conversation.update({
          where: { id: importedToClose.id },
          data: { status: 'RESOLVED', resolvedAt: new Date(), unreadCount: 0 },
        })
        counts.autoResolved++
      }
    }

    // ── Se chat já lido e não pediu histórico → pula totalmente este chat ──
    if (isReadElsewhere && !importHistory) continue

    // ── Buscar mensagens via Evolution ─────────────────────────────────────
    let records: any[] = []
    try {
      const msgsData = await client.getMessages(instanceName, remoteJid, importHistory ? 200 : 50)
      records = msgsData?.messages?.records ?? []
    } catch {
      continue
    }

    // Ordena por timestamp asc pra processar em ordem cronológica (importante pro lazy create)
    records.sort((a, b) => (a.messageTimestamp ?? 0) - (b.messageTimestamp ?? 0))

    let liveLastSent: Date | null = null

    for (const msg of records) {
      const externalMsgId: string = msg.key?.id ?? ''
      if (!externalMsgId) continue

      const sentAt = new Date((msg.messageTimestamp ?? Date.now() / 1000) * 1000)

      // 1) Cursor: pula mensagens mais antigas que a última que temos salva
      if (cursorSentAt && sentAt < cursorSentAt && !importHistory) {
        continue
      }

      // 2) Idempotência GLOBAL por chat — antes de qualquer create/reopen:
      // se essa mensagem já existe em QUALQUER conv (OPEN, RESOLVED, IMPORTED) desse chat,
      // pula. Isso evita reabrir conv RESOLVED só porque sync re-buscou mensagens antigas
      // do Evolution (que tem unreadCount alto mesmo sem mensagem nova).
      const alreadyExists = await prisma.message.findFirst({
        where: {
          externalId: externalMsgId,
          conversation: { channelId, externalId: remoteJid, workspaceId: channel.workspaceId },
        },
        select: { id: true },
      })
      if (alreadyExists) {
        counts.skipped++
        continue
      }

      // Pula meta-mensagens (reaction, pollUpdate, protocol, etc.)
      if (isMetaMessage(msg)) {
        counts.skipped++
        continue
      }

      const mediaInfo = extractMediaInfo(msg)
      const rawText = extractText(msg)
      const body = rawText ?? (mediaInfo ? mediaTypeLabel(mediaInfo.type) : null)
      if (!body) continue

      // ── Decide destino: LIVE (chat com unread) ou IMPORTED (chat lido) ──
      // Regra: se o chat está com unreadCount > 0 → mensagens vão pra LIVE OPEN.
      //        Se está lido → vão pra IMPORTED RESOLVED (só entra aqui se importHistory=true).
      let targetConvId: string
      if (isReadElsewhere) {
        // Lazy-create IMPORTED conv (só roda se importHistory=true, garantido pelo continue acima)
        if (!importedConv) {
          importedConv = await prisma.conversation.findFirst({
            where: { channelId, externalId: remoteJid, source: 'IMPORTED' },
            orderBy: { createdAt: 'desc' },
          })
          if (!importedConv) {
            const nowDt = new Date()
            importedConv = await prisma.conversation.create({
              data: {
                workspaceId: channel.workspaceId,
                channelId,
                contactId: isGroup ? null : rootContact?.id ?? null,
                externalId: remoteJid,
                isGroup,
                subject: isGroup ? groupSubject : null,
                source: 'IMPORTED',
                status: 'RESOLVED',
                importedAt: nowDt,
                resolvedAt: nowDt,
                lastMessageAt: sentAt,
                unreadCount: 0,
              },
            })
            counts.newHistoricalConvs++
          }
        }
        targetConvId = importedConv.id
        counts.messagesImported++
      } else {
        // Chat com mensagem nova (já passou o filtro de cursor) → LIVE OPEN
        if (!liveConv) {
          // Double-check antes de criar (evita race com webhook)
          liveConv = await prisma.conversation.findFirst({
            where: { channelId, externalId: remoteJid, source: 'LIVE', status: { in: ['OPEN', 'WAITING'] } },
            orderBy: { createdAt: 'asc' },
          })

          // Antes de criar nova, tenta REABRIR a conv RESOLVED mais recente
          // (modelo chat-contínuo: cliente respondendo após finalização reabre o mesmo ticket).
          // Importante: chegamos aqui pq a `msg` em curso passou o filtro de cursor
          // (sentAt > último salvo), então sabemos que é mensagem genuinamente nova.
          if (!liveConv) {
            const resolvedToReopen = await prisma.conversation.findFirst({
              where: { channelId, externalId: remoteJid, source: 'LIVE', status: 'RESOLVED' },
              orderBy: { lastMessageAt: 'desc' },
            })
            if (resolvedToReopen) {
              // Volta pra fila pública — atendente que finalizou não fica novamente
              // responsável automaticamente.
              liveConv = await prisma.conversation.update({
                where: { id: resolvedToReopen.id },
                data: {
                  status: 'OPEN',
                  resolvedAt: null,
                  assigneeId: null,
                  claimedAt: null,
                  reopenCount: { increment: 1 },
                  lastMessageAt: sentAt,
                  unreadCount: remoteUnread,
                },
              })
              logger.info({ conversationId: liveConv.id, remoteJid }, 'Conv RESOLVED reaberta no sync — voltou pra fila')
            }
          }

          // Se nem ativa nem RESOLVED — primeira vez do chat, cria nova
          if (!liveConv) {
            liveConv = await prisma.conversation.create({
              data: {
                workspaceId: channel.workspaceId,
                channelId,
                contactId: isGroup ? null : rootContact?.id ?? null,
                externalId: remoteJid,
                isGroup,
                subject: isGroup ? groupSubject : null,
                source: 'LIVE',
                status: 'OPEN',
                lastMessageAt: sentAt,
                unreadCount: remoteUnread,
              },
            }).catch(async () => {
              // Race condition: webhook criou ao mesmo tempo → reutiliza a existente
              const existing = await prisma.conversation.findFirst({
                where: { channelId, externalId: remoteJid, source: 'LIVE', status: { in: ['OPEN', 'WAITING'] } },
                orderBy: { createdAt: 'asc' },
              })
              if (!existing) throw new Error(`Falha race-condition em ${remoteJid}`)
              return existing
            })
          }
        }
        targetConvId = liveConv.id
        counts.messagesLive++
        if (!liveLastSent || sentAt > liveLastSent) liveLastSent = sentAt
      }

      // ── Idempotência local (defesa contra race) ─────────────────────────
      // O check global no início do loop já barra duplicatas; este aqui só
      // protege contra inserts paralelos na MESMA conv-alvo.
      const exists = await prisma.message.findUnique({
        where: { conversationId_externalId: { conversationId: targetConvId, externalId: externalMsgId } },
      })
      if (exists) {
        if (mediaInfo && !exists.attachments) {
          await prisma.message.update({ where: { id: exists.id }, data: { attachments: [mediaInfo] as any } })
        }
        continue
      }

      // ── Sender da mensagem (em grupos, é diferente do remetente do chat) ─
      const fromMe: boolean = msg.key?.fromMe ?? false
      const senderPrimaryJid: string = isGroup ? (msg.key?.participant ?? '') : remoteJid
      const senderAltJid: string = isGroup ? (msg.key?.participantAlt ?? '') : ''
      const sParsedPrimary = parseJid(senderPrimaryJid)
      const sParsedAlt = senderAltJid ? parseJid(senderAltJid) : null
      const sParsed = sParsedAlt?.kind === 'pn' ? sParsedAlt : sParsedPrimary
      const sKnownLid: string | null = sParsedPrimary.kind === 'lid' ? (sParsedPrimary.lid ?? null)
        : sParsedAlt?.kind === 'lid' ? (sParsedAlt.lid ?? null) : null

      // Aprende identidade do DONO do canal a partir de mensagens fromMe em grupos
      if (fromMe && isGroup && (senderPrimaryJid || senderAltJid)) {
        const ownerPhone = sParsedPrimary.kind === 'pn' ? sParsedPrimary.phone
          : sParsedAlt?.kind === 'pn' ? sParsedAlt.phone
          : undefined
        const ownerLid = sParsedPrimary.kind === 'lid' ? sParsedPrimary.lid
          : sParsedAlt?.kind === 'lid' ? sParsedAlt.lid
          : undefined
        if (ownerPhone || ownerLid) {
          const cur = (channel.settings as Record<string, unknown> | null) ?? {}
          const next = { ...cur } as Record<string, unknown>
          let chg = false
          if (ownerPhone && cur.ownerPhone !== ownerPhone) { next.ownerPhone = ownerPhone; chg = true }
          if (ownerLid && cur.ownerLid !== ownerLid) { next.ownerLid = ownerLid; chg = true }
          if (chg) {
            await prisma.channel.update({ where: { id: channelId }, data: { settings: next as any } }).catch(() => {})
            // Atualiza a referência em memória pra próximas iterações desta sync
            ;(channel as any).settings = next
          }
        }
      }

      let fromContactId: string | null = null
      if (!fromMe) {
        const { contact, created } = await upsertWaSender(channel.workspaceId, msg.pushName ?? '', sParsed, sKnownLid)
        fromContactId = contact?.id ?? null
        if (created) counts.newContacts++
      }

      await prisma.message.create({
        data: {
          workspaceId: channel.workspaceId,
          conversationId: targetConvId,
          direction: fromMe ? 'OUTBOUND' : 'INBOUND',
          externalId: externalMsgId,
          fromContactId,
          body,
          sentAt,
          attachments: mediaInfo ? [mediaInfo] as any : undefined,
        },
      })
      // (contadores já incrementados quando o destino foi decidido)
    }

    // Atualiza lastMessageAt da conv LIVE se chegaram novas mensagens
    if (liveConv && liveLastSent && (!liveConv.lastMessageAt || liveLastSent > liveConv.lastMessageAt)) {
      await prisma.conversation.update({
        where: { id: liveConv.id },
        data: { lastMessageAt: liveLastSent },
      })
    }

    // Auto-dedup do chat ao final (defesa contra race com webhook em paralelo)
    try {
      const merged = await (await import('../messages/dedup.service.js')).dedupChatConversations(
        channel.workspaceId, channelId, remoteJid,
      )
      if (merged > 0) {
        logger.info({ remoteJid, merged }, 'Duplicatas mescladas durante sync')
      }
    } catch (err) {
      logger.warn({ err, remoteJid }, 'Auto-dedup per-chat falhou no sync (ignorada)')
    }
  }

  const totalMessages = counts.messagesLive + counts.messagesImported
  logger.info(
    { instanceName, importHistory, ...counts, totalMessages },
    'Sync WA concluído',
  )

  // ── Auto-dedup pós-sync ────────────────────────────────────────────────
  // 1) Contatos: LID → PN merge automático
  // 2) Conversas: mescla LIVE OPEN duplicadas (mesmo externalId OU mesmo contato canonical)
  try {
    const mergedContacts = await autoDedupContacts(channel.workspaceId)
    if (mergedContacts > 0) {
      logger.info({ workspaceId: channel.workspaceId, mergedContacts }, 'Contatos deduplicados pós-sync')
    }
    // Importa lazy pra evitar ciclo de dependências
    const { dedupConversations } = await import('../messages/dedup.service.js')
    const convResult = await dedupConversations(channel.workspaceId)
    if (convResult.merged > 0) {
      logger.info({ workspaceId: channel.workspaceId, ...convResult }, 'Conversas deduplicadas pós-sync')
    }
  } catch (err) {
    logger.warn({ err, channelId }, 'Auto-dedup pós-sync falhou (sync não foi afetado)')
  }

  // Marca a janela de sync como concluída (usado no próximo delta)
  await prisma.channel.update({
    where: { id: channelId },
    data: { lastSyncedAt: startedAt },
  })

  await eventBus.emitAndPersist(channel.workspaceId, 'channel.synced', {
    channelId,
    chats: chats.length,
    messages: totalMessages,
    importHistory,
    autoResolved: counts.autoResolved,
  })

  return {
    chats: chats.length,
    messages: totalMessages,
    messagesLive: counts.messagesLive,
    messagesImported: counts.messagesImported,
    newContacts: counts.newContacts,
    newHistoricalConvs: counts.newHistoricalConvs,
    autoResolved: counts.autoResolved,
    skipped: counts.skipped,
  }
}

/**
 * Detecta e mescla contatos duplicados num workspace inteiro.
 * Agrupa por `phone` (PN normalizado) E separadamente por `lid`.
 * Mescla cada grupo no mais antigo (que vira primário).
 * Retorna o número de contatos mesclados.
 */
export async function autoDedupContacts(workspaceId: string): Promise<number> {
  const all = await prisma.contact.findMany({
    where: {
      workspaceId,
      mergedIntoId: null,
      OR: [{ phone: { not: null } }, { lid: { not: null } }],
    },
    select: { id: true, phone: true, lid: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  const groups = new Map<string, typeof all>()
  for (const c of all) {
    if (c.phone) {
      const k = `pn:${c.phone}`
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(c)
    }
    if (c.lid) {
      const k = `lid:${c.lid}`
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(c)
    }
  }

  let merged = 0
  const alreadyMerged = new Set<string>()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const primary = group[0]
    for (const dup of group.slice(1)) {
      if (dup.id === primary.id || alreadyMerged.has(dup.id)) continue
      await mergeContacts(dup.id, primary.id)
      alreadyMerged.add(dup.id)
      merged++
    }
  }
  return merged
}

/** Sincroniza emails recebidos via IMAP */
export async function syncImapChannel(channelId: string): Promise<{
  chats: number
  messages: number
  skipped: number
}> {
  const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } })
  const cfg = channel.config as { ciphertext: string; iv: string; authTag: string }
  const smtpCfg = decryptJson<any>(
    Buffer.from(cfg.ciphertext, 'base64'),
    Buffer.from(cfg.iv, 'base64'),
    Buffer.from(cfg.authTag, 'base64'),
  )

  if (!smtpCfg.imapHost) {
    return { chats: 0, messages: 0, skipped: 0 }
  }

  // ── Descobre/persiste as pastas IMAP disponíveis ───────────────────────────
  // 1ª execução: lista todas as pastas do servidor e persiste em channel.settings.imapFolders.
  // Execuções seguintes: usa a lista persistida.
  const settings = (channel.settings as Record<string, unknown> | null) ?? {}
  let folders = Array.isArray(settings.imapFolders) ? (settings.imapFolders as string[]) : null
  if (!folders || folders.length === 0) {
    try {
      folders = await listImapFolders(smtpCfg)
      await prisma.channel.update({
        where: { id: channelId },
        data: { settings: { ...settings, imapFolders: folders } },
      })
      logger.info({ channelId, folders }, 'Pastas IMAP descobertas e persistidas')
    } catch (err: any) {
      logger.warn({ channelId, err: err?.message }, 'Falha ao listar pastas IMAP — caindo no INBOX')
      folders = ['INBOX']
    }
  }
  if (!folders.includes('INBOX')) folders.unshift('INBOX')

  // Limite por pasta — não queremos puxar 1000 emails se houver 20 pastas grandes
  const PER_FOLDER_LIMIT = Math.max(20, Math.floor(100 / Math.max(folders.length, 1)))

  let totalMessages = 0
  let totalSkipped = 0
  const conversationsSet = new Set<string>()

  for (const folder of folders) {
    let emails: Awaited<ReturnType<typeof fetchImapMessages>> = []
    try {
      emails = await fetchImapMessages(smtpCfg, PER_FOLDER_LIMIT, folder)
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      logger.warn({ channelId, folder, err: msg }, 'Erro ao buscar emails de pasta IMAP — pulando')
      continue
    }

    for (const email of emails) {
      const fromAddr = (email.from ?? '').trim().toLowerCase()
      if (!fromAddr) continue

      // Upsert contato pelo email — sempre lowercase pra evitar duplicidade
      // por casing (Foo@Bar.com vs foo@bar.com)
      let contact = await prisma.contact.findFirst({
        where: { workspaceId: channel.workspaceId, email: fromAddr, mergedIntoId: null },
      })
      if (!contact) {
        contact = await prisma.contact.create({
          data: {
            workspaceId: channel.workspaceId,
            email: fromAddr,
            name: (email.fromName || fromAddr).trim(),
          },
        })
      }

      // externalId = hash do thread-root (inReplyTo ou próprio messageId)
      const threadRoot = email.inReplyTo ?? email.messageId
      const externalId = threadHash(threadRoot)

      // externalId da mensagem individual (hash do messageId único)
      const msgExternalId = threadHash(email.messageId)

      let conversation = await prisma.conversation.findFirst({
        where: { channelId, externalId },
        orderBy: { createdAt: 'desc' },
      })
      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            workspaceId: channel.workspaceId,
            channelId,
            contactId: contact.id,
            externalId,
            folder,
            subject: email.subject,
            lastMessageAt: email.date,
            unreadCount: 1,
          },
        })
      } else if (conversation.folder !== folder) {
        // Conversa existente migrou de pasta (ex: usuário moveu manualmente no Gmail)
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { folder },
        })
      }
      conversationsSet.add(conversation.id)

      // Idempotência por messageId hasheado
      const exists = await prisma.message.findFirst({
        where: { conversationId: conversation.id, externalId: msgExternalId },
      })
      if (exists) { totalSkipped++; continue }

      const body = (email.text || email.subject || '').slice(0, 60_000)
      await prisma.message.create({
        data: {
          workspaceId: channel.workspaceId,
          conversationId: conversation.id,
          direction: 'INBOUND',
          externalId: msgExternalId,
          fromContactId: contact.id,
          body,
          bodyHtml: email.html ? email.html.slice(0, 500_000) : null,
          sentAt: email.date,
          // Persiste UID + folder IMAP — necessário pra moveImapMessage / delete
          metadata: { imapUid: email.uid, imapFolder: folder },
        },
      })
      totalMessages++

      // Atualiza lastMessageAt da conversa
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: email.date },
      })
    }
  }

  logger.info({ channelId, totalMessages, totalSkipped, folders }, 'Sync IMAP concluído')

  // ── Auto-dedup pós-sync (mesma lógica do WhatsApp) ─────────────────────────
  // Importante para email: se o usuário já tinha um contato com email em uppercase
  // antes do fix de lowercase, o dedup mescla.
  try {
    const merged = await autoDedupContacts(channel.workspaceId)
    if (merged > 0) {
      logger.info({ workspaceId: channel.workspaceId, merged }, 'Auto-dedup pós-sync IMAP concluída')
    }
  } catch (err) {
    logger.warn({ err, channelId }, 'Auto-dedup pós-sync IMAP falhou (sync não foi afetado)')
  }

  await eventBus.emitAndPersist(channel.workspaceId, 'channel.synced', {
    channelId,
    chats: conversationsSet.size,
    messages: totalMessages,
  })

  return { chats: conversationsSet.size, messages: totalMessages, skipped: totalSkipped }
}

/** Sincroniza fotos de perfil em background (não bloqueia o HTTP) */
export function syncWhatsAppAvatars(channelId: string): { started: true; message: string } {
  // Dispara em background sem await — retorna imediatamente
  void _runAvatarSync(channelId)
  return { started: true, message: 'Sincronização de fotos iniciada em background' }
}

async function _runAvatarSync(channelId: string) {
  try {
    const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } })
    const cfg = channel.config as { ciphertext: string; iv: string; authTag: string }
    const { instanceName } = decryptJson<{ instanceName: string }>(
      Buffer.from(cfg.ciphertext, 'base64'),
      Buffer.from(cfg.iv, 'base64'),
      Buffer.from(cfg.authTag, 'base64'),
    )

    // Busca contatos com telefone e filtra em memória quem ainda não tem avatar
    const allContacts = await prisma.contact.findMany({
      where: { workspaceId: channel.workspaceId, phone: { not: null } },
    })
    const contacts = allContacts.filter(
      (c) => !(c.metadata as Record<string, unknown> | null)?.avatarUrl,
    )

    logger.info({ channelId, total: contacts.length }, 'Iniciando sync de avatares WA')

    let updated = 0
    let skipped = 0

    for (const contact of contacts) {
      try {
        const avatarClient = await getClientForChannel(channelId)
        const result = await avatarClient.fetchProfilePicture(instanceName, contact.phone!)
        if (result.profilePictureUrl) {
          const meta = (contact.metadata as Record<string, unknown> | null) ?? {}
          await prisma.contact.update({
            where: { id: contact.id },
            data: { metadata: { ...meta, avatarUrl: result.profilePictureUrl } },
          })
          updated++
        } else {
          skipped++
        }
      } catch {
        skipped++
      }
      // 100ms entre requests para não sobrecarregar
      await new Promise((r) => setTimeout(r, 100))
    }

    logger.info({ channelId, updated, skipped }, 'Sync de avatares WA concluído')
  } catch (err) {
    logger.error({ channelId, err }, 'Erro no sync de avatares WA')
  }
}

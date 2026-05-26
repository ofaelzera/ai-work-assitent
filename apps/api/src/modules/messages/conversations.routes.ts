import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { getChannelConfig, getSmtpConfig, getMetaConfig } from '../channels/channels.service.js'
import { getClientForChannel } from '../evolution-servers/evolution-servers.service.js'
import { makeMetaClient } from '../channels/meta.client.js'
import { sendEmail, moveImapMessage } from '../channels/email.client.js'
import { dedupConversations } from './dedup.service.js'
import { routeNewConversation } from './routing.service.js'
import { Prisma } from '@prisma/client'

/**
 * Filtro de eligibility para queries de FILA (assigneeId=null).
 * Retorna:
 *  - `eligibleAssigneeIds IS NULL` (fila pública) OU
 *  - `userId IN eligibleAssigneeIds` (fila restrita ao usuário)
 *
 * Aplicado APENAS quando a query envolve convs sem dono.
 * Para "Todas"/"Outros" (supervisor view) NÃO se aplica — admin vê tudo.
 */
function eligibilityFilter(userId: string): Prisma.ConversationWhereInput {
  return {
    OR: [
      { eligibleAssigneeIds: { equals: Prisma.DbNull } },
      { eligibleAssigneeIds: { array_contains: userId } as any },
    ],
  }
}
import { sendSystemMessage, getUserMessageTemplate, getUserIgnoreGroups, createInternalEvent } from '../../lib/systemMessages.js'
import { eventBus } from '../../lib/eventBus.js'
import { logger } from '../../lib/logger.js'
import { hasPermission } from '../../lib/acl.js'
import type { MediaAttachment } from '../channels/media.utils.js'
import { env } from '../../config/env.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export const conversationsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Listar conversas
  app.get(
    '/conversations',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          channelId: z.string().optional(),
          channelType: z.enum(['WHATSAPP', 'GMAIL', 'IMAP_SMTP', 'INTERNAL']).optional(),
          channelTypeIn: z.string().optional(), // CSV: "WHATSAPP,GMAIL"
          excludeChannelType: z.string().optional(), // CSV
          folder: z.string().optional(),
          assigneeId: z.string().optional(),  // "me" | "unassigned" | "mine_and_queue" | <userId>
          companyId: z.string().optional(),   // filtra conversas da empresa (direto OU via contato)
          q: z.string().optional(),
          cursor: z.string().optional(),
          limit: z.coerce.number().default(50),
          filter: z.enum(['all', 'unread', 'favorites', 'groups', 'archived', 'resolved']).default('all'),
          includeImported: z.coerce.boolean().optional(),  // default false — esconde conversas IMPORTED
        }),
      },
    },
    async (req) => {
      const { workspaceId, sub: userId } = req.user
      const { channelId, channelType, channelTypeIn, excludeChannelType, folder, assigneeId, companyId, q, cursor, limit, filter, includeImported } = req.query

      // Resolve filtro de canal por tipo (single, CSV-in ou CSV-not-in)
      const channelTypeFilter: Record<string, unknown> = {}
      if (channelType) channelTypeFilter.type = channelType
      else if (channelTypeIn) {
        const list = channelTypeIn.split(',').filter(Boolean)
        if (list.length) channelTypeFilter.type = { in: list }
      } else if (excludeChannelType) {
        const list = excludeChannelType.split(',').filter(Boolean)
        if (list.length) channelTypeFilter.type = { notIn: list }
      }

      // ── Guard de visibilidade por permissão ───────────────────────────────
      // Quem tem `conversations.viewAll` (ADMIN/Supervisor): vê tudo, respeita
      //   o `assigneeId` que o frontend mandar.
      // Demais (Atendente): só vê o que é dele. Única exceção é quando ele pede
      //   explicitamente a Fila (`assigneeId=unassigned`) — aí mostra as não
      //   atribuídas pra ele poder assumir.
      const canViewAll = await hasPermission(req.user, 'conversations.viewAll')
      let assigneeFilter: Record<string, unknown> | null = null
      // Helper: combina filtro de assignee=null com eligibility (fila restrita).
      // Para admins/supervisores, eligibility é ignorado — vêem TODAS as convs da
      // fila e a UI mostra "Aguardando @user" para distinguir filas restritas.
      const queueClause = () =>
        canViewAll
          ? { assigneeId: null }
          : { AND: [{ assigneeId: null }, eligibilityFilter(userId)] }
      if (canViewAll) {
        assigneeFilter = assigneeId === 'unassigned'
          ? queueClause()
          : assigneeId === 'mine_and_queue'
          ? { OR: [{ assigneeId: userId }, queueClause()] }
          : assigneeId === 'others'
          // ADMIN-only: conversas com outros atendentes (excluindo as minhas e sem dono)
          ? { AND: [{ NOT: { assigneeId: null } }, { NOT: { assigneeId: userId } }] }
          : assigneeId
          ? { assigneeId: assigneeId === 'me' ? userId : assigneeId }
          : null
      } else {
        // Sem conversations.viewAll: só vê o que é dele
        if (assigneeId === 'unassigned') {
          assigneeFilter = queueClause()
        } else {
          // Qualquer outro caso (mine, todos, others, undefined) → força só as minhas
          assigneeFilter = { assigneeId: userId }
        }
      }
      const memberScope = null  // já incluso em assigneeFilter

      // Chat interno (DIRECT/GROUP) tem UI dedicada em /chat e NÃO deve aparecer
      // no Inbox — exceto quando o caller pede explicitamente channelType=INTERNAL.
      const askedForInternal = channelType === 'INTERNAL'

      const conversations = await prisma.conversation.findMany({
        where: {
          workspaceId,
          // Exclui status@broadcast (status do WhatsApp)
          NOT: { externalId: 'status@broadcast' },
          // Esconde conversas IMPORTED do inbox padrão (visíveis só via ContactDrawer/Histórico)
          ...(!includeImported && { source: 'LIVE' }),
          ...(channelId && { channelId }),
          ...(Object.keys(channelTypeFilter).length && { channel: channelTypeFilter as any }),
          ...(folder && { folder }),
          ...(askedForInternal
            ? {
                type: { in: ['DIRECT', 'GROUP'] },
                participants: { some: { userId, leftAt: null } },
              }
            : {
                // Só EXTERNAL no Inbox padrão
                type: 'EXTERNAL',
                AND: [
                  ...(memberScope ? [memberScope] : []),
                  ...(assigneeFilter ? [assigneeFilter] : []),
                ],
              }),
          // Arquivadas ficam separadas; demais filtros excluem arquivadas
          archived: filter === 'archived' ? true : false,
          // Por padrão mostra apenas tickets ativos; 'resolved' mostra apenas finalizados
          ...(filter === 'resolved'
            ? { status: 'RESOLVED' }
            : filter !== 'archived' ? { status: { in: ['OPEN', 'WAITING'] } } : {}),
          ...(filter === 'unread' && { unreadCount: { gt: 0 } }),
          ...(filter === 'favorites' && { favorite: true }),
          ...(filter === 'groups' && { isGroup: true }),
          ...(q && {
            OR: [
              { subject: { contains: q } },
              { contact: { name: { contains: q } } },
              { contact: { phone: { contains: q } } },
              { externalId: { contains: q } },
            ],
          }),
          // Filtro por empresa: pega conversas com vínculo direto OU via contato
          ...(companyId && {
            OR: [
              { companyId },
              { contact: { companyId } },
            ],
          }),
          ...(cursor && { lastMessageAt: { lt: new Date(cursor) } }),
        },
        orderBy: [
          { favorite: 'desc' },
          { lastMessageAt: 'desc' },
        ],
        // Sobre-busca pra compensar o dedup por (channelId, externalId) feito abaixo —
        // assim o usuário não perde tickets quando há múltiplos para o mesmo chat.
        take: limit * 2,
        include: {
          contact: { select: { id: true, name: true, phone: true, email: true, metadata: true, company: { select: { id: true, name: true, color: true } } } },
          channel: { select: { id: true, type: true, label: true } },
          assignee: { select: { id: true, name: true, email: true, settings: true } },
          company: { select: { id: true, name: true, color: true } },
          messages: {
            orderBy: { sentAt: 'desc' },
            take: 1,
            select: { body: true, sentAt: true, direction: true, attachments: true, fromUserId: true },
          },
          // Chat interno: participantes ativos (vazio em EXTERNAL — custo mínimo)
          participants: {
            where: { leftAt: null },
            include: { user: { select: { id: true, name: true, email: true } } },
          },
        },
      })

      // Dedup por (channelId, externalId) — modelo ticket cria múltiplas
      // conversations para o mesmo chat (uma por ciclo aberto/finalizado).
      // No inbox mostramos apenas a mais recente; o histórico completo fica
      // acessível pelo drawer do contato. Não deduplica chat interno (DIRECT/GROUP).
      const seenChat = new Set<string>()
      const dedupedAll: typeof conversations = []
      for (const c of conversations) {
        if (c.type === 'EXTERNAL' && c.externalId) {
          const key = `${c.channelId}:${c.externalId}`
          if (seenChat.has(key)) continue
          seenChat.add(key)
        }
        dedupedAll.push(c)
        if (dedupedAll.length >= limit) break
      }

      // Enriquece eligibleAssigneeIds com nome/email pra UI mostrar "Aguardando @X"
      const allEligibleIds = new Set<string>()
      for (const c of dedupedAll) {
        const ids = Array.isArray(c.eligibleAssigneeIds) ? (c.eligibleAssigneeIds as string[]) : []
        ids.forEach(id => allEligibleIds.add(id))
      }
      const eligibleUsersList = allEligibleIds.size > 0
        ? await prisma.user.findMany({
            where: { id: { in: Array.from(allEligibleIds) }, workspaceId },
            select: { id: true, name: true, email: true },
          })
        : []
      const eligibleUsersMap = new Map(eligibleUsersList.map(u => [u.id, u]))

      const dedupedConversations = dedupedAll.map(c => {
        const ids = Array.isArray(c.eligibleAssigneeIds) ? (c.eligibleAssigneeIds as string[]) : null
        return {
          ...c,
          eligibleAssignees: ids
            ? ids.flatMap(id => {
                const u = eligibleUsersMap.get(id)
                return u ? [u] : []
              })
            : null,
        }
      })

      const nextCursor =
        dedupedConversations.length === limit
          ? dedupedConversations[dedupedConversations.length - 1].lastMessageAt?.toISOString()
          : null

      // Contagem da fila para o usuário atual.
      // - Atendente: só conta convs que ele pode assumir (eligibilityFilter).
      // - Admin/Supervisor: conta TODAS as convs sem dono (visão geral da fila).
      const queueCount = await prisma.conversation.count({
        where: {
          workspaceId,
          archived: false,
          assigneeId: null,
          source: 'LIVE',
          status: { in: ['OPEN', 'WAITING'] },
          type: 'EXTERNAL',
          unreadCount: { gt: 0 },
          NOT: { externalId: 'status@broadcast' },
          ...(canViewAll ? {} : eligibilityFilter(userId)),
          ...(Object.keys(channelTypeFilter).length && { channel: channelTypeFilter as any }),
        },
      })

      return { conversations: dedupedConversations, nextCursor, queueCount }
    },
  )

  // ── Badges do Inbox: Fila + Minhas não lidas ────────────────────────────
  // Usado pelo item "Inbox" da sidebar; barato (dois COUNT com índice).
  app.get(
    '/inbox/badges',
    { onRequest: [app.authenticate] },
    async (req) => {
      const { workspaceId, sub: userId } = req.user
      const canViewAll = await hasPermission(req.user, 'conversations.viewAll')

      const baseExternal = {
        workspaceId,
        archived: false,
        source: 'LIVE' as const,
        status: { in: ['OPEN' as const, 'WAITING' as const] },
        type: 'EXTERNAL' as const,
        NOT: { externalId: 'status@broadcast' },
      }

      const [queueCount, myUnreadCount] = await Promise.all([
        // Fila: atendente só conta o que pode assumir; admin conta tudo (visão geral).
        prisma.conversation.count({
          where: {
            ...baseExternal,
            assigneeId: null,
            unreadCount: { gt: 0 },
            ...(canViewAll ? {} : eligibilityFilter(userId)),
          },
        }),
        prisma.conversation.count({
          where: { ...baseExternal, assigneeId: userId, unreadCount: { gt: 0 } },
        }),
      ])

      return { queueCount, myUnreadCount }
    },
  )

  // ── Deduplicar conversas LIVE OPEN ──────────────────────────────────────
  // Mescla quando há mais de uma conv OPEN para a mesma combinação:
  //   1) mesmo (channelId, externalId)     — race condition sync/webhook
  //   2) mesmo (channelId, contactId)      — LID/PN do mesmo contato (após merge)
  // Mantém o mais antigo (primary), move mensagens, deleta o resto.
  app.post(
    '/conversations/dedup',
    { onRequest: [app.authenticate] },
    async (req) => {
      const { workspaceId } = req.user
      const result = await dedupConversations(workspaceId)
      return result
    },
  )

  // Toggle favorito
  app.patch(
    '/conversations/:id/favorite',
    { onRequest: [app.authenticate] },
    async (req) => {
      const { workspaceId } = req.user
      const { id } = req.params as { id: string }
      const conv = await prisma.conversation.findFirstOrThrow({ where: { id, workspaceId } })
      return prisma.conversation.update({
        where: { id },
        data: { favorite: !conv.favorite },
        select: { id: true, favorite: true },
      })
    },
  )

  // Toggle arquivar
  app.patch(
    '/conversations/:id/archive',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { workspaceId } = req.user
      if (!(await hasPermission(req.user, 'conversations.archive'))) {
        return reply.forbidden('Sem permissão pra arquivar conversas')
      }
      const { id } = req.params as { id: string }
      const conv = await prisma.conversation.findFirstOrThrow({ where: { id, workspaceId } })
      return prisma.conversation.update({
        where: { id },
        data: { archived: !conv.archived },
        select: { id: true, archived: true },
      })
    },
  )

  // Mensagens de uma conversa
  app.get(
    '/conversations/:id/messages',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        querystring: z.object({
          cursor: z.string().optional(),
          limit: z.coerce.number().default(50),
        }),
      },
    },
    async (req) => {
      const { workspaceId } = req.user
      const { id } = req.params
      const { cursor, limit } = req.query

      // Marcar como lido no banco
      await prisma.conversation.updateMany({
        where: { id, workspaceId },
        data: { unreadCount: 0 },
      })

      const messages = await prisma.message.findMany({
        where: {
          conversationId: id,
          workspaceId,
          ...(cursor && { sentAt: { lt: new Date(cursor) } }),
        },
        orderBy: { sentAt: 'desc' },
        take: limit,
        include: {
          fromContact: { select: { id: true, name: true, phone: true, metadata: true } },
          fromUser: { select: { id: true, name: true, email: true, settings: true } },
        },
      })

      const conversation = await prisma.conversation.findUnique({
        where: { id },
        include: {
          contact: { select: { id: true, name: true, phone: true, email: true, metadata: true, companyId: true } },
          channel: { select: { id: true, type: true, label: true, signature: true, settings: true } },
          assignee: { select: { id: true, name: true, email: true, settings: true } },
          company: { select: { id: true, name: true, color: true } },
        },
      })

      // Para canais WhatsApp e Meta WhatsApp: envia read receipt
      if ((conversation?.channel.type === 'WHATSAPP' || conversation?.channel.type === 'META_WHATSAPP') && !cursor) {
        try {
          const remoteJid = conversation.externalId
          const phoneNumber = remoteJid.replace(/@.+$/, '')

          const unreadIds = messages
            .filter(m => m.direction === 'INBOUND' && m.externalId)
            .map(m => m.externalId!)

          if (unreadIds.length > 0) {
            if (conversation.channel.type === 'WHATSAPP') {
              const { instanceName } = await getChannelConfig(conversation.channelId)
              const waClient = await getClientForChannel(conversation.channelId)
              await waClient.markMessageAsRead(instanceName, remoteJid, unreadIds).catch(() => {})
              await waClient.subscribePresence(instanceName, phoneNumber).catch(() => {})
            } else if (conversation.channel.type === 'META_WHATSAPP') {
              const metaCredentials = await getMetaConfig(conversation.channelId)
              const metaClient = makeMetaClient(metaCredentials)
              for (const msgId of unreadIds) {
                await metaClient.markAsRead(msgId).catch(() => {})
              }
            }
          }
        } catch {
          // Falhas aqui não devem quebrar o carregamento da conversa
        }
      }

      const nextCursor =
        messages.length === limit ? messages[messages.length - 1].sentAt.toISOString() : null

      return { conversation, messages: messages.reverse(), nextCursor }
    },
  )

  // Enviar mensagem
  app.post(
    '/conversations/:id/messages',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          text: z.string().min(1),
          html: z.string().optional(),
          quotedMsgId: z.string().optional(),   // externalId da msg citada
          quotedBody: z.string().optional(),    // preview do corpo citado
          quotedSender: z.string().optional(),  // nome do remetente citado
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId, role } = req.user
      const { id } = req.params
      const { text, html, quotedMsgId, quotedBody, quotedSender } = req.body

      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id, workspaceId },
        include: {
          channel: true,
          contact: { select: { email: true } },
          assignee: { select: { id: true, name: true, email: true, settings: true } },
        },
      })

      // Quem está enviando (usado pro prefixo "Nome: ...")
      const sender = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      })
      const senderName = (sender?.name ?? sender?.email ?? '').trim().split('@')[0]

      // ── Guard de escrita: ADMIN sempre pode; MEMBER só se for o assignee ──
      if (role !== 'ADMIN') {
        if (!conversation.assigneeId) {
          return reply.forbidden(JSON.stringify({
            error: 'forbidden',
            reason: 'unassigned',
            message: 'Assuma a conversa antes de enviar mensagens.',
          }))
        }
        if (conversation.assigneeId !== userId) {
          return reply.forbidden(JSON.stringify({
            error: 'forbidden',
            reason: 'assignedToOther',
            assignee: conversation.assignee,
            message: `Esta conversa está em atendimento por ${conversation.assignee?.name ?? 'outro atendente'}.`,
          }))
        }
      }

      let externalId: string | undefined
      let bodyHtml: string | null = null

      // Texto final enviado (com prefixo do atendente se a config estiver ligada)
      const channelSettings = (conversation.channel.settings as Record<string, unknown> | null) ?? {}
      const prefixSenderName = channelSettings.prefixSenderName !== false  // default: true
      const outboundText = (conversation.channel.type === 'WHATSAPP' && prefixSenderName && senderName)
        ? `*${senderName}:*\n${text}`
        : text

      if (conversation.channel.type === 'WHATSAPP') {
        // WhatsApp: envia via Evolution API
        const { instanceName } = await getChannelConfig(conversation.channelId)
        const waClient = await getClientForChannel(conversation.channelId)
        const quoted = quotedMsgId && quotedBody
          ? { id: quotedMsgId, remoteJid: conversation.externalId, fromMe: false, body: quotedBody }
          : undefined
        const result = await waClient.sendText(instanceName, conversation.externalId, outboundText, quoted)
        externalId = result.key?.id

      } else if (conversation.channel.type === 'META_WHATSAPP') {
        // Meta Oficial WhatsApp
        const metaCredentials = await getMetaConfig(conversation.channelId)
        const metaClient = makeMetaClient(metaCredentials)
        
        const phone = conversation.externalId.replace('@s.whatsapp.net', '')
        const result = await metaClient.sendWhatsAppText(phone, outboundText)
        
        externalId = result.messages?.[0]?.id
      } else if (conversation.channel.type === 'IMAP_SMTP') {
        // Email: envia via SMTP
        const toEmail = conversation.contact?.email ?? conversation.externalId
        if (!toEmail || !toEmail.includes('@')) {
          return reply.badRequest('Email do destinatário não encontrado')
        }

        const smtpCfg = await getSmtpConfig(conversation.channelId)
        const subject = conversation.subject
          ? `Re: ${conversation.subject.replace(/^(Re:\s*)+/i, '')}`
          : 'Re: (sem assunto)'

        const messageId = await sendEmail(smtpCfg, toEmail, subject, text, html ?? undefined)
        externalId = messageId
        bodyHtml = html ?? null
      }

      // Salvar no banco com o texto EXATO que foi enviado (com prefixo se aplicável)
      // — assim o painel reflete o que o cliente vê na conversa.
      const message = await prisma.message.create({
        data: {
          workspaceId,
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          externalId,
          fromUserId: userId,
          body: outboundText,
          bodyHtml,
          sentAt: new Date(),
          deliveryStatus: (conversation.channel.type === 'WHATSAPP' || conversation.channel.type === 'META_WHATSAPP') ? 'PENDING' : null,
          quotedMsgId: quotedMsgId ?? null,
          quotedBody: quotedBody ?? null,
          quotedSender: quotedSender ?? null,
        },
      })

      await prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: new Date() },
      })

      await eventBus.emitAndPersist(workspaceId, 'message.sent', {
        messageId: message.id,
        conversationId: conversation.id,
      })

      return reply.code(201).send(message)
    },
  )

  // Proxy de mídia: busca base64 da Evolution e devolve como binário
  app.get(
    '/messages/:id/media',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const message = await prisma.message.findUniqueOrThrow({
        where: { id: req.params.id },
        include: { conversation: { include: { channel: true } } },
      })

      if (message.workspaceId !== workspaceId) return reply.forbidden()

      const attachments = message.attachments as (MediaAttachment & { storageKey?: string })[] | null
      if (!attachments?.length) return reply.notFound('Sem anexo')

      const att = attachments[0]

      // Tenta servir do arquivo local primeiro (salvo no ingest)
      if (att.storageKey) {
        try {
          const fullPath = path.join(env.STORAGE_PATH, att.storageKey)
          const buffer = await fs.readFile(fullPath)
          reply.header('Content-Type', att.mimetype)
          reply.header('Content-Length', buffer.length)
          reply.header('Cache-Control', 'private, max-age=604800') // 7 dias — arquivo local não expira
          return reply.send(buffer)
        } catch {
          // Arquivo local não encontrado — fallback para Evolution API
        }
      }

      // Fallback: busca da Evolution API (CDN WhatsApp — pode expirar)
      const { instanceName } = await getChannelConfig(message.conversation.channelId)
      const waClient = await getClientForChannel(message.conversation.channelId)
      let base64: string
      let mimetype: string
      try {
        const result = await waClient.getMediaBase64(instanceName, att.key)
        base64 = result.base64
        mimetype = result.mimetype
      } catch (err: any) {
        // URL de mídia expirada no WhatsApp CDN (mmg.whatsapp.net)
        const msg = String(err?.message ?? '')
        if (msg.includes('400') || msg.includes('Failed to fetch stream') || msg.includes('expired')) {
          return reply.status(410).send({ error: 'Mídia expirada', expired: true })
        }
        throw err
      }

      const buffer = Buffer.from(base64, 'base64')
      reply.header('Content-Type', mimetype ?? att.mimetype)
      reply.header('Content-Length', buffer.length)
      reply.header('Cache-Control', 'private, max-age=86400')
      return reply.send(buffer)
    },
  )

  // Enviar mídia
  app.post(
    '/conversations/:id/messages/media',
    { onRequest: [app.authenticate] },
    async (req: any, reply) => {
      const { workspaceId } = req.user
      const { id } = req.params

      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id, workspaceId },
        include: { channel: true },
      })

      const data = await req.file()
      if (!data) return reply.badRequest('Arquivo obrigatório')

      const chunks: Buffer[] = []
      for await (const chunk of data.file) chunks.push(chunk)
      const buffer = Buffer.concat(chunks)
      const base64 = buffer.toString('base64')
      const mimetype: string = data.mimetype
      const filename: string = data.filename
      const rawCaption: string = data.fields?.caption?.value ?? ''

      let mediatype: string
      if (mimetype.startsWith('image/')) mediatype = 'image'
      else if (mimetype.startsWith('video/')) mediatype = 'video'
      else if (mimetype.startsWith('audio/')) mediatype = 'audio'
      else mediatype = 'document'

      // Prefixo do atendente na legenda (se setting ligado)
      const channelSettings = (conversation.channel.settings as Record<string, unknown> | null) ?? {}
      const prefixSenderName = channelSettings.prefixSenderName !== false  // default: true
      const sender = await prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { name: true, email: true },
      })
      const senderName = (sender?.name ?? sender?.email ?? '').trim().split('@')[0]
      const caption = (conversation.channel.type === 'WHATSAPP' && prefixSenderName && senderName && rawCaption)
        ? `*${senderName}:*\n${rawCaption}`
        : rawCaption

      let externalId: string | undefined
      if (conversation.channel.type === 'WHATSAPP') {
        const { instanceName } = await getChannelConfig(conversation.channelId)
        const waClient = await getClientForChannel(conversation.channelId)
        const result = await waClient.sendMedia(
          instanceName, conversation.externalId,
          mediatype, mimetype, caption, base64,
          mediatype === 'document' ? filename : undefined,
        )
        externalId = result.key?.id
      } else if (conversation.channel.type === 'META_WHATSAPP') {
        const metaCredentials = await getMetaConfig(conversation.channelId)
        const metaClient = makeMetaClient(metaCredentials)
        
        const mediaId = await metaClient.uploadMedia(buffer, mimetype, filename)
        const phone = conversation.externalId.replace('@s.whatsapp.net', '')
        const result = await metaClient.sendWhatsAppMedia(phone, mediatype as any, mediaId, caption, mediatype === 'document' ? filename : undefined)
        
        externalId = result.messages?.[0]?.id
      }

      const body = caption || `[${mediatype}]`
      const att: MediaAttachment = {
        type: mediatype as any,
        mimetype,
        caption: caption || undefined,
        filename: mediatype === 'document' ? filename : undefined,
        key: { id: externalId ?? '', remoteJid: conversation.externalId, fromMe: true },
      }

      const message = await prisma.message.create({
        data: {
          workspaceId,
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          externalId,
          fromUserId: req.user.sub,
          body,
          sentAt: new Date(),
          attachments: [att] as any,
        },
      })

      await prisma.conversation.update({ where: { id }, data: { lastMessageAt: new Date() } })
      await eventBus.emitAndPersist(workspaceId, 'message.sent', { messageId: message.id, conversationId: id })

      return reply.code(201).send(message)
    },
  )

  // ── Enviar arquivo da biblioteca pra conversa ────────────────────────────
  // Reutiliza um Attachment já no storage (sem re-upload do cliente).
  app.post(
    '/conversations/:id/messages/from-library',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          attachmentId: z.string(),
          caption: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId, role } = req.user
      const { id } = req.params
      const { attachmentId, caption } = req.body

      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id, workspaceId },
        include: { channel: true, assignee: { select: { id: true, name: true, email: true, settings: true } } },
      })

      // Mesmo guard de escrita das mensagens normais
      if (role !== 'ADMIN') {
        if (!conversation.assigneeId) {
          return reply.forbidden('Assuma a conversa antes de enviar')
        }
        if (conversation.assigneeId !== userId) {
          return reply.forbidden(`Em atendimento por ${conversation.assignee?.name ?? 'outro atendente'}`)
        }
      }

      // Verifica acesso ao arquivo: dono OU PUBLIC OU compartilhado comigo
      const file = await prisma.attachment.findFirst({
        where: { id: attachmentId, workspaceId },
        include: { shares: { where: { userId } } },
      })
      if (!file) return reply.notFound('Arquivo não encontrado')

      const hasAccess = file.uploadedBy === userId
        || file.visibility === 'PUBLIC'
        || (file.visibility === 'SHARED' && file.shares.length > 0)
        || role === 'ADMIN'
      if (!hasAccess) {
        return reply.forbidden('Sem acesso a este arquivo')
      }

      // Carrega o binário do disco
      const fullPath = path.join(env.STORAGE_PATH, file.storageKey)
      let buffer: Buffer
      try {
        buffer = await fs.readFile(fullPath)
      } catch {
        return reply.notFound('Arquivo não encontrado no disco')
      }

      // Determina tipo + prefixo do atendente na legenda
      const mime = file.mimeType
      let mediatype: string
      if (mime.startsWith('image/')) mediatype = 'image'
      else if (mime.startsWith('video/')) mediatype = 'video'
      else if (mime.startsWith('audio/')) mediatype = 'audio'
      else mediatype = 'document'

      const channelSettings = (conversation.channel.settings as Record<string, unknown> | null) ?? {}
      const prefixSenderName = channelSettings.prefixSenderName !== false
      const sender = await prisma.user.findUnique({
        where: { id: userId }, select: { name: true, email: true },
      })
      const senderName = (sender?.name ?? sender?.email ?? '').trim().split('@')[0]
      const finalCaption = (conversation.channel.type === 'WHATSAPP' && prefixSenderName && senderName && caption)
        ? `*${senderName}:*\n${caption}`
        : (caption ?? '')

      let externalId: string | undefined
      if (conversation.channel.type === 'WHATSAPP') {
        const { instanceName } = await getChannelConfig(conversation.channelId)
        const waClient = await getClientForChannel(conversation.channelId)
        const result = await waClient.sendMedia(
          instanceName, conversation.externalId,
          mediatype, mime, finalCaption, buffer.toString('base64'),
          mediatype === 'document' ? file.filename : undefined,
        )
        externalId = result.key?.id
      } else if (conversation.channel.type === 'META_WHATSAPP') {
        const metaCredentials = await getMetaConfig(conversation.channelId)
        const metaClient = makeMetaClient(metaCredentials)
        
        const mediaId = await metaClient.uploadMedia(buffer, mime, file.filename)
        const phone = conversation.externalId.replace('@s.whatsapp.net', '')
        const result = await metaClient.sendWhatsAppMedia(phone, mediatype as any, mediaId, finalCaption, mediatype === 'document' ? file.filename : undefined)
        
        externalId = result.messages?.[0]?.id
      }

      const body = finalCaption || `[${mediatype}]`
      const att = {
        type: mediatype,
        mimetype: mime,
        caption: finalCaption || undefined,
        filename: mediatype === 'document' ? file.filename : undefined,
        key: { id: externalId ?? '', remoteJid: conversation.externalId, fromMe: true },
        libraryAttachmentId: file.id,
      }

      const message = await prisma.message.create({
        data: {
          workspaceId,
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          externalId,
          fromUserId: userId,
          body,
          sentAt: new Date(),
          attachments: [att] as any,
        },
      })

      await prisma.conversation.update({ where: { id }, data: { lastMessageAt: new Date() } })
      await eventBus.emitAndPersist(workspaceId, 'message.sent', { messageId: message.id, conversationId: id })

      return reply.code(201).send(message)
    },
  )

  // Iniciar nova conversa
  app.post(
    '/conversations/new',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          channelId: z.string(),
          contactId: z.string().optional(),
          phone: z.string().optional(),    // WhatsApp: número direto
          email: z.string().email().optional(), // Email
          subject: z.string().optional(),
          text: z.string().min(1),
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const { channelId, contactId, phone, email, subject, text } = req.body

      const channel = await prisma.channel.findFirstOrThrow({ where: { id: channelId, workspaceId } })

      let contact = contactId
        ? await prisma.contact.findFirstOrThrow({ where: { id: contactId, workspaceId } })
        : null

      // Determina o externalId da conversa
      let externalId: string
      if (channel.type === 'WHATSAPP') {
        const rawPhone = phone ?? contact?.phone ?? ''
        const digits = rawPhone.replace(/\D/g, '')
        externalId = `${digits}@s.whatsapp.net`
      } else {
        const toEmail = email ?? contact?.email ?? ''
        externalId = toEmail
      }

      if (!externalId || externalId === '@s.whatsapp.net') {
        return reply.badRequest('Telefone ou email obrigatório')
      }

      // Cria ou busca o contato
      if (!contact) {
        const lookupWhere = channel.type === 'WHATSAPP'
          ? { workspaceId, phone: externalId.replace('@s.whatsapp.net', '') }
          : { workspaceId, email: email ?? '' }
        contact = await prisma.contact.findFirst({ where: lookupWhere })
          ?? await prisma.contact.create({
            data: { workspaceId, phone: channel.type === 'WHATSAPP' ? externalId.replace('@s.whatsapp.net', '') : undefined, email: channel.type !== 'WHATSAPP' ? (email ?? undefined) : undefined },
          })
      }

      // Cria ou busca conversa existente (ativa)
      let conversation = await prisma.conversation.findFirst({
        where: { channelId, externalId, workspaceId, status: { in: ['OPEN', 'WAITING'] } },
        orderBy: { createdAt: 'desc' },
      })
      if (!conversation) {
        // Conv proativa iniciada por atendente: aplica routing com autoAssign=true.
        // Se houver regra fixed/RR, atribui ao designado (assume na hora).
        // Senão, fica com o próprio criador como dono.
        const route = await routeNewConversation({
          workspaceId,
          channelId,
          contactId: contact.id,
          autoAssign: true,
          fallbackUserId: req.user.sub,
        })
        const now = new Date()
        conversation = await prisma.conversation.create({
          data: {
            workspaceId,
            channelId,
            contactId: contact.id,
            externalId,
            subject,
            lastMessageAt: now,
            unreadCount: 0,
            assigneeId: route.assigneeId,
            claimedAt: route.assigneeId ? now : null,
            lastQueuedAt: now,
          },
        })
        logger.info(
          { conversationId: conversation.id, assigneeId: route.assigneeId, source: route.source, distMode: route.distMode },
          'Nova conversa proativa criada',
        )
      }

      // Envia a primeira mensagem
      let msgExternalId: string | undefined
      if (channel.type === 'WHATSAPP') {
        const { instanceName } = await getChannelConfig(channelId)
        const waClient = await getClientForChannel(channelId)
        const result = await waClient.sendText(instanceName, externalId, text)
        msgExternalId = result.key?.id
      } else if (channel.type === 'IMAP_SMTP') {
        const smtpCfg = await getSmtpConfig(channelId)
        const toEmail = email ?? contact?.email ?? externalId
        msgExternalId = await sendEmail(smtpCfg, toEmail, subject ?? '(sem assunto)', text)
      }

      const now = new Date()
      const message = await prisma.message.create({
        data: { workspaceId, conversationId: conversation.id, direction: 'OUTBOUND', externalId: msgExternalId, fromUserId: req.user.sub, body: text, sentAt: now },
      })

      // Rastreia primeira resposta e muda status para WAITING (aguardando cliente)
      const convUpdate: Record<string, any> = { lastMessageAt: now, status: 'WAITING' }
      if (!conversation.firstResponseAt) {
        // Calcula tempo desde a última mensagem inbound
        const lastInbound = await prisma.message.findFirst({
          where: { conversationId: conversation.id, direction: 'INBOUND' },
          orderBy: { sentAt: 'desc' },
          select: { sentAt: true },
        })
        convUpdate.firstResponseAt = now
        if (lastInbound) {
          const responseMs = now.getTime() - lastInbound.sentAt.getTime()
          // Salva o tempo de resposta no EventLog para métricas
          await eventBus.emitAndPersist(workspaceId, 'conversation.first_response', {
            conversationId: conversation.id,
            responseMs,
            responseMinutes: Math.round(responseMs / 60000),
          })
        }
      }
      await prisma.conversation.update({ where: { id: conversation.id }, data: convUpdate })

      return reply.code(201).send({ conversation, message })
    },
  )

  // Enviar presença (digitando / parou) para o contato no WhatsApp
  app.post(
    '/conversations/:id/presence',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          presence: z.enum(['composing', 'recording', 'paused']),
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const { id } = req.params
      const { presence } = req.body

      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id, workspaceId },
        include: { channel: true },
      })

      if (conversation.channel.type !== 'WHATSAPP') return reply.send({ ok: true })

      try {
        const { instanceName } = await getChannelConfig(conversation.channelId)
        const waClient = await getClientForChannel(conversation.channelId)
        // Evolution espera só o número sem sufixo JID
        const phoneNumber = conversation.externalId.replace(/@.+$/, '')
        await waClient.sendPresence(instanceName, phoneNumber, presence)
      } catch {
        // Silencioso — presença é best-effort
      }

      return reply.send({ ok: true })
    },
  )

  // ── Enviar reação a uma mensagem WhatsApp ───────────────────────────────────
  app.post(
    '/conversations/:id/messages/:messageId/reaction',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string(), messageId: z.string() }),
        body: z.object({ reaction: z.string() }),
      },
    },
    async (req: any, reply) => {
      const { workspaceId, sub: userId } = req.user
      const { id, messageId } = req.params
      const { reaction } = req.body

      const message = await prisma.message.findFirst({
        where: { id: messageId, workspaceId },
        include: { conversation: { include: { channel: { select: { type: true } } } } }
      })
      if (!message) return reply.notFound('Mensagem não encontrada')

      const conversation = message.conversation
      if (conversation.channel.type !== 'WHATSAPP') return reply.badRequest('Apenas canais WhatsApp')
      if (!message.externalId) return reply.badRequest('Mensagem sem ID externo')

      const { instanceName } = await getChannelConfig(conversation.channelId)
      const waClient = await getClientForChannel(conversation.channelId)
      await waClient.sendReaction(instanceName, conversation.externalId, message.externalId, reaction)

      const existingMeta = (message.metadata ?? {}) as any
      const existingReactions: any[] = existingMeta.reactions ?? []
      const filtered = existingReactions.filter((r: any) => r.senderId !== userId)
      const newReactions = reaction
        ? [...filtered, { emoji: reaction, senderId: userId, fromMe: true }]
        : filtered
      await prisma.message.update({
        where: { id: messageId },
        data: { metadata: { ...existingMeta, reactions: newReactions } },
      })
      await eventBus.emitAndPersist(workspaceId, 'message.updated', { messageId, conversationId: conversation.id, reactions: newReactions })

      return { ok: true }
    },
  )

  // ── Deletar mensagem para todos ──────────────────────────────────────────────
  app.delete(
    '/conversations/:id/messages/:messageId',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string(), messageId: z.string() }) },
    },
    async (req: any, reply) => {
      const { workspaceId, sub: userId, role } = req.user
      const { id, messageId } = req.params

      const message = await prisma.message.findFirst({
        where: { id: messageId, workspaceId },
        include: { conversation: { include: { channel: { select: { type: true } } } } }
      })
      if (!message) return reply.notFound('Mensagem não encontrada')

      const conversation = message.conversation

      if (role !== 'ADMIN' && message.fromUserId !== userId) {
        return reply.forbidden('Sem permissão para deletar esta mensagem')
      }

      if (conversation.channel.type === 'WHATSAPP' && message.externalId) {
        try {
          const { instanceName } = await getChannelConfig(conversation.channelId)
          const waClient = await getClientForChannel(conversation.channelId)
          await waClient.deleteMessage(instanceName, conversation.externalId, message.externalId, message.direction === 'OUTBOUND')
        } catch {
          // Falha silenciosa — mensagem pode já ter sido deletada no WA
        }
      }

      await prisma.message.update({
        where: { id: messageId },
        data: {
          body: '🚫 Esta mensagem foi apagada.',
          attachments: [],
          metadata: { ...((message.metadata as any) ?? {}), deleted: true },
        },
      })

      await eventBus.emitAndPersist(workspaceId, 'message.deleted', { messageId, conversationId: conversation.id })

      return reply.code(204).send()
    },
  )

  // ── Editar mensagem enviada ──────────────────────────────────────────────────
  app.patch(
    '/conversations/:id/messages/:messageId',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string(), messageId: z.string() }),
        body: z.object({ text: z.string().min(1) }),
      },
    },
    async (req: any, reply) => {
      const { workspaceId, sub: userId, role } = req.user
      const { id, messageId } = req.params
      const { text } = req.body

      const message = await prisma.message.findFirst({
        where: { id: messageId, workspaceId, direction: 'OUTBOUND' },
        include: { conversation: { include: { channel: { select: { type: true } } } } }
      })
      if (!message) return reply.notFound()

      const conversation = message.conversation
      if (conversation.channel.type !== 'WHATSAPP') return reply.badRequest('Apenas canais WhatsApp')
      if (message.fromUserId !== userId && role !== 'ADMIN') return reply.forbidden()
      if (!message.externalId) return reply.badRequest('Mensagem sem ID externo')

      const { instanceName } = await getChannelConfig(conversation.channelId)
      const waClient = await getClientForChannel(conversation.channelId)
      await waClient.updateMessage(instanceName, conversation.externalId, message.externalId, text)

      await prisma.message.update({
        where: { id: messageId },
        data: { body: text, metadata: { ...((message.metadata as any) ?? {}), edited: true } },
      })

      await eventBus.emitAndPersist(workspaceId, 'message.updated', { messageId, conversationId: conversation.id })
      return { ok: true }
    },
  )

  // ── Enviar localização ───────────────────────────────────────────────────────
  app.post(
    '/conversations/:id/send/location',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          latitude: z.number(),
          longitude: z.number(),
          name: z.string().optional(),
          address: z.string().optional(),
        }),
      },
    },
    async (req: any, reply) => {
      const { workspaceId } = req.user
      const { id } = req.params
      const { latitude, longitude, name, address } = req.body

      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id, workspaceId },
        include: { channel: { select: { type: true } } },
      })
      if (conversation.channel.type !== 'WHATSAPP') return reply.badRequest('Apenas canais WhatsApp')

      const { instanceName } = await getChannelConfig(conversation.channelId)
      const waClient = await getClientForChannel(conversation.channelId)
      let result: any
      try {
        result = await waClient.sendLocation(instanceName, conversation.externalId, latitude, longitude, name, address)
      } catch (err: any) {
        logger.error({ err: err?.message, instanceName, remoteJid: conversation.externalId }, 'Erro sendLocation Evolution API')
        return reply.internalServerError(err?.message ?? 'Erro ao enviar localização na Evolution API')
      }

      const body = `📍 ${name ?? `${latitude}, ${longitude}`}`
      await prisma.message.create({
        data: {
          workspaceId,
          conversationId: id,
          direction: 'OUTBOUND',
          fromUserId: req.user.sub,
          externalId: (result as any)?.key?.id ?? undefined,
          body,
          sentAt: new Date(),
          attachments: [{ kind: 'location', latitude, longitude, name, address }] as any,
        },
      })

      await eventBus.emitAndPersist(workspaceId, 'message.received', { conversationId: id })
      return reply.code(201).send({ ok: true })
    },
  )

  // ── Enviar contato (vCard) ────────────────────────────────────────────────────
  app.post(
    '/conversations/:id/send/contact',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          fullName: z.string().min(1),
          phoneNumber: z.string().min(1),
          waid: z.string().optional(),
          organization: z.string().optional(),
        }),
      },
    },
    async (req: any, reply) => {
      const { workspaceId } = req.user
      const { id } = req.params
      const { fullName, phoneNumber, waid, organization } = req.body

      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id, workspaceId },
        include: { channel: { select: { type: true } } },
      })
      if (conversation.channel.type !== 'WHATSAPP') return reply.badRequest('Apenas canais WhatsApp')

      const { instanceName } = await getChannelConfig(conversation.channelId)
      const waClient = await getClientForChannel(conversation.channelId)
      const result = await waClient.sendContact(instanceName, conversation.externalId, [{
        fullName, phoneNumber, waid: waid ?? phoneNumber.replace(/\D/g, ''), organization,
      }])

      await prisma.message.create({
        data: {
          workspaceId,
          conversationId: id,
          direction: 'OUTBOUND',
          fromUserId: req.user.sub,
          externalId: (result as any)?.key?.id ?? undefined,
          body: `👤 ${fullName} — ${phoneNumber}`,
          sentAt: new Date(),
          attachments: [{ kind: 'contact', fullName, phoneNumber, organization }] as any,
        },
      })

      await eventBus.emitAndPersist(workspaceId, 'message.received', { conversationId: id })
      return reply.code(201).send({ ok: true })
    },
  )

  // ── Enviar enquete (poll) ────────────────────────────────────────────────────
  app.post(
    '/conversations/:id/send/poll',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().min(1),
          values: z.array(z.string().min(1)).min(2).max(12),
          selectableCount: z.number().int().min(1).default(1),
        }),
      },
    },
    async (req: any, reply) => {
      const { workspaceId } = req.user
      const { id } = req.params
      const { name, values, selectableCount } = req.body

      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id, workspaceId },
        include: { channel: { select: { type: true } } },
      })
      if (conversation.channel.type !== 'WHATSAPP') return reply.badRequest('Apenas canais WhatsApp')
      if (!conversation.isGroup) return reply.badRequest('Enquetes só funcionam em conversas de grupo')

      const { instanceName } = await getChannelConfig(conversation.channelId)
      const waClient = await getClientForChannel(conversation.channelId)
      const result = await waClient.sendPoll(instanceName, conversation.externalId, name, values, selectableCount)

      await prisma.message.create({
        data: {
          workspaceId,
          conversationId: id,
          direction: 'OUTBOUND',
          fromUserId: req.user.sub,
          externalId: (result as any)?.key?.id ?? undefined,
          body: `📊 ${name}\n${(values as string[]).map((v: string, i: number) => `${i + 1}. ${v}`).join('\n')}`,
          sentAt: new Date(),
          attachments: [{ kind: 'poll', name, values, selectableCount }] as any,
        },
      })

      await eventBus.emitAndPersist(workspaceId, 'message.received', { conversationId: id })
      return reply.code(201).send({ ok: true })
    },
  )

  // ── Bloquear/desbloquear contato ──────────────────────────────────────────────
  app.patch(
    '/conversations/:id/block',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ action: z.enum(['block', 'unblock']) }),
      },
    },
    async (req: any, reply) => {
      const { workspaceId } = req.user
      const { id } = req.params
      const { action } = req.body

      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id, workspaceId },
        include: { channel: { select: { type: true } }, contact: { select: { phone: true } } },
      })
      if (conversation.channel.type !== 'WHATSAPP') return reply.badRequest('Apenas canais WhatsApp')
      const phone = conversation.externalId.replace('@s.whatsapp.net', '').replace('@g.us', '')
      if (!phone) return reply.badRequest('Número não encontrado')

      const { instanceName } = await getChannelConfig(conversation.channelId)
      const waClient = await getClientForChannel(conversation.channelId)
      await waClient.updateBlockStatus(instanceName, phone, action)

      await eventBus.emitAndPersist(workspaceId, 'conversation.updated', { conversationId: id, blocked: action === 'block' })
      return { ok: true, blocked: action === 'block' }
    },
  )

  // ── Marcar mensagem como não lida ─────────────────────────────────────────────
  app.post(
    '/conversations/:id/messages/:messageId/mark-unread',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string(), messageId: z.string() }) },
    },
    async (req: any, reply) => {
      const { workspaceId } = req.user
      const { id, messageId } = req.params

      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id, workspaceId },
        include: { channel: { select: { type: true } } },
      })
      if (conversation.channel.type !== 'WHATSAPP') return reply.badRequest('Apenas canais WhatsApp')

      const message = await prisma.message.findFirst({ where: { id: messageId, conversationId: id } })
      if (!message?.externalId) return reply.notFound()

      const { instanceName } = await getChannelConfig(conversation.channelId)
      const waClient = await getClientForChannel(conversation.channelId)
      await waClient.markMessageAsUnread(
        instanceName, conversation.externalId, message.externalId, message.direction === 'OUTBOUND',
      )
      return { ok: true }
    },
  )

  // ── Arquivar/desarquivar conversa no WA ──────────────────────────────────────
  app.patch(
    '/conversations/:id/wa-archive',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ archive: z.boolean() }),
      },
    },
    async (req: any, reply) => {
      const { workspaceId } = req.user
      const { id } = req.params

      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id, workspaceId },
        include: { channel: { select: { type: true } } },
      })
      if (conversation.channel.type !== 'WHATSAPP') return reply.badRequest('Apenas canais WhatsApp')

      const { instanceName } = await getChannelConfig(conversation.channelId)
      const waClient = await getClientForChannel(conversation.channelId)
      await waClient.archiveChat(instanceName, conversation.externalId, req.body.archive)
      return { ok: true }
    },
  )

  // Resumir conversa (dispara agente)
  app.post(
    '/conversations/:id/summarize',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req) => {
      const { workspaceId } = req.user
      const { id } = req.params

      const messages = await prisma.message.findMany({
        where: { conversationId: id, workspaceId },
        orderBy: { sentAt: 'asc' },
        take: 100,
        select: { body: true, direction: true, sentAt: true },
      })

      // TODO Sprint 3: disparar agente resumidor via queue
      return { message: 'Resumo enfileirado (Sprint 3)', count: messages.length }
    },
  )

  // ── Histórico de conversas por contato ───────────────────────────────────
  app.get(
    '/contacts/:contactId/conversations',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ contactId: z.string() }),
        querystring: z.object({ limit: z.coerce.number().default(20), cursor: z.string().optional() }),
      },
    },
    async (req) => {
      const { workspaceId } = req.user
      const { contactId } = req.params
      const { limit, cursor } = req.query

      const conversations = await prisma.conversation.findMany({
        where: {
          workspaceId,
          contactId,
          ...(cursor && { createdAt: { lt: new Date(cursor) } }),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          channel: { select: { id: true, type: true, label: true } },
          assignee: { select: { id: true, name: true, email: true, settings: true } },
          messages: {
            orderBy: { sentAt: 'desc' },
            take: 1,
            select: { body: true, sentAt: true, direction: true },
          },
          _count: { select: { messages: true } },
        },
      })

      const nextCursor = conversations.length === limit
        ? conversations[conversations.length - 1].createdAt.toISOString()
        : null

      return { conversations, nextCursor }
    },
  )

  // ── Atualizar status da conversa (finalizar / reabrir) ────────────────────
  // Quem pode: ADMIN sempre; MEMBER só se for o assignee atual.
  app.patch(
    '/conversations/:id/status',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ status: z.enum(['OPEN', 'WAITING', 'RESOLVED']) }),
      },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId, role } = req.user
      const { id } = req.params
      const { status } = req.body

      const current = await prisma.conversation.findFirstOrThrow({
        where: { id, workspaceId }, select: { assigneeId: true, status: true },
      })
      if (role !== 'ADMIN' && current.assigneeId !== userId) {
        return reply.forbidden('Você precisa ser o atendente atual (ou admin) para mudar o status')
      }

      const conversation = await prisma.conversation.update({
        where: { id, workspaceId },
        data: {
          status,
          ...(status === 'RESOLVED' && { resolvedAt: new Date() }),
          ...(status === 'OPEN' && { resolvedAt: null }),
        },
        include: {
          channel: { select: { id: true, settings: true } },
        },
      })

      await eventBus.audit(workspaceId, 'conversation.status_changed', {
        actorUserId: userId,
        targetType: 'conversation', targetId: id,
        payload: { status, previousStatus: current.status },
      })

      // ── Closing message ao finalizar (user > canal fallback) ─────────────
      // Regra padrão: só envia se quem está finalizando É o assignee atual.
      // Quando admin finaliza conversa sem ter assumido (da fila ou supervisão),
      // só envia se o canal tiver `sendClosingOnAdminFinalize=true` — evita
      // mandar "obrigado pelo atendimento" sem ter havido atendimento real.
      if (status === 'RESOLVED') {
        const isFinalizerTheAssignee = current.assigneeId === userId
        const channelSettings = (conversation.channel.settings as Record<string, unknown> | null) ?? {}
        const adminCanForce = channelSettings.sendClosingOnAdminFinalize === true

        if (isFinalizerTheAssignee || adminCanForce) {
          const userTpl = await getUserMessageTemplate(userId, 'closingMessage')
          const channelTpl = typeof channelSettings.closingMessage === 'string'
            ? channelSettings.closingMessage
            : ''
          const template = userTpl || channelTpl
          if (template) {
            const skipGroupsClosing = userTpl
              ? await getUserIgnoreGroups(userId, 'ignoreGroupsClosing')
              : false
            void sendSystemMessage({
              conversationId: id,
              template,
              kind: 'closing',
              userId,
              skipIfGroup: skipGroupsClosing,
            })
          }
        } else {
          logger.info(
            { conversationId: id, actorUserId: userId, assigneeId: current.assigneeId },
            'Closing não enviado: admin finalizou sem assumir e canal não permite',
          )
        }
      }

      return conversation
    },
  )

  // ── Métricas de atendimento ───────────────────────────────────────────────
  app.get(
    '/conversations/metrics',
    { onRequest: [app.authenticate] },
    async (req) => {
      const { workspaceId } = req.user

      const [open, waiting, resolved, totalToday, avgResponseMs] = await Promise.all([
        prisma.conversation.count({ where: { workspaceId, status: 'OPEN' } }),
        prisma.conversation.count({ where: { workspaceId, status: 'WAITING' } }),
        prisma.conversation.count({ where: { workspaceId, status: 'RESOLVED' } }),
        prisma.conversation.count({
          where: {
            workspaceId,
            createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          },
        }),
        // Tempo médio de primeira resposta (em ms) das últimas 30 resolvidas
        prisma.conversation.aggregate({
          where: {
            workspaceId,
            firstResponseAt: { not: null },
            resolvedAt: { not: null },
          },
          _avg: { } ,  // workaround — calculado abaixo
        }).then(() => null), // placeholder
      ])

      // Calcula avg response time manualmente (Prisma não faz diff entre dates)
      const recentResolved = await prisma.conversation.findMany({
        where: { workspaceId, firstResponseAt: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { createdAt: true, firstResponseAt: true },
      })

      const avgMs = recentResolved.length > 0
        ? recentResolved.reduce((sum, c) => {
            return sum + (c.firstResponseAt!.getTime() - c.createdAt.getTime())
          }, 0) / recentResolved.length
        : null

      return {
        open,
        waiting,
        resolved,
        totalToday,
        avgFirstResponseMs: avgMs ? Math.round(avgMs) : null,
        avgFirstResponseMin: avgMs ? Math.round(avgMs / 60000) : null,
      }
    },
  )

  // ─── Encaminhar conversa para um usuário (transferir pra fila do destino) ──
  // A conv vai para a FILA restrita ao usuário destino — ele precisa clicar
  // Assumir para iniciar (gera métricas + dispara boas-vindas).
  // Quem pode: ADMIN sempre; MEMBER só se for o assignee atual.
  app.patch(
    '/conversations/:id/assign',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          assigneeId: z.string().nullable(),
          note: z.string().max(1000).optional(),
        }),
      },
    },
    async (req: any, reply) => {
      const { workspaceId, sub: userId, role } = req.user
      const { assigneeId: targetUserId, note } = req.body
      const conv = await prisma.conversation.findFirstOrThrow({
        where: { id: req.params.id, workspaceId },
        select: { assigneeId: true, assignee: { select: { id: true, name: true, email: true } } },
      })
      if (role !== 'ADMIN' && conv.assigneeId !== userId) {
        return reply.forbidden('Você precisa ser o atendente atual (ou admin) para encaminhar esta conversa')
      }

      // Resolve nomes pra log de evento
      const [fromUser, toUser] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } }),
        targetUserId
          ? prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, name: true, email: true } })
          : null,
      ])

      const now = new Date()
      // Encaminhar para usuário específico → conv vai para FILA restrita a ele
      // Encaminhar para null → devolve à fila pública
      const updated = await prisma.conversation.update({
        where: { id: req.params.id, workspaceId },
        data: {
          assigneeId: null,
          claimedAt: null,
          lastQueuedAt: now,
          eligibleAssigneeIds: targetUserId ? [targetUserId] as any : Prisma.JsonNull,
        },
        select: {
          id: true,
          assigneeId: true,
          eligibleAssigneeIds: true,
          assignee: { select: { id: true, name: true, email: true, settings: true } },
        },
      })

      // Cria evento interno no timeline (não envia pro cliente)
      const fromLabel = fromUser?.name ?? fromUser?.email ?? 'Sistema'
      const toLabel = toUser ? (toUser.name ?? toUser.email) : 'Fila pública'
      const transferBody = note
        ? `${fromLabel} encaminhou para ${toLabel}\n— ${note}`
        : `${fromLabel} encaminhou para ${toLabel}`
      await createInternalEvent({
        workspaceId,
        conversationId: req.params.id,
        kind: 'transfer',
        body: transferBody,
        fromUserId: userId,
        meta: {
          fromUserId: userId,
          fromName: fromLabel,
          toUserId: targetUserId,
          toName: toLabel,
          note: note ?? null,
        },
      })

      await eventBus.audit(workspaceId, 'conversation.assigned', {
        actorUserId: userId,
        targetType: 'conversation',
        targetId: req.params.id,
      })

      return updated
    },
  )

  // ─── Assumir conversa (claim atômico) ──────────────────────────────────────
  // Primeiro a chegar ganha — usa updateMany com guard assigneeId=null.
  // Exceção: ADMIN pode fazer takeover de conversa que já tem outro assignee
  // (vira o novo responsável). Útil quando o atendente original ficou ausente.
  app.post(
    '/conversations/:id/claim',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId, role } = req.user
      const { id } = req.params

      const now = new Date()

      // Valida eligibility: se a conv tem eligibleAssigneeIds preenchido, só
      // usuários nessa lista podem assumir (exceto admins com takeover).
      const eligibilityCheck = await prisma.conversation.findFirst({
        where: { id, workspaceId },
        select: { eligibleAssigneeIds: true },
      })
      if (eligibilityCheck) {
        const eligible = Array.isArray(eligibilityCheck.eligibleAssigneeIds)
          ? eligibilityCheck.eligibleAssigneeIds as string[]
          : null
        if (eligible && eligible.length > 0 && !eligible.includes(userId)) {
          const canTakeover = await hasPermission(req.user, 'conversations.takeover')
          if (!canTakeover) {
            return reply.status(403).send({
              error: 'Você não tem permissão para assumir esta conversa',
            })
          }
        }
      }

      // Tenta claim atômico (caminho normal: conv sem atribuição)
      const result = await prisma.conversation.updateMany({
        where: { id, workspaceId, assigneeId: null },
        data: { assigneeId: userId, claimedAt: now },
      })

      if (result.count === 0) {
        // Conv já tem outro assignee
        const current = await prisma.conversation.findUnique({
          where: { id },
          select: { assigneeId: true, assignee: { select: { id: true, name: true, email: true, settings: true } } },
        })

        // Já é minha → ok, idempotente
        if (current?.assigneeId === userId) {
          // segue pro return updated abaixo
        }
        // Quem tem `conversations.takeover` → permitido (registra no releasedFrom)
        else if (await hasPermission(req.user, 'conversations.takeover')) {
          const full = await prisma.conversation.findUniqueOrThrow({
            where: { id }, select: { releasedFrom: true },
          })
          const prevReleases = Array.isArray(full.releasedFrom) ? full.releasedFrom : []
          await prisma.conversation.update({
            where: { id, workspaceId },
            data: {
              assigneeId: userId,
              claimedAt: now,
              releasedFrom: [
                ...prevReleases,
                { userId: current?.assigneeId, at: now.toISOString(), reason: `Takeover por ${userId}` },
              ] as any,
            },
          })
        }
        // Sem permissão → 409
        else {
          return reply.status(409).send({
            error: 'Conversa já assumida',
            assignee: current?.assignee ?? null,
          })
        }
      }

      const updated = await prisma.conversation.findUnique({
        where: { id },
        select: {
          id: true,
          assigneeId: true,
          claimedAt: true,
          assignee: { select: { id: true, name: true, email: true, settings: true } },
        },
      })

      await eventBus.audit(workspaceId, 'conversation.claimed', {
        actorUserId: userId,
        targetType: 'conversation', targetId: id,
      })

      // Divisor no timeline: "Atendimento iniciado por X"
      const claimer = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      })
      const claimerLabel = claimer?.name ?? claimer?.email ?? 'atendente'
      await createInternalEvent({
        workspaceId,
        conversationId: id,
        kind: 'claim',
        body: `Atendimento iniciado por ${claimerLabel}`,
        fromUserId: userId,
        meta: { userId, userName: claimerLabel },
      })

      // ── Welcome message do atendente (apresentação pessoal) ──────────────
      // Dispara fire-and-forget no background, nunca bloqueia a resposta do claim.
      const userWelcomeTpl = await getUserMessageTemplate(userId, 'welcomeMessage')
      if (userWelcomeTpl) {
        const skipGroupsWelcome = await getUserIgnoreGroups(userId, 'ignoreGroupsWelcome')
        void sendSystemMessage({
          conversationId: id,
          template: userWelcomeTpl,
          kind: 'agent-welcome',
          userId,
          skipIfGroup: skipGroupsWelcome,
        })
      }

      return reply.code(200).send(updated)
    },
  )

  // ─── Devolver conversa à fila (release) ───────────────────────────────────
  // Só o atribuído atual ou ADMIN pode devolver. Requer motivo.
  app.post(
    '/conversations/:id/release',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ reason: z.string().min(3) }),
      },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId, role } = req.user
      const { id } = req.params
      const { reason } = req.body

      const conversation = await prisma.conversation.findFirst({
        where: { id, workspaceId },
        select: { assigneeId: true, releasedFrom: true },
      })
      if (!conversation) return reply.notFound('Conversa não encontrada')

      // Guard: só o assignee atual ou ADMIN pode devolver
      if (role !== 'ADMIN' && conversation.assigneeId !== userId) {
        return reply.forbidden('Apenas o responsável atual ou admin pode devolver à fila')
      }

      const prevReleases = Array.isArray(conversation.releasedFrom)
        ? conversation.releasedFrom as any[]
        : []

      const updated = await prisma.conversation.update({
        where: { id },
        data: {
          assigneeId: null,
          claimedAt: null,
          releasedFrom: [
            ...prevReleases,
            { userId, at: new Date().toISOString(), reason },
          ] as any,
        },
        select: {
          id: true,
          assigneeId: true,
          claimedAt: true,
          releasedFrom: true,
        },
      })

      await eventBus.audit(workspaceId, 'conversation.released', {
        actorUserId: userId,
        targetType: 'conversation', targetId: id,
        payload: { reason },
      })

      return updated
    },
  )

  // ─── Email: mover conversa pra outra pasta IMAP ─────────────────────────────
  // Move TODAS as mensagens da conversa (que tenham UID IMAP) pra outra pasta no servidor.
  // Atualiza Conversation.folder no banco. Funciona como "delete" quando toFolder = lixeira.
  app.post(
    '/conversations/:id/move-to-folder',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ toFolder: z.string().min(1) }),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const { id } = req.params
      const { toFolder } = req.body

      const conversation = await prisma.conversation.findFirst({
        where: { id, workspaceId },
        include: { channel: true },
      })
      if (!conversation) return reply.notFound('Conversa não encontrada')
      if (conversation.channel.type !== 'IMAP_SMTP' && conversation.channel.type !== 'GMAIL') {
        return reply.badRequest('Conversa não é de email')
      }

      const smtpCfg = await getSmtpConfig(conversation.channelId)
      if (!smtpCfg) return reply.badRequest('Canal sem credenciais IMAP')

      // Busca todas as mensagens com UID IMAP
      const messages = await prisma.message.findMany({
        where: { conversationId: id, workspaceId },
        select: { id: true, metadata: true },
      })

      let moved = 0
      let failed = 0
      for (const m of messages) {
        const meta = (m.metadata as { imapUid?: number; imapFolder?: string } | null) ?? null
        if (!meta?.imapUid || !meta.imapFolder) continue
        if (meta.imapFolder === toFolder) { moved++; continue } // já está
        try {
          await moveImapMessage(smtpCfg, meta.imapUid, meta.imapFolder, toFolder)
          await prisma.message.update({
            where: { id: m.id },
            data: { metadata: { ...meta, imapFolder: toFolder } },
          })
          moved++
        } catch {
          failed++
        }
      }

      await prisma.conversation.update({
        where: { id },
        data: { folder: toFolder },
      })

      await eventBus.audit(workspaceId, 'conversation.moved', {
        actorUserId: req.user.sub,
        targetType: 'conversation', targetId: id,
        payload: { toFolder, moved, failed },
      })

      return { ok: true, moved, failed, toFolder }
    },
  )

  // ─── Email: excluir conversa (move pra lixeira IMAP, depois deleta local) ───
  // Detecta o nome da pasta lixeira a partir das pastas conhecidas do canal.
  app.delete(
    '/conversations/:id/email',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const { id } = req.params

      const conversation = await prisma.conversation.findFirst({
        where: { id, workspaceId },
        include: { channel: true },
      })
      if (!conversation) return reply.notFound('Conversa não encontrada')
      if (conversation.channel.type !== 'IMAP_SMTP' && conversation.channel.type !== 'GMAIL') {
        return reply.badRequest('Use DELETE padrão para canais não-email')
      }

      const settings = (conversation.channel.settings as { imapFolders?: string[] } | null) ?? {}
      const folders = settings.imapFolders ?? []
      // Detecta a pasta de lixeira pelo nome
      const trashCandidates = ['Trash', 'INBOX.Trash', 'Lixeira', 'INBOX.Lixeira', 'Deleted', 'Deleted Items', 'INBOX.Deleted']
      const trashFolder = trashCandidates.find(t =>
        folders.some(f => f.toLowerCase() === t.toLowerCase()),
      ) ?? folders.find(f => /trash|lixeira|deleted/i.test(f))

      const smtpCfg = await getSmtpConfig(conversation.channelId)
      if (!smtpCfg) return reply.badRequest('Canal sem credenciais IMAP')

      // Tenta mover pra lixeira IMAP (se houver pasta detectada)
      if (trashFolder) {
        const messages = await prisma.message.findMany({
          where: { conversationId: id, workspaceId },
          select: { id: true, metadata: true },
        })
        for (const m of messages) {
          const meta = (m.metadata as { imapUid?: number; imapFolder?: string } | null) ?? null
          if (!meta?.imapUid || !meta.imapFolder || meta.imapFolder === trashFolder) continue
          try {
            await moveImapMessage(smtpCfg, meta.imapUid, meta.imapFolder, trashFolder)
          } catch {
            // segue mesmo se falhar — vamos deletar do banco de qualquer jeito
          }
        }
      }

      // Apaga local (mensagens primeiro pra não violar FK)
      await prisma.message.deleteMany({ where: { conversationId: id, workspaceId } })
      await prisma.conversation.delete({ where: { id } })

      await eventBus.audit(workspaceId, 'conversation.deleted', {
        actorUserId: req.user.sub,
        targetType: 'conversation', targetId: id,
      })

      return reply.code(204).send()
    },
  )

  // ─── Email: criar nova conversa (compose) ──────────────────────────────────
  // Cria conversa local + envia primeiro email via SMTP.
  app.post(
    '/email/compose',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          channelId: z.string(),
          to: z.string().email(),
          subject: z.string().min(1),
          text: z.string(),
          html: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const { channelId, to, subject, text, html } = req.body

      const channel = await prisma.channel.findFirst({
        where: { id: channelId, workspaceId, type: { in: ['IMAP_SMTP', 'GMAIL'] } },
      })
      if (!channel) return reply.notFound('Canal de email não encontrado')

      const smtpCfg = await getSmtpConfig(channelId)
      if (!smtpCfg) return reply.badRequest('Canal sem credenciais SMTP')

      // Upsert contato
      const toAddr = to.trim().toLowerCase()
      let contact = await prisma.contact.findFirst({
        where: { workspaceId, email: toAddr, mergedIntoId: null },
      })
      if (!contact) {
        contact = await prisma.contact.create({
          data: { workspaceId, email: toAddr, name: toAddr },
        })
      }

      // Envia o email
      const messageId = await sendEmail(smtpCfg, toAddr, subject, text, html ?? undefined)

      // Cria conversa + primeira mensagem (externalId = hash igual ao do sync IMAP)
      const { createHash } = await import('node:crypto')
      const externalId = createHash('md5').update(messageId).digest('hex')

      const conversation = await prisma.conversation.create({
        data: {
          workspaceId,
          channelId,
          contactId: contact.id,
          externalId,
          subject,
          folder: 'INBOX', // outbound nasce sem folder; usamos INBOX como default
          lastMessageAt: new Date(),
          firstResponseAt: new Date(),
        },
      })

      const msgExternalId = createHash('md5').update(messageId).digest('hex')
      await prisma.message.create({
        data: {
          workspaceId,
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          externalId: msgExternalId,
          body: text,
          bodyHtml: html ?? null,
          sentAt: new Date(),
        },
      })

      await eventBus.emitAndPersist(workspaceId, 'message.sent', {
        conversationId: conversation.id, channelId,
      })

      return reply.code(201).send({ conversationId: conversation.id })
    },
  )

  // ────────────────────────────────────────────────────────────────────────────
  // ── Grupo: gerenciamento via Evolution API ──────────────────────────────────
  // Todas as rotas exigem que a conversa seja WhatsApp e isGroup=true
  // ────────────────────────────────────────────────────────────────────────────

  async function loadGroupConversation(id: string, workspaceId: string) {
    const conv = await prisma.conversation.findFirstOrThrow({
      where: { id, workspaceId },
      include: { channel: { select: { id: true, type: true } } },
    })
    if (conv.channel.type !== 'WHATSAPP') throw new Error('Apenas canais WhatsApp')
    if (!conv.isGroup) throw new Error('Apenas conversas de grupo')
    const { instanceName } = await getChannelConfig(conv.channelId)
    const client = await getClientForChannel(conv.channelId)
    return { conv, client, instanceName, groupJid: conv.externalId }
  }

  /** GET /conversations/:id/group — info + membros */
  app.get(
    '/conversations/:id/group',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req: any, reply) => {
      try {
        const { client, instanceName, groupJid } = await loadGroupConversation(req.params.id, req.user.workspaceId)
        const [info, members] = await Promise.all([
          client.fetchGroupInfo(instanceName, groupJid),
          client.findGroupMembers(instanceName, groupJid).catch(() => ({ participants: [] })),
        ])

        // Enriquece participantes com nome/foto do Contact (se existir)
        const participants = (members?.participants ?? []) as Array<{ id: string; admin?: string | null }>
        const jids = participants.map(p => p.id.replace(/@.*$/, ''))
        const contacts = await prisma.contact.findMany({
          where: {
            workspaceId: req.user.workspaceId,
            mergedIntoId: null,
            OR: [{ phone: { in: jids } }, { lid: { in: jids } }],
          },
          select: { id: true, name: true, phone: true, lid: true, metadata: true },
        })
        const byId = new Map<string, typeof contacts[number]>()
        for (const c of contacts) {
          if (c.phone) byId.set(c.phone, c)
          if (c.lid) byId.set(c.lid, c)
        }

        const enriched = participants.map(p => {
          const raw = p.id.replace(/@.*$/, '')
          const contact = byId.get(raw)
          const avatarUrl = (contact?.metadata as any)?.avatarUrl ?? null
          return {
            jid: p.id,
            number: raw,
            admin: p.admin ?? null,
            name: contact?.name ?? null,
            contactId: contact?.id ?? null,
            avatarUrl,
          }
        })

        return { info, participants: enriched }
      } catch (err: any) {
        return reply.badRequest(err?.message ?? 'Erro ao buscar grupo')
      }
    },
  )

  /** PATCH /conversations/:id/group — atualiza subject e/ou description */
  app.patch(
    '/conversations/:id/group',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          subject: z.string().min(1).max(100).optional(),
          description: z.string().max(500).optional(),
        }),
      },
    },
    async (req: any, reply) => {
      try {
        const { client, instanceName, groupJid, conv } = await loadGroupConversation(req.params.id, req.user.workspaceId)
        const { subject, description } = req.body
        if (subject) {
          await client.updateGroupSubject(instanceName, groupJid, subject)
          // Atualiza o subject local da conversation pra refletir imediatamente
          await prisma.conversation.update({ where: { id: conv.id }, data: { subject } })
        }
        if (description !== undefined) {
          await client.updateGroupDescription(instanceName, groupJid, description)
        }
        return { ok: true }
      } catch (err: any) {
        return reply.badRequest(err?.message ?? 'Erro ao atualizar grupo')
      }
    },
  )

  /** POST /conversations/:id/group/picture — upload de foto do grupo */
  app.post(
    '/conversations/:id/group/picture',
    { onRequest: [app.authenticate] },
    async (req: any, reply) => {
      try {
        const { client, instanceName, groupJid } = await loadGroupConversation(req.params.id, req.user.workspaceId)
        const data = await req.file()
        if (!data) return reply.badRequest('Arquivo obrigatório')
        const chunks: Buffer[] = []
        for await (const chunk of data.file) chunks.push(chunk)
        const base64 = Buffer.concat(chunks).toString('base64')
        const mime: string = data.mimetype || 'image/jpeg'
        await client.updateGroupPicture(instanceName, groupJid, `data:${mime};base64,${base64}`)
        return { ok: true }
      } catch (err: any) {
        return reply.badRequest(err?.message ?? 'Erro ao atualizar foto')
      }
    },
  )

  /** POST /conversations/:id/group/members — add/remove/promote/demote */
  app.post(
    '/conversations/:id/group/members',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          action: z.enum(['add', 'remove', 'promote', 'demote']),
          participants: z.array(z.string()).min(1).max(50),
        }),
      },
    },
    async (req: any, reply) => {
      try {
        const { client, instanceName, groupJid } = await loadGroupConversation(req.params.id, req.user.workspaceId)
        const { action, participants } = req.body
        await client.updateGroupMembers(instanceName, groupJid, action, participants)
        return { ok: true }
      } catch (err: any) {
        return reply.badRequest(err?.message ?? 'Erro ao atualizar membros')
      }
    },
  )

  /** DELETE /conversations/:id/group/leave — sair do grupo */
  app.delete(
    '/conversations/:id/group/leave',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }) } },
    async (req: any, reply) => {
      try {
        const { client, instanceName, groupJid, conv } = await loadGroupConversation(req.params.id, req.user.workspaceId)
        await client.leaveGroup(instanceName, groupJid)
        // Marca a conversa como resolvida — já não temos mais acesso ao grupo
        await prisma.conversation.update({
          where: { id: conv.id },
          data: { status: 'RESOLVED', resolvedAt: new Date() },
        })
        return { ok: true }
      } catch (err: any) {
        return reply.badRequest(err?.message ?? 'Erro ao sair do grupo')
      }
    },
  )

  /** GET /conversations/:id/group/invite — pega link de convite */
  app.get(
    '/conversations/:id/group/invite',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }) } },
    async (req: any, reply) => {
      try {
        const { client, instanceName, groupJid } = await loadGroupConversation(req.params.id, req.user.workspaceId)
        const data = await client.fetchInviteCode(instanceName, groupJid)
        return data
      } catch (err: any) {
        return reply.badRequest(err?.message ?? 'Erro ao buscar convite')
      }
    },
  )

  /** PATCH /conversations/:id/company — vincula/desvincula empresa */
  app.patch(
    '/conversations/:id/company',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ companyId: z.string().nullable() }),
      },
    },
    async (req: any, reply) => {
      const { workspaceId } = req.user
      const { id } = req.params
      const { companyId } = req.body

      // Garante que a conversa pertence ao workspace
      const conv = await prisma.conversation.findFirst({
        where: { id, workspaceId },
        select: { id: true },
      })
      if (!conv) return reply.notFound()

      // Se companyId não-nulo: garante que pertence ao workspace
      if (companyId) {
        const company = await prisma.company.findFirst({
          where: { id: companyId, workspaceId },
          select: { id: true },
        })
        if (!company) return reply.badRequest('Empresa não encontrada')
      }

      const updated = await prisma.conversation.update({
        where: { id },
        data: { companyId },
        select: {
          id: true,
          companyId: true,
          company: { select: { id: true, name: true, color: true } },
        },
      })
      return updated
    },
  )

  /** POST /conversations/:id/group/invite/revoke — revoga e regenera */
  app.post(
    '/conversations/:id/group/invite/revoke',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }) } },
    async (req: any, reply) => {
      try {
        const { client, instanceName, groupJid } = await loadGroupConversation(req.params.id, req.user.workspaceId)
        const data = await client.revokeInviteCode(instanceName, groupJid)
        return data
      } catch (err: any) {
        return reply.badRequest(err?.message ?? 'Erro ao revogar convite')
      }
    },
  )
}

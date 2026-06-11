import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { hasPermission } from '../../lib/acl.js'
import { enqueueMessage, cancelMessage, retryMessage } from './communication.service.js'
import { dispatchCampaign, campaignMetrics } from './campaigns.service.js'
import { importContactsToList, exportListToCsv } from './broadcast-lists.service.js'
import { createApiKey, listApiKeys, revokeApiKey } from './comm-api-keys.service.js'
import { storeAttachments, deleteAttachmentFile, type AttachmentInput } from './comm-attachments.service.js'

const channelEnum = z.enum(['WHATSAPP', 'EMAIL'])

const attachmentSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('url'), nome: z.string().optional(), arquivo: z.string().url(), mime_type: z.string().optional() }),
  z.object({ tipo: z.literal('base64'), nome: z.string(), arquivo: z.string(), mime_type: z.string().optional() }),
])

export const communicationRoutes: FastifyPluginAsyncZod = async (app) => {
  const requireView = async (user: any, reply: any) => {
    if (!(await hasPermission(user, 'campaigns.view'))) {
      reply.code(403).send({ error: 'Sem permissão' })
      return false
    }
    return true
  }
  const requireManage = async (user: any, reply: any) => {
    if (!(await hasPermission(user, 'campaigns.manage'))) {
      reply.code(403).send({ error: 'Sem permissão' })
      return false
    }
    return true
  }

  // ════════════════════════ CAMPANHAS ════════════════════════
  app.get('/comm/campaigns', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!(await requireView(req.user, reply))) return
    const { workspaceId } = req.user
    const campaigns = await prisma.campaign.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      include: {
        list: { select: { id: true, name: true } },
        attachments: { select: { id: true, filename: true, mimeType: true, sizeBytes: true } },
        _count: { select: { messages: true } },
      },
    })
    return campaigns
  })

  app.get(
    '/comm/campaigns/:id/metrics',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      if (!(await requireView(req.user, reply))) return
      const metrics = await campaignMetrics(req.user.workspaceId, req.params.id)
      if (!metrics) return reply.code(404).send({ error: 'Campanha não encontrada' })
      return metrics
    },
  )

  app.post(
    '/comm/campaigns',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          name: z.string().min(1).max(150),
          description: z.string().max(2000).optional(),
          channelType: channelEnum,
          channelId: z.string().nullable().optional(),
          subject: z.string().max(300).optional(),
          body: z.string().min(1),
          listId: z.string().nullable().optional(),
          scheduledAt: z.string().datetime().nullable().optional(),
        }),
      },
    },
    async (req, reply) => {
      if (!(await requireManage(req.user, reply))) return
      const { workspaceId, sub } = req.user
      const b = req.body
      const scheduledAt = b.scheduledAt ? new Date(b.scheduledAt) : null
      const campaign = await prisma.campaign.create({
        data: {
          workspaceId,
          name: b.name,
          description: b.description,
          channelType: b.channelType,
          channelId: b.channelId ?? null,
          subject: b.subject,
          body: b.body,
          listId: b.listId ?? null,
          scheduledAt,
          status: 'DRAFT',
          createdBy: sub,
        },
      })
      return reply.code(201).send(campaign)
    },
  )

  app.patch(
    '/comm/campaigns/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().min(1).max(150).optional(),
          description: z.string().max(2000).nullable().optional(),
          channelType: channelEnum.optional(),
          channelId: z.string().nullable().optional(),
          subject: z.string().max(300).nullable().optional(),
          body: z.string().min(1).optional(),
          listId: z.string().nullable().optional(),
          scheduledAt: z.string().datetime().nullable().optional(),
        }),
      },
    },
    async (req, reply) => {
      if (!(await requireManage(req.user, reply))) return
      const { workspaceId } = req.user
      const current = await prisma.campaign.findFirst({ where: { id: req.params.id, workspaceId }, select: { id: true, status: true } })
      if (!current) return reply.code(404).send({ error: 'Campanha não encontrada' })
      if (['RUNNING', 'COMPLETED'].includes(current.status)) {
        return reply.code(409).send({ error: 'Campanha em execução/concluída não pode ser editada' })
      }
      const { scheduledAt, ...rest } = req.body
      const updated = await prisma.campaign.update({
        where: { id: current.id },
        data: { ...rest, ...(scheduledAt !== undefined && { scheduledAt: scheduledAt ? new Date(scheduledAt) : null }) },
      })
      return updated
    },
  )

  app.delete(
    '/comm/campaigns/:id',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      if (!(await requireManage(req.user, reply))) return
      const { workspaceId } = req.user
      const current = await prisma.campaign.findFirst({ where: { id: req.params.id, workspaceId }, select: { id: true } })
      if (!current) return reply.code(404).send({ error: 'Campanha não encontrada' })
      await prisma.campaign.delete({ where: { id: current.id } })
      return reply.code(204).send()
    },
  )

  // Duplicar
  app.post(
    '/comm/campaigns/:id/duplicate',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      if (!(await requireManage(req.user, reply))) return
      const { workspaceId, sub } = req.user
      const src = await prisma.campaign.findFirst({ where: { id: req.params.id, workspaceId } })
      if (!src) return reply.code(404).send({ error: 'Campanha não encontrada' })
      const copy = await prisma.campaign.create({
        data: {
          workspaceId,
          name: `${src.name} (cópia)`,
          description: src.description,
          channelType: src.channelType,
          channelId: src.channelId,
          subject: src.subject,
          body: src.body,
          listId: src.listId,
          status: 'DRAFT',
          createdBy: sub,
        },
      })
      return reply.code(201).send(copy)
    },
  )

  // Agendar / disparar
  app.post(
    '/comm/campaigns/:id/schedule',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }), body: z.object({ scheduledAt: z.string().datetime().nullable().optional() }) },
    },
    async (req, reply) => {
      if (!(await requireManage(req.user, reply))) return
      const { workspaceId } = req.user
      const campaign = await prisma.campaign.findFirst({ where: { id: req.params.id, workspaceId } })
      if (!campaign) return reply.code(404).send({ error: 'Campanha não encontrada' })
      if (['RUNNING', 'COMPLETED'].includes(campaign.status)) {
        return reply.code(409).send({ error: 'Campanha já em execução ou concluída' })
      }
      if (!campaign.listId) return reply.code(400).send({ error: 'Vincule uma lista de transmissão antes de disparar' })

      const scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : null
      const isScheduled = !!scheduledAt && scheduledAt.getTime() > Date.now() + 1000
      const updated = await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: isScheduled ? 'SCHEDULED' : 'RUNNING', scheduledAt, ...(isScheduled ? {} : { startedAt: new Date() }) },
      })
      // Agendada: a varredura (sweepScheduledCampaigns) dispara no horário.
      // Imediata: dispara agora.
      if (!isScheduled) await dispatchCampaign(campaign.id)
      return updated
    },
  )

  // Cancelar
  app.post(
    '/comm/campaigns/:id/cancel',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      if (!(await requireManage(req.user, reply))) return
      const { workspaceId } = req.user
      const campaign = await prisma.campaign.findFirst({ where: { id: req.params.id, workspaceId }, select: { id: true } })
      if (!campaign) return reply.code(404).send({ error: 'Campanha não encontrada' })
      await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'CANCELED' } })
      // Cancela mensagens ainda não enviadas
      await prisma.commMessage.updateMany({
        where: { campaignId: campaign.id, status: { in: ['PENDING', 'SCHEDULED'] } },
        data: { status: 'CANCELED' },
      })
      return { ok: true }
    },
  )

  // ── Anexos de campanha ────────────────────────────────────────────────────
  // Upload via multipart (arquivos) — armazenados no storage e enviados a cada
  // destinatário no disparo. Compartilhados (1 arquivo, N envios).
  app.post('/comm/campaigns/:id/attachments', { onRequest: [app.authenticate] }, async (req: any, reply) => {
    if (!(await requireManage(req.user, reply))) return
    const { workspaceId } = req.user
    const campaignId = req.params.id as string
    const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId }, select: { id: true } })
    if (!campaign) return reply.code(404).send({ error: 'Campanha não encontrada' })
    if (!req.isMultipart()) return reply.code(400).send({ error: 'Envie os arquivos como multipart/form-data' })

    const inputs: AttachmentInput[] = []
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const chunks: Buffer[] = []
        for await (const chunk of part.file) chunks.push(chunk)
        inputs.push({ tipo: 'buffer', nome: part.filename ?? 'arquivo', buffer: Buffer.concat(chunks), mime_type: part.mimetype })
      }
    }
    if (inputs.length === 0) return reply.code(400).send({ error: 'Nenhum arquivo recebido' })

    await storeAttachments(workspaceId, inputs, { campaignId })
    const attachments = await prisma.commAttachment.findMany({
      where: { campaignId },
      select: { id: true, filename: true, mimeType: true, sizeBytes: true },
    })
    return reply.code(201).send(attachments)
  })

  app.delete(
    '/comm/campaigns/:id/attachments/:attId',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string(), attId: z.string() }) } },
    async (req, reply) => {
      if (!(await requireManage(req.user, reply))) return
      const { workspaceId } = req.user
      const att = await prisma.commAttachment.findFirst({
        where: { id: req.params.attId, campaignId: req.params.id, workspaceId },
        select: { id: true, storageKey: true },
      })
      if (!att) return reply.code(404).send({ error: 'Anexo não encontrado' })
      await prisma.commAttachment.delete({ where: { id: att.id } })
      await deleteAttachmentFile(att.storageKey)
      return reply.code(204).send()
    },
  )

  // ════════════════════════ LISTAS DE TRANSMISSÃO ════════════════════════
  app.get('/comm/broadcast-lists', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!(await requireView(req.user, reply))) return
    return prisma.broadcastList.findMany({
      where: { workspaceId: req.user.workspaceId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { members: true, campaigns: true } } },
    })
  })

  app.get(
    '/comm/broadcast-lists/:id',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      if (!(await requireView(req.user, reply))) return
      const list = await prisma.broadcastList.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId },
        include: {
          members: {
            include: {
              contact: {
                select: {
                  id: true, name: true, phone: true, email: true, verified: true, metadata: true,
                  company: { select: { id: true, name: true, color: true } },
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      })
      if (!list) return reply.code(404).send({ error: 'Lista não encontrada' })
      return list
    },
  )

  app.post(
    '/comm/broadcast-lists',
    {
      onRequest: [app.authenticate],
      schema: { body: z.object({ name: z.string().min(1).max(150), description: z.string().max(2000).optional() }) },
    },
    async (req, reply) => {
      if (!(await requireManage(req.user, reply))) return
      const list = await prisma.broadcastList.create({
        data: { workspaceId: req.user.workspaceId, name: req.body.name, description: req.body.description },
      })
      return reply.code(201).send(list)
    },
  )

  app.patch(
    '/comm/broadcast-lists/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }), body: z.object({ name: z.string().min(1).max(150).optional(), description: z.string().max(2000).nullable().optional() }) },
    },
    async (req, reply) => {
      if (!(await requireManage(req.user, reply))) return
      const current = await prisma.broadcastList.findFirst({ where: { id: req.params.id, workspaceId: req.user.workspaceId }, select: { id: true } })
      if (!current) return reply.code(404).send({ error: 'Lista não encontrada' })
      return prisma.broadcastList.update({ where: { id: current.id }, data: req.body })
    },
  )

  app.delete(
    '/comm/broadcast-lists/:id',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      if (!(await requireManage(req.user, reply))) return
      const current = await prisma.broadcastList.findFirst({ where: { id: req.params.id, workspaceId: req.user.workspaceId }, select: { id: true } })
      if (!current) return reply.code(404).send({ error: 'Lista não encontrada' })
      await prisma.broadcastList.delete({ where: { id: current.id } })
      return reply.code(204).send()
    },
  )

  // Membros (só contatos cadastrados)
  app.post(
    '/comm/broadcast-lists/:id/members',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }), body: z.object({ contactIds: z.array(z.string()).min(1) }) } },
    async (req, reply) => {
      if (!(await requireManage(req.user, reply))) return
      const { workspaceId } = req.user
      const list = await prisma.broadcastList.findFirst({ where: { id: req.params.id, workspaceId }, select: { id: true } })
      if (!list) return reply.code(404).send({ error: 'Lista não encontrada' })
      // Valida que os contatos pertencem ao workspace
      const valid = await prisma.contact.findMany({
        where: { id: { in: req.body.contactIds }, workspaceId, mergedIntoId: null },
        select: { id: true },
      })
      await prisma.broadcastListMember.createMany({
        data: valid.map((c) => ({ listId: list.id, contactId: c.id })),
        skipDuplicates: true,
      })
      return { added: valid.length }
    },
  )

  app.delete(
    '/comm/broadcast-lists/:id/members/:contactId',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string(), contactId: z.string() }) } },
    async (req, reply) => {
      if (!(await requireManage(req.user, reply))) return
      const { workspaceId } = req.user
      const list = await prisma.broadcastList.findFirst({ where: { id: req.params.id, workspaceId }, select: { id: true } })
      if (!list) return reply.code(404).send({ error: 'Lista não encontrada' })
      await prisma.broadcastListMember.deleteMany({ where: { listId: list.id, contactId: req.params.contactId } })
      return reply.code(204).send()
    },
  )

  // Import / Export CSV
  app.post(
    '/comm/broadcast-lists/:id/import',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }), body: z.object({ csv: z.string().min(1) }) } },
    async (req, reply) => {
      if (!(await requireManage(req.user, reply))) return
      const { workspaceId } = req.user
      const list = await prisma.broadcastList.findFirst({ where: { id: req.params.id, workspaceId }, select: { id: true } })
      if (!list) return reply.code(404).send({ error: 'Lista não encontrada' })
      const result = await importContactsToList(workspaceId, list.id, req.body.csv)
      return result
    },
  )

  app.get(
    '/comm/broadcast-lists/:id/export',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      if (!(await requireView(req.user, reply))) return
      const { workspaceId } = req.user
      const list = await prisma.broadcastList.findFirst({ where: { id: req.params.id, workspaceId }, select: { id: true, name: true } })
      if (!list) return reply.code(404).send({ error: 'Lista não encontrada' })
      const csv = await exportListToCsv(workspaceId, list.id)
      return { filename: `lista-${list.name}.csv`, csv }
    },
  )

  // ════════════════════════ FILA DE MENSAGENS ════════════════════════
  app.get(
    '/comm/messages',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          status: z.enum(['PENDING', 'SCHEDULED', 'PROCESSING', 'SENT', 'FAILED', 'CANCELED']).optional(),
          channel: channelEnum.optional(),
          campaignId: z.string().optional(),
          take: z.coerce.number().min(1).max(200).default(50),
        }),
      },
    },
    async (req, reply) => {
      if (!(await requireView(req.user, reply))) return
      const { workspaceId } = req.user
      const { status, channel, campaignId, take } = req.query
      return prisma.commMessage.findMany({
        where: {
          workspaceId,
          ...(status && { status }),
          ...(channel && { channelType: channel }),
          ...(campaignId && { campaignId }),
        },
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          id: true, channelType: true, to: true, subject: true, status: true,
          priority: true, scheduledAt: true, sentAt: true, attempts: true,
          lastError: true, source: true, campaignId: true, createdAt: true,
        },
      })
    },
  )

  app.get(
    '/comm/messages/:id',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      if (!(await requireView(req.user, reply))) return
      const msg = await prisma.commMessage.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId },
        include: {
          logs: { orderBy: { createdAt: 'asc' } },
          attachments: { select: { id: true, filename: true, mimeType: true, sizeBytes: true } },
        },
      })
      if (!msg) return reply.code(404).send({ error: 'Mensagem não encontrada' })
      return msg
    },
  )

  // Envio avulso interno (testes / módulos internos via HTTP)
  app.post(
    '/comm/messages',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          channelType: channelEnum,
          channelId: z.string().nullable().optional(),
          to: z.string().min(1),
          subject: z.string().optional(),
          body: z.string().min(1),
          scheduledAt: z.string().datetime().nullable().optional(),
          priority: z.number().int().min(0).max(100).optional(),
          contactId: z.string().nullable().optional(),
          attachments: z.array(attachmentSchema).optional(),
        }),
      },
    },
    async (req, reply) => {
      if (!(await requireManage(req.user, reply))) return
      const b = req.body
      const result = await enqueueMessage({
        workspaceId: req.user.workspaceId,
        channelType: b.channelType,
        channelId: b.channelId ?? null,
        to: b.to,
        subject: b.subject,
        body: b.body,
        scheduledAt: b.scheduledAt ? new Date(b.scheduledAt) : null,
        priority: b.priority,
        contactId: b.contactId ?? null,
        attachments: b.attachments,
        source: 'internal',
      })
      return reply.code(201).send({ success: true, message_id: result.messageId, status: result.status.toLowerCase() })
    },
  )

  app.post(
    '/comm/messages/:id/cancel',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      if (!(await requireManage(req.user, reply))) return
      try {
        await cancelMessage(req.user.workspaceId, req.params.id)
        return { ok: true }
      } catch (err: any) {
        return reply.code(400).send({ error: err.message })
      }
    },
  )

  app.post(
    '/comm/messages/:id/retry',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      if (!(await requireManage(req.user, reply))) return
      try {
        await retryMessage(req.user.workspaceId, req.params.id)
        return { ok: true }
      } catch (err: any) {
        return reply.code(400).send({ error: err.message })
      }
    },
  )

  // ════════════════════════ DASHBOARD ════════════════════════
  app.get('/comm/dashboard', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!(await requireView(req.user, reply))) return
    const { workspaceId } = req.user
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)

    const [sentToday, pending, failed, byChannel, runningCampaigns, completedCampaigns] = await Promise.all([
      prisma.commMessage.count({ where: { workspaceId, status: 'SENT', sentAt: { gte: startOfDay } } }),
      prisma.commMessage.count({ where: { workspaceId, status: { in: ['PENDING', 'SCHEDULED', 'PROCESSING'] } } }),
      prisma.commMessage.count({ where: { workspaceId, status: 'FAILED' } }),
      prisma.commMessage.groupBy({ by: ['channelType'], where: { workspaceId }, _count: { _all: true } }),
      prisma.campaign.count({ where: { workspaceId, status: 'RUNNING' } }),
      prisma.campaign.count({ where: { workspaceId, status: 'COMPLETED' } }),
    ])

    const totalSent = await prisma.commMessage.count({ where: { workspaceId, status: 'SENT' } })
    const totalFinished = totalSent + failed
    const deliveryRate = totalFinished > 0 ? Math.round((totalSent / totalFinished) * 100) : 0

    return {
      sentToday,
      pending,
      failed,
      deliveryRate,
      runningCampaigns,
      completedCampaigns,
      volumeByChannel: byChannel.map((c) => ({ channel: c.channelType, count: c._count._all })),
    }
  })

  // ════════════════════════ API KEYS ════════════════════════
  app.get('/comm/api-keys', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!(await requireManage(req.user, reply))) return
    return listApiKeys(req.user.workspaceId)
  })

  app.post(
    '/comm/api-keys',
    {
      onRequest: [app.authenticate],
      schema: { body: z.object({ name: z.string().min(1).max(100), expiresAt: z.string().datetime().nullable().optional() }) },
    },
    async (req, reply) => {
      if (!(await requireManage(req.user, reply))) return
      const created = await createApiKey(req.user.workspaceId, req.body.name, {
        expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
        createdBy: req.user.sub,
      })
      return reply.code(201).send(created)
    },
  )

  app.delete(
    '/comm/api-keys/:id',
    { onRequest: [app.authenticate], schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      if (!(await requireManage(req.user, reply))) return
      const ok = await revokeApiKey(req.user.workspaceId, req.params.id)
      if (!ok) return reply.code(404).send({ error: 'API key não encontrada' })
      return reply.code(204).send()
    },
  )
}

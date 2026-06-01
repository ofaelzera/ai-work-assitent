import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { parseJid } from '../../lib/phone.js'
import { logger } from '../../lib/logger.js'
import { mergeContacts } from './merge.service.js'
import { autoDedupContacts } from '../channels/sync.service.js'
import { getClientForChannel } from '../evolution-servers/evolution-servers.service.js'
import { hasPermission, requirePerm } from '../../lib/acl.js'

export const contactsRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── Listar / buscar contatos ───────────────────────────────────────────────
  app.get(
    '/contacts',
    {
      onRequest: [app.authenticate, requirePerm('contacts.view')],
      schema: {
        querystring: z.object({
          q: z.string().optional(),
          companyId: z.string().optional(),
          excludeLid: z.coerce.boolean().optional(),
          hasPhone: z.coerce.boolean().optional(),
          limit: z.coerce.number().default(50),
          offset: z.coerce.number().default(0),
        }),
      },
    },
    async (req) => {
      const { workspaceId, sub: userId } = req.user
      const { q, companyId, excludeLid, hasPhone, limit, offset } = req.query

      // excludeLid=true esconde LIDs SEM nome (LIDs com nome continuam visíveis)
      const hiddenLidFilter = excludeLid
        ? { NOT: { AND: [{ phoneType: 'LID' as const }, { name: null }] } }
        : {}

      // hasPhone=true traz apenas contatos com número de telefone cadastrado
      // (usado na criação de conversa WhatsApp, onde contatos sem número são inúteis)
      const hasPhoneFilter = hasPhone
        ? { phone: { not: null } }
        : {}

      // Filtro de visibilidade por role:
      //  • Quem tem `contacts.viewAll` (ADMIN/Supervisor) → vê todos
      //  • Sem essa permissão → vê apenas contatos com quem tem conversa atribuída a ele
      const canViewAll = await hasPermission(req.user, 'contacts.viewAll')
      const visibilityFilter = canViewAll ? {} : {
        conversations: { some: { assigneeId: userId } },
      }

      const baseWhere = {
        workspaceId,
        mergedIntoId: null,
        ...hiddenLidFilter,
        ...hasPhoneFilter,
        ...visibilityFilter,
        ...(companyId && { companyId }),
        ...(q && {
          OR: [
            { name: { contains: q } },
            { phone: { contains: q } },
            { email: { contains: q } },
            { lid: { contains: q } },
          ],
        }),
      }

      const [contacts, hiddenCount] = await Promise.all([
        prisma.contact.findMany({
          where: baseWhere,
          orderBy: [{ name: 'asc' }, { createdAt: 'desc' }],
          take: limit,
          skip: offset,
          select: {
            id: true,
            name: true,
            phone: true,
            phoneType: true,
            lid: true,
            email: true,
            metadata: true,
            companyId: true,
            company: { select: { id: true, name: true, color: true } },
            _count: { select: { conversations: true } },
          },
        }),
        // Conta quantos LIDs sem nome estão ocultos (só quando o filtro está ativo e sem busca textual)
        excludeLid && !q
          ? prisma.contact.count({
              where: { workspaceId, mergedIntoId: null, phoneType: 'LID', name: null },
            })
          : Promise.resolve(0),
      ])

      return { items: contacts, hiddenCount }
    },
  )

  // ── Criar contato ─────────────────────────────────────────────────────────
  app.post(
    '/contacts',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          name: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().email().optional(),
          companyId: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      if (!(await hasPermission(req.user, 'contacts.edit'))) {
        return reply.forbidden('Sem permissão pra criar contatos')
      }
      const { name, phone, email, companyId } = req.body

      // Phone manualmente digitado é sempre PN — se o usuário digitar lixo, parseJid vai retornar 'unknown'
      let normalizedPhone: string | undefined
      let phoneType: 'PN' | 'UNKNOWN' = 'UNKNOWN'
      if (phone) {
        const parsed = parseJid(phone)
        if (parsed.kind === 'pn' && parsed.phone) {
          normalizedPhone = parsed.phone
          phoneType = 'PN'
        }
      }

      const contact = await prisma.contact.create({
        data: { workspaceId, name, phone: normalizedPhone, phoneType, email, companyId },
        select: { id: true, name: true, phone: true, phoneType: true, lid: true, email: true, companyId: true, createdAt: true },
      })
      return reply.code(201).send(contact)
    },
  )

  // ── Atualizar contato (inclui desvincular empresa com companyId: null) ────
  app.patch(
    '/contacts/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().email().optional().nullable(),
          companyId: z.string().nullable().optional(), // null = remove da empresa
          metadata: z.record(z.unknown()).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      if (!(await hasPermission(req.user, 'contacts.edit'))) {
        return reply.forbidden('Sem permissão pra editar contatos')
      }
      const current = await prisma.contact.findFirstOrThrow({ where: { id: req.params.id, workspaceId } })

      const { phone, companyId, ...rest } = req.body

      // Build update data carefully to handle nullable relation
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: Record<string, any> = { ...rest }
      if (phone !== undefined) {
        if (phone === '' || phone === null) {
          data.phone = null
        } else {
          const parsed = parseJid(phone)
          if (parsed.kind === 'pn' && parsed.phone) {
            data.phone = parsed.phone
            // Se era LID e agora descobrimos o PN, promove para PN
            if (current.phoneType === 'LID' || current.phoneType === 'UNKNOWN') {
              data.phoneType = 'PN'
            }
            // Auto-merge: se já existe outro contato PN com esse mesmo phone, mescla este nele
            const otherPn = await prisma.contact.findFirst({
              where: { workspaceId, phone: parsed.phone, mergedIntoId: null, id: { not: current.id } },
            })
            if (otherPn) {
              await mergeContacts(current.id, otherPn.id)
              return prisma.contact.findUniqueOrThrow({
                where: { id: otherPn.id },
                select: {
                  id: true, name: true, phone: true, phoneType: true, lid: true, email: true,
                  companyId: true, metadata: true, updatedAt: true,
                  company: { select: { id: true, name: true, color: true } },
                },
              })
            }
          } else {
            data.phone = phone.replace(/\D/g, '') || null
          }
        }
      }
      // companyId: null → desvincula empresa; string → vincula; undefined → mantém
      if (companyId !== undefined) data.companyId = companyId ?? null

      return prisma.contact.update({
        where: { id: req.params.id },
        data,
        select: {
          id: true, name: true, phone: true, phoneType: true, lid: true, email: true,
          companyId: true, metadata: true, updatedAt: true,
          company: { select: { id: true, name: true, color: true } },
        },
      })
    },
  )

  // ── Deletar contato ───────────────────────────────────────────────────────
  app.delete(
    '/contacts/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      if (!(await hasPermission(req.user, 'contacts.delete'))) {
        return reply.forbidden('Sem permissão pra deletar contatos')
      }
      await prisma.contact.findFirstOrThrow({ where: { id: req.params.id, workspaceId } })
      await prisma.contact.delete({ where: { id: req.params.id } })
      return reply.code(204).send()
    },
  )

  // ── Resolver IDs de menção (WhatsApp PN/LID → nome do contato) ───────────
  // Usado pelo frontend para renderizar @<dígitos> nas mensagens com o nome certo.
  app.post(
    '/contacts/resolve-mentions',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({ ids: z.array(z.string()).max(200) }),
      },
    },
    async (req) => {
      const { workspaceId } = req.user
      const { ids } = req.body
      if (ids.length === 0) return {}

      const dedup = Array.from(new Set(ids))
      const contacts = await prisma.contact.findMany({
        where: {
          workspaceId,
          mergedIntoId: null,
          OR: [
            { phone: { in: dedup } },
            { lid: { in: dedup } },
          ],
        },
        select: { name: true, phone: true, lid: true },
      })

      const map: Record<string, string> = {}
      for (const c of contacts) {
        const label = c.name ?? c.phone ?? c.lid ?? ''
        if (c.phone && dedup.includes(c.phone)) map[c.phone] = label
        if (c.lid && dedup.includes(c.lid)) map[c.lid] = label
      }

      // Fallback: também resolve menções que correspondem ao DONO do canal
      // (LID/PN aprendido a partir de mensagens fromMe — ver evolution.handler).
      const remaining = dedup.filter(id => !map[id])
      if (remaining.length > 0) {
        const channels = await prisma.channel.findMany({
          where: { workspaceId, type: 'WHATSAPP', deletedAt: null },
          select: { label: true, settings: true },
        })
        for (const ch of channels) {
          const s = (ch.settings as Record<string, unknown> | null) ?? {}
          const phone = typeof s.ownerPhone === 'string' ? s.ownerPhone : undefined
          const lid = typeof s.ownerLid === 'string' ? s.ownerLid : undefined
          const profile = typeof s.ownerProfileName === 'string' ? s.ownerProfileName : ch.label
          if (phone && remaining.includes(phone) && !map[phone]) map[phone] = profile
          if (lid && remaining.includes(lid) && !map[lid]) map[lid] = profile
        }
      }

      return map
    },
  )

  // ── Deduplicar contatos (merge de duplicatas por telefone OU LID) ─────────
  // Reusa o helper `autoDedupContacts` que também roda automaticamente após sync.
  app.post(
    '/contacts/dedup',
    { onRequest: [app.authenticate] },
    async (req) => {
      const { workspaceId } = req.user
      const merged = await autoDedupContacts(workspaceId)
      const checked = await prisma.contact.count({
        where: { workspaceId, mergedIntoId: null },
      })
      return { merged, checked }
    },
  )

  // ── Mesclar dois contatos específicos ────────────────────────────────────
  // O contato :id é migrado para mergeWithId (que vira o primário).
  app.post(
    '/contacts/:id/merge',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ mergeWithId: z.string() }),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const { id } = req.params
      const { mergeWithId } = req.body

      if (id === mergeWithId) return reply.badRequest('Não é possível mesclar um contato com ele mesmo')

      // Valida que ambos pertencem ao workspace
      const [dup, primary] = await Promise.all([
        prisma.contact.findFirst({ where: { id, workspaceId, mergedIntoId: null } }),
        prisma.contact.findFirst({ where: { id: mergeWithId, workspaceId, mergedIntoId: null } }),
      ])
      if (!dup || !primary) return reply.notFound('Contato não encontrado ou já mesclado')

      // Delega pra função utilitária (mesma lógica do auto-merge)
      await mergeContacts(dup.id, primary.id)
      logger.info({ primaryId: primary.id, dupId: dup.id }, 'Contatos mesclados manualmente')
      return { ok: true, primaryId: primary.id }
    },
  )

  // ── Sincronizar foto de perfil do WhatsApp ────────────────────────────────
  // Busca a foto via Evolution usando qualquer canal WhatsApp conectado do workspace.
  app.post(
    '/contacts/:id/sync-avatar',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const contact = await prisma.contact.findFirst({
        where: { id: req.params.id, workspaceId, mergedIntoId: null },
      })
      if (!contact) return reply.notFound('Contato não encontrado')

      // Precisa de um número de telefone real (não LID)
      if (!contact.phone || contact.phoneType === 'LID') {
        return reply.badRequest('Contato sem número de telefone — não é possível buscar foto do WhatsApp')
      }

      // Usa o primeiro canal WhatsApp conectado do workspace
      const channel = await prisma.channel.findFirst({
        where: { workspaceId, type: 'WHATSAPP', status: 'CONNECTED', deletedAt: null },
        select: { id: true },
      })
      if (!channel) return reply.badRequest('Nenhum canal WhatsApp conectado')

      const { getChannelConfig } = await import('../channels/channels.service.js')
      const { instanceName } = await getChannelConfig(channel.id)
      const waClient = await getClientForChannel(channel.id)

      const jid = `${contact.phone}@s.whatsapp.net`
      let profilePictureUrl: string | null = null
      try {
        const result = await waClient.fetchProfilePicture(instanceName, jid)
        profilePictureUrl = result.profilePictureUrl ?? null
      } catch {
        return reply.badRequest('Não foi possível buscar a foto — contato pode ter privacidade restrita')
      }

      if (!profilePictureUrl) {
        return reply.badRequest('Este contato não tem foto de perfil disponível')
      }

      const meta = (contact.metadata as Record<string, unknown> | null) ?? {}
      await prisma.contact.update({
        where: { id: contact.id },
        data: { metadata: { ...meta, avatarUrl: profilePictureUrl } },
      })

      return { ok: true, avatarUrl: profilePictureUrl }
    },
  )

  // ── Upload manual de foto de perfil ──────────────────────────────────────
  // Recebe multipart/form-data com campo "file" (imagem).
  // Converte para base64 data URL e salva em metadata.avatarUrl — sem storage externo.
  app.post(
    '/contacts/:id/avatar',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req: any, reply) => {
      const { workspaceId } = req.user
      const contact = await prisma.contact.findFirst({
        where: { id: req.params.id, workspaceId, mergedIntoId: null },
      })
      if (!contact) return reply.notFound('Contato não encontrado')

      const data = await req.file()
      if (!data) return reply.badRequest('Arquivo obrigatório')
      if (!data.mimetype.startsWith('image/')) return reply.badRequest('Apenas imagens são permitidas')

      const chunks: Buffer[] = []
      for await (const chunk of data.file) chunks.push(chunk)
      const buffer = Buffer.concat(chunks)

      // Limita a 2 MB para não inflar demais o banco
      if (buffer.length > 2 * 1024 * 1024) {
        return reply.badRequest('Imagem muito grande — máximo 2 MB')
      }

      const avatarUrl = `data:${data.mimetype};base64,${buffer.toString('base64')}`

      const meta = (contact.metadata as Record<string, unknown> | null) ?? {}
      await prisma.contact.update({
        where: { id: contact.id },
        data: { metadata: { ...meta, avatarUrl } },
      })

      return reply.code(201).send({ ok: true, avatarUrl })
    },
  )
}

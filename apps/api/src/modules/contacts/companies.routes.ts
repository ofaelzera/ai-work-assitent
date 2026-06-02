import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { hasPermission, requirePerm } from '../../lib/acl.js'
import { setContactCompanies } from './contact-company.service.js'

// Campos comuns de cadastro/edição (não inclui logoUrl — vem do upload)
const companyBodyFields = {
  name: z.string().min(1).optional(),
  color: z.string().optional(),
  domain: z.string().optional().nullable(),
  cnpj: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  // Regras de atribuição
  distributionMode: z.enum(['all', 'fixed', 'round_robin']).nullable().optional(),
  defaultAssigneeId: z.string().nullable().optional(),
  roundRobinUserIds: z.array(z.string()).optional(),
}

export const companiesRoutes: FastifyPluginAsyncZod = async (app) => {
  // Listar empresas — quem não tem contacts.viewAll vê só empresas dos contatos que atende
  app.get('/companies', { onRequest: [app.authenticate, requirePerm('companies.view')] }, async (req) => {
    const { workspaceId, sub: userId } = req.user
    const canViewAll = await hasPermission(req.user, 'contacts.viewAll')
    return prisma.company.findMany({
      where: {
        workspaceId,
        ...(!canViewAll && {
          OR: [
            { contactLinks: { some: { contact: { conversations: { some: { assigneeId: userId } } } } } },
            { conversations: { some: { assigneeId: userId } } },
          ],
        }),
      },
      orderBy: { name: 'asc' },
      include: {
        // contagem de contatos via junção N:N (RF04); expõe como `contacts` p/ compat de UI
        _count: { select: { contactLinks: true, conversations: true } },
      },
    })
  })

  // ── Detalhes de uma empresa (todos os campos) ─────────────────────────────
  app.get(
    '/companies/:id',
    {
      onRequest: [app.authenticate, requirePerm('companies.view')],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req) => {
      const { workspaceId } = req.user
      return prisma.company.findFirstOrThrow({
        where: { id: req.params.id, workspaceId },
      })
    },
  )

  // Criar / editar / deletar empresa → requer companies.manage
  app.post(
    '/companies',
    {
      onRequest: [app.authenticate, requirePerm('companies.manage')],
      schema: {
        body: z.object({
          ...companyBodyFields,
          name: z.string().min(1), // obrigatório na criação
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const company = await prisma.company.create({
        data: { workspaceId, ...req.body },
      })
      return reply.code(201).send(company)
    },
  )

  app.patch(
    '/companies/:id',
    {
      onRequest: [app.authenticate, requirePerm('companies.manage')],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object(companyBodyFields),
      },
    },
    async (req) => {
      const { workspaceId } = req.user
      await prisma.company.findFirstOrThrow({ where: { id: req.params.id, workspaceId } })
      return prisma.company.update({ where: { id: req.params.id }, data: req.body })
    },
  )

  // ── Upload de logo (multipart/form-data) ──────────────────────────────────
  // Mesmo padrão dos avatares de contato: salva como data URL base64 inline,
  // sem dependência de storage externo.
  app.post(
    '/companies/:id/logo',
    { onRequest: [app.authenticate, requirePerm('companies.manage')] },
    async (req: any, reply) => {
      const { workspaceId } = req.user
      const company = await prisma.company.findFirstOrThrow({
        where: { id: req.params.id, workspaceId },
      })

      const data = await req.file()
      if (!data) return reply.badRequest('Arquivo obrigatório')
      if (!data.mimetype.startsWith('image/')) {
        return reply.badRequest('Apenas imagens são aceitas')
      }

      const chunks: Buffer[] = []
      for await (const chunk of data.file) chunks.push(chunk)
      const buffer = Buffer.concat(chunks)

      // Limite de 2MB para não inflar o DB
      if (buffer.length > 2 * 1024 * 1024) {
        return reply.badRequest('Imagem muito grande (máx 2 MB)')
      }

      const logoUrl = `data:${data.mimetype};base64,${buffer.toString('base64')}`
      const updated = await prisma.company.update({
        where: { id: company.id },
        data: { logoUrl },
        select: { id: true, logoUrl: true },
      })
      return updated
    },
  )

  // Remove a logo
  app.delete(
    '/companies/:id/logo',
    {
      onRequest: [app.authenticate, requirePerm('companies.manage')],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req) => {
      const { workspaceId } = req.user
      await prisma.company.findFirstOrThrow({ where: { id: req.params.id, workspaceId } })
      return prisma.company.update({
        where: { id: req.params.id },
        data: { logoUrl: null },
        select: { id: true, logoUrl: true },
      })
    },
  )

  app.delete(
    '/companies/:id',
    {
      onRequest: [app.authenticate, requirePerm('companies.manage')],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      await prisma.company.findFirstOrThrow({ where: { id: req.params.id, workspaceId } })
      await prisma.contact.updateMany({
        where: { workspaceId, companyId: req.params.id },
        data: { companyId: null },
      })
      // Também desvincula conversations diretamente vinculadas (grupos)
      await prisma.conversation.updateMany({
        where: { workspaceId, companyId: req.params.id },
        data: { companyId: null },
      })
      await prisma.company.delete({ where: { id: req.params.id } })
      return reply.code(204).send()
    },
  )

  // Atribuir empresa a contato (precisa permissão de editar contato)
  // Mantém a semântica antiga (uma empresa principal) mas grava no vínculo N:N:
  // substitui os vínculos MANUAIS por [companyId] (ou limpa se null).
  app.patch(
    '/contacts/:id/company',
    {
      onRequest: [app.authenticate, requirePerm('contacts.edit')],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ companyId: z.string().nullable() }),
      },
    },
    async (req) => {
      const { workspaceId } = req.user
      await prisma.contact.findFirstOrThrow({ where: { id: req.params.id, workspaceId } })
      await setContactCompanies(req.params.id, workspaceId, req.body.companyId ? [req.body.companyId] : [])
      return prisma.contact.findUniqueOrThrow({
        where: { id: req.params.id },
        select: { id: true, companyId: true },
      })
    },
  )
}

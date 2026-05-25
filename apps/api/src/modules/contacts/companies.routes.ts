import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { hasPermission, requirePerm } from '../../lib/acl.js'

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
            { contacts: { some: { conversations: { some: { assigneeId: userId } } } } },
            { conversations: { some: { assigneeId: userId } } },
          ],
        }),
      },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { contacts: true, conversations: true } },
      },
    })
  })

  // Criar / editar / deletar empresa → requer companies.manage
  app.post(
    '/companies',
    {
      onRequest: [app.authenticate, requirePerm('companies.manage')],
      schema: {
        body: z.object({
          name: z.string().min(1),
          color: z.string().optional(),
          domain: z.string().optional(),
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
        body: z.object({
          name: z.string().min(1).optional(),
          color: z.string().optional(),
          domain: z.string().optional(),
        }),
      },
    },
    async (req) => {
      const { workspaceId } = req.user
      await prisma.company.findFirstOrThrow({ where: { id: req.params.id, workspaceId } })
      return prisma.company.update({ where: { id: req.params.id }, data: req.body })
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
      return prisma.contact.update({
        where: { id: req.params.id },
        data: { companyId: req.body.companyId },
        select: { id: true, companyId: true },
      })
    },
  )
}

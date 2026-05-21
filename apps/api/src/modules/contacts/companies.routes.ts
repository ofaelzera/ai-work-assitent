import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'

export const companiesRoutes: FastifyPluginAsyncZod = async (app) => {
  // Listar empresas
  app.get('/companies', { onRequest: [app.authenticate] }, async (req) => {
    const { workspaceId } = req.user
    return prisma.company.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { contacts: true } } },
    })
  })

  // Criar empresa
  app.post(
    '/companies',
    {
      onRequest: [app.authenticate],
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

  // Atualizar empresa
  app.patch(
    '/companies/:id',
    {
      onRequest: [app.authenticate],
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

  // Deletar empresa
  app.delete(
    '/companies/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      await prisma.company.findFirstOrThrow({ where: { id: req.params.id, workspaceId } })
      // Desvincula contatos antes de deletar
      await prisma.contact.updateMany({
        where: { workspaceId, companyId: req.params.id },
        data: { companyId: null },
      })
      await prisma.company.delete({ where: { id: req.params.id } })
      return reply.code(204).send()
    },
  )

  // Atribuir empresa a contato
  app.patch(
    '/contacts/:id/company',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ companyId: z.string().nullable() }),
      },
    },
    async (req) => {
      const { workspaceId } = req.user
      return prisma.contact.update({
        where: { id: req.params.id },
        data: { companyId: req.body.companyId },
        select: { id: true, companyId: true },
      })
    },
  )
}

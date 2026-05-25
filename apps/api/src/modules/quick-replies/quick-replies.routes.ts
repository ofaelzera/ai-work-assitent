import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { hasPermission } from '../../lib/acl.js'

export const quickRepliesRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── GET /quick-replies ────────────────────────────────────────────────────
  app.get(
    '/quick-replies',
    { onRequest: [app.authenticate] },
    async (req) => {
      const { workspaceId } = req.user
      return prisma.quickReply.findMany({
        where: { workspaceId },
        orderBy: { shortcut: 'asc' },
        select: { id: true, shortcut: true, title: true, body: true, createdAt: true },
      })
    },
  )

  // ── POST /quick-replies ───────────────────────────────────────────────────
  app.post(
    '/quick-replies',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          shortcut: z.string().min(1).max(50).regex(/^\S+$/, 'Sem espaços'),
          title: z.string().max(100).optional(),
          body: z.string().min(1).max(4000),
        }),
      },
    },
    async (req, reply) => {
      if (!(await hasPermission(req.user, 'admin.settings'))) {
        return reply.code(403).send({ error: 'Sem permissão' })
      }
      const { workspaceId } = req.user
      const { shortcut, title, body } = req.body

      const existing = await prisma.quickReply.findUnique({
        where: { workspaceId_shortcut: { workspaceId, shortcut } },
        select: { id: true },
      })
      if (existing) {
        return reply.code(409).send({ error: `Atalho "/${shortcut}" já existe` })
      }

      const qr = await prisma.quickReply.create({
        data: { workspaceId, shortcut, title, body },
        select: { id: true, shortcut: true, title: true, body: true, createdAt: true },
      })
      return reply.code(201).send(qr)
    },
  )

  // ── PATCH /quick-replies/:id ──────────────────────────────────────────────
  app.patch(
    '/quick-replies/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          shortcut: z.string().min(1).max(50).regex(/^\S+$/, 'Sem espaços').optional(),
          title: z.string().max(100).nullable().optional(),
          body: z.string().min(1).max(4000).optional(),
        }),
      },
    },
    async (req, reply) => {
      if (!(await hasPermission(req.user, 'admin.settings'))) {
        return reply.code(403).send({ error: 'Sem permissão' })
      }
      const { workspaceId } = req.user
      const { id } = req.params

      const current = await prisma.quickReply.findFirst({
        where: { id, workspaceId },
        select: { id: true },
      })
      if (!current) return reply.code(404).send({ error: 'Não encontrado' })

      if (req.body.shortcut) {
        const conflict = await prisma.quickReply.findFirst({
          where: { workspaceId, shortcut: req.body.shortcut, NOT: { id } },
          select: { id: true },
        })
        if (conflict) {
          return reply.code(409).send({ error: `Atalho "/${req.body.shortcut}" já existe` })
        }
      }

      const updated = await prisma.quickReply.update({
        where: { id },
        data: req.body,
        select: { id: true, shortcut: true, title: true, body: true, createdAt: true },
      })
      return updated
    },
  )

  // ── DELETE /quick-replies/:id ─────────────────────────────────────────────
  app.delete(
    '/quick-replies/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      if (!(await hasPermission(req.user, 'admin.settings'))) {
        return reply.code(403).send({ error: 'Sem permissão' })
      }
      const { workspaceId } = req.user
      const { id } = req.params

      const current = await prisma.quickReply.findFirst({
        where: { id, workspaceId },
        select: { id: true },
      })
      if (!current) return reply.code(404).send({ error: 'Não encontrado' })

      await prisma.quickReply.delete({ where: { id } })
      return reply.code(204).send()
    },
  )
}

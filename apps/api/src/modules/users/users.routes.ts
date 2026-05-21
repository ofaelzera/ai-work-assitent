import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { hashPassword } from '../auth/auth.service.js'

const USER_SELECT = {
  id: true,
  workspaceId: true,
  email: true,
  name: true,
  role: true,
  twoFactor: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const

export const usersRoutes: FastifyPluginAsyncZod = async (app) => {

  // ── Listar usuários do workspace ───────────────────────────────────────────

  app.get(
    '/users',
    { onRequest: [app.authenticate] },
    async (req) => {
      return prisma.user.findMany({
        where: { workspaceId: req.user.workspaceId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: USER_SELECT,
      })
    },
  )

  // ── Criar usuário ──────────────────────────────────────────────────────────

  app.post(
    '/users',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          email: z.string().email(),
          name: z.string().min(1),
          password: z.string().min(8),
          role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
        }),
      },
    },
    async (req, reply) => {
      const existing = await prisma.user.findUnique({ where: { email: req.body.email } })
      if (existing) {
        return reply.conflict('Email já cadastrado')
      }

      const passwordHash = await hashPassword(req.body.password)
      const user = await prisma.user.create({
        data: {
          workspaceId: req.user.workspaceId,
          email: req.body.email,
          name: req.body.name,
          role: req.body.role,
          passwordHash,
        },
        select: USER_SELECT,
      })

      return reply.code(201).send(user)
    },
  )

  // ── Atualizar usuário ──────────────────────────────────────────────────────

  app.patch(
    '/users/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().min(1).optional(),
          email: z.string().email().optional(),
          role: z.enum(['ADMIN', 'MEMBER']).optional(),
        }),
      },
    },
    async (req, reply) => {
      const user = await prisma.user.findUnique({
        where: { id: req.params.id },
        select: { workspaceId: true, deletedAt: true },
      })

      if (!user || user.workspaceId !== req.user.workspaceId || user.deletedAt) {
        return reply.notFound('Usuário não encontrado')
      }

      return prisma.user.update({
        where: { id: req.params.id },
        data: req.body,
        select: USER_SELECT,
      })
    },
  )

  // ── Deletar usuário (soft delete) ─────────────────────────────────────────

  app.delete(
    '/users/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
      },
    },
    async (req, reply) => {
      if (req.user.role !== 'ADMIN') {
        return reply.forbidden('Apenas administradores podem remover usuários')
      }

      if (req.params.id === req.user.sub) {
        return reply.badRequest('Você não pode remover sua própria conta')
      }

      const user = await prisma.user.findUnique({
        where: { id: req.params.id },
        select: { workspaceId: true, deletedAt: true },
      })

      if (!user || user.workspaceId !== req.user.workspaceId) {
        return reply.notFound('Usuário não encontrado')
      }

      if (user.deletedAt) {
        return reply.notFound('Usuário já foi removido')
      }

      await prisma.user.update({
        where: { id: req.params.id },
        data: { deletedAt: new Date() },
      })

      return reply.code(204).send()
    },
  )
}

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { hashPassword } from '../auth/auth.service.js'
import { AVAILABLE_TEMPLATE_VARIABLES } from '../../lib/templates.js'

const USER_SELECT = {
  id: true,
  workspaceId: true,
  email: true,
  name: true,
  role: true,
  customRoleId: true,
  customRole: { select: { id: true, name: true, isSystem: true } },
  twoFactor: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const

export const usersRoutes: FastifyPluginAsyncZod = async (app) => {

  // ── Catálogo de variáveis disponíveis pra templates de mensagem ──────────
  app.get(
    '/templates/variables',
    { onRequest: [app.authenticate] },
    async () => AVAILABLE_TEMPLATE_VARIABLES,
  )

  // ── Settings pessoais do usuário logado ──────────────────────────────────
  // (welcomeMessage, closingMessage, signature, etc — JSON livre)
  app.get(
    '/users/me/settings',
    { onRequest: [app.authenticate] },
    async (req) => {
      const me = await prisma.user.findUniqueOrThrow({
        where: { id: req.user.sub },
        select: { settings: true },
      })
      return (me.settings as Record<string, unknown> | null) ?? {}
    },
  )

  app.patch(
    '/users/me/settings',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          welcomeMessage: z.string().max(2000).nullable().optional(),
          closingMessage: z.string().max(2000).nullable().optional(),
          signature:      z.string().max(2000).nullable().optional(),
        }),
      },
    },
    async (req) => {
      const current = await prisma.user.findUniqueOrThrow({
        where: { id: req.user.sub },
        select: { settings: true },
      })
      const merged: Record<string, unknown> = {
        ...(current.settings as Record<string, unknown> ?? {}),
        ...req.body,
      }
      // Remove nulls (clear)
      for (const k of Object.keys(merged)) {
        if (merged[k] === null) delete merged[k]
      }
      const updated = await prisma.user.update({
        where: { id: req.user.sub },
        data: { settings: merged as any },
        select: { settings: true },
      })
      return (updated.settings as Record<string, unknown>) ?? {}
    },
  )

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
          customRoleId: z.string().nullable().optional(),
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

      // Valida que o customRoleId (se passado) pertence ao mesmo workspace
      if (req.body.customRoleId) {
        const role = await prisma.customRole.findFirst({
          where: { id: req.body.customRoleId, workspaceId: req.user.workspaceId },
          select: { id: true },
        })
        if (!role) return reply.badRequest('Role customizado não encontrado neste workspace')
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

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { hashPassword, verifyPassword } from '../auth/auth.service.js'
import { AVAILABLE_TEMPLATE_VARIABLES } from '../../lib/templates.js'

const USER_SELECT = {
  id: true,
  workspaceId: true,
  email: true,
  googleId: true,
  name: true,
  role: true,
  customRoleId: true,
  customRole: { select: { id: true, name: true, isSystem: true } },
  twoFactor: true,
  settings: true,        // inclui avatarUrl, welcomeMessage, etc.
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

  // ── Perfil do usuário logado (read/write) ────────────────────────────────
  // Qualquer usuário pode mexer no próprio nome/email/senha aqui, sem precisar
  // de admin.users.
  app.get('/users/me', { onRequest: [app.authenticate] }, async (req) => {
    return prisma.user.findUniqueOrThrow({
      where: { id: req.user.sub },
      select: USER_SELECT,
    })
  })

  app.patch(
    '/users/me',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          name: z.string().min(1).max(80).optional(),
          email: z.string().email().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { name, email } = req.body
      if (email) {
        const taken = await prisma.user.findFirst({
          where: { email, NOT: { id: req.user.sub } },
          select: { id: true },
        })
        if (taken) return reply.conflict('Já existe um usuário com este email')
      }
      return prisma.user.update({
        where: { id: req.user.sub },
        data: {
          ...(name !== undefined && { name }),
          ...(email !== undefined && { email }),
        },
        select: USER_SELECT,
      })
    },
  )

  // ── Preferências pessoais (merge em settings) ─────────────────────────────
  // dashboardWidgets: { [widgetKey]: boolean } — quais widgets o usuário quer ver.
  // dashboardLayout: { [breakpoint]: Array<{i,x,y,w,h}> } — posições/tamanhos da grade.
  app.patch(
    '/users/me/preferences',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          dashboardWidgets: z.record(z.string(), z.boolean()).optional(),
          dashboardLayout: z.record(z.string(), z.array(z.object({
            i: z.string(),
            x: z.number(),
            y: z.number(),
            w: z.number(),
            h: z.number(),
          }))).nullable().optional(),
        }),
      },
    },
    async (req) => {
      const current = await prisma.user.findUniqueOrThrow({
        where: { id: req.user.sub },
        select: { settings: true },
      })
      const settings = { ...((current.settings as Record<string, unknown> | null) ?? {}) }
      if (req.body.dashboardWidgets !== undefined) {
        const prev = (settings.dashboardWidgets as Record<string, boolean> | undefined) ?? {}
        settings.dashboardWidgets = { ...prev, ...req.body.dashboardWidgets }
      }
      if (req.body.dashboardLayout !== undefined) {
        // null = resetar para o padrão
        settings.dashboardLayout = req.body.dashboardLayout ?? undefined
      }
      return prisma.user.update({
        where: { id: req.user.sub },
        data: { settings: settings as any },
        select: USER_SELECT,
      })
    },
  )

  app.post(
    '/users/me/password',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          currentPassword: z.string().min(1),
          newPassword: z.string().min(8).max(128),
        }),
      },
    },
    async (req, reply) => {
      const me = await prisma.user.findUniqueOrThrow({
        where: { id: req.user.sub },
        select: { id: true, passwordHash: true },
      })
      if (!me.passwordHash) return reply.badRequest('Esta conta usa login com Google e não tem senha local')
      const ok = await verifyPassword(me.passwordHash, req.body.currentPassword)
      if (!ok) return reply.unauthorized('Senha atual incorreta')
      const passwordHash = await hashPassword(req.body.newPassword)
      await prisma.user.update({ where: { id: me.id }, data: { passwordHash } })
      return { ok: true }
    },
  )

  // ── Upload de foto de perfil ─────────────────────────────────────────────
  // Salva como data URL base64 em User.settings.avatarUrl (mesmo padrão de Contact).
  app.post(
    '/users/me/avatar',
    { onRequest: [app.authenticate] },
    async (req: any, reply) => {
      const data = await req.file()
      if (!data) return reply.badRequest('Arquivo obrigatório')
      if (!data.mimetype.startsWith('image/')) return reply.badRequest('Apenas imagens')

      const chunks: Buffer[] = []
      for await (const chunk of data.file) chunks.push(chunk)
      const buffer = Buffer.concat(chunks)

      // Limita a 2 MB pra não inflar o banco
      if (buffer.length > 2 * 1024 * 1024) {
        return reply.badRequest('Imagem muito grande — máximo 2 MB')
      }

      const avatarUrl = `data:${data.mimetype};base64,${buffer.toString('base64')}`

      const current = await prisma.user.findUniqueOrThrow({
        where: { id: req.user.sub },
        select: { settings: true },
      })
      const merged = { ...(current.settings as Record<string, unknown> ?? {}), avatarUrl }
      await prisma.user.update({
        where: { id: req.user.sub },
        data: { settings: merged as any },
      })
      return reply.code(201).send({ ok: true, avatarUrl })
    },
  )

  // DELETE /users/me/avatar — remove foto
  app.delete(
    '/users/me/avatar',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const current = await prisma.user.findUniqueOrThrow({
        where: { id: req.user.sub },
        select: { settings: true },
      })
      const merged = { ...(current.settings as Record<string, unknown> ?? {}) }
      delete merged.avatarUrl
      await prisma.user.update({
        where: { id: req.user.sub },
        data: { settings: merged as any },
      })
      return reply.code(204).send()
    },
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

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { ALL_PERMISSION_KEYS, PERMISSIONS, SYSTEM_ROLES, isValidPermission } from '../../lib/permissions.js'
import { requirePerm, invalidateRoleCache } from '../../lib/acl.js'

/**
 * CRUD de roles customizáveis (RBAC).
 * Roles isSystem=true (seed) podem ter permissions editadas pelo admin, mas não podem ser deletados.
 *
 * Auto-cria os system roles se ainda não existirem (lazy seed por workspace).
 */
export const rolesRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── GET /permissions — catálogo completo (pra UI desenhar checkboxes) ────
  app.get(
    '/permissions',
    { onRequest: [app.authenticate] },
    async () => {
      return Object.entries(PERMISSIONS).map(([key, label]) => ({ key, label }))
    },
  )

  // ── Helper: garante que workspace tem os 3 system roles (lazy seed) ──────
  async function ensureSystemRoles(workspaceId: string) {
    const existing = await prisma.customRole.findMany({
      where: { workspaceId, isSystem: true },
      select: { name: true },
    })
    const existingNames = new Set(existing.map(r => r.name))
    const toCreate = SYSTEM_ROLES.filter(r => !existingNames.has(r.name))
    if (toCreate.length === 0) return
    await prisma.$transaction(
      toCreate.map(r =>
        prisma.customRole.create({
          data: {
            workspaceId,
            name: r.name,
            description: r.description,
            permissions: r.permissions as any,
            isSystem: true,
          },
        }),
      ),
    )
  }

  // ── GET /roles — lista roles do workspace ────────────────────────────────
  app.get(
    '/roles',
    { onRequest: [app.authenticate, requirePerm('admin.users')] },
    async (req) => {
      await ensureSystemRoles(req.user.workspaceId)
      return prisma.customRole.findMany({
        where: { workspaceId: req.user.workspaceId },
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
        select: {
          id: true, name: true, description: true, permissions: true, isSystem: true,
          createdAt: true, updatedAt: true,
          _count: { select: { users: true } },
        },
      })
    },
  )

  // ── POST /roles — cria role customizado ──────────────────────────────────
  app.post(
    '/roles',
    {
      onRequest: [app.authenticate, requirePerm('admin.users')],
      schema: {
        body: z.object({
          name: z.string().min(1).max(60),
          description: z.string().max(200).nullable().optional(),
          permissions: z.array(z.string()).default([]),
        }),
      },
    },
    async (req, reply) => {
      const validPerms = req.body.permissions.filter(isValidPermission)
      try {
        const role = await prisma.customRole.create({
          data: {
            workspaceId: req.user.workspaceId,
            name: req.body.name.trim(),
            description: req.body.description ?? null,
            permissions: validPerms as any,
            isSystem: false,
          },
        })
        return reply.code(201).send(role)
      } catch (err: any) {
        if (err?.code === 'P2002') return reply.badRequest('Já existe um role com esse nome')
        throw err
      }
    },
  )

  // ── PATCH /roles/:id — edita name/description/permissions ────────────────
  app.patch(
    '/roles/:id',
    {
      onRequest: [app.authenticate, requirePerm('admin.users')],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().min(1).max(60).optional(),
          description: z.string().max(200).nullable().optional(),
          permissions: z.array(z.string()).optional(),
        }),
      },
    },
    async (req, reply) => {
      const role = await prisma.customRole.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId },
      })
      if (!role) return reply.notFound()

      // Roles do sistema: pode editar perms e descrição, mas não pode renomear
      if (role.isSystem && req.body.name && req.body.name !== role.name) {
        return reply.badRequest('Não é possível renomear roles do sistema')
      }

      const data: Record<string, unknown> = {}
      if (req.body.name !== undefined) data.name = req.body.name.trim()
      if (req.body.description !== undefined) data.description = req.body.description
      if (req.body.permissions !== undefined) {
        const valid = req.body.permissions.filter(isValidPermission)
        data.permissions = valid as any
      }

      try {
        const updated = await prisma.customRole.update({
          where: { id: role.id },
          data,
        })
        invalidateRoleCache(role.id)  // limpa cache pra próximas requests
        return updated
      } catch (err: any) {
        if (err?.code === 'P2002') return reply.badRequest('Já existe um role com esse nome')
        throw err
      }
    },
  )

  // ── DELETE /roles/:id ────────────────────────────────────────────────────
  app.delete(
    '/roles/:id',
    {
      onRequest: [app.authenticate, requirePerm('admin.users')],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const role = await prisma.customRole.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId },
        include: { _count: { select: { users: true } } },
      })
      if (!role) return reply.notFound()
      if (role.isSystem) return reply.badRequest('Roles do sistema não podem ser deletados')
      if (role._count.users > 0) {
        return reply.status(409).send({
          error: 'roleInUse',
          message: `${role._count.users} usuário(s) ainda usam este role. Mude-os antes de deletar.`,
          users: role._count.users,
        })
      }

      await prisma.customRole.delete({ where: { id: role.id } })
      invalidateRoleCache(role.id)
      return reply.code(204).send()
    },
  )
}

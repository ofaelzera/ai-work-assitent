import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { hasPermission, requirePerm } from '../../lib/acl.js'
import { eventBus } from '../../lib/eventBus.js'
import { ensureUniqueSlug, slugify, getTeamStats, getUserTeamIds } from './teams.service.js'

const distModeSchema = z.enum(['all', 'fixed', 'round_robin', 'load_balanced'])

const teamBodyFields = {
  name: z.string().min(1).max(80).optional(),
  slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(40).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  distributionMode: distModeSchema.optional(),
  defaultAssigneeId: z.string().nullable().optional(),
  roundRobinUserIds: z.array(z.string()).nullable().optional(),
  businessHours: z.record(z.string(), z.any()).nullable().optional(),
  slaFirstResponseMin: z.number().int().positive().nullable().optional(),
  slaResolutionMin: z.number().int().positive().nullable().optional(),
  overflowTeamId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
}

const memberBodySchema = z.object({
  userId: z.string(),
  role: z.enum(['LEADER', 'AGENT']).default('AGENT'),
  isActive: z.boolean().default(true),
  capacity: z.number().int().positive().nullable().optional(),
})

export const teamsRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── Listar teams ─────────────────────────────────────────────────────────
  // Quem tem teams.viewAll vê todos; demais veem só os que são membros.
  app.get(
    '/teams',
    {
      onRequest: [app.authenticate, requirePerm('teams.view')],
      schema: { querystring: z.object({ includeStats: z.coerce.boolean().optional() }) },
    },
    async (req) => {
      const { workspaceId, sub: userId } = req.user
      const canViewAll = await hasPermission(req.user, 'teams.viewAll')
      const teams = await prisma.team.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          ...(!canViewAll && { members: { some: { userId, isActive: true } } }),
        },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        include: {
          _count: { select: { members: true, conversations: true } },
          members: {
            select: {
              userId: true,
              role: true,
              isActive: true,
              capacity: true,
              user: { select: { id: true, name: true, email: true } },
            },
            take: 50,
          },
        },
      })
      if (req.query.includeStats) {
        const stats = await Promise.all(teams.map((t) => getTeamStats(workspaceId, t.id)))
        return teams.map((t, i) => ({ ...t, stats: stats[i] }))
      }
      return teams
    },
  )

  // ── Ver detalhe ──────────────────────────────────────────────────────────
  app.get(
    '/teams/:id',
    {
      onRequest: [app.authenticate, requirePerm('teams.view')],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const team = await prisma.team.findFirst({
        where: { id: req.params.id, workspaceId, deletedAt: null },
        include: {
          members: {
            include: { user: { select: { id: true, name: true, email: true } } },
            orderBy: { joinedAt: 'asc' },
          },
          overflowTeam: { select: { id: true, name: true, color: true } },
          _count: { select: { conversations: true } },
        },
      })
      if (!team) return reply.notFound('Time não encontrado')
      const canViewAll = await hasPermission(req.user, 'teams.viewAll')
      if (!canViewAll && !team.members.some((m) => m.userId === userId && m.isActive)) {
        return reply.forbidden('Você não é membro deste time')
      }
      return team
    },
  )

  // ── Stats de um team ─────────────────────────────────────────────────────
  app.get(
    '/teams/:id/stats',
    {
      onRequest: [app.authenticate, requirePerm('teams.view')],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req) => {
      const { workspaceId } = req.user
      return getTeamStats(workspaceId, req.params.id)
    },
  )

  // ── Times do usuário atual (atalho pra UI) ───────────────────────────────
  app.get(
    '/teams/mine',
    { onRequest: [app.authenticate] },
    async (req) => {
      const ids = await getUserTeamIds(req.user.sub)
      if (ids.length === 0) return []
      return prisma.team.findMany({
        where: { id: { in: ids }, workspaceId: req.user.workspaceId, deletedAt: null },
        select: { id: true, name: true, slug: true, color: true, icon: true },
        orderBy: { name: 'asc' },
      })
    },
  )

  // ── Opções (para selects, etc) ──────────────────────────────────────────
  app.get(
    '/teams/options',
    { onRequest: [app.authenticate] },
    async (req) => {
      const { workspaceId } = req.user
      return prisma.team.findMany({
        where: { workspaceId, deletedAt: null, isActive: true },
        select: { id: true, name: true, color: true, slug: true },
        orderBy: { name: 'asc' },
      })
    }
  )

  // ── Criar ────────────────────────────────────────────────────────────────
  app.post(
    '/teams',
    {
      onRequest: [app.authenticate, requirePerm('teams.manage')],
      schema: {
        body: z.object({
          ...teamBodyFields,
          name: z.string().min(1).max(80),
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const body = req.body
      const baseSlug = body.slug ?? slugify(body.name)
      const slug = await ensureUniqueSlug(workspaceId, baseSlug)
      const team = await prisma.team.create({
        data: {
          workspaceId,
          name: body.name,
          slug,
          color: body.color ?? '#6366f1',
          icon: body.icon ?? null,
          description: body.description ?? null,
          distributionMode: body.distributionMode ?? 'all',
          defaultAssigneeId: body.defaultAssigneeId ?? null,
          roundRobinUserIds: body.roundRobinUserIds ?? undefined,
          businessHours: body.businessHours ?? undefined,
          slaFirstResponseMin: body.slaFirstResponseMin ?? null,
          slaResolutionMin: body.slaResolutionMin ?? null,
          overflowTeamId: body.overflowTeamId ?? null,
          isActive: body.isActive ?? true,
        },
      })
      await eventBus.audit(workspaceId, 'team.created', {
        actorUserId: req.user.sub,
        targetType: 'team',
        targetId: team.id,
        payload: { name: team.name, slug: team.slug },
      })
      return reply.code(201).send(team)
    },
  )

  // ── Editar ───────────────────────────────────────────────────────────────
  app.patch(
    '/teams/:id',
    {
      onRequest: [app.authenticate, requirePerm('teams.manage')],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object(teamBodyFields),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const exists = await prisma.team.findFirst({
        where: { id: req.params.id, workspaceId, deletedAt: null },
        select: { id: true, slug: true },
      })
      if (!exists) return reply.notFound('Time não encontrado')

      const body = req.body
      let nextSlug: string | undefined
      if (body.slug && body.slug !== exists.slug) {
        nextSlug = await ensureUniqueSlug(workspaceId, slugify(body.slug), req.params.id)
      }

      const updated = await prisma.team.update({
        where: { id: req.params.id },
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(nextSlug && { slug: nextSlug }),
          ...(body.color !== undefined && { color: body.color }),
          ...(body.icon !== undefined && { icon: body.icon }),
          ...(body.description !== undefined && { description: body.description }),
          ...(body.distributionMode !== undefined && { distributionMode: body.distributionMode }),
          ...(body.defaultAssigneeId !== undefined && { defaultAssigneeId: body.defaultAssigneeId }),
          ...(body.roundRobinUserIds !== undefined && { roundRobinUserIds: body.roundRobinUserIds ?? undefined }),
          ...(body.businessHours !== undefined && { businessHours: body.businessHours ?? undefined }),
          ...(body.slaFirstResponseMin !== undefined && { slaFirstResponseMin: body.slaFirstResponseMin }),
          ...(body.slaResolutionMin !== undefined && { slaResolutionMin: body.slaResolutionMin }),
          ...(body.overflowTeamId !== undefined && { overflowTeamId: body.overflowTeamId }),
          ...(body.isActive !== undefined && { isActive: body.isActive }),
        },
      })
      await eventBus.audit(workspaceId, 'team.updated', {
        actorUserId: req.user.sub,
        targetType: 'team',
        targetId: req.params.id,
      })
      return updated
    },
  )

  // ── Soft delete ──────────────────────────────────────────────────────────
  app.delete(
    '/teams/:id',
    {
      onRequest: [app.authenticate, requirePerm('teams.manage')],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const exists = await prisma.team.findFirst({
        where: { id: req.params.id, workspaceId, deletedAt: null },
        select: { id: true },
      })
      if (!exists) return reply.notFound('Time não encontrado')

      // Bloqueia delete se houver conversas OPEN/WAITING ativas
      const activeCount = await prisma.conversation.count({
        where: {
          workspaceId,
          teamId: req.params.id,
          status: { in: ['OPEN', 'WAITING'] },
        },
      })
      if (activeCount > 0) {
        return reply.conflict(`Existem ${activeCount} conversa(s) ativas neste time. Transfira-as antes de excluir.`)
      }

      await prisma.team.update({
        where: { id: req.params.id },
        data: { deletedAt: new Date(), isActive: false },
      })
      // Remove vínculos de canais default
      await prisma.channel.updateMany({
        where: { defaultTeamId: req.params.id },
        data: { defaultTeamId: null },
      })
      await eventBus.audit(workspaceId, 'team.deleted', {
        actorUserId: req.user.sub,
        targetType: 'team',
        targetId: req.params.id,
      })
      return reply.code(204).send()
    },
  )

  // ── Membros: adicionar ───────────────────────────────────────────────────
  app.post(
    '/teams/:id/members',
    {
      onRequest: [app.authenticate, requirePerm('teams.manage')],
      schema: {
        params: z.object({ id: z.string() }),
        body: memberBodySchema,
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const team = await prisma.team.findFirst({
        where: { id: req.params.id, workspaceId, deletedAt: null },
        select: { id: true },
      })
      if (!team) return reply.notFound('Time não encontrado')

      // Garante que o user pertence ao mesmo workspace
      const user = await prisma.user.findFirst({
        where: { id: req.body.userId, workspaceId, deletedAt: null },
        select: { id: true },
      })
      if (!user) return reply.notFound('Usuário não encontrado neste workspace')

      const membership = await prisma.teamMembership.upsert({
        where: { teamId_userId: { teamId: req.params.id, userId: req.body.userId } },
        update: {
          role: req.body.role,
          isActive: req.body.isActive,
          capacity: req.body.capacity ?? null,
        },
        create: {
          teamId: req.params.id,
          userId: req.body.userId,
          role: req.body.role,
          isActive: req.body.isActive,
          capacity: req.body.capacity ?? null,
        },
      })
      await eventBus.audit(workspaceId, 'team.member.added', {
        actorUserId: req.user.sub,
        targetType: 'team',
        targetId: req.params.id,
        payload: { userId: req.body.userId, role: req.body.role },
      })
      return reply.code(201).send(membership)
    },
  )

  // ── Membros: editar ──────────────────────────────────────────────────────
  app.patch(
    '/teams/:id/members/:userId',
    {
      onRequest: [app.authenticate, requirePerm('teams.manage')],
      schema: {
        params: z.object({ id: z.string(), userId: z.string() }),
        body: memberBodySchema.partial().omit({ userId: true }),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const existing = await prisma.teamMembership.findFirst({
        where: {
          teamId: req.params.id,
          userId: req.params.userId,
          team: { workspaceId, deletedAt: null },
        },
        select: { id: true },
      })
      if (!existing) return reply.notFound('Membro não encontrado')
      const updated = await prisma.teamMembership.update({
        where: { id: existing.id },
        data: req.body,
      })
      return updated
    },
  )

  // ── Membros: remover ─────────────────────────────────────────────────────
  app.delete(
    '/teams/:id/members/:userId',
    {
      onRequest: [app.authenticate, requirePerm('teams.manage')],
      schema: { params: z.object({ id: z.string(), userId: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      const existing = await prisma.teamMembership.findFirst({
        where: {
          teamId: req.params.id,
          userId: req.params.userId,
          team: { workspaceId, deletedAt: null },
        },
        select: { id: true },
      })
      if (!existing) return reply.notFound('Membro não encontrado')
      await prisma.teamMembership.delete({ where: { id: existing.id } })
      await eventBus.audit(workspaceId, 'team.member.removed', {
        actorUserId: req.user.sub,
        targetType: 'team',
        targetId: req.params.id,
        payload: { userId: req.params.userId },
      })
      return reply.code(204).send()
    },
  )
}

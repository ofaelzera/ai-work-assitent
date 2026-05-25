import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { hasPermission } from '../../lib/acl.js'

/**
 * Configurações globais do workspace.
 * São usadas como fallback quando o canal não tem distributionMode próprio.
 *
 * Canal sobrescreve workspace: canal.settings.distributionMode ?? workspace.settings.distributionMode ?? 'all'
 */
export const workspaceRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── GET /workspace/settings ───────────────────────────────────────────────
  app.get(
    '/workspace/settings',
    { onRequest: [app.authenticate] },
    async (req) => {
      const { workspaceId } = req.user
      const ws = await prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { settings: true },
      })
      return (ws.settings as Record<string, unknown> | null) ?? {}
    },
  )

  // ── PATCH /workspace/settings ─────────────────────────────────────────────
  app.patch(
    '/workspace/settings',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          distributionMode: z.enum(['all', 'fixed', 'round_robin']).optional(),
          defaultAssigneeId: z.string().nullable().optional(),
          roundRobinUserIds: z.array(z.string()).optional(),
          claimTimeoutMinutes: z.number().int().min(0).nullable().optional(),
          aiSuggestReplyEnabled: z.boolean().optional(),
          razaoSocial: z.string().optional(),
          cnpj: z.string().optional(),
          companyPhone: z.string().optional(),
          companyEmail: z.string().optional(),
          companyAddress: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      if (!(await hasPermission(req.user, 'admin.settings'))) {
        return reply.forbidden('Sem permissão pra alterar configurações do workspace')
      }

      const ws = await prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { settings: true },
      })
      const current = (ws.settings as Record<string, unknown> | null) ?? {}
      const updated = await prisma.workspace.update({
        where: { id: workspaceId },
        data: { settings: { ...current, ...req.body } },
        select: { settings: true },
      })
      return (updated.settings as Record<string, unknown>) ?? {}
    },
  )

  // ── PATCH /workspaces/me (nome do workspace) ──────────────────────────────
  app.patch(
    '/workspaces/me',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({ name: z.string().min(1) }),
      },
    },
    async (req, reply) => {
      const { workspaceId } = req.user
      if (!(await hasPermission(req.user, 'admin.settings'))) {
        return reply.forbidden('Sem permissão pra renomear o workspace')
      }
      const ws = await prisma.workspace.update({
        where: { id: workspaceId },
        data: { name: req.body.name },
        select: { id: true, name: true },
      })
      return ws
    },
  )
}

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { eventBus } from '../../lib/eventBus.js'
import { hasPermission } from '../../lib/acl.js'

const recurrenceEnum = z.enum(['daily', 'weekly', 'monthly']).nullable().optional()

const taskSelect = {
  id: true,
  title: true,
  description: true,
  done: true,
  remindAt: true,
  recurrence: true,
  cardId: true,
  contactId: true,
  conversationId: true,
  messageId: true,
  assigneeId: true,
  createdAt: true,
  updatedAt: true,
  contact: { select: { id: true, name: true, phone: true, email: true } },
  conversation: { select: { id: true, isGroup: true, subject: true, externalId: true } },
  assignee: { select: { id: true, name: true, email: true, settings: true } },
} as const

export const tasksRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /tasks — filtros opcionais
  app.get(
    '/tasks',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          done: z
            .string()
            .optional()
            .transform((v) => (v === undefined ? undefined : v === 'true')),
          cardId: z.string().optional(),
          contactId: z.string().optional(),
          conversationId: z.string().optional(),
          assigneeId: z.string().optional(),  // "me" | <userId>
        }),
      },
    },
    async (req) => {
      const { workspaceId, sub: userId } = req.user
      const { done, cardId, contactId, conversationId, assigneeId } = req.query

      // Tarefas são pessoais por padrão. ADMIN/Supervisor (via `admin.users`)
      // pode ver tarefas de outros usando ?assigneeId=<id>. Sem essa permissão,
      // o filtro de assignee é forçado pra o próprio user.
      const canViewOthers = await hasPermission(req.user, 'admin.users')
      const effectiveAssigneeFilter = canViewOthers
        ? (assigneeId !== undefined
          ? { assigneeId: assigneeId === 'me' ? userId : assigneeId === 'all' ? undefined : assigneeId }
          : { assigneeId: userId })   // default sem filtro = só minhas
        : { assigneeId: userId }      // member: sempre só minhas, ignora query

      return prisma.task.findMany({
        where: {
          workspaceId,
          ...(done !== undefined && { done }),
          ...(cardId !== undefined && { cardId }),
          ...(contactId !== undefined && { contactId }),
          ...(conversationId !== undefined && { conversationId }),
          ...effectiveAssigneeFilter,
        },
        orderBy: [{ done: 'asc' }, { remindAt: 'asc' }, { createdAt: 'desc' }],
        select: taskSelect,
      })
    },
  )

  // POST /tasks
  app.post(
    '/tasks',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          title: z.string().min(1),
          description: z.string().optional(),
          cardId: z.string().optional(),
          contactId: z.string().optional(),
          conversationId: z.string().optional(),
          messageId: z.string().optional(),
          assigneeId: z.string().optional(),
          remindAt: z.string().datetime().optional(),
          recurrence: recurrenceEnum,
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const { title, description, cardId, contactId, conversationId, messageId, assigneeId, remindAt, recurrence } = req.body

      // Quem pode atribuir tarefa pra outro: tem `admin.users` (ADMIN/Supervisor).
      // Caso contrário: força assignee = self.
      const canAssignToOthers = await hasPermission(req.user, 'admin.users')
      const finalAssigneeId = canAssignToOthers
        ? (assigneeId ?? userId)   // se admin não escolheu, ele cria pra si
        : userId                    // member: sempre pra si

      if (!canAssignToOthers && assigneeId && assigneeId !== userId) {
        return reply.forbidden('Sem permissão pra criar tarefa pra outro usuário')
      }

      const task = await prisma.task.create({
        data: {
          workspaceId,
          title,
          ...(description && { description }),
          ...(cardId && { cardId }),
          ...(contactId && { contactId }),
          ...(conversationId && { conversationId }),
          ...(messageId && { messageId }),
          assigneeId: finalAssigneeId,
          ...(remindAt && { remindAt: new Date(remindAt) }),
          ...(recurrence && { recurrence }),
        },
        select: taskSelect,
      })

      await eventBus.audit(workspaceId, 'task.created', {
        actorUserId: req.user.sub,
        targetType: 'task', targetId: task.id,
        payload: { title: task.title, assigneeId: task.assigneeId },
      })

      return reply.code(201).send(task)
    },
  )

  // PATCH /tasks/:id
  app.patch(
    '/tasks/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          title: z.string().min(1).optional(),
          description: z.string().nullable().optional(),
          done: z.boolean().optional(),
          remindAt: z.string().datetime().nullable().optional(),
          recurrence: recurrenceEnum,
          cardId: z.string().nullable().optional(),
          contactId: z.string().nullable().optional(),
          conversationId: z.string().nullable().optional(),
          assigneeId: z.string().nullable().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const { title, description, done, remindAt, recurrence, cardId, contactId, conversationId, assigneeId } = req.body

      // Guard: só o assignee atual ou quem tem admin.users pode editar
      const task = await prisma.task.findFirst({
        where: { id: req.params.id, workspaceId },
        select: { assigneeId: true },
      })
      if (!task) return reply.notFound()
      const canManageAll = await hasPermission(req.user, 'admin.users')
      if (!canManageAll && task.assigneeId !== userId) {
        return reply.forbidden('Sem permissão pra editar tarefa de outro usuário')
      }

      await prisma.task.update({
        where: { id: req.params.id },
        data: {
          ...(title !== undefined && { title }),
          ...(description !== undefined && { description: description ?? null }),
          ...(done !== undefined && { done }),
          ...(remindAt !== undefined && { remindAt: remindAt ? new Date(remindAt) : null }),
          ...(recurrence !== undefined && { recurrence: recurrence ?? null }),
          ...(cardId !== undefined && { cardId: cardId ?? null }),
          ...(contactId !== undefined && { contactId: contactId ?? null }),
          ...(conversationId !== undefined && { conversationId: conversationId ?? null }),
          ...(assigneeId !== undefined && canManageAll && { assigneeId: assigneeId ?? null }),
        },
      })

      await eventBus.audit(workspaceId, 'task.updated', {
        actorUserId: req.user.sub,
        targetType: 'task', targetId: req.params.id,
        payload: { changes: Object.keys(req.body) },
      })
      return { ok: true }
    },
  )

  // DELETE /tasks/:id
  app.delete(
    '/tasks/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
      },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user

      const task = await prisma.task.findFirst({
        where: { id: req.params.id, workspaceId },
        select: { assigneeId: true },
      })
      if (!task) return reply.notFound()
      const canManageAll = await hasPermission(req.user, 'admin.users')
      if (!canManageAll && task.assigneeId !== userId) {
        return reply.forbidden('Sem permissão pra deletar tarefa de outro usuário')
      }

      const result = await prisma.task.deleteMany({
        where: { id: req.params.id, workspaceId },
      })

      if (!result.count) return reply.notFound()

      return reply.code(204).send()
    },
  )
}

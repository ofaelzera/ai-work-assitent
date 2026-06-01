/**
 * Rotas de configuração de horários e disponibilidade da agenda:
 *   • Horário de trabalho por usuário (UserWorkingHours)
 *   • Bloqueios pontuais/recorrentes (ScheduleBlock)
 *   • Horário de funcionamento da empresa (CompanyHours)
 *   • Feriados e datas especiais (Holiday)
 *   • Consulta de horários livres (findFreeSlots)
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { hasPermission, requirePerm } from '../../lib/acl.js'
import {
  findFreeSlots,
  findFreeIntervals,
  isWithinCompanyHours,
  isWithinWorkingHours,
  hasConflict,
} from './availability.service.js'

const hoursRowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startMin: z.number().int().min(0).max(1440),
  endMin: z.number().int().min(0).max(1440),
  isActive: z.boolean().optional(),
})

export const scheduleRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Horário de trabalho por usuário ──────────────────────────────────────
  app.get(
    '/calendar/working-hours/:userId',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ userId: z.string() }) },
    },
    async (req, reply) => {
      const { userId } = req.params
      if (userId !== req.user.sub) {
        const ok = await hasPermission(req.user, 'calendar.viewOthers')
        if (!ok) return reply.forbidden('Sem permissão para ver a agenda de terceiros')
      }
      return prisma.userWorkingHours.findMany({
        where: { workspaceId: req.user.workspaceId, userId },
        orderBy: [{ weekday: 'asc' }, { startMin: 'asc' }],
      })
    },
  )

  // PUT substitui todas as linhas do usuário (forma simples de editar a grade).
  app.put(
    '/calendar/working-hours/:userId',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ userId: z.string() }),
        body: z.object({ rows: z.array(hoursRowSchema) }),
      },
    },
    async (req, reply) => {
      const { userId } = req.params
      if (userId !== req.user.sub) {
        const ok = await hasPermission(req.user, 'calendar.manageWorkingHours')
        if (!ok) return reply.forbidden('Sem permissão para gerenciar horários de terceiros')
      }
      for (const r of req.body.rows) {
        if (r.endMin <= r.startMin) return reply.badRequest('endMin deve ser maior que startMin')
      }

      const workspaceId = req.user.workspaceId
      await prisma.$transaction([
        prisma.userWorkingHours.deleteMany({ where: { workspaceId, userId } }),
        prisma.userWorkingHours.createMany({
          data: req.body.rows.map((r) => ({
            workspaceId,
            userId,
            weekday: r.weekday,
            startMin: r.startMin,
            endMin: r.endMin,
            isActive: r.isActive ?? true,
          })),
        }),
      ])
      return prisma.userWorkingHours.findMany({
        where: { workspaceId, userId },
        orderBy: [{ weekday: 'asc' }, { startMin: 'asc' }],
      })
    },
  )

  // ─── Bloqueios ────────────────────────────────────────────────────────────
  app.get(
    '/calendar/blocks',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          userId: z.string().optional(),
          from: z.string().datetime().optional(),
          to: z.string().datetime().optional(),
        }),
      },
    },
    async (req, reply) => {
      const userId = req.query.userId ?? req.user.sub
      if (userId !== req.user.sub) {
        const ok = await hasPermission(req.user, 'calendar.viewOthers')
        if (!ok) return reply.forbidden('Sem permissão para ver bloqueios de terceiros')
      }
      return prisma.scheduleBlock.findMany({
        where: {
          workspaceId: req.user.workspaceId,
          OR: [{ userId }, { userId: null }],
          ...(req.query.from ? { endAt: { gt: new Date(req.query.from) } } : {}),
          ...(req.query.to ? { startAt: { lt: new Date(req.query.to) } } : {}),
        },
        orderBy: { startAt: 'asc' },
      })
    },
  )

  app.post(
    '/calendar/blocks',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          userId: z.string().nullable().optional(), // null = bloqueio global da empresa
          title: z.string().optional(),
          startAt: z.string().datetime(),
          endAt: z.string().datetime(),
          recurrence: z.enum(['WEEKLY']).nullable().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { userId, title, startAt, endAt, recurrence } = req.body
      if (new Date(endAt) <= new Date(startAt)) return reply.badRequest('endAt deve ser maior que startAt')

      // Bloqueio global ou de terceiro exige permissão.
      if (userId === null || userId === undefined) {
        const ok = await hasPermission(req.user, 'calendar.manageCompanyHours')
        if (!ok) return reply.forbidden('Sem permissão para criar bloqueio global')
      } else if (userId !== req.user.sub) {
        const ok = await hasPermission(req.user, 'calendar.manageWorkingHours')
        if (!ok) return reply.forbidden('Sem permissão para criar bloqueio de terceiros')
      }

      const block = await prisma.scheduleBlock.create({
        data: {
          workspaceId: req.user.workspaceId,
          userId: userId ?? null,
          title: title ?? null,
          startAt: new Date(startAt),
          endAt: new Date(endAt),
          recurrence: recurrence ?? null,
        },
      })
      return reply.code(201).send(block)
    },
  )

  app.delete(
    '/calendar/blocks/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const block = await prisma.scheduleBlock.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId },
      })
      if (!block) return reply.notFound('Bloqueio não encontrado')

      if (block.userId === null) {
        const ok = await hasPermission(req.user, 'calendar.manageCompanyHours')
        if (!ok) return reply.forbidden('Sem permissão')
      } else if (block.userId !== req.user.sub) {
        const ok = await hasPermission(req.user, 'calendar.manageWorkingHours')
        if (!ok) return reply.forbidden('Sem permissão')
      }
      await prisma.scheduleBlock.delete({ where: { id: block.id } })
      return reply.code(204).send()
    },
  )

  // ─── Horário de funcionamento da empresa ──────────────────────────────────
  app.get('/calendar/company-hours', { onRequest: [app.authenticate] }, async (req) => {
    return prisma.companyHours.findMany({
      where: { workspaceId: req.user.workspaceId },
      orderBy: [{ weekday: 'asc' }, { startMin: 'asc' }],
    })
  })

  app.put(
    '/calendar/company-hours',
    {
      onRequest: [app.authenticate, requirePerm('calendar.manageCompanyHours')],
      schema: { body: z.object({ rows: z.array(hoursRowSchema) }) },
    },
    async (req, reply) => {
      for (const r of req.body.rows) {
        if (r.endMin <= r.startMin) return reply.badRequest('endMin deve ser maior que startMin')
      }
      const workspaceId = req.user.workspaceId
      await prisma.$transaction([
        prisma.companyHours.deleteMany({ where: { workspaceId } }),
        prisma.companyHours.createMany({
          data: req.body.rows.map((r) => ({
            workspaceId,
            weekday: r.weekday,
            startMin: r.startMin,
            endMin: r.endMin,
            isActive: r.isActive ?? true,
          })),
        }),
      ])
      return prisma.companyHours.findMany({
        where: { workspaceId },
        orderBy: [{ weekday: 'asc' }, { startMin: 'asc' }],
      })
    },
  )

  // ─── Feriados ─────────────────────────────────────────────────────────────
  app.get('/calendar/holidays', { onRequest: [app.authenticate] }, async (req) => {
    return prisma.holiday.findMany({
      where: { workspaceId: req.user.workspaceId },
      orderBy: { date: 'asc' },
    })
  })

  app.post(
    '/calendar/holidays',
    {
      onRequest: [app.authenticate, requirePerm('calendar.manageCompanyHours')],
      schema: {
        body: z.object({
          date: z.string(), // YYYY-MM-DD
          name: z.string().min(1),
          closed: z.boolean().optional(),
          startMin: z.number().int().min(0).max(1440).nullable().optional(),
          endMin: z.number().int().min(0).max(1440).nullable().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { date, name, closed, startMin, endMin } = req.body
      const day = new Date(`${date}T00:00:00`)
      const holiday = await prisma.holiday.upsert({
        where: { workspaceId_date: { workspaceId: req.user.workspaceId, date: day } },
        create: {
          workspaceId: req.user.workspaceId,
          date: day,
          name,
          closed: closed ?? true,
          startMin: startMin ?? null,
          endMin: endMin ?? null,
        },
        update: { name, closed: closed ?? true, startMin: startMin ?? null, endMin: endMin ?? null },
      })
      return reply.code(201).send(holiday)
    },
  )

  // Sincroniza feriados nacionais via BrasilAPI (gratuita, sem chave).
  // https://brasilapi.com.br/api/feriados/v1/{ano}
  app.post(
    '/calendar/holidays/sync',
    {
      onRequest: [app.authenticate, requirePerm('calendar.manageCompanyHours')],
      schema: {
        body: z.object({
          // Anos a sincronizar. Default: ano atual + próximo.
          years: z.array(z.number().int().min(2000).max(2100)).optional(),
        }),
      },
    },
    async (req, reply) => {
      const currentYear = new Date().getFullYear()
      const years = req.body.years && req.body.years.length > 0
        ? req.body.years
        : [currentYear, currentYear + 1]

      let imported = 0
      for (const year of years) {
        let items: { date: string; name: string }[]
        try {
          const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`)
          if (!res.ok) {
            req.log.warn({ status: res.status, year }, 'BrasilAPI feriados falhou')
            continue
          }
          items = (await res.json()) as { date: string; name: string }[]
        } catch (err) {
          req.log.error({ err, year }, 'Erro ao buscar feriados na BrasilAPI')
          continue
        }

        for (const item of items) {
          if (!item.date || !item.name) continue
          const day = new Date(`${item.date}T00:00:00`)
          await prisma.holiday.upsert({
            where: { workspaceId_date: { workspaceId: req.user.workspaceId, date: day } },
            create: { workspaceId: req.user.workspaceId, date: day, name: item.name, closed: true },
            // Não sobrescreve customizações (closed/janela) de feriados já existentes.
            update: { name: item.name },
          })
          imported++
        }
      }

      return { imported, years }
    },
  )

  app.delete(
    '/calendar/holidays/:id',
    {
      onRequest: [app.authenticate, requirePerm('calendar.manageCompanyHours')],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const holiday = await prisma.holiday.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId },
      })
      if (!holiday) return reply.notFound('Feriado não encontrado')
      await prisma.holiday.delete({ where: { id: holiday.id } })
      return reply.code(204).send()
    },
  )

  // ─── Horários livres ──────────────────────────────────────────────────────
  app.get(
    '/calendar/free-slots',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          userId: z.string().optional(),
          from: z.string().datetime(),
          to: z.string().datetime(),
          durationMin: z.coerce.number().int().positive().default(30),
        }),
      },
    },
    async (req, reply) => {
      const userId = req.query.userId ?? req.user.sub
      if (userId !== req.user.sub) {
        const ok = await hasPermission(req.user, 'calendar.viewOthers')
        if (!ok) return reply.forbidden('Sem permissão para ver a agenda de terceiros')
      }
      const slots = await findFreeSlots(
        req.user.workspaceId,
        userId,
        { from: new Date(req.query.from), to: new Date(req.query.to) },
        req.query.durationMin,
      )
      return slots
    },
  )

  // ─── Intervalos livres contínuos (para popular selects de início/fim) ────────
  app.get(
    '/calendar/free-intervals',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          userId: z.string().optional(),
          from: z.string().datetime(),
          to: z.string().datetime(),
        }),
      },
    },
    async (req, reply) => {
      const userId = req.query.userId ?? req.user.sub
      if (userId !== req.user.sub) {
        const ok = await hasPermission(req.user, 'calendar.viewOthers')
        if (!ok) return reply.forbidden('Sem permissão para ver a agenda de terceiros')
      }
      return findFreeIntervals(req.user.workspaceId, userId, {
        from: new Date(req.query.from),
        to: new Date(req.query.to),
      })
    },
  )

  // ─── Checagem de disponibilidade (para validação no front antes de agendar) ──
  app.get(
    '/calendar/availability',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          userId: z.string().optional(),
          start: z.string().datetime(),
          end: z.string().datetime(),
          ignoreEventId: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const userId = req.query.userId ?? req.user.sub
      if (userId !== req.user.sub) {
        const ok = await hasPermission(req.user, 'calendar.viewOthers')
        if (!ok) return reply.forbidden('Sem permissão para ver a agenda de terceiros')
      }
      const start = new Date(req.query.start)
      const end = new Date(req.query.end)
      if (end <= start) return reply.badRequest('end deve ser maior que start')

      const ws = req.user.workspaceId
      const [companyOpen, userAvailable, conflict] = await Promise.all([
        isWithinCompanyHours(ws, start),
        isWithinWorkingHours(ws, userId, start),
        hasConflict(ws, userId, start, end, req.query.ignoreEventId),
      ])

      // Motivo legível pro front.
      let reason: string | null = null
      if (!companyOpen) reason = 'Fora do horário de funcionamento da empresa'
      else if (!userAvailable) reason = 'Fora do horário de trabalho do usuário'
      else if (conflict) reason = 'Conflito com outro compromisso'

      return { companyOpen, userAvailable, conflict, ok: companyOpen && userAvailable && !conflict, reason }
    },
  )
}

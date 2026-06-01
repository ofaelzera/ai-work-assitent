/**
 * Serviço central de disponibilidade da agenda.
 *
 * Reúne a lógica de horário de trabalho do usuário, horário de funcionamento da
 * empresa, feriados, bloqueios e detecção de conflito. É consumido pelas rotas
 * de calendário, pelos nós de fluxo e pelas tools de IA — nenhum desses deve
 * reimplementar essas regras.
 *
 * Convenção de tempo: weekday/startMin/endMin são em horário local do servidor
 * (wall-clock). `weekday` = 0 (domingo) .. 6 (sábado). `startMin`/`endMin` são
 * minutos desde 00:00 (ex: 480 = 08:00, 1080 = 18:00).
 */
import { prisma } from '../../lib/prisma.js'

export interface Slot {
  start: Date
  end: Date
}

interface Interval {
  startMin: number
  endMin: number
}

const DAY_MIN = 24 * 60

function weekdayOf(at: Date): number {
  return at.getDay()
}

function minuteOfDay(at: Date): number {
  return at.getHours() * 60 + at.getMinutes()
}

function startOfDay(at: Date): Date {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  return d
}

/** Constrói um Date no dia `day` (00:00 local) deslocado por `min` minutos. */
function atMinute(day: Date, min: number): Date {
  const d = startOfDay(day)
  d.setMinutes(min)
  return d
}

/** Subtrai uma lista de intervalos (busy) de uma lista base (free). Tudo em min-do-dia. */
function subtractIntervals(base: Interval[], busy: Interval[]): Interval[] {
  let result = [...base]
  for (const b of busy) {
    const next: Interval[] = []
    for (const f of result) {
      if (b.endMin <= f.startMin || b.startMin >= f.endMin) {
        next.push(f) // sem sobreposição
        continue
      }
      if (b.startMin > f.startMin) next.push({ startMin: f.startMin, endMin: b.startMin })
      if (b.endMin < f.endMin) next.push({ startMin: b.endMin, endMin: f.endMin })
    }
    result = next
  }
  return result.filter((i) => i.endMin > i.startMin)
}

/** Feriado da data, se houver. */
async function getHoliday(workspaceId: string, at: Date) {
  return prisma.holiday.findUnique({
    where: { workspaceId_date: { workspaceId, date: startOfDay(at) } },
  })
}

/**
 * Empresa está aberta no instante `at`?
 * Considera feriados (fechado, ou janela especial) e o CompanyHours do dia.
 */
export async function isWithinCompanyHours(workspaceId: string, at: Date): Promise<boolean> {
  const holiday = await getHoliday(workspaceId, at)
  if (holiday) {
    if (holiday.closed) return false
    if (holiday.startMin != null && holiday.endMin != null) {
      const m = minuteOfDay(at)
      return m >= holiday.startMin && m < holiday.endMin
    }
    return false
  }

  // Verifica se há QUALQUER configuração de horário da empresa. Sem nenhuma
  // configurada → sem restrição (sempre aberto). Configurada → respeita o dia.
  const anyConfigured = await prisma.companyHours.count({ where: { workspaceId, isActive: true } })
  if (anyConfigured === 0) return true

  const rows = await prisma.companyHours.findMany({
    where: { workspaceId, weekday: weekdayOf(at), isActive: true },
  })
  if (rows.length === 0) return false // tem expediente configurado, mas não nesse dia
  const m = minuteOfDay(at)
  return rows.some((r) => m >= r.startMin && m < r.endMin)
}

/**
 * Usuário está disponível no instante `at`?
 * Dentro do horário de trabalho dele E sem bloqueio ativo nesse momento.
 */
export async function isWithinWorkingHours(
  workspaceId: string,
  userId: string,
  at: Date,
): Promise<boolean> {
  // Sem nenhum horário de trabalho configurado para o usuário → sem restrição
  // de expediente (disponível), respeitando apenas bloqueios pontuais.
  const anyConfigured = await prisma.userWorkingHours.count({ where: { workspaceId, userId, isActive: true } })
  if (anyConfigured > 0) {
    const rows = await prisma.userWorkingHours.findMany({
      where: { workspaceId, userId, weekday: weekdayOf(at), isActive: true },
    })
    const m = minuteOfDay(at)
    const inHours = rows.some((r) => m >= r.startMin && m < r.endMin)
    if (!inHours) return false
  }

  const block = await prisma.scheduleBlock.findFirst({
    where: {
      workspaceId,
      OR: [{ userId }, { userId: null }],
      startAt: { lte: at },
      endAt: { gt: at },
    },
  })
  return !block
}

/**
 * Existe conflito para o usuário no intervalo [startAt, endAt)?
 * Checa eventos do owner e bloqueios (do usuário ou globais). `ignoreEventId`
 * permite revalidar ao remarcar o próprio evento.
 */
export async function hasConflict(
  workspaceId: string,
  userId: string,
  startAt: Date,
  endAt: Date,
  ignoreEventId?: string,
): Promise<boolean> {
  const event = await prisma.calendarEvent.findFirst({
    where: {
      workspaceId,
      ownerId: userId,
      ...(ignoreEventId ? { id: { not: ignoreEventId } } : {}),
      // Inclui eventos sem status (locais) — `not: 'cancelled'` sozinho descartaria NULL no SQL.
      OR: [{ status: null }, { status: { not: 'cancelled' } }],
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { id: true },
  })
  if (event) return true

  const block = await prisma.scheduleBlock.findFirst({
    where: {
      workspaceId,
      OR: [{ userId }, { userId: null }],
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { id: true },
  })
  return !!block
}

/**
 * Lista os horários livres do usuário num intervalo, fatiados pela duração.
 * Interseção: horário de trabalho ∩ horário da empresa − (eventos + bloqueios).
 */
export async function findFreeSlots(
  workspaceId: string,
  userId: string,
  range: { from: Date; to: Date },
  durationMin: number,
): Promise<Slot[]> {
  if (durationMin <= 0) return []
  const slots: Slot[] = []

  // Carrega tudo uma vez e filtra por dia em memória.
  const [workRows, companyRows, holidays, events, blocks] = await Promise.all([
    prisma.userWorkingHours.findMany({ where: { workspaceId, userId, isActive: true } }),
    prisma.companyHours.findMany({ where: { workspaceId, isActive: true } }),
    prisma.holiday.findMany({
      where: { workspaceId, date: { gte: startOfDay(range.from), lte: startOfDay(range.to) } },
    }),
    prisma.calendarEvent.findMany({
      where: {
        workspaceId,
        ownerId: userId,
        OR: [{ status: null }, { status: { not: 'cancelled' } }],
        startAt: { lt: range.to },
        endAt: { gt: range.from },
      },
      select: { startAt: true, endAt: true },
    }),
    prisma.scheduleBlock.findMany({
      where: {
        workspaceId,
        OR: [{ userId }, { userId: null }],
        startAt: { lt: range.to },
        endAt: { gt: range.from },
      },
      select: { startAt: true, endAt: true },
    }),
  ])

  const holidayByDay = new Map(holidays.map((h) => [startOfDay(h.date).getTime(), h]))

  for (let day = startOfDay(range.from); day <= range.to; day = new Date(day.getTime() + DAY_MIN * 60_000)) {
    const wd = day.getDay()
    const holiday = holidayByDay.get(day.getTime())

    // Janela da empresa nesse dia
    let companyIntervals: Interval[]
    if (holiday) {
      if (holiday.closed) continue
      companyIntervals =
        holiday.startMin != null && holiday.endMin != null
          ? [{ startMin: holiday.startMin, endMin: holiday.endMin }]
          : []
      if (companyIntervals.length === 0) continue
    } else {
      companyIntervals = companyRows
        .filter((r) => r.weekday === wd)
        .map((r) => ({ startMin: r.startMin, endMin: r.endMin }))
      if (companyIntervals.length === 0) continue
    }

    // Janela de trabalho do usuário nesse dia
    const workIntervals = workRows
      .filter((r) => r.weekday === wd)
      .map((r) => ({ startMin: r.startMin, endMin: r.endMin }))
    if (workIntervals.length === 0) continue

    // Interseção trabalho ∩ empresa
    let free: Interval[] = []
    for (const w of workIntervals) {
      for (const c of companyIntervals) {
        const s = Math.max(w.startMin, c.startMin)
        const e = Math.min(w.endMin, c.endMin)
        if (e > s) free.push({ startMin: s, endMin: e })
      }
    }
    if (free.length === 0) continue

    // Subtrai eventos e bloqueios (convertidos pra min-do-dia, clampados ao dia)
    const dayStartMs = day.getTime()
    const toIntervals = (items: { startAt: Date; endAt: Date }[]): Interval[] =>
      items
        .map((it) => ({
          startMin: Math.max(0, Math.round((it.startAt.getTime() - dayStartMs) / 60_000)),
          endMin: Math.min(DAY_MIN, Math.round((it.endAt.getTime() - dayStartMs) / 60_000)),
        }))
        .filter((i) => i.endMin > i.startMin && i.startMin < DAY_MIN && i.endMin > 0)
    const busy = [...toIntervals(events), ...toIntervals(blocks)]
    free = subtractIntervals(free, busy)

    // Fatia cada intervalo livre em blocos de durationMin
    for (const f of free) {
      for (let s = f.startMin; s + durationMin <= f.endMin; s += durationMin) {
        const start = atMinute(day, s)
        if (start < range.from || start >= range.to) continue
        slots.push({ start, end: atMinute(day, s + durationMin) })
      }
    }
  }

  return slots
}

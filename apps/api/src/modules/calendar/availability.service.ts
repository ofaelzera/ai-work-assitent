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

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function dateKey(at: Date): string {
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`
}

// ─── Feriados nacionais obrigatórios (automáticos) ──────────────────────────────
// Calculados em código — sem API externa, sem botão. NÃO inclui ponto facultativo
// (Carnaval, Corpus Christi, Dia do Servidor), apenas os feriados nacionais por lei.

/** Domingo de Páscoa (algoritmo de Computus / Gauss-Anônimo). */
function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31) // 3=março, 4=abril
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

const nationalHolidayCache = new Map<number, Map<string, string>>()

/** Mapa data->nome dos feriados nacionais obrigatórios do ano (cacheado). */
function nationalHolidaysOf(year: number): Map<string, string> {
  const cached = nationalHolidayCache.get(year)
  if (cached) return cached

  const map = new Map<string, string>()
  const add = (month: number, day: number, name: string) =>
    map.set(`${year}-${pad2(month)}-${pad2(day)}`, name)

  add(1, 1, 'Confraternização Universal')
  add(4, 21, 'Tiradentes')
  add(5, 1, 'Dia do Trabalho')
  add(9, 7, 'Independência do Brasil')
  add(10, 12, 'Nossa Senhora Aparecida')
  add(11, 2, 'Finados')
  add(11, 15, 'Proclamação da República')
  if (year >= 2024) add(11, 20, 'Consciência Negra') // nacional desde 2024
  add(12, 25, 'Natal')

  // Sexta-feira Santa (Paixão de Cristo) = Páscoa − 2 dias. Feriado nacional.
  const easter = easterSunday(year)
  const goodFriday = new Date(easter.getTime() - 2 * 86400000)
  map.set(dateKey(goodFriday), 'Sexta-feira Santa')

  nationalHolidayCache.set(year, map)
  return map
}

/** É feriado nacional obrigatório? */
export function isNationalHoliday(at: Date): boolean {
  return nationalHolidaysOf(at.getFullYear()).has(dateKey(at))
}

/** Lista os feriados nacionais obrigatórios de um ano (para exibição). */
export function listNationalHolidays(year: number): { date: string; name: string }[] {
  return Array.from(nationalHolidaysOf(year).entries())
    .map(([date, name]) => ({ date, name }))
    .sort((a, b) => a.date.localeCompare(b.date))
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

  // Feriado nacional obrigatório (automático) sem override na tabela → fechado.
  if (isNationalHoliday(at)) return false

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
  // Fallback POR DIA: se o usuário configurou horário para ESTE dia da semana,
  // respeita-o; se não configurou esse dia, herda o horário da empresa (sem
  // restrição própria — a janela da empresa é validada à parte). Assim, deixar
  // um dia "Fechado" no horário pessoal não bloqueia o dia: ele segue a empresa.
  const rowsForDay = await prisma.userWorkingHours.findMany({
    where: { workspaceId, userId, weekday: weekdayOf(at), isActive: true },
  })
  if (rowsForDay.length > 0) {
    const m = minuteOfDay(at)
    const inHours = rowsForDay.some((r) => m >= r.startMin && m < r.endMin)
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
/**
 * Lista os INTERVALOS livres contínuos do usuário num período (sem fatiar).
 * Aplica a hierarquia (horário do usuário ou, na ausência, da empresa),
 * limita ao funcionamento da empresa/feriados e subtrai eventos + bloqueios.
 */
export async function findFreeIntervals(
  workspaceId: string,
  userId: string,
  range: { from: Date; to: Date },
): Promise<Slot[]> {
  const result: Slot[] = []

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
  const hasCompanyHours = companyRows.length > 0

  for (let day = startOfDay(range.from); day <= range.to; day = new Date(day.getTime() + DAY_MIN * 60_000)) {
    const wd = day.getDay()
    const holiday = holidayByDay.get(day.getTime())

    // Janela de funcionamento da empresa nesse dia
    let companyIntervals: Interval[]
    if (holiday) {
      if (holiday.closed) continue // feriado fechado → dia indisponível
      companyIntervals =
        holiday.startMin != null && holiday.endMin != null
          ? [{ startMin: holiday.startMin, endMin: holiday.endMin }]
          : []
      if (companyIntervals.length === 0) continue
    } else if (isNationalHoliday(day)) {
      continue // feriado nacional obrigatório (automático) → fechado
    } else if (hasCompanyHours) {
      companyIntervals = companyRows
        .filter((r) => r.weekday === wd)
        .map((r) => ({ startMin: r.startMin, endMin: r.endMin }))
      if (companyIntervals.length === 0) continue // empresa fechada nesse dia
    } else {
      // Empresa sem horário configurado → sem restrição (dia todo)
      companyIntervals = [{ startMin: 0, endMin: DAY_MIN }]
    }

    // Janela de trabalho do usuário nesse dia — fallback POR DIA:
    // tem horário pessoal nesse weekday → usa; senão → herda o da empresa.
    const userForDay = workRows
      .filter((r) => r.weekday === wd)
      .map((r) => ({ startMin: r.startMin, endMin: r.endMin }))
    const workIntervals = userForDay.length > 0 ? userForDay : companyIntervals

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

    // Converte cada intervalo livre (min-do-dia) em Date, clampado ao range.
    for (const f of free) {
      let start = atMinute(day, f.startMin)
      let end = atMinute(day, f.endMin)
      if (start < range.from) start = range.from
      if (end > range.to) end = range.to
      if (end > start) result.push({ start, end })
    }
  }

  return result
}

/**
 * Lista os horários livres fatiados em blocos de `durationMin`.
 */
export async function findFreeSlots(
  workspaceId: string,
  userId: string,
  range: { from: Date; to: Date },
  durationMin: number,
): Promise<Slot[]> {
  if (durationMin <= 0) return []
  const intervals = await findFreeIntervals(workspaceId, userId, range)
  const slots: Slot[] = []
  const stepMs = durationMin * 60_000
  for (const itv of intervals) {
    for (let t = itv.start.getTime(); t + stepMs <= itv.end.getTime(); t += stepMs) {
      slots.push({ start: new Date(t), end: new Date(t + stepMs) })
    }
  }
  return slots
}

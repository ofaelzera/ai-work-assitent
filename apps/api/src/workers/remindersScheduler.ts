import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { dispatch, type NotificationEvent } from '../modules/notifications/notification.service.js'
import type { NotificationEventType } from '@aiwa/shared'

const SWEEP_INTERVAL_MS = 60_000 // 60s
const LOOKBACK_MS = 24 * 60 * 60 * 1000 // só dispara "atrasados" das últimas 24h (evita flood no 1º boot)
const MAX_LOOKAHEAD_MS = 24 * 60 * 60 * 1000 // janela máxima de antecedência considerada

// Antecedência padrão (min) quando não há regra configurada.
const DEFAULT_LEAD: Record<string, number> = {
  TASK_DUE_SOON: 60,
  CARD_DUE_SOON: 60,
  CALENDAR_EVENT_UPCOMING: 15,
  TASK_OVERDUE: 0,
  CARD_OVERDUE: 0,
  CALENDAR_EVENT_STARTED: 0,
}

interface RuleInfo {
  enabled: boolean
  leadTimeMinutes: number | null
}

async function loadRules(): Promise<Map<string, RuleInfo>> {
  const rules = await prisma.notificationTriggerRule.findMany({
    select: { workspaceId: true, eventType: true, enabled: true, leadTimeMinutes: true },
  })
  const map = new Map<string, RuleInfo>()
  for (const r of rules) {
    map.set(`${r.workspaceId}:${r.eventType}`, { enabled: r.enabled, leadTimeMinutes: r.leadTimeMinutes })
  }
  return map
}

function ruleFor(map: Map<string, RuleInfo>, workspaceId: string, eventType: string): RuleInfo {
  return map.get(`${workspaceId}:${eventType}`) ?? { enabled: true, leadTimeMinutes: null }
}

function leadMs(rule: RuleInfo, eventType: string): number {
  const min = rule.leadTimeMinutes ?? DEFAULT_LEAD[eventType] ?? 0
  return min * 60_000
}

/** Registra o disparo (idempotência) e chama o service. Retorna true se disparou. */
async function fireOnce(
  workspaceId: string,
  eventType: NotificationEventType,
  entityType: 'task' | 'card' | 'event',
  entityId: string,
  leadMinutes: number,
  event: NotificationEvent,
): Promise<boolean> {
  try {
    // O @@unique garante 1 disparo por (entidade, evento, leadTime). Create que
    // colide = já disparado → ignora.
    await prisma.reminderDispatchLog.create({
      data: { workspaceId, eventType, entityType, entityId, leadTimeMinutes: leadMinutes },
    })
  } catch {
    return false // já disparado
  }
  await dispatch(event)
  return true
}

async function sweepTasks(rules: Map<string, RuleInfo>, now: Date): Promise<number> {
  const from = new Date(now.getTime() - LOOKBACK_MS)
  const to = new Date(now.getTime() + MAX_LOOKAHEAD_MS)
  const tasks = await prisma.task.findMany({
    where: { done: false, remindAt: { gte: from, lte: to }, assigneeId: { not: null } },
    select: { id: true, workspaceId: true, title: true, remindAt: true, assigneeId: true },
  })

  let fired = 0
  for (const t of tasks) {
    if (!t.remindAt || !t.assigneeId) continue
    const remind = t.remindAt.getTime()
    const link = '/tasks'

    // OVERDUE: remindAt já passou
    if (remind <= now.getTime()) {
      const rule = ruleFor(rules, t.workspaceId, 'TASK_OVERDUE')
      if (rule.enabled) {
        const ok = await fireOnce(t.workspaceId, 'TASK_OVERDUE', 'task', t.id, 0, {
          workspaceId: t.workspaceId,
          eventType: 'TASK_OVERDUE',
          scope: 'user',
          recipientUserIds: [t.assigneeId],
          title: `Tarefa vencida: ${t.title}`,
          body: 'Esta tarefa passou do horário e ainda não foi concluída.',
          link,
          metadata: { taskId: t.id },
        })
        if (ok) fired++
      }
      continue
    }

    // DUE_SOON: dentro da antecedência configurada
    const rule = ruleFor(rules, t.workspaceId, 'TASK_DUE_SOON')
    if (!rule.enabled) continue
    const lead = leadMs(rule, 'TASK_DUE_SOON')
    if (lead > 0 && remind - now.getTime() <= lead) {
      const ok = await fireOnce(t.workspaceId, 'TASK_DUE_SOON', 'task', t.id, lead / 60_000, {
        workspaceId: t.workspaceId,
        eventType: 'TASK_DUE_SOON',
        scope: 'user',
        recipientUserIds: [t.assigneeId],
        title: `Tarefa a vencer: ${t.title}`,
        body: 'Lembrete: esta tarefa está se aproximando do horário.',
        link,
        metadata: { taskId: t.id },
      })
      if (ok) fired++
    }
  }
  return fired
}

async function sweepCards(rules: Map<string, RuleInfo>, now: Date): Promise<number> {
  const from = new Date(now.getTime() - LOOKBACK_MS)
  const to = new Date(now.getTime() + MAX_LOOKAHEAD_MS)
  const cards = await prisma.card.findMany({
    where: { deletedAt: null, dueDate: { gte: from, lte: to }, column: { isDone: false } },
    select: {
      id: true,
      workspaceId: true,
      title: true,
      dueDate: true,
      assigneeId: true,
      assignees: { select: { userId: true } },
    },
  })

  let fired = 0
  for (const c of cards) {
    if (!c.dueDate) continue
    const recipients = [...new Set([...c.assignees.map((a) => a.userId), ...(c.assigneeId ? [c.assigneeId] : [])])]
    if (recipients.length === 0) continue
    const due = c.dueDate.getTime()
    const link = '/kanban'

    if (due <= now.getTime()) {
      const rule = ruleFor(rules, c.workspaceId, 'CARD_OVERDUE')
      if (rule.enabled) {
        const ok = await fireOnce(c.workspaceId, 'CARD_OVERDUE', 'card', c.id, 0, {
          workspaceId: c.workspaceId,
          eventType: 'CARD_OVERDUE',
          scope: 'user',
          recipientUserIds: recipients,
          title: `Atividade atrasada: ${c.title}`,
          body: 'Esta atividade do Kanban passou do prazo.',
          link,
          metadata: { cardId: c.id },
        })
        if (ok) fired++
      }
      continue
    }

    const rule = ruleFor(rules, c.workspaceId, 'CARD_DUE_SOON')
    if (!rule.enabled) continue
    const lead = leadMs(rule, 'CARD_DUE_SOON')
    if (lead > 0 && due - now.getTime() <= lead) {
      const ok = await fireOnce(c.workspaceId, 'CARD_DUE_SOON', 'card', c.id, lead / 60_000, {
        workspaceId: c.workspaceId,
        eventType: 'CARD_DUE_SOON',
        scope: 'user',
        recipientUserIds: recipients,
        title: `Atividade próxima do vencimento: ${c.title}`,
        body: 'Lembrete: o prazo desta atividade está chegando.',
        link,
        metadata: { cardId: c.id },
      })
      if (ok) fired++
    }
  }
  return fired
}

async function sweepEvents(rules: Map<string, RuleInfo>, now: Date): Promise<number> {
  const from = new Date(now.getTime() - LOOKBACK_MS)
  const to = new Date(now.getTime() + MAX_LOOKAHEAD_MS)
  const events = await prisma.calendarEvent.findMany({
    where: { startAt: { gte: from, lte: to }, NOT: { status: 'cancelled' } },
    select: { id: true, workspaceId: true, title: true, startAt: true, ownerId: true },
  })

  let fired = 0
  for (const e of events) {
    const start = e.startAt.getTime()
    const link = '/calendar'

    if (start <= now.getTime()) {
      const rule = ruleFor(rules, e.workspaceId, 'CALENDAR_EVENT_STARTED')
      if (rule.enabled) {
        const ok = await fireOnce(e.workspaceId, 'CALENDAR_EVENT_STARTED', 'event', e.id, 0, {
          workspaceId: e.workspaceId,
          eventType: 'CALENDAR_EVENT_STARTED',
          scope: 'user',
          recipientUserIds: [e.ownerId],
          title: `Evento iniciado: ${e.title}`,
          body: 'Seu compromisso na agenda começou.',
          link,
          metadata: { eventId: e.id },
        })
        if (ok) fired++
      }
      continue
    }

    const rule = ruleFor(rules, e.workspaceId, 'CALENDAR_EVENT_UPCOMING')
    if (!rule.enabled) continue
    const lead = leadMs(rule, 'CALENDAR_EVENT_UPCOMING')
    if (lead > 0 && start - now.getTime() <= lead) {
      const ok = await fireOnce(e.workspaceId, 'CALENDAR_EVENT_UPCOMING', 'event', e.id, lead / 60_000, {
        workspaceId: e.workspaceId,
        eventType: 'CALENDAR_EVENT_UPCOMING',
        scope: 'user',
        recipientUserIds: [e.ownerId],
        title: `Evento próximo: ${e.title}`,
        body: 'Lembrete: você tem um compromisso chegando.',
        link,
        metadata: { eventId: e.id },
      })
      if (ok) fired++
    }
  }
  return fired
}

/**
 * Scheduler de lembretes temporais. Espelha o padrão do commScheduler: varredura
 * fixa por intervalo (robusta a quedas — atrasados disparam no próximo tick) +
 * idempotência via ReminderDispatchLog (não dispara em dobro).
 */
export function startRemindersScheduler() {
  async function tick() {
    try {
      const now = new Date()
      const rules = await loadRules()
      const [t, c, e] = await Promise.all([sweepTasks(rules, now), sweepCards(rules, now), sweepEvents(rules, now)])
      if (t + c + e > 0) {
        logger.info({ tasks: t, cards: c, events: e }, 'remindersScheduler: lembretes disparados')
      }
    } catch (err: any) {
      logger.error({ err: err?.message }, 'remindersScheduler tick falhou')
    }
  }

  void tick()
  const handle = setInterval(tick, SWEEP_INTERVAL_MS)
  logger.info('remindersScheduler iniciado (varredura a cada 60s)')
  return handle
}

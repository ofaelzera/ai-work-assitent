import { Worker, Queue } from 'bullmq'
import { redis } from '../lib/redis.js'
import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'
import { logger } from '../lib/logger.js'
import { runAgent } from '../modules/ai/agents/runAgent.js'

export const digestQueue = new Queue('dailyDigest', { connection: redis })

const DAILY_DIGEST_SYSTEM_PROMPT = `Você é um assistente pessoal. Faça um resumo diário conciso em português do dia de hoje.
Inclua: eventos do dia, tarefas pendentes prioritárias, e status do inbox.
Seja direto e útil. Use emojis moderadamente. Máximo 300 palavras.`

export function startDailyDigestWorker() {
  const worker = new Worker(
    'dailyDigest',
    async (job) => {
      logger.info({ jobId: job.id }, 'Daily digest: iniciando')

      // Busca todos os workspaces
      const workspaces = await prisma.workspace.findMany({
        select: { id: true, name: true },
      })

      for (const workspace of workspaces) {
        try {
          await runDigestForWorkspace(workspace.id, workspace.name)
        } catch (err) {
          logger.error({ err, workspaceId: workspace.id }, 'Daily digest: erro no workspace')
        }
      }

      logger.info({ jobId: job.id }, 'Daily digest: concluído')
    },
    {
      connection: redis,
      concurrency: 1,
    },
  )

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'dailyDigest worker falhou')
  })

  // Registra job repetível (10:00 UTC = 07:00 BRT)
  digestQueue
    .add(
      'digest',
      {},
      {
        repeat: { pattern: '0 10 * * *' },
        jobId: 'daily-digest-repeat',
      },
    )
    .catch((err) => logger.error({ err }, 'Falha ao registrar job repetível de daily digest'))

  logger.info('Daily digest worker iniciado (cron: 0 10 * * * UTC)')

  return worker
}

async function runDigestForWorkspace(workspaceId: string, workspaceName: string) {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  // 1. Eventos do dia
  const calendarEvents = await prisma.calendarEvent.findMany({
    where: {
      workspaceId,
      startAt: { gte: todayStart, lt: tomorrowStart },
    },
    orderBy: { startAt: 'asc' },
    select: { title: true, startAt: true, endAt: true },
  })

  // 2. Tarefas pendentes (top 10 por remindAt)
  const pendingTasks = await prisma.task.findMany({
    where: { workspaceId, done: false },
    orderBy: { remindAt: 'asc' },
    take: 10,
    select: { title: true, remindAt: true },
  })

  // 3. Conversas abertas/aguardando
  const openConversationsCount = await prisma.conversation.count({
    where: {
      workspaceId,
      status: { in: ['OPEN', 'WAITING'] },
    },
  })

  // 4. Execuções de IA nas últimas 24h
  const aiExecutionsCount = await prisma.aIExecutionLog.count({
    where: {
      workspaceId,
      createdAt: { gte: yesterday },
    },
  })

  // 5. Monta texto do contexto
  const todayStr = todayStart.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })

  const eventsText = calendarEvents.length === 0
    ? 'Nenhum evento agendado para hoje.'
    : calendarEvents.map(e => {
        const start = e.startAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        const end = e.endAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        return `- ${e.title} (${start}–${end})`
      }).join('\n')

  const tasksText = pendingTasks.length === 0
    ? 'Nenhuma tarefa pendente.'
    : pendingTasks.map(t => {
        const remind = t.remindAt
          ? ` [lembrete: ${t.remindAt.toLocaleDateString('pt-BR')}]`
          : ''
        return `- ${t.title}${remind}`
      }).join('\n')

  const contextInput = `Workspace: ${workspaceName}
Data de hoje: ${todayStr}

== Eventos do dia ==
${eventsText}

== Tarefas pendentes (top 10) ==
${tasksText}

== Status do Inbox ==
Conversas abertas ou aguardando: ${openConversationsCount}
Execuções de IA nas últimas 24h: ${aiExecutionsCount}`

  // 6. Busca agente "daily-digest" / "digest" / "resumo" no workspace.
  // Se NÃO houver agente ativo, pula totalmente — respeita o desligamento do usuário.
  const agent = await prisma.agent.findFirst({
    where: {
      workspaceId,
      isActive: true,
      OR: [
        { name: { contains: 'daily-digest' } },
        { name: { contains: 'digest' } },
        { name: { contains: 'Digest' } },
        { name: { contains: 'resumo' } },
        { name: { contains: 'Resumo' } },
      ],
    },
  })

  if (!agent) {
    logger.info({ workspaceId }, 'Daily digest pulado — nenhum agente de digest ativo')
    return
  }

  // 7. Chama IA
  const result = await runAgent({
    agentId: agent.id,
    workspaceId,
    model: agent.model,
    provider: agent.provider,
    messages: [{ role: 'user', content: contextInput }],
    responseFormat: 'text',
  })

  // 8. Emite evento via SSE
  await eventBus.emitAndPersist(workspaceId, 'daily.digest', {
    digest: result.text,
    date: todayStart.toISOString(),
    eventsCount: calendarEvents.length,
    pendingTasksCount: pendingTasks.length,
    openConversationsCount,
    aiExecutionsCount,
  })

  logger.info(
    { workspaceId, logId: result.logId, tokensIn: result.tokensIn, tokensOut: result.tokensOut },
    'Daily digest gerado',
  )
}

import { Worker, Queue } from 'bullmq'
import { redis } from '../lib/redis.js'
import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'
import { logger } from '../lib/logger.js'
import { runAgent } from '../modules/ai/agents/runAgent.js'

export const classifyQueue = new Queue('classifyMessage', { connection: redis })

interface TriageResult {
  isDemand: boolean
  intent: string
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  summary: string
  suggestedTitle: string
  checklist: string[]
  confidence: number
}

export function startClassifyWorker() {
  const worker = new Worker(
    'classifyMessage',
    async (job) => {
      const { messageId, conversationId, workspaceId } = job.data as {
        messageId: string
        conversationId: string
        workspaceId: string
      }

      // Carrega mensagem + contexto (últimas 10 msgs)
      const [message, context] = await Promise.all([
        prisma.message.findUnique({ where: { id: messageId } }),
        prisma.message.findMany({
          where: { conversationId },
          orderBy: { sentAt: 'desc' },
          take: 10,
          select: { body: true, direction: true, sentAt: true },
        }),
      ])

      if (!message?.body) return

      // ── Gate: verifica se triage é necessário ────────────────────────────────
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { status: true, triageCount: true },
      })

      const wasResolved = conversation?.status === 'RESOLVED'
      const neverTriaged = (conversation?.triageCount ?? 0) === 0

      if (!neverTriaged && !wasResolved) {
        // Conversa ativa e já foi triada — não gasta tokens
        logger.info({ messageId, conversationId }, 'Triage ignorado — conversa em andamento')
        return
      }
      // ─────────────────────────────────────────────────────────────────────────

      // Monta histórico para contexto (últimas 10 msgs)
      const historyText = context
        .reverse()
        .map(m => `[${m.direction === 'INBOUND' ? 'Cliente' : 'Agente'}]: ${m.body}`)
        .join('\n')

      // Busca agente triage ativo no workspace.
      // Se NÃO houver agente ativo de triagem, pula totalmente — respeita o desligamento do usuário.
      const agent = await prisma.agent.findFirst({
        where: {
          workspaceId,
          isActive: true,
          OR: [
            { name: { contains: 'triage' } },
            { name: { contains: 'Triage' } },
            { name: { contains: 'Triagem' } },
            { name: { contains: 'triagem' } },
          ],
        },
      })

      if (!agent) {
        logger.info({ messageId, workspaceId }, 'Triage pulado — nenhum agente de triagem ativo')
        return
      }

      const result = await runAgent({
        agentId: agent.id,
        workspaceId,
        model: agent.model,
        provider: agent.provider,
        messages: [{
          role: 'user',
          content: `Histórico da conversa:\n${historyText}\n\nÚltima mensagem do cliente:\n${message.body}`,
        }],
        responseFormat: 'json',
      })

      const triage = result.parsed as TriageResult | undefined
      if (!triage) {
        logger.warn({ messageId }, 'Triage: falha ao parsear resposta JSON')
        return
      }

      // Salva classificação na mensagem + incrementa triageCount + reabre se estava resolvida
      await Promise.all([
        prisma.message.update({
          where: { id: messageId },
          data: { aiClassification: triage as any },
        }),
        prisma.conversation.update({
          where: { id: conversationId },
          data: {
            triageCount: { increment: 1 },
            // Se estava resolvida e chegou nova mensagem, reabre
            ...(wasResolved && {
              status: 'OPEN',
              resolvedAt: null,
              reopenCount: { increment: 1 },
            }),
          },
        }),
      ])

      // Cria card automaticamente se for demanda com alta confiança
      if (triage.isDemand && triage.confidence >= 0.7) {
        await createCardFromTriage(workspaceId, conversationId, messageId, triage)
      }

      // Notifica frontend
      await eventBus.emitAndPersist(workspaceId, 'message.classified', {
        messageId,
        conversationId,
        classification: triage,
        reopened: wasResolved,
      })

      logger.info({ messageId, isDemand: triage.isDemand, confidence: triage.confidence, reopened: wasResolved }, 'Triage concluído')
    },
    {
      connection: redis,
      concurrency: 3,
    },
  )

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'classifyMessage worker falhou')
  })

  return worker
}

async function createCardFromTriage(
  workspaceId: string,
  conversationId: string,
  messageId: string,
  triage: TriageResult,
) {
  // Busca o primeiro board do workspace
  const board = await prisma.board.findFirst({
    where: { workspaceId },
    include: {
      columns: { orderBy: { position: 'asc' }, take: 1 },
    },
  })

  if (!board?.columns[0]) {
    logger.warn({ workspaceId }, 'Triage: nenhum board/coluna encontrado para criar card')
    return
  }

  // Prefere coluna chamada "Entrada", senão usa a primeira
  const entryColumn = await prisma.column.findFirst({
    where: { boardId: board.id, name: { in: ['Entrada', 'Backlog', 'Todo', 'A fazer'] } },
  }) ?? board.columns[0]

  const lastCard = await prisma.card.findFirst({
    where: { columnId: entryColumn.id, deletedAt: null },
    orderBy: { position: 'desc' },
    select: { position: true },
  })

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { contactId: true },
  })

  const card = await prisma.card.create({
    data: {
      workspaceId,
      columnId: entryColumn.id,
      title: triage.suggestedTitle || triage.summary,
      description: triage.summary,
      priority: triage.priority,
      checklist: triage.checklist.length > 0
        ? triage.checklist.map((item, i) => ({ id: i, text: item, done: false })) as any
        : undefined,
      contactId: conversation?.contactId ?? null,
      conversationId,
      createdBy: 'AI',
      position: (lastCard?.position ?? 0) + 1000,
    },
  })

  await prisma.cardHistory.create({
    data: {
      cardId: card.id,
      action: 'created',
      payload: { origin: 'AI', messageId, triage } as any,
    },
  })

  const { eventBus: eb } = await import('../lib/eventBus.js')
  await eb.emitAndPersist(workspaceId, 'card.created', {
    cardId: card.id,
    conversationId,
    origin: 'AI',
  })

  logger.info({ cardId: card.id, title: card.title }, 'Card criado via triage IA')
}

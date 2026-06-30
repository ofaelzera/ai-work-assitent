import { Queue } from 'bullmq'
import type { CommChannel, CommStatus } from '@prisma/client'
import { redis } from '../../lib/redis.js'
import { prisma } from '../../lib/prisma.js'
import { storeAttachments, type AttachmentInput } from './comm-attachments.service.js'

/**
 * Fila de despacho de mensagens individuais. Cada job carrega o id de um
 * `CommMessage`; o worker (commDispatch.worker) resolve canal e envia.
 */
export const commDispatchQueue = new Queue('commDispatch', { connection: redis })

const DEFAULT_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
}

export interface EnqueueInput {
  workspaceId: string
  channelType: CommChannel
  channelId?: string | null
  to: string
  subject?: string | null
  body: string
  scheduledAt?: Date | null
  priority?: number
  attachments?: AttachmentInput[]
  contactId?: string | null
  campaignId?: string | null
  source?: string // 'api' | 'campaign' | 'billing' | ...
}

export interface EnqueueResult {
  messageId: string
  status: CommStatus
}

/** Adiciona um job de despacho IMEDIATO à fila, respeitando prioridade. */
async function queueDispatch(messageId: string, priority: number): Promise<void> {
  await commDispatchQueue.add(
    'dispatch',
    { messageId },
    { ...DEFAULT_JOB_OPTS, priority: priority > 0 ? Math.max(1, 100 - priority) : undefined },
  )
}

/**
 * Ponto único de envio do sistema (Central de Comunicação).
 * Todos os módulos internos e a API externa chamam esta função — nenhum fala
 * direto com Evolution/SMTP. Normaliza anexos, cria o `CommMessage` e enfileira.
 */
export async function enqueueMessage(input: EnqueueInput): Promise<EnqueueResult> {
  const now = Date.now()
  const scheduledAt = input.scheduledAt ?? null
  const isScheduled = !!scheduledAt && scheduledAt.getTime() > now + 1000
  const status: CommStatus = isScheduled ? 'SCHEDULED' : 'PENDING'

  const message = await prisma.commMessage.create({
    data: {
      workspaceId: input.workspaceId,
      campaignId: input.campaignId ?? null,
      contactId: input.contactId ?? null,
      channelType: input.channelType,
      channelId: input.channelId ?? null,
      to: input.to,
      subject: input.subject ?? null,
      body: input.body,
      status,
      priority: input.priority ?? 0,
      scheduledAt,
      source: input.source ?? 'api',
    },
  })

  // Normaliza anexos (URL/Base64/buffer) → storage → CommAttachment
  if (input.attachments && input.attachments.length > 0) {
    await storeAttachments(input.workspaceId, input.attachments, { commMessageId: message.id })
  }

  await prisma.commMessageLog.create({
    data: {
      commMessageId: message.id,
      type: 'CREATED',
      detail: { channelType: input.channelType, to: input.to, scheduled: isScheduled, source: input.source ?? 'api' },
    },
  })

  // Agendadas ficam SCHEDULED e são promovidas pela varredura (sweepScheduledMessages).
  // Imediatas vão direto pra fila.
  if (!isScheduled) {
    await queueDispatch(message.id, input.priority ?? 0)
  }

  return { messageId: message.id, status }
}

/**
 * Rede de segurança: re-enfileira mensagens "presas" em PENDING há muito tempo
 * (job perdido no Redis, criadas em versão antiga, restart no meio, etc.). O
 * claim atômico no worker garante que não há envio em dobro caso ainda exista um
 * job vivo. O update re-carimba `updatedAt` pra não re-pegar a cada varredura.
 */
export async function requeueStuckPending(olderThanMs = 5 * 60 * 1000, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanMs)
  const stuck = await prisma.commMessage.findMany({
    where: { status: 'PENDING', updatedAt: { lt: cutoff } },
    select: { id: true, priority: true },
  })
  for (const m of stuck) {
    const res = await prisma.commMessage.updateMany({ where: { id: m.id, status: 'PENDING' }, data: { status: 'PENDING' } })
    if (res.count > 0) await queueDispatch(m.id, m.priority)
  }
  return stuck.length
}

/**
 * Varredura de mensagens agendadas: promove as SCHEDULED cujo horário já chegou
 * para PENDING e as enfileira. Roda em intervalo fixo no scheduler — robusto a
 * reagendamentos e quedas do servidor.
 */
export async function sweepScheduledMessages(now: Date = new Date()): Promise<number> {
  const due = await prisma.commMessage.findMany({
    where: { status: 'SCHEDULED', scheduledAt: { lte: now } },
    select: { id: true, priority: true },
  })
  for (const m of due) {
    const res = await prisma.commMessage.updateMany({
      where: { id: m.id, status: 'SCHEDULED' },
      data: { status: 'PENDING' },
    })
    if (res.count > 0) await queueDispatch(m.id, m.priority)
  }
  return due.length
}

/** Re-enfileira uma mensagem que falhou ou foi cancelada (botão "tentar de novo"). */
export async function retryMessage(workspaceId: string, messageId: string): Promise<void> {
  const msg = await prisma.commMessage.findFirst({
    where: { id: messageId, workspaceId },
    select: { id: true, status: true },
  })
  if (!msg) throw new Error('Mensagem não encontrada')

  await prisma.commMessage.update({
    where: { id: msg.id },
    data: { status: 'PENDING', lastError: null },
  })
  await prisma.commMessageLog.create({
    data: { commMessageId: msg.id, type: 'RETRY', detail: { manual: true } },
  })
  await queueDispatch(msg.id, 0)
}

/** Marca uma mensagem como cancelada (o worker pula CANCELED). */
export async function cancelMessage(workspaceId: string, messageId: string): Promise<void> {
  const msg = await prisma.commMessage.findFirst({
    where: { id: messageId, workspaceId },
    select: { id: true, status: true },
  })
  if (!msg) throw new Error('Mensagem não encontrada')
  if (msg.status === 'SENT') throw new Error('Mensagem já enviada não pode ser cancelada')

  await prisma.commMessage.update({
    where: { id: msg.id },
    data: { status: 'CANCELED' },
  })
  await prisma.commMessageLog.create({
    data: { commMessageId: msg.id, type: 'CANCELED', detail: { manual: true } },
  })
}

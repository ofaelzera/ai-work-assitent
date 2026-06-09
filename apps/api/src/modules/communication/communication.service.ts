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

/** Adiciona um job de despacho à fila, respeitando agendamento e prioridade. */
async function queueDispatch(messageId: string, scheduledAt: Date | null, priority: number): Promise<void> {
  const delay = scheduledAt ? Math.max(0, scheduledAt.getTime() - Date.now()) : 0
  await commDispatchQueue.add(
    'dispatch',
    { messageId },
    { ...DEFAULT_JOB_OPTS, delay, priority: priority > 0 ? Math.max(1, 100 - priority) : undefined },
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

  await queueDispatch(message.id, isScheduled ? scheduledAt : null, input.priority ?? 0)

  return { messageId: message.id, status }
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
  await queueDispatch(msg.id, null, 0)
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

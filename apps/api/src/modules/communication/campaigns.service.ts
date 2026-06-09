import { Queue } from 'bullmq'
import type { CommChannel } from '@prisma/client'
import { redis } from '../../lib/redis.js'
import { prisma } from '../../lib/prisma.js'

/** Fila de disparo de campanhas. Cada job carrega o id de uma `Campaign`. */
export const campaignDispatchQueue = new Queue('campaignDispatch', { connection: redis })

const CAMPAIGN_JOB_OPTS = {
  attempts: 1, // a campanha não re-tenta em bloco; cada CommMessage tem seu próprio retry
  removeOnComplete: 500,
  removeOnFail: 1000,
}

export interface CampaignInput {
  name: string
  description?: string | null
  channelType: CommChannel
  channelId?: string | null
  subject?: string | null
  body: string
  listId?: string | null
  scheduledAt?: Date | null
}

/** Enfileira o disparo de uma campanha (imediato ou agendado). */
export async function dispatchCampaign(campaignId: string, scheduledAt: Date | null): Promise<void> {
  const delay = scheduledAt ? Math.max(0, scheduledAt.getTime() - Date.now()) : 0
  await campaignDispatchQueue.add('dispatch', { campaignId }, { ...CAMPAIGN_JOB_OPTS, delay })
}

/** Métricas agregadas de uma campanha a partir das CommMessage materializadas. */
export async function campaignMetrics(workspaceId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    select: { id: true, status: true, startedAt: true, completedAt: true, scheduledAt: true },
  })
  if (!campaign) return null

  const grouped = await prisma.commMessage.groupBy({
    by: ['status'],
    where: { campaignId, workspaceId },
    _count: { _all: true },
  })
  const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]))
  const total = grouped.reduce((acc, g) => acc + g._count._all, 0)
  const sent = counts['SENT'] ?? 0
  const failed = counts['FAILED'] ?? 0
  const pending = (counts['PENDING'] ?? 0) + (counts['SCHEDULED'] ?? 0) + (counts['PROCESSING'] ?? 0)
  const finished = sent + failed
  const successRate = finished > 0 ? Math.round((sent / finished) * 100) : 0

  return {
    campaignId,
    status: campaign.status,
    recipients: total,
    sent,
    pending,
    failed,
    successRate,
    startedAt: campaign.startedAt,
    completedAt: campaign.completedAt,
    scheduledAt: campaign.scheduledAt,
  }
}

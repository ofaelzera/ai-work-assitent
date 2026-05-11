import { prisma } from '../../lib/prisma.js'
import { encryptJson, decryptJson } from '../../lib/crypto.js'
import { evolutionClient } from './evolution.client.js'
import { env } from '../../config/env.js'

export async function listChannels(workspaceId: string) {
  return prisma.channel.findMany({
    where: { workspaceId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, type: true, label: true, status: true, createdAt: true },
  })
}

export async function createWhatsAppChannel(workspaceId: string, label: string) {
  const instanceName = `aiwa-${workspaceId.slice(0, 8)}-${Date.now()}`
  const webhookUrl = env.EVOLUTION_WEBHOOK_URL ?? `${env.EVOLUTION_SERVER_URL}/webhooks/whatsapp`

  const instance = await evolutionClient.createInstance(instanceName, webhookUrl)
  const { ciphertext, iv, authTag } = encryptJson({ instanceName, ...instance })

  return prisma.channel.create({
    data: {
      workspaceId,
      type: 'WHATSAPP',
      label,
      status: 'DISCONNECTED',
      config: { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), authTag: authTag.toString('base64') },
    },
  })
}

export async function getChannelQr(channelId: string) {
  const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } })
  const cfg = channel.config as { ciphertext: string; iv: string; authTag: string }
  const decrypted = decryptJson<{ instanceName: string }>(
    Buffer.from(cfg.ciphertext, 'base64'),
    Buffer.from(cfg.iv, 'base64'),
    Buffer.from(cfg.authTag, 'base64'),
  )
  return evolutionClient.connectInstance(decrypted.instanceName)
}

export async function syncChannelStatus(channelId: string) {
  const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } })
  const cfg = channel.config as { ciphertext: string; iv: string; authTag: string }
  const decrypted = decryptJson<{ instanceName: string }>(
    Buffer.from(cfg.ciphertext, 'base64'),
    Buffer.from(cfg.iv, 'base64'),
    Buffer.from(cfg.authTag, 'base64'),
  )

  try {
    const instances = await evolutionClient.getInstance(decrypted.instanceName) as unknown as EvolutionInstanceResponse
    const inst = Array.isArray(instances) ? instances[0] : instances
    const connected = inst?.instance?.status === 'open'
    const status = connected ? 'CONNECTED' : 'DISCONNECTED'
    await prisma.channel.update({ where: { id: channelId }, data: { status } })
    return { status, instanceName: decrypted.instanceName }
  } catch {
    await prisma.channel.update({ where: { id: channelId }, data: { status: 'ERROR' } })
    return { status: 'ERROR', instanceName: decrypted.instanceName }
  }
}

interface EvolutionInstanceResponse {
  instance?: { status?: string }
}

export async function deleteChannel(channelId: string) {
  const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } })
  const cfg = channel.config as { ciphertext: string; iv: string; authTag: string }
  const decrypted = decryptJson<{ instanceName: string }>(
    Buffer.from(cfg.ciphertext, 'base64'),
    Buffer.from(cfg.iv, 'base64'),
    Buffer.from(cfg.authTag, 'base64'),
  )
  await evolutionClient.deleteInstance(decrypted.instanceName).catch(() => {})
  await prisma.channel.update({ where: { id: channelId }, data: { deletedAt: new Date() } })
}

export async function getChannelConfig(channelId: string): Promise<{ instanceName: string }> {
  const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } })
  const cfg = channel.config as { ciphertext: string; iv: string; authTag: string }
  return decryptJson<{ instanceName: string }>(
    Buffer.from(cfg.ciphertext, 'base64'),
    Buffer.from(cfg.iv, 'base64'),
    Buffer.from(cfg.authTag, 'base64'),
  )
}

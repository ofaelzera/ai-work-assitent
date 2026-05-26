import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { encryptJson, decryptJson } from '../../lib/crypto.js'
import { makeEvolutionClient } from './evolution.client.js'
import { testSmtpConnection, type SmtpConfig } from './email.client.js'
import { env } from '../../config/env.js'
import { selectBestServer, getClientForChannel, getServerCredentials } from '../evolution-servers/evolution-servers.service.js'
import { MetaCredentials, makeMetaClient } from './meta.client.js'

export async function listChannels(workspaceId: string) {
  return prisma.channel.findMany({
    where: { workspaceId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, type: true, label: true, status: true, settings: true, createdAt: true },
  })
}

export async function createWhatsAppChannel(workspaceId: string, label: string, evolutionServerId?: string) {
  const instanceName = `aiwa-${workspaceId.slice(0, 8)}-${Date.now()}`

  const server = evolutionServerId
    ? await getServerCredentials(evolutionServerId)
    : await selectBestServer()

  const serverId = server.id

  const webhookUrl = env.EVOLUTION_WEBHOOK_URL ?? `${server.url}/webhooks/whatsapp`
  const client = makeEvolutionClient(server.url, server.apiKey)

  const instance = await client.createInstance(instanceName, webhookUrl)
  const { ciphertext, iv, authTag } = encryptJson({ instanceName, ...instance })

  const channel = await prisma.channel.create({
    data: {
      workspaceId,
      evolutionServerId: serverId,
      type: 'WHATSAPP',
      label,
      status: 'DISCONNECTED',
      config: { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), authTag: authTag.toString('base64') },
    },
  })

  // Incrementa contador no servidor
  if (serverId) {
    await prisma.evolutionServer.update({
      where: { id: serverId },
      data: { instanceCount: { increment: 1 } },
    }).catch(() => {})
  }

  return channel
}

/**
 * Adota uma instância Evolution já existente, criando um Channel vinculado a ela.
 * Valida que a instância existe no servidor informado e ainda não está adotada
 * por outro canal. Atualiza o webhook da instância para apontar ao nosso backend.
 */
export async function adoptExistingInstance(
  workspaceId: string,
  data: { label: string; evolutionServerId: string; instanceName: string },
) {
  const server = await getServerCredentials(data.evolutionServerId)
  const client = makeEvolutionClient(server.url, server.apiKey)

  // Busca a instância no Evolution
  const raw = await client.fetchInstances() as unknown as any[]
  const all = Array.isArray(raw) ? raw : []
  const inst = all.find((i) => {
    const name = i?.name ?? i?.instance?.instanceName
    return name === data.instanceName
  })

  if (!inst) {
    throw new Error(`Instância "${data.instanceName}" não encontrada no servidor`)
  }

  // Garante que não está adotada por outro canal (verifica todos os canais WhatsApp ativos)
  const existing = await prisma.channel.findMany({
    where: { type: 'WHATSAPP', deletedAt: null },
    select: { id: true, config: true, label: true },
  })
  for (const ch of existing) {
    try {
      const cfg = ch.config as { ciphertext: string; iv: string; authTag: string }
      const { instanceName } = decryptJson<{ instanceName: string }>(
        Buffer.from(cfg.ciphertext, 'base64'),
        Buffer.from(cfg.iv, 'base64'),
        Buffer.from(cfg.authTag, 'base64'),
      )
      if (instanceName === data.instanceName) {
        throw new Error(`Instância já adotada pelo canal "${ch.label}"`)
      }
    } catch (err: any) {
      if (err?.message?.startsWith('Instância já adotada')) throw err
      // outros erros de decrypt — ignora
    }
  }

  const connectionStatus =
    (inst as any)?.connectionStatus ?? (inst as any)?.instance?.status
  const status = connectionStatus === 'open' ? 'CONNECTED' : 'DISCONNECTED'

  const { ciphertext, iv, authTag } = encryptJson({
    instanceName: data.instanceName,
    adopted: true, // marca como adotada — não deletar do Evolution ao remover o canal
    ...inst,
  })

  // Extrai profileName e ownerJid pra settings (usado pra resolver self-mentions)
  const ownerProfileName: string | undefined =
    (inst as any)?.profileName ?? (inst as any)?.instance?.profileName
  const ownerJidRaw: string | undefined =
    (inst as any)?.ownerJid ?? (inst as any)?.instance?.owner
  const ownerPhone = ownerJidRaw?.match(/^(\d+)@s\.whatsapp\.net/)?.[1]
  const initialSettings = {
    ...(ownerProfileName ? { ownerProfileName } : {}),
    ...(ownerPhone ? { ownerPhone } : {}),
  }

  const channel = await prisma.channel.create({
    data: {
      workspaceId,
      evolutionServerId: data.evolutionServerId,
      type: 'WHATSAPP',
      label: data.label,
      status,
      config: {
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
      },
      ...(Object.keys(initialSettings).length > 0 && { settings: initialSettings }),
    },
  })

  // Aponta o webhook/websocket da instância para o nosso backend
  const webhookUrl = env.EVOLUTION_WEBHOOK_URL ?? `${server.url}/webhooks/whatsapp`
  await client.updateInstanceWebhook(data.instanceName, webhookUrl).catch(() => {})
  await client.updateInstanceWebsocket(data.instanceName).catch(() => {})

  await prisma.evolutionServer.update({
    where: { id: data.evolutionServerId },
    data: { instanceCount: { increment: 1 } },
  }).catch(() => {})

  return channel
}

export async function getChannelQr(channelId: string) {
  const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } })
  const cfg = channel.config as { ciphertext: string; iv: string; authTag: string }
  const decrypted = decryptJson<{ instanceName: string }>(
    Buffer.from(cfg.ciphertext, 'base64'),
    Buffer.from(cfg.iv, 'base64'),
    Buffer.from(cfg.authTag, 'base64'),
  )
  const client = await getClientForChannel(channelId)
  return client.connectInstance(decrypted.instanceName)
}

export async function syncChannelStatus(channelId: string) {
  const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } })
  const cfg = channel.config as { ciphertext: string; iv: string; authTag: string }
  const decrypted = decryptJson<any>(
    Buffer.from(cfg.ciphertext, 'base64'),
    Buffer.from(cfg.iv, 'base64'),
    Buffer.from(cfg.authTag, 'base64'),
  )

  // Canal de email — testa SMTP
  if (channel.type === 'IMAP_SMTP') {
    const result = await testSmtpConnection(decrypted)
    const status = result.ok ? 'CONNECTED' : 'ERROR'
    await prisma.channel.update({ where: { id: channelId }, data: { status } })
    return { status, error: result.error }
  }

  // Canal Meta — considera sempre conectado (webhook driven)
  if (channel.type.startsWith('META_')) {
    return { status: 'CONNECTED', type: channel.type }
  }

  // Canal WhatsApp — consulta Evolution API
  try {
    const client = await getClientForChannel(channelId)
    const instances = await client.getInstance(decrypted.instanceName) as unknown as EvolutionInstanceV2[]
    const inst = Array.isArray(instances) ? instances[0] : instances
    const connectionStatus = (inst as any)?.connectionStatus ?? (inst as any)?.instance?.status
    const connected = connectionStatus === 'open'
    const status = connected ? 'CONNECTED' : 'DISCONNECTED'

    // Captura profileName e ownerPhone no settings (pra resolver self-mentions)
    const ownerProfileName: string | undefined =
      (inst as any)?.profileName ?? (inst as any)?.instance?.profileName
    const ownerJidRaw: string | undefined =
      (inst as any)?.ownerJid ?? (inst as any)?.instance?.owner
    const ownerPhone = ownerJidRaw?.match(/^(\d+)@s\.whatsapp\.net/)?.[1]

    const current = (channel.settings as Record<string, unknown> | null) ?? {}
    const newSettings = { ...current } as Record<string, unknown>
    let settingsChanged = false
    if (ownerProfileName && current.ownerProfileName !== ownerProfileName) {
      newSettings.ownerProfileName = ownerProfileName
      settingsChanged = true
    }
    if (ownerPhone && current.ownerPhone !== ownerPhone) {
      newSettings.ownerPhone = ownerPhone
      settingsChanged = true
    }

    await prisma.channel.update({
      where: { id: channelId },
      data: {
        status,
        ...(settingsChanged && { settings: newSettings as Prisma.InputJsonValue }),
      },
    })
    return { status, instanceName: decrypted.instanceName, connectionStatus }
  } catch {
    await prisma.channel.update({ where: { id: channelId }, data: { status: 'ERROR' } })
    return { status: 'ERROR', instanceName: decrypted.instanceName }
  }
}

interface EvolutionInstanceV2 {
  id?: string
  name?: string
  connectionStatus?: string
  ownerJid?: string
  profileName?: string
}

export async function deleteChannel(channelId: string) {
  const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } })

  // Apenas canais WhatsApp têm instância Evolution para deletar
  if (channel.type === 'WHATSAPP') {
    try {
      const cfg = channel.config as { ciphertext: string; iv: string; authTag: string }
      const { instanceName, adopted } = decryptJson<{ instanceName?: string; adopted?: boolean }>(
        Buffer.from(cfg.ciphertext, 'base64'),
        Buffer.from(cfg.iv, 'base64'),
        Buffer.from(cfg.authTag, 'base64'),
      )
      // Instâncias adotadas (criadas fora do nosso sistema) não são deletadas no Evolution
      if (instanceName && !adopted) {
        const client = await getClientForChannel(channelId)
        await client.deleteInstance(instanceName).catch(() => {})
      }
    } catch {
      // Config malformado — segue para soft delete mesmo assim
    }

    // Decrementa contador no servidor
    if (channel.evolutionServerId) {
      await prisma.evolutionServer.update({
        where: { id: channel.evolutionServerId },
        data: { instanceCount: { decrement: 1 } },
      }).catch(() => {})
    }
  }

  await prisma.channel.update({ where: { id: channelId }, data: { deletedAt: new Date() } })
}

export async function createSmtpChannel(workspaceId: string, label: string, cfg: {
  smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string
  imapHost?: string; imapPort?: number; fromName?: string; fromEmail: string; secure?: boolean
}) {
  const { ciphertext, iv, authTag } = encryptJson(cfg)
  return prisma.channel.create({
    data: {
      workspaceId,
      type: 'IMAP_SMTP',
      label,
      status: 'CONNECTED',
      config: { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), authTag: authTag.toString('base64') },
    },
  })
}

export async function createMetaChannel(workspaceId: string, label: string, type: 'META_WHATSAPP' | 'META_INSTAGRAM' | 'META_MESSENGER', credentials: MetaCredentials) {
  const { ciphertext, iv, authTag } = encryptJson(credentials)
  return prisma.channel.create({
    data: {
      workspaceId,
      type,
      label,
      status: 'CONNECTED', // Meta não tem websocket constante, o token define se tá on
      config: { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), authTag: authTag.toString('base64') },
    },
  })
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

export async function getSmtpConfig(channelId: string): Promise<SmtpConfig> {
  const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } })
  const cfg = channel.config as { ciphertext: string; iv: string; authTag: string }
  return decryptJson<SmtpConfig>(
    Buffer.from(cfg.ciphertext, 'base64'),
    Buffer.from(cfg.iv, 'base64'),
    Buffer.from(cfg.authTag, 'base64'),
  )
}

export async function getMetaConfig(channelId: string): Promise<MetaCredentials> {
  const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } })
  const cfg = channel.config as { ciphertext: string; iv: string; authTag: string }
  return decryptJson<MetaCredentials>(
    Buffer.from(cfg.ciphertext, 'base64'),
    Buffer.from(cfg.iv, 'base64'),
    Buffer.from(cfg.authTag, 'base64'),
  )
}

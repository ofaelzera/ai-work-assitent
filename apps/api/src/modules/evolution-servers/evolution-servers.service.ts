import { prisma } from '../../lib/prisma.js'
import { encrypt, decrypt } from '../../lib/crypto.js'
import { env } from '../../config/env.js'
import { makeEvolutionClient, type EvolutionClient } from '../channels/evolution.client.js'
import { logger } from '../../lib/logger.js'

// ─── Helpers de criptografia da apiKey ───────────────────────────────────────

function encryptApiKey(plain: string): string {
  const { ciphertext, iv, authTag } = encrypt(plain)
  return JSON.stringify({
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  })
}

function decryptApiKey(stored: string): string {
  const { ciphertext, iv, authTag } = JSON.parse(stored)
  return decrypt(
    Buffer.from(ciphertext, 'base64'),
    Buffer.from(iv, 'base64'),
    Buffer.from(authTag, 'base64'),
  )
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listEvolutionServers() {
  const servers = await prisma.evolutionServer.findMany({
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  })
  // Não expõe a apiKey criptografada para o frontend
  return servers.map(({ apiKey: _, ...s }) => s)
}

export async function getEvolutionServer(id: string) {
  const server = await prisma.evolutionServer.findUniqueOrThrow({ where: { id } })
  return { ...server, apiKey: undefined }
}

export async function createEvolutionServer(data: {
  name: string
  url: string
  apiKey: string
  maxInstances?: number
  priority?: number
}) {
  const encryptedKey = encryptApiKey(data.apiKey)
  const server = await prisma.evolutionServer.create({
    data: {
      name: data.name,
      url: data.url.replace(/\/$/, ''), // remove trailing slash
      apiKey: encryptedKey,
      maxInstances: data.maxInstances ?? 100,
      priority: data.priority ?? 0,
    },
  })
  return { ...server, apiKey: undefined }
}

export async function updateEvolutionServer(id: string, data: {
  name?: string
  url?: string
  apiKey?: string
  maxInstances?: number
  priority?: number
  status?: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE'
}) {
  const update: Record<string, unknown> = {}
  if (data.name !== undefined) update.name = data.name
  if (data.url !== undefined) update.url = data.url.replace(/\/$/, '')
  if (data.apiKey !== undefined) update.apiKey = encryptApiKey(data.apiKey)
  if (data.maxInstances !== undefined) update.maxInstances = data.maxInstances
  if (data.priority !== undefined) update.priority = data.priority
  if (data.status !== undefined) update.status = data.status

  const server = await prisma.evolutionServer.update({ where: { id }, data: update })
  return { ...server, apiKey: undefined }
}

export async function deleteEvolutionServer(id: string) {
  // Desvincula canais antes de deletar
  await prisma.channel.updateMany({
    where: { evolutionServerId: id },
    data: { evolutionServerId: null },
  })
  await prisma.evolutionServer.delete({ where: { id } })
}

// ─── Seleção de servidor ──────────────────────────────────────────────────────

/**
 * Seleciona o melhor servidor disponível pela menor carga relativa
 * (instanceCount / maxInstances) entre servidores ACTIVE e saudáveis.
 */
export async function selectBestServer() {
  const servers = await prisma.evolutionServer.findMany({
    where: { status: 'ACTIVE', isHealthy: true },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  })

  if (servers.length === 0) {
    // Fallback: sem servidores no DB, usa env vars
    if (env.EVOLUTION_SERVER_URL) {
      return { id: null, url: env.EVOLUTION_SERVER_URL, apiKey: env.EVOLUTION_API_KEY ?? '' }
    }
    throw new Error('Nenhum servidor Evolution disponível. Cadastre um servidor em Configurações → Servidores Evolution.')
  }

  // Escolhe o com menor carga relativa (instanceCount / maxInstances)
  const best = servers.reduce((prev, curr) => {
    const prevLoad = prev.instanceCount / prev.maxInstances
    const currLoad = curr.instanceCount / curr.maxInstances
    return currLoad < prevLoad ? curr : prev
  })

  return {
    id: best.id,
    url: best.url,
    apiKey: decryptApiKey(best.apiKey),
  }
}

// ─── Obter cliente por canal ──────────────────────────────────────────────────

/**
 * Retorna um EvolutionClient configurado para o servidor do canal.
 * Se o canal não tiver servidor vinculado, usa env vars como fallback.
 */
export async function getClientForChannel(channelId: string): Promise<EvolutionClient> {
  const channel = await prisma.channel.findUniqueOrThrow({
    where: { id: channelId },
    select: { evolutionServerId: true },
  })

  if (!channel.evolutionServerId) {
    return makeEvolutionClient(env.EVOLUTION_SERVER_URL ?? '', env.EVOLUTION_API_KEY ?? '')
  }

  const server = await prisma.evolutionServer.findUniqueOrThrow({
    where: { id: channel.evolutionServerId },
  })

  return makeEvolutionClient(server.url, decryptApiKey(server.apiKey))
}

/**
 * Retorna url e apiKey descriptografadas para um servidor pelo ID.
 * Usado para criar sockets Socket.IO.
 */
export async function getServerCredentials(serverId: string) {
  const server = await prisma.evolutionServer.findUniqueOrThrow({ where: { id: serverId } })
  return { id: server.id, url: server.url, apiKey: decryptApiKey(server.apiKey) }
}

// ─── Healthcheck ──────────────────────────────────────────────────────────────

export async function healthcheckServer(id: string) {
  const server = await prisma.evolutionServer.findUniqueOrThrow({ where: { id } })
  const client = makeEvolutionClient(server.url, decryptApiKey(server.apiKey))

  try {
    const instances = await client.fetchInstances()
    const instanceCount = Array.isArray(instances) ? instances.length : 0
    await prisma.evolutionServer.update({
      where: { id },
      data: { isHealthy: true, lastHealthCheck: new Date(), instanceCount },
    })
    return { healthy: true, instanceCount }
  } catch (err: any) {
    await prisma.evolutionServer.update({
      where: { id },
      data: { isHealthy: false, lastHealthCheck: new Date() },
    })
    return { healthy: false, error: err?.message }
  }
}

// ─── Listar instâncias de um servidor ─────────────────────────────────────────

/**
 * Lista todas as instâncias de um servidor Evolution, marcando quais já estão
 * adotadas por algum Channel (de qualquer workspace).
 */
export async function listServerInstances(serverId: string, workspaceId: string) {
  const creds = await getServerCredentials(serverId)
  const client = makeEvolutionClient(creds.url, creds.apiKey)

  const raw = await client.fetchInstances() as unknown as any[]
  const instances = Array.isArray(raw) ? raw : []

  // Normaliza payload (Evolution v1 wraps em `instance`, v2 retorna flat)
  const normalized = instances.map((inst) => {
    const name: string | undefined = inst?.name ?? inst?.instance?.instanceName
    const connectionStatus: string | undefined =
      inst?.connectionStatus ?? inst?.instance?.status
    const profileName: string | undefined = inst?.profileName ?? inst?.instance?.profileName
    const profilePictureUrl: string | undefined =
      inst?.profilePicUrl ?? inst?.profilePictureUrl ?? inst?.instance?.profilePictureUrl
    const ownerJid: string | undefined = inst?.ownerJid ?? inst?.instance?.owner
    return { name, connectionStatus, profileName, profilePictureUrl, ownerJid }
  }).filter((i) => !!i.name)

  // Descobre instâncias já adotadas: verifica TODOS os canais WhatsApp ativos
  // (não filtra por evolutionServerId pois canais antigos podem ter ele como null
  // — eles existem no servidor "Default" semeado a partir do .env).
  const channels = await prisma.channel.findMany({
    where: { type: 'WHATSAPP', deletedAt: null },
    select: { id: true, label: true, workspaceId: true, config: true },
  })

  const { decryptJson } = await import('../../lib/crypto.js')
  const adopted = new Map<string, { channelId: string; label: string; sameWorkspace: boolean }>()
  for (const ch of channels) {
    try {
      const cfg = ch.config as { ciphertext: string; iv: string; authTag: string }
      const { instanceName } = decryptJson<{ instanceName: string }>(
        Buffer.from(cfg.ciphertext, 'base64'),
        Buffer.from(cfg.iv, 'base64'),
        Buffer.from(cfg.authTag, 'base64'),
      )
      adopted.set(instanceName, {
        channelId: ch.id,
        label: ch.label,
        sameWorkspace: ch.workspaceId === workspaceId,
      })
    } catch {
      // config inválido — ignora
    }
  }

  return normalized.map((inst) => {
    const info = adopted.get(inst.name!)
    return {
      ...inst,
      alreadyAdopted: !!info,
      adoptedByLabel: info?.label,
      adoptedInSameWorkspace: info?.sameWorkspace ?? false,
    }
  })
}

export async function healthcheckAllServers() {
  const servers = await prisma.evolutionServer.findMany({
    where: { status: 'ACTIVE' },
  })

  for (const server of servers) {
    try {
      await healthcheckServer(server.id)
    } catch (err: any) {
      logger.warn({ serverId: server.id, err: err?.message }, 'Healthcheck falhou para servidor Evolution')
    }
  }
}

// ─── Seed retrocompatibilidade ────────────────────────────────────────────────

/**
 * Se houver EVOLUTION_SERVER_URL no .env e nenhum servidor cadastrado no DB,
 * cria automaticamente um servidor "Default" para retrocompatibilidade.
 */
export async function seedDefaultServerFromEnv() {
  if (!env.EVOLUTION_SERVER_URL || !env.EVOLUTION_API_KEY) return

  const count = await prisma.evolutionServer.count()
  if (count > 0) return

  logger.info('Criando servidor Evolution padrão a partir das variáveis de ambiente...')
  await createEvolutionServer({
    name: 'Default',
    url: env.EVOLUTION_SERVER_URL,
    apiKey: env.EVOLUTION_API_KEY,
    priority: 0,
  })
  logger.info('Servidor Evolution padrão criado. Você pode gerenciá-lo em Admin → Servidores Evolution.')
}

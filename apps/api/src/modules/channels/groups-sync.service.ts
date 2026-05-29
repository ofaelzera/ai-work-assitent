import { prisma } from '../../lib/prisma.js'
import { logger } from '../../lib/logger.js'
import { getChannelConfig } from './channels.service.js'
import { getClientForChannel } from '../evolution-servers/evolution-servers.service.js'

export interface GroupsCacheEntry {
  at: number
  data: any[]
}

export const GROUPS_TTL_MS = 5 * 60_000

const memCache = new Map<string, GroupsCacheEntry>()
const inflight = new Map<string, Promise<any[]>>()

/** Carrega cache de grupos (memória → channel.settings.groupsCache). */
export async function loadGroupsCache(channelId: string): Promise<GroupsCacheEntry | null> {
  const memo = memCache.get(channelId)
  if (memo) return memo
  const ch = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { settings: true },
  })
  const persisted = (ch?.settings as any)?.groupsCache as { at?: number; data?: any[] } | undefined
  if (persisted?.data && Array.isArray(persisted.data)) {
    const entry: GroupsCacheEntry = { at: persisted.at ?? 0, data: persisted.data }
    memCache.set(channelId, entry)
    return entry
  }
  return null
}

/** Força refresh do cache via Evolution.fetchAllGroups. De-duplica chamadas paralelas. */
export async function refreshGroupsCache(channelId: string): Promise<any[]> {
  const existing = inflight.get(channelId)
  if (existing) return existing
  const promise = (async () => {
    const { instanceName } = await getChannelConfig(channelId)
    const client = await getClientForChannel(channelId)
    const raw = await client.fetchAllGroups(instanceName, false)
    const data: any[] = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as any)?.groups)
        ? (raw as any).groups
        : []
    const entry: GroupsCacheEntry = { at: Date.now(), data }
    memCache.set(channelId, entry)
    try {
      const ch = await prisma.channel.findUnique({
        where: { id: channelId },
        select: { settings: true },
      })
      const settings = (ch?.settings as Record<string, any>) ?? {}
      await prisma.channel.update({
        where: { id: channelId },
        data: { settings: { ...settings, groupsCache: { at: entry.at, data: entry.data } } as any },
      })
    } catch (err) {
      logger.warn({ err, channelId }, 'Falha ao persistir groupsCache em channel.settings')
    }
    return data
  })().finally(() => { inflight.delete(channelId) })
  inflight.set(channelId, promise)
  return promise
}

/** Sincroniza grupos de todos os canais WhatsApp conectados. */
export async function syncAllChannelsGroups(): Promise<{ synced: number; failed: number }> {
  const channels = await prisma.channel.findMany({
    where: { type: 'WHATSAPP', status: 'CONNECTED', deletedAt: null },
    select: { id: true, label: true },
  })
  let synced = 0
  let failed = 0
  for (const ch of channels) {
    try {
      const data = await refreshGroupsCache(ch.id)
      logger.info({ channelId: ch.id, label: ch.label, total: data.length }, 'Grupos sincronizados')
      synced++
    } catch (err) {
      logger.warn({ err, channelId: ch.id, label: ch.label }, 'Falha ao sincronizar grupos do canal')
      failed++
    }
  }
  return { synced, failed }
}

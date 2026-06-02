import { prisma } from '../../lib/prisma.js'
import { logger } from '../../lib/logger.js'
import { parseJid } from '../../lib/phone.js'
import { getChannelConfig } from './channels.service.js'
import { getClientForChannel } from '../evolution-servers/evolution-servers.service.js'
import { linkContactCompany } from '../contacts/contact-company.service.js'

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

/**
 * Resolve um participante de grupo (JID) num contato, criando-o como NÃO verificado
 * (RF02) se ainda não existir. Reusa a mesma estratégia PN→LID do sync de mensagens.
 * Retorna o id do contato ou null se o JID for irreconhecível.
 */
async function resolveParticipantContact(workspaceId: string, jid: string): Promise<string | null> {
  const parsed = parseJid(jid)
  if (parsed.kind === 'pn' && parsed.phone) {
    const existing = await prisma.contact.findFirst({
      where: { workspaceId, phone: parsed.phone, mergedIntoId: null },
      select: { id: true },
    })
    if (existing) return existing.id
    const created = await prisma.contact.create({
      data: { workspaceId, phone: parsed.phone, phoneType: 'PN', verified: false },
      select: { id: true },
    })
    return created.id
  }
  if (parsed.kind === 'lid' && parsed.lid) {
    const existing = await prisma.contact.findFirst({
      where: { workspaceId, lid: parsed.lid, mergedIntoId: null },
      select: { id: true },
    })
    if (existing) return existing.id
    const created = await prisma.contact.create({
      data: { workspaceId, lid: parsed.lid, phoneType: 'LID', verified: false },
      select: { id: true },
    })
    return created.id
  }
  return null
}

/**
 * RF04 — Sincronização inteligente com empresas.
 * Para cada grupo do canal que está vinculado a uma empresa (Conversation.isGroup=true
 * com companyId), busca os participantes via Evolution e associa cada contato à empresa
 * (vínculo N:N com source=GROUP_SYNC). Idempotente: re-rodar não duplica vínculos.
 */
export async function syncGroupCompanyLinks(channelId: string): Promise<{ groups: number; links: number }> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { workspaceId: true },
  })
  if (!channel) return { groups: 0, links: 0 }

  const groups = await prisma.conversation.findMany({
    where: { channelId, isGroup: true, companyId: { not: null } },
    select: { externalId: true, companyId: true },
  })
  if (groups.length === 0) return { groups: 0, links: 0 }

  const { instanceName } = await getChannelConfig(channelId)
  const client = await getClientForChannel(channelId)

  let links = 0
  for (const group of groups) {
    if (!group.companyId) continue
    try {
      const res = await client.findGroupMembers(instanceName, group.externalId)
      const participants = res?.participants ?? []
      for (const p of participants) {
        const contactId = await resolveParticipantContact(channel.workspaceId, p.id)
        if (!contactId) continue
        await linkContactCompany(contactId, group.companyId, 'GROUP_SYNC')
        links++
      }
    } catch (err) {
      logger.warn({ err, channelId, groupJid: group.externalId }, 'Falha ao vincular participantes do grupo à empresa')
    }
  }
  logger.info({ channelId, groups: groups.length, links }, 'RF04: vínculos grupo→empresa sincronizados')
  return { groups: groups.length, links }
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
      // RF04: associa participantes de grupos vinculados a empresas
      await syncGroupCompanyLinks(ch.id).catch((err) =>
        logger.warn({ err, channelId: ch.id }, 'Falha em syncGroupCompanyLinks'),
      )
      synced++
    } catch (err) {
      logger.warn({ err, channelId: ch.id, label: ch.label }, 'Falha ao sincronizar grupos do canal')
      failed++
    }
  }
  return { synced, failed }
}

import { prisma } from '../../lib/prisma.js'
import { logger } from '../../lib/logger.js'

/**
 * Detecta e mescla conversas LIVE OPEN duplicadas num workspace.
 *
 * Agrupa por duas chaves complementares (em ordem):
 *   1) (channelId, externalId)           — race condition entre sync e webhook
 *   2) (channelId, contactId não-null)   — LID e PN do mesmo contato (após merge de contatos)
 *
 * Para cada grupo com >1 conv, mantém a mais antiga como primary, move todas
 * as mensagens das duplicadas pra ela, preserva assigneeId/favorite quando útil
 * e deleta as duplicadas.
 *
 * Idempotente: rodar várias vezes não causa efeitos colaterais.
 */
export async function dedupConversations(workspaceId: string): Promise<{
  merged: number
  checked: number
}> {
  const openConvs = await prisma.conversation.findMany({
    where: { workspaceId, source: 'LIVE', status: { in: ['OPEN', 'WAITING'] } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      channelId: true,
      externalId: true,
      contactId: true,
      createdAt: true,
      assigneeId: true,
      favorite: true,
      unreadCount: true,
      archived: true,
    },
  })

  // Resolve contato canonical (segue mergedIntoId em cadeia)
  // Pra evitar N queries, buscamos todos os contatos referenciados de uma vez.
  const contactIds = Array.from(new Set(openConvs.map(c => c.contactId).filter((v): v is string => !!v)))
  const allContacts = contactIds.length > 0
    ? await prisma.contact.findMany({
        where: { id: { in: contactIds } },
        select: { id: true, mergedIntoId: true },
      })
    : []
  const mergeMap = new Map(allContacts.map(c => [c.id, c.mergedIntoId]))
  function resolveContactId(id: string | null): string | null {
    if (!id) return null
    let cur: string | null = id
    const seen = new Set<string>()
    while (cur && mergeMap.get(cur) && !seen.has(cur)) {
      seen.add(cur)
      cur = mergeMap.get(cur) ?? null
    }
    return cur
  }

  // Agrupa por duas chaves complementares.
  // Uma conv pode cair em ambos (mesmo external + mesmo contact) — ok, processamos a 1ª e a 2ª já não acha duplicata.
  const groups = new Map<string, typeof openConvs>()
  for (const conv of openConvs) {
    // Chave por externalId
    const k1 = `ext::${conv.channelId}::${conv.externalId}`
    if (!groups.has(k1)) groups.set(k1, [])
    groups.get(k1)!.push(conv)

    // Chave por contactId resolvido (canonical) — só pra DMs (groups não têm contact)
    const rootContact = resolveContactId(conv.contactId)
    if (rootContact) {
      const k2 = `ct::${conv.channelId}::${rootContact}`
      if (k1 !== k2 && !groups.has(k2)) groups.set(k2, [])
      if (k1 !== k2) groups.get(k2)!.push(conv)
    }
  }

  // Set de IDs já fundidos (pra não tentar fundir duas vezes)
  const alreadyMerged = new Set<string>()
  let merged = 0

  for (const [, group] of groups) {
    // Remove duplicatas dentro do grupo (caso a mesma conv tenha caído em 2 chaves)
    const uniq = Array.from(new Map(group.map(c => [c.id, c])).values())
      .filter(c => !alreadyMerged.has(c.id))

    if (uniq.length <= 1) continue

    // Mantém o mais antigo
    uniq.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    const primary = uniq[0]
    const dups = uniq.slice(1)

    for (const dup of dups) {
      // Move mensagens — primeiro resolve conflitos de unique (conversationId, externalId).
      // Quando há race condition, a MESMA mensagem pode ter sido ingerida nas duas convs.
      // Estratégia: identificar externalIds que já existem na primary e deletar essas dups,
      // depois mover as demais com segurança.
      const dupMsgs = await prisma.message.findMany({
        where: { conversationId: dup.id },
        select: { id: true, externalId: true },
      })
      if (dupMsgs.length > 0) {
        const externalIds = dupMsgs.map(m => m.externalId).filter((v): v is string => !!v)
        if (externalIds.length > 0) {
          const alreadyInPrimary = await prisma.message.findMany({
            where: { conversationId: primary.id, externalId: { in: externalIds } },
            select: { externalId: true },
          })
          const conflictSet = new Set(alreadyInPrimary.map(m => m.externalId))
          const conflictingDupIds = dupMsgs.filter(m => m.externalId && conflictSet.has(m.externalId)).map(m => m.id)
          if (conflictingDupIds.length > 0) {
            await prisma.message.deleteMany({ where: { id: { in: conflictingDupIds } } })
          }
        }
        // Move o restante
        await prisma.message.updateMany({
          where: { conversationId: dup.id },
          data: { conversationId: primary.id },
        })
      }
      // Migra tarefas/eventos vinculados a esta conv (Fase D)
      await prisma.task.updateMany({
        where: { conversationId: dup.id },
        data: { conversationId: primary.id },
      })
      await prisma.calendarEvent.updateMany({
        where: { conversationId: dup.id },
        data: { conversationId: primary.id },
      })

      // Preserva assignee/favorite/unread se útil
      const patchData: Record<string, unknown> = {}
      if (!primary.assigneeId && dup.assigneeId) patchData.assigneeId = dup.assigneeId
      if (!primary.favorite && dup.favorite) patchData.favorite = true
      if (dup.unreadCount > 0) patchData.unreadCount = { increment: dup.unreadCount }
      if (Object.keys(patchData).length) {
        await prisma.conversation.update({ where: { id: primary.id }, data: patchData })
      }

      // Deleta a duplicada
      await prisma.conversation.delete({ where: { id: dup.id } })
      alreadyMerged.add(dup.id)
      merged++

      logger.info({ primaryId: primary.id, dupId: dup.id, workspaceId }, 'Conv duplicada mesclada')
    }
  }

  return { merged, checked: openConvs.length }
}

/**
 * Variante focada num único chat — barata pra rodar ao final de cada ingest.
 * Detecta as duplicatas APENAS pro par (channelId, externalId) e/ou (channelId, contactId).
 * Caso 0 ou 1 conv aberta → noop (1 query e sai).
 *
 * Retorna nº de duplicatas mescladas (geralmente 0).
 */
export async function dedupChatConversations(
  workspaceId: string,
  channelId: string,
  externalId: string,
): Promise<number> {
  // Pega TODAS as convs ativas do chat (normalmente 0 ou 1; 2+ = duplicata)
  let openConvs = await prisma.conversation.findMany({
    where: {
      workspaceId, channelId, externalId,
      source: 'LIVE', status: { in: ['OPEN', 'WAITING'] },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, channelId: true, externalId: true, contactId: true,
      createdAt: true, assigneeId: true, favorite: true, unreadCount: true,
    },
  })

  // Caminho rápido: 0 ou 1 conv = nada a fazer
  if (openConvs.length <= 1) {
    // Também tenta detectar duplicatas por contato canonical (LID + PN do mesmo dono)
    const firstContactId = openConvs[0]?.contactId
    if (!firstContactId) return 0
    const canonicalId = await resolveContactCanonical(firstContactId)
    if (!canonicalId) return 0
    // Procura outras convs LIVE OPEN pro mesmo contato canonical neste canal,
    // mas com externalId diferente (LID vs PN)
    const others = await prisma.conversation.findMany({
      where: {
        workspaceId, channelId,
        source: 'LIVE', status: { in: ['OPEN', 'WAITING'] },
        contactId: canonicalId,
        id: { not: openConvs[0]!.id },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, channelId: true, externalId: true, contactId: true,
        createdAt: true, assigneeId: true, favorite: true, unreadCount: true,
      },
    })
    if (others.length === 0) return 0
    openConvs = [...openConvs, ...others]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }

  // 2+ duplicatas → mescla todas na mais antiga
  const primary = openConvs[0]
  let merged = 0
  for (const dup of openConvs.slice(1)) {
    await mergeOneInto(primary.id, dup, workspaceId)
    merged++
  }
  return merged
}

/** Resolve cadeia de mergedIntoId pra contato canônico (root). */
async function resolveContactCanonical(contactId: string): Promise<string | null> {
  let current: string | null = contactId
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    seen.add(current)
    const c: { mergedIntoId: string | null } | null = await prisma.contact.findUnique({
      where: { id: current }, select: { mergedIntoId: true },
    })
    if (!c) return null
    if (!c.mergedIntoId) return current
    current = c.mergedIntoId
  }
  return current
}

/** Move tudo de `dup` pra `primaryId` e deleta `dup`. Lida com idempotência de mensagens. */
async function mergeOneInto(
  primaryId: string,
  dup: { id: string; assigneeId: string | null; favorite: boolean; unreadCount: number },
  workspaceId: string,
) {
  // Idempotência de mensagens
  const dupMsgs = await prisma.message.findMany({
    where: { conversationId: dup.id },
    select: { id: true, externalId: true },
  })
  if (dupMsgs.length > 0) {
    const externalIds = dupMsgs.map(m => m.externalId).filter((v): v is string => !!v)
    if (externalIds.length > 0) {
      const alreadyInPrimary = await prisma.message.findMany({
        where: { conversationId: primaryId, externalId: { in: externalIds } },
        select: { externalId: true },
      })
      const conflictSet = new Set(alreadyInPrimary.map(m => m.externalId))
      const conflictingDupIds = dupMsgs.filter(m => m.externalId && conflictSet.has(m.externalId)).map(m => m.id)
      if (conflictingDupIds.length > 0) {
        await prisma.message.deleteMany({ where: { id: { in: conflictingDupIds } } })
      }
    }
    await prisma.message.updateMany({
      where: { conversationId: dup.id },
      data: { conversationId: primaryId },
    })
  }
  await prisma.task.updateMany({
    where: { conversationId: dup.id },
    data: { conversationId: primaryId },
  })
  await prisma.calendarEvent.updateMany({
    where: { conversationId: dup.id },
    data: { conversationId: primaryId },
  })

  // Patch da primary com dados úteis do dup
  const primaryData = await prisma.conversation.findUniqueOrThrow({
    where: { id: primaryId },
    select: { assigneeId: true, favorite: true },
  })
  const patchData: Record<string, unknown> = {}
  if (!primaryData.assigneeId && dup.assigneeId) patchData.assigneeId = dup.assigneeId
  if (!primaryData.favorite && dup.favorite) patchData.favorite = true
  if (dup.unreadCount > 0) patchData.unreadCount = { increment: dup.unreadCount }
  if (Object.keys(patchData).length) {
    await prisma.conversation.update({ where: { id: primaryId }, data: patchData })
  }

  await prisma.conversation.delete({ where: { id: dup.id } })
  logger.info({ primaryId, dupId: dup.id, workspaceId }, 'Conv duplicada auto-mesclada (chat-scoped)')
}

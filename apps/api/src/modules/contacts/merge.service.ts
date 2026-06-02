import { prisma } from '../../lib/prisma.js'
import { logger } from '../../lib/logger.js'

/**
 * Funde o contato `dupId` no `primaryId`:
 *   - Migra conversas, mensagens e cards
 *   - Preserva nome/email/phone/lid do primário, mas preenche campos vazios com o do dup
 *   - Marca o dup como mergedIntoId=primaryId (soft-merge — mantém histórico)
 *
 * Idempotente: chamar duas vezes não causa dano (a segunda chamada não encontra
 * registros pra migrar e o `mergedIntoId` já está setado).
 */
export async function mergeContacts(dupId: string, primaryId: string): Promise<void> {
  if (dupId === primaryId) return

  const [dup, primary] = await Promise.all([
    prisma.contact.findUnique({ where: { id: dupId } }),
    prisma.contact.findUnique({ where: { id: primaryId } }),
  ])
  if (!dup || !primary) {
    logger.warn({ dupId, primaryId }, 'mergeContacts: contato não encontrado')
    return
  }
  if (dup.mergedIntoId === primaryId) return // já mesclado

  // Migra referências de mensagens (Message.fromContactId) e cards
  await prisma.message.updateMany({ where: { fromContactId: dup.id }, data: { fromContactId: primary.id } })
  await prisma.card.updateMany({ where: { contactId: dup.id }, data: { contactId: primary.id } })

  // Migra vínculos N:N de empresa (ContactCompany) do dup para o primário, sem duplicar.
  const dupLinks = await prisma.contactCompany.findMany({ where: { contactId: dup.id } })
  for (const link of dupLinks) {
    await prisma.contactCompany.upsert({
      where: { contactId_companyId: { contactId: primary.id, companyId: link.companyId } },
      update: {},
      create: { contactId: primary.id, companyId: link.companyId, source: link.source },
    })
  }
  await prisma.contactCompany.deleteMany({ where: { contactId: dup.id } })

  // ── Conversations ────────────────────────────────────────────────────────
  // 1) Move todas as conversas do dup pro primary
  // 2) Para cada (channelId, isGroup) duplicado entre as conversas resultantes,
  //    mescla as conversas: mantém a mais antiga, move mensagens da mais nova,
  //    deleta a mais nova.
  await prisma.conversation.updateMany({ where: { contactId: dup.id }, data: { contactId: primary.id } })

  const allConvs = await prisma.conversation.findMany({
    where: { contactId: primary.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, channelId: true, isGroup: true, status: true, lastMessageAt: true, unreadCount: true },
  })

  // Agrupa por canal — para 1-on-1 (isGroup=false), múltiplas conversas no mesmo canal
  // representam o MESMO contato com externalIds diferentes (PN vs LID) → merge.
  // Para grupos, mantemos como está (cada grupo é um chat distinto, mesmo se o user é membro de dois).
  const groups = new Map<string, typeof allConvs>()
  for (const conv of allConvs) {
    if (conv.isGroup) continue
    const key = conv.channelId
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(conv)
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue
    const keep = group[0]
    const drops = group.slice(1)
    for (const drop of drops) {
      // Move mensagens (idempotência: o índice unique é (conversationId, externalId),
      // então em teoria não há colisão entre conversas distintas — mas se houver, ignoramos)
      try {
        await prisma.message.updateMany({
          where: { conversationId: drop.id },
          data: { conversationId: keep.id },
        })
      } catch (err) {
        logger.warn({ err, dropId: drop.id, keepId: keep.id }, 'Colisão ao mover mensagens — algumas mensagens podem ter sido descartadas')
      }
      // Move cards
      await prisma.card.updateMany({
        where: { conversationId: drop.id },
        data: { conversationId: keep.id },
      })
      // Atualiza counts/datas
      const newLastMsg = drop.lastMessageAt && (!keep.lastMessageAt || drop.lastMessageAt > keep.lastMessageAt)
        ? drop.lastMessageAt : keep.lastMessageAt
      await prisma.conversation.update({
        where: { id: keep.id },
        data: {
          lastMessageAt: newLastMsg,
          unreadCount: keep.unreadCount + drop.unreadCount,
        },
      })
      // Apaga a duplicata
      await prisma.conversation.delete({ where: { id: drop.id } })
      logger.info({ keptId: keep.id, droppedId: drop.id, contactId: primary.id }, 'Conversa duplicada mesclada')
    }
  }

  // Preenche campos faltantes do primário com dados do dup
  const enrichment: Record<string, unknown> = {}
  if (!primary.name && dup.name) enrichment.name = dup.name
  if (!primary.email && dup.email) enrichment.email = dup.email
  if (!primary.phone && dup.phone) enrichment.phone = dup.phone
  if (!primary.lid && dup.lid) enrichment.lid = dup.lid
  if (!primary.companyId && dup.companyId) enrichment.companyId = dup.companyId
  // Se o primário era LID e o dup tem PN, promove para PN
  if (primary.phoneType === 'LID' && dup.phoneType === 'PN') enrichment.phoneType = 'PN'
  if (Object.keys(enrichment).length) {
    await prisma.contact.update({ where: { id: primary.id }, data: enrichment })
  }

  await prisma.contact.update({ where: { id: dup.id }, data: { mergedIntoId: primary.id } })

  logger.info(
    { primaryId, dupId, primaryPhone: primary.phone, primaryLid: primary.lid },
    'Contato mesclado',
  )
}

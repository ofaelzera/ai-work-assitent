/**
 * Espelha os campos legados Card.contactId / Card.assigneeId nas novas tabelas
 * M2M CardContact / CardAssignee. Idempotente (upsert) — pode rodar quantas
 * vezes quiser sem duplicar.
 *
 * Uso (na raiz do repo):
 *   pnpm --filter api migrate:card-multi
 */
import { prisma } from '../src/lib/prisma.js'

async function main() {
  console.log('🔄 Migrando contactId/assigneeId legados → CardContact/CardAssignee...')

  const cards = await prisma.card.findMany({
    where: {
      deletedAt: null,
      OR: [{ contactId: { not: null } }, { assigneeId: { not: null } }],
    },
    select: { id: true, contactId: true, assigneeId: true, workspaceId: true },
  })
  console.log(`   Cards candidatos: ${cards.length}`)

  let contactsLinked = 0
  let assigneesLinked = 0
  let contactsSkippedMissing = 0
  let assigneesSkippedMissing = 0

  for (const card of cards) {
    // — Contato legado → CardContact
    if (card.contactId) {
      // Confirma que o contato ainda existe (não foi merged/deletado)
      const c = await prisma.contact.findFirst({
        where: { id: card.contactId, workspaceId: card.workspaceId },
        select: { id: true },
      })
      if (c) {
        await prisma.cardContact.upsert({
          where: { cardId_contactId: { cardId: card.id, contactId: card.contactId } },
          create: { cardId: card.id, contactId: card.contactId },
          update: {},
        })
        contactsLinked++
      } else {
        contactsSkippedMissing++
      }
    }

    // — Assignee legado → CardAssignee
    if (card.assigneeId) {
      const u = await prisma.user.findFirst({
        where: { id: card.assigneeId, workspaceId: card.workspaceId, deletedAt: null },
        select: { id: true },
      })
      if (u) {
        await prisma.cardAssignee.upsert({
          where: { cardId_userId: { cardId: card.id, userId: card.assigneeId } },
          create: { cardId: card.id, userId: card.assigneeId },
          update: {},
        })
        assigneesLinked++
      } else {
        assigneesSkippedMissing++
      }
    }
  }

  console.log('')
  console.log(`✅ Contatos vinculados:    ${contactsLinked}`)
  console.log(`✅ Responsáveis vinculados: ${assigneesLinked}`)
  if (contactsSkippedMissing > 0)  console.log(`⚠️  Contatos não encontrados (pulados):    ${contactsSkippedMissing}`)
  if (assigneesSkippedMissing > 0) console.log(`⚠️  Usuários não encontrados (pulados):    ${assigneesSkippedMissing}`)
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())

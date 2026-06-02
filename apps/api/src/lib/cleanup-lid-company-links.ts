/**
 * Cleanup: remove vínculos contato→empresa de origem GROUP_SYNC que apontam para
 * contatos SEM número real (LID, sem phone, ou phone com JID). A partir de agora o
 * RF04 não cria esses vínculos; este script limpa os que já existiam.
 *
 * Idempotente. Reacerta o mirror Contact.companyId dos contatos afetados.
 *
 * Rodar: pnpm exec dotenv -e ../../.env -- tsx src/lib/cleanup-lid-company-links.ts
 */
import { prisma } from './prisma.js'

async function main() {
  console.log('🔄 Limpando vínculos GROUP_SYNC de contatos sem número real...')

  // Contatos "sem número real"
  const lidContacts = await prisma.contact.findMany({
    where: {
      OR: [
        { phoneType: 'LID' },
        { phone: null },
        { phone: { contains: '@' } },
      ],
    },
    select: { id: true, companyId: true },
  })
  const ids = new Set(lidContacts.map((c) => c.id))
  if (ids.size === 0) { console.log('   nada a fazer.'); return }

  const del = await prisma.contactCompany.deleteMany({
    where: { contactId: { in: [...ids] }, source: 'GROUP_SYNC' },
  })

  // Reacerta o mirror companyId: se o contato não tem mais nenhum vínculo, zera.
  let mirrorsFixed = 0
  for (const c of lidContacts) {
    if (!c.companyId) continue
    const still = await prisma.contactCompany.findFirst({
      where: { contactId: c.id },
      orderBy: { createdAt: 'asc' },
      select: { companyId: true },
    })
    const next = still?.companyId ?? null
    if (next !== c.companyId) {
      await prisma.contact.update({ where: { id: c.id }, data: { companyId: next } })
      mirrorsFixed++
    }
  }

  console.log(`✅ Removidos ${del.count} vínculo(s) GROUP_SYNC; ${mirrorsFixed} mirror(s) reacertado(s).`)
}

main()
  .catch((err) => { console.error('❌ Cleanup falhou:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())

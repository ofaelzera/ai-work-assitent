/**
 * Soft-delete de cards "órfãos": cards ainda ativos (deletedAt=null) cujo board
 * já foi deletado. Antes do cascade no DELETE de board, esses cards continuavam
 * contando nos KPIs do workspace. Idempotente — rode quando quiser.
 *
 * Uso (na raiz do repo):
 *   pnpm --filter api cleanup:orphan-cards
 */
import { prisma } from '../src/lib/prisma.js'

async function main() {
  console.log('🧹 Procurando cards ativos em boards deletados...')

  const orphans = await prisma.card.findMany({
    where: { deletedAt: null, column: { board: { deletedAt: { not: null } } } },
    select: { id: true, title: true, column: { select: { board: { select: { name: true } } } } },
  })
  console.log(`   Encontrados: ${orphans.length}`)
  for (const c of orphans) {
    console.log(`   • "${c.title}" (board deletado: ${c.column?.board?.name})`)
  }

  if (orphans.length > 0) {
    await prisma.card.updateMany({
      where: { id: { in: orphans.map(o => o.id) } },
      data: { deletedAt: new Date() },
    })
  }
  console.log(`✅ ${orphans.length} card(s) órfão(s) arquivado(s).`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())

/**
 * Diagnóstico: lista todos os cards que contam como "demanda aberta" nos KPIs
 * (deletedAt null E coluna com isDone=false), agrupados por board → coluna.
 * Mostra também as colunas e seu flag isDone, pra identificar o card "perdido".
 *
 * Uso (na raiz do repo):
 *   pnpm --filter api debug:open-cards
 */
import { prisma } from '../src/lib/prisma.js'

async function main() {
  const openCards = await prisma.card.findMany({
    where: { deletedAt: null, column: { isDone: false } },
    select: {
      id: true, title: true,
      column: { select: { name: true, isDone: true, board: { select: { name: true } } } },
    },
  })

  console.log(`\n📊 Total contado como "Demandas abertas": ${openCards.length}\n`)
  const byBoard = new Map<string, typeof openCards>()
  for (const c of openCards) {
    const board = c.column?.board?.name ?? '(sem board)'
    if (!byBoard.has(board)) byBoard.set(board, [])
    byBoard.get(board)!.push(c)
  }
  for (const [board, cards] of byBoard) {
    console.log(`▸ Board "${board}" — ${cards.length} card(s) aberto(s):`)
    for (const c of cards) {
      console.log(`    • [${c.column?.name ?? 'sem coluna'}] ${c.title}`)
    }
  }

  // Lista também todas as colunas e o flag isDone, pra conferir marcações
  console.log(`\n🧭 Colunas e flag isDone:`)
  const cols = await prisma.column.findMany({
    select: { name: true, isDone: true, board: { select: { name: true } }, _count: { select: { cards: { where: { deletedAt: null } } } } },
    orderBy: [{ board: { name: 'asc' } }, { position: 'asc' }],
  })
  for (const col of cols) {
    console.log(`    ${col.isDone ? '✅ DONE ' : '⬜ aberta'} | ${col.board?.name} › ${col.name} (${col._count.cards} cards)`)
  }
  console.log('')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())

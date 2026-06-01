/**
 * Backfill do flag Column.isDone para boards existentes.
 * Marca como "coluna de conclusão" toda coluna cujo nome remete a encerramento
 * (concluído, finalizado, cancelado, resolvido, fechado, etc.), de forma tolerante
 * a acento/caixa. Idempotente — pode rodar quantas vezes quiser.
 *
 * Uso (na raiz do repo):
 *   pnpm --filter api migrate:column-done
 */
import { prisma } from '../src/lib/prisma.js'

// Normaliza: minúsculas, sem acento, só letras.
const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '')

// Radicais que indicam coluna de conclusão (match por prefixo após normalizar).
const DONE_PREFIXES = [
  'conclu',     // concluído, concluída, concluido, concluir
  'finaliz',    // finalizado/a
  'cancel',     // cancelado/a
  'resolv',     // resolvido/a
  'encerr',     // encerrado/a
  'fechad',     // fechado/a
  'done',
  'arquivad',   // arquivado/a
]

async function main() {
  console.log('🔄 Backfill Column.isDone para colunas de conclusão existentes...')

  const columns = await prisma.column.findMany({
    where: { isDone: false },
    select: { id: true, name: true },
  })
  console.log(`   Colunas candidatas (isDone=false): ${columns.length}`)

  let marked = 0
  for (const col of columns) {
    const n = norm(col.name)
    if (DONE_PREFIXES.some(p => n.startsWith(p))) {
      await prisma.column.update({ where: { id: col.id }, data: { isDone: true } })
      console.log(`   ✓ "${col.name}" → isDone=true`)
      marked++
    }
  }

  console.log(`✅ Concluído. ${marked} coluna(s) marcada(s) como conclusão.`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())

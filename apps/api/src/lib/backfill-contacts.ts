/**
 * Backfill único da migração de contatos (RF02 + RF04 N:N).
 *
 * Executa DUAS coisas, de forma idempotente:
 *   1. verified: marca `true` para contatos que já têm histórico de conversa
 *      (chat/atendimento) e `false` para os que não têm nenhuma — decisão de
 *      produto para não esconder a base atual ao ativar o RF03.
 *   2. ContactCompany: cria o vínculo N:N a partir do antigo Contact.companyId
 *      (source = 'MANUAL'), sem duplicar.
 *
 * Ordem de execução:
 *   1) `pnpm --filter api db:push`   (cria ContactCompany + colunas novas, mantém companyId)
 *   2) `pnpm --filter api exec tsx src/lib/backfill-contacts.ts`
 *
 * Pode ser rodado mais de uma vez sem efeito colateral.
 */
import { prisma } from './prisma.js'

async function main() {
  console.log('🔄 Backfill de contatos (verified + ContactCompany)...')

  // ── 1. verified ────────────────────────────────────────────────────────────
  // Verdadeiro para quem tem ≥1 conversa; falso para quem não tem.
  const withConvos = await prisma.contact.updateMany({
    where: { conversations: { some: {} } },
    data: { verified: true },
  })
  const withoutConvos = await prisma.contact.updateMany({
    where: { conversations: { none: {} } },
    data: { verified: false },
  })
  console.log(`   verified=true: ${withConvos.count} | verified=false: ${withoutConvos.count}`)

  // ── 2. ContactCompany a partir do antigo companyId ──────────────────────────
  const linked = await prisma.contact.findMany({
    where: { companyId: { not: null } },
    select: { id: true, companyId: true },
  })
  let created = 0
  for (const c of linked) {
    if (!c.companyId) continue
    const res = await prisma.contactCompany.upsert({
      where: { contactId_companyId: { contactId: c.id, companyId: c.companyId } },
      update: {},
      create: { contactId: c.id, companyId: c.companyId, source: 'MANUAL' },
    })
    if (res) created++
  }
  console.log(`   ContactCompany processados: ${created} (de ${linked.length} contatos com empresa)`)

  console.log('✅ Backfill concluído.')
}

main()
  .catch((err) => {
    console.error('❌ Backfill falhou:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

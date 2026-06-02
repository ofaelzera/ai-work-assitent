import { prisma } from '../../lib/prisma.js'

/**
 * Vínculo N:N Contato ↔ Empresa (RF04). Helpers reutilizados por rotas, sync e merge.
 */

/** Adiciona (idempotente) um vínculo contato→empresa. `source` distingue origem. */
export async function linkContactCompany(
  contactId: string,
  companyId: string,
  source: 'MANUAL' | 'GROUP_SYNC' = 'MANUAL',
): Promise<void> {
  await prisma.contactCompany.upsert({
    where: { contactId_companyId: { contactId, companyId } },
    update: {}, // mantém source original — não rebaixa MANUAL para GROUP_SYNC
    create: { contactId, companyId, source },
  })
  // Mirror: preenche a "empresa principal" denormalizada se ainda estiver vazia.
  await prisma.contact.updateMany({
    where: { id: contactId, companyId: null },
    data: { companyId },
  })
}

/**
 * Sincroniza os vínculos MANUAIS de um contato com a lista `companyIds`.
 * Preserva vínculos de origem GROUP_SYNC (gerados pela sincronização de grupos).
 * Valida que as empresas pertencem ao workspace.
 */
export async function setContactCompanies(
  contactId: string,
  workspaceId: string,
  companyIds: string[],
): Promise<void> {
  const unique = Array.from(new Set(companyIds))

  // Garante que todas as empresas existem no workspace (ignora ids inválidos)
  const valid = unique.length
    ? await prisma.company.findMany({
        where: { id: { in: unique }, workspaceId },
        select: { id: true },
      })
    : []
  const validIds = new Set(valid.map((c) => c.id))

  const existing = await prisma.contactCompany.findMany({
    where: { contactId },
    select: { companyId: true, source: true },
  })
  const manualExisting = new Set(existing.filter((e) => e.source === 'MANUAL').map((e) => e.companyId))

  // Remove vínculos MANUAIS que saíram da lista (não toca em GROUP_SYNC)
  const toRemove = [...manualExisting].filter((id) => !validIds.has(id))
  if (toRemove.length) {
    await prisma.contactCompany.deleteMany({
      where: { contactId, companyId: { in: toRemove }, source: 'MANUAL' },
    })
  }

  // Adiciona os novos
  for (const id of validIds) {
    if (!manualExisting.has(id)) await linkContactCompany(contactId, id, 'MANUAL')
  }

  // Mirror: empresa principal = primeira manual selecionada (ou null se nenhuma).
  // Se zerou a lista manual mas ainda há vínculo GROUP_SYNC, usa o primeiro deles.
  let primary: string | null = [...validIds][0] ?? null
  if (!primary) {
    const fallback = await prisma.contactCompany.findFirst({
      where: { contactId },
      orderBy: { createdAt: 'asc' },
      select: { companyId: true },
    })
    primary = fallback?.companyId ?? null
  }
  await prisma.contact.update({ where: { id: contactId }, data: { companyId: primary } })
}

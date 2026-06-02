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

/** Remove um vínculo específico contato→empresa e reacerta o mirror `companyId`. */
export async function unlinkContactCompany(contactId: string, companyId: string): Promise<void> {
  await prisma.contactCompany.deleteMany({ where: { contactId, companyId } })
  const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { companyId: true } })
  if (contact?.companyId === companyId) {
    const next = await prisma.contactCompany.findFirst({
      where: { contactId },
      orderBy: { createdAt: 'asc' },
      select: { companyId: true },
    })
    await prisma.contact.update({ where: { id: contactId }, data: { companyId: next?.companyId ?? null } })
  }
}

/**
 * Sincroniza os vínculos de empresa de um contato com a lista `companyIds`.
 * Valida que as empresas pertencem ao workspace.
 *
 * `opts.replaceGroupLinks` (default false): quando true, a lista representa o
 * conjunto COMPLETO desejado — remove inclusive vínculos GROUP_SYNC que saíram
 * (usado pela tela de edição de contato, onde o usuário gerencia tudo). Quando
 * false, preserva os GROUP_SYNC e reconcilia só os MANUAIS (uso legado).
 */
export async function setContactCompanies(
  contactId: string,
  workspaceId: string,
  companyIds: string[],
  opts: { replaceGroupLinks?: boolean } = {},
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
  // Quais vínculos existentes contam para reconciliação: todos (replaceGroupLinks)
  // ou apenas os MANUAIS (preservando GROUP_SYNC).
  const managed = opts.replaceGroupLinks ? existing : existing.filter((e) => e.source === 'MANUAL')
  const managedExisting = new Set(managed.map((e) => e.companyId))

  // Remove vínculos gerenciados que saíram da lista
  const toRemove = [...managedExisting].filter((id) => !validIds.has(id))
  if (toRemove.length) {
    await prisma.contactCompany.deleteMany({
      where: opts.replaceGroupLinks
        ? { contactId, companyId: { in: toRemove } }
        : { contactId, companyId: { in: toRemove }, source: 'MANUAL' },
    })
  }

  // Adiciona os novos como MANUAL (os que já existem mantêm o source original)
  const allExisting = new Set(existing.map((e) => e.companyId))
  for (const id of validIds) {
    if (!allExisting.has(id)) await linkContactCompany(contactId, id, 'MANUAL')
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

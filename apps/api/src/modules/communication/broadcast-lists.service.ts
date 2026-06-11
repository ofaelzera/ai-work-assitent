import { prisma } from '../../lib/prisma.js'

/**
 * Importa contatos para uma lista a partir de um CSV simples.
 * Cada linha pode conter telefone e/ou email; só vincula contatos JÁ cadastrados
 * no workspace (casados por telefone — só dígitos — ou email). Retorna o resumo.
 */
export interface ImportResult {
  added: number
  skipped: number // já estavam na lista
  notFound: string[] // linhas sem contato correspondente
}

function parseCsv(content: string): string[][] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/[;,]/).map((c) => c.trim().replace(/^"|"$/g, '')))
}

export async function importContactsToList(
  workspaceId: string,
  listId: string,
  csvContent: string,
): Promise<ImportResult> {
  const rows = parseCsv(csvContent)
  const result: ImportResult = { added: 0, skipped: 0, notFound: [] }

  // Detecta e pula cabeçalho comum (nome/telefone/email)
  const startIdx = rows[0]?.some((c) => /telefone|phone|email|e-mail|nome|name/i.test(c)) ? 1 : 0

  for (let i = startIdx; i < rows.length; i++) {
    const cells = rows[i]
    const raw = cells.join(' ')
    const phoneCell = cells.find((c) => /\d{8,}/.test(c.replace(/\D/g, '')))
    const emailCell = cells.find((c) => /@/.test(c))
    const phone = phoneCell ? phoneCell.replace(/\D/g, '') : null
    const email = emailCell ?? null

    if (!phone && !email) {
      result.notFound.push(raw)
      continue
    }

    const contact = await prisma.contact.findFirst({
      where: {
        workspaceId,
        mergedIntoId: null,
        OR: [
          ...(phone ? [{ phone }] : []),
          ...(email ? [{ email }] : []),
        ],
      },
      select: { id: true },
    })

    if (!contact) {
      result.notFound.push(raw)
      continue
    }

    const existing = await prisma.broadcastListMember.findUnique({
      where: { listId_contactId: { listId, contactId: contact.id } },
      select: { id: true },
    })
    if (existing) {
      result.skipped++
      continue
    }

    await prisma.broadcastListMember.create({ data: { listId, contactId: contact.id } })
    result.added++
  }

  return result
}

/** Exporta os contatos de uma lista como CSV (nome, telefone, email). */
export async function exportListToCsv(workspaceId: string, listId: string): Promise<string> {
  const members = await prisma.broadcastListMember.findMany({
    where: { listId, list: { workspaceId } },
    select: { contact: { select: { name: true, phone: true, email: true } } },
  })
  const header = 'nome,telefone,email'
  const lines = members.map((m) => {
    const c = m.contact
    return [c.name ?? '', c.phone ?? '', c.email ?? ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')
  })
  return [header, ...lines].join('\n')
}

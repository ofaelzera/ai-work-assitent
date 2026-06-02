/**
 * Backfill aditivo: garante `contacts.viewVerified` nos roles de sistema "Atendente"
 * já existentes (workspaces criados antes da permissão existir).
 *
 * Só ADICIONA a permissão se ainda não estiver presente — nunca remove nem mexe em
 * outras permissões, então é seguro e idempotente.
 *
 * Rodar: pnpm exec dotenv -e ../../.env -- tsx src/lib/backfill-atendente-viewverified.ts
 */
import { prisma } from './prisma.js'

async function main() {
  console.log('🔄 Adicionando contacts.viewVerified aos roles "Atendente" existentes...')

  const roles = await prisma.customRole.findMany({
    where: { isSystem: true, name: 'Atendente' },
    select: { id: true, workspaceId: true, permissions: true },
  })

  let updated = 0
  for (const role of roles) {
    const perms = Array.isArray(role.permissions) ? (role.permissions as string[]) : []
    if (perms.includes('contacts.viewVerified')) continue
    await prisma.customRole.update({
      where: { id: role.id },
      data: { permissions: [...perms, 'contacts.viewVerified'] as any },
    })
    updated++
  }

  console.log(`✅ Concluído: ${updated} role(s) atualizado(s) de ${roles.length} "Atendente" encontrado(s).`)
}

main()
  .catch((err) => {
    console.error('❌ Backfill falhou:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

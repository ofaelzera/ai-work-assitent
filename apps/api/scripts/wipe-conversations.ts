/**
 * Wipe TOTAL de dados operacionais — limpa contatos, conversas, mensagens,
 * cards, kanban inteiro, anexos, logs de IA e eventos.
 *
 * Mantém:
 *   - Workspace, Users, RefreshTokens
 *   - Channels (WhatsApp/Email conectados)
 *   - Companies
 *   - Agents, Prompts (config de IA)
 *   - Vault (senhas)
 *   - CalendarAccount (mas wipa CalendarEvents)
 *
 * Use:  pnpm --filter api tsx scripts/wipe-conversations.ts
 *
 * ⚠️  Não há undo. Confirme antes de rodar em qualquer ambiente que importe.
 */
import { PrismaClient } from '@prisma/client'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const prisma = new PrismaClient()

async function main() {
  console.log('🧹 Wipe completo de dados operacionais iniciado…\n')

  // Conta antes
  const before = {
    messages:        await prisma.message.count(),
    conversations:   await prisma.conversation.count(),
    contacts:        await prisma.contact.count(),
    cards:           await prisma.card.count(),
    columns:         await prisma.column.count(),
    boards:          await prisma.board.count(),
    cardComments:    await prisma.cardComment.count(),
    cardHistory:     await prisma.cardHistory.count(),
    tasks:           await prisma.task.count(),
    attachments:     await prisma.attachment.count(),
    aiLogs:          await prisma.aIExecutionLog.count(),
    memoryChunks:    await prisma.memoryChunk.count(),
    calendarEvents:  await prisma.calendarEvent.count(),
    eventLogs:       await prisma.eventLog.count(),
  }
  console.log('Antes:', before)

  // Ordem importa (FKs):
  console.log('\n→ Limpando Kanban (comments, history, cards, columns, boards)…')
  await prisma.cardComment.deleteMany({})
  await prisma.cardHistory.deleteMany({})
  // Attachments têm FK opcional pra Card e VaultItem — wipa só os de Card
  await prisma.attachment.deleteMany({ where: { cardId: { not: null } } })
  await prisma.task.deleteMany({})
  await prisma.card.deleteMany({})
  await prisma.column.deleteMany({})
  await prisma.board.deleteMany({})

  console.log('→ Limpando Messages…')
  await prisma.message.deleteMany({})

  console.log('→ Limpando Conversations…')
  await prisma.conversation.deleteMany({})

  console.log('→ Limpando Contacts…')
  await prisma.contact.deleteMany({})

  console.log('→ Limpando logs de IA + memória…')
  await prisma.aIExecutionLog.deleteMany({})
  await prisma.memoryChunk.deleteMany({})

  console.log('→ Limpando CalendarEvents (mantém CalendarAccount)…')
  await prisma.calendarEvent.deleteMany({})

  console.log('→ Limpando EventLogs (audit)…')
  await prisma.eventLog.deleteMany({})

  console.log('→ Limpando Attachments restantes (sem cardId)…')
  await prisma.attachment.deleteMany({ where: { cardId: null, vaultItemId: null } })

  // Apaga arquivos físicos do storage local
  console.log('→ Limpando storage físico (mídia salva localmente)…')
  const STORAGE_PATH = process.env.STORAGE_PATH ?? path.resolve('./storage')
  try {
    const stat = await fs.stat(STORAGE_PATH).catch(() => null)
    if (stat?.isDirectory()) {
      const workspaces = await fs.readdir(STORAGE_PATH)
      for (const ws of workspaces) {
        const mediaDir = path.join(STORAGE_PATH, ws, 'media')
        const mediaStat = await fs.stat(mediaDir).catch(() => null)
        if (mediaStat?.isDirectory()) {
          const files = await fs.readdir(mediaDir)
          for (const f of files) await fs.rm(path.join(mediaDir, f), { force: true, recursive: true })
          console.log(`  ${files.length} arquivo(s) removido(s) de ${mediaDir}`)
        }
      }
    } else {
      console.log(`  (storage path não existe: ${STORAGE_PATH} — pulando)`)
    }
  } catch (err) {
    console.warn(`  ⚠️ Não foi possível limpar o storage: ${(err as Error).message}`)
  }

  // Conta depois
  const after = {
    messages:        await prisma.message.count(),
    conversations:   await prisma.conversation.count(),
    contacts:        await prisma.contact.count(),
    cards:           await prisma.card.count(),
    columns:         await prisma.column.count(),
    boards:          await prisma.board.count(),
    cardComments:    await prisma.cardComment.count(),
    cardHistory:     await prisma.cardHistory.count(),
    tasks:           await prisma.task.count(),
    attachments:     await prisma.attachment.count(),
    aiLogs:          await prisma.aIExecutionLog.count(),
    memoryChunks:    await prisma.memoryChunk.count(),
    calendarEvents:  await prisma.calendarEvent.count(),
    eventLogs:       await prisma.eventLog.count(),
  }
  console.log('\nDepois:', after)
  console.log('\n✅ Wipe concluído. Reinicie a API para o sync recriar tudo do zero.\n')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())

import { prisma } from './prisma.js'
import argon2 from 'argon2'
import { DEFAULT_BOARD_COLUMNS } from '@aiwa/shared'

async function main() {
  console.log('🌱 Seeding...')

  const workspace = await prisma.workspace.upsert({
    where: { id: 'default-workspace' },
    update: {},
    create: { id: 'default-workspace', name: 'Meu Workspace' },
  })

  const passwordHash = await argon2.hash('admin123456', {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  })

  const user = await prisma.user.upsert({
    where: { email: 'admin@aiwa.local' },
    update: {},
    create: {
      workspaceId: workspace.id,
      email: 'admin@aiwa.local',
      name: 'Admin',
      passwordHash,
      role: 'ADMIN',
    },
  })

  // Board padrão
  const existingBoard = await prisma.board.findFirst({ where: { workspaceId: workspace.id } })
  if (!existingBoard) {
    const board = await prisma.board.create({
      data: { workspaceId: workspace.id, name: 'Principal' },
    })
    for (const col of DEFAULT_BOARD_COLUMNS) {
      await prisma.column.create({ data: { boardId: board.id, ...col } })
    }
    console.log(`✅ Board criado: ${board.name}`)
  }

  // Agentes padrão
  const agents = [
    {
      name: 'Triagem',
      description: 'Classifica mensagens e identifica demandas',
      systemPrompt: `Você é um agente de triagem. Analise a mensagem e responda SOMENTE em JSON válido com este schema:
{
  "isDemand": boolean,
  "intent": "support" | "billing" | "sales" | "info" | "technical" | "other",
  "priority": "LOW" | "MEDIUM" | "HIGH" | "URGENT",
  "summary": "resumo curto em até 100 chars",
  "suggestedTitle": "título do card se for demanda",
  "checklist": ["item1", "item2"],
  "confidence": 0.0 a 1.0
}
Considere URGENT apenas para problemas de produção ou sistema fora do ar.`,
      model: 'gemini-1.5-flash',
      provider: 'gemini',
      temperature: 0.3,
    },
    {
      name: 'Sugestão de Resposta',
      description: 'Sugere respostas para mensagens recebidas',
      systemPrompt: `Você é um assistente que sugere respostas profissionais e cordiais.
Dado o histórico da conversa e a última mensagem, sugira 2 opções de resposta curtas e diretas.
Responda em JSON: { "suggestions": ["opção 1", "opção 2"] }`,
      model: 'gemini-1.5-flash',
      provider: 'gemini',
      temperature: 0.7,
    },
    {
      name: 'Resumidor',
      description: 'Resume conversas longas',
      systemPrompt: `Você é um resumidor. Dado o histórico de mensagens de uma conversa, produza um resumo conciso em 3-5 bullet points do que foi discutido, decisões tomadas e próximos passos (se houver).
Responda em JSON: { "summary": "texto", "bullets": ["item1", "item2"] }`,
      model: 'gemini-1.5-flash',
      provider: 'gemini',
      temperature: 0.4,
    },
  ]

  for (const agent of agents) {
    const existing = await prisma.agent.findFirst({
      where: { workspaceId: workspace.id, name: agent.name },
    })
    if (!existing) {
      await prisma.agent.create({ data: { workspaceId: workspace.id, ...agent } })
      console.log(`✅ Agente criado: ${agent.name}`)
    }
  }

  console.log(`\n✅ Seed concluído!`)
  console.log(`   Workspace: ${workspace.name} (${workspace.id})`)
  console.log(`   Admin: ${user.email} / senha: admin123456`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

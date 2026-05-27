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
      model: 'gemini-2.5-flash',
      provider: 'gemini',
      temperature: 0.3,
    },
    {
      name: 'Sugestão de Resposta',
      description: 'Sugere respostas para mensagens recebidas',
      systemPrompt: `Você é um assistente que sugere respostas profissionais e empáticas para mensagens de negócios.

Analise o histórico da conversa e a última mensagem, e sugira 3 opções de resposta.

Responda APENAS com um JSON válido:
{
  "suggestions": [
    { "label": string, "text": string },
    { "label": string, "text": string },
    { "label": string, "text": string }
  ]
}

Regras:
- label: rótulo curto descrevendo o tom (ex: "Formal", "Amigável", "Direto")
- text: a resposta completa, pronta para enviar
- Mantenha o idioma da conversa
- Seja conciso — respostas de 1 a 3 frases`,
      model: 'gemini-2.5-flash',
      provider: 'gemini',
      temperature: 0.7,
    },
    {
      name: 'Resumidor',
      description: 'Resume conversas longas',
      systemPrompt: `Você é um resumidor. Dado o histórico de mensagens de uma conversa, produza um resumo conciso em 3-5 bullet points do que foi discutido, decisões tomadas e próximos passos (se houver).
Responda em JSON: { "summary": "texto", "bullets": ["item1", "item2"] }`,
      model: 'gemini-2.5-flash',
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

  // ── Times padrão (setores) ────────────────────────────────────────────────
  // Cria um time "Geral" como fallback e modelos de Suporte/Vendas/Financeiro.
  // Quem não tem nenhum time hoje cai no Geral e o admin vai customizando.
  const defaultTeams = [
    { name: 'Geral',      slug: 'geral',      color: '#6366f1', icon: 'inbox',         description: 'Fila padrão para conversas sem setor definido.' },
    { name: 'Suporte',    slug: 'suporte',    color: '#0ea5e9', icon: 'headphones',    description: 'Atendimento de dúvidas técnicas e pós-venda.' },
    { name: 'Vendas',     slug: 'vendas',     color: '#10b981', icon: 'shopping-cart', description: 'Novos negócios e oportunidades comerciais.' },
    { name: 'Financeiro', slug: 'financeiro', color: '#f59e0b', icon: 'wallet',        description: 'Cobranças, pagamentos e questões financeiras.' },
  ]

  for (const t of defaultTeams) {
    const existing = await prisma.team.findFirst({
      where: { workspaceId: workspace.id, slug: t.slug },
    })
    if (!existing) {
      const team = await prisma.team.create({
        data: { workspaceId: workspace.id, ...t, distributionMode: 'all' },
      })
      // Admin entra como LEADER em todos por padrão
      await prisma.teamMembership.create({
        data: { teamId: team.id, userId: user.id, role: 'LEADER', isActive: true },
      })
      console.log(`✅ Time criado: ${team.name}`)
    }
  }

  // Garante que todos os usuários do workspace estão no time "Geral"
  const generalTeam = await prisma.team.findFirst({
    where: { workspaceId: workspace.id, slug: 'geral' },
  })
  if (generalTeam) {
    const allUsers = await prisma.user.findMany({
      where: { workspaceId: workspace.id, deletedAt: null },
      select: { id: true },
    })
    for (const u of allUsers) {
      await prisma.teamMembership.upsert({
        where: { teamId_userId: { teamId: generalTeam.id, userId: u.id } },
        update: {},
        create: { teamId: generalTeam.id, userId: u.id, role: 'AGENT', isActive: true },
      })
    }
  }

  console.log(`\n✅ Seed concluído!`)
  console.log(`   Workspace: ${workspace.name} (${workspace.id})`)
  console.log(`   Admin: ${user.email} / senha: admin123456`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

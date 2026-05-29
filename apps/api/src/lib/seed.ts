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

  // SystemSettings padrão (white-label) — evita 404/erro quando a UI consulta
  // /system-settings/public em um banco recém-criado.
  await prisma.systemSettings.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      systemTitle: 'AI Work Assistant',
      companyName: 'Minha Empresa',
      primaryColor: '#6366f1',
      secondaryColor: '#4f46e5',
    },
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
  // (Triagem foi removida — atendimento/triagem agora é feito pelos Flows.)
  const agents = [
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

  // Aponta as configurações do workspace para os agentes padrão (Configurações → IA),
  // sem sobrescrever escolhas já feitas pelo admin. Mapeia por nome → função.
  const wsRow = await prisma.workspace.findUnique({ where: { id: workspace.id }, select: { settings: true } })
  const wsSettings = (wsRow?.settings as Record<string, unknown> | null) ?? {}
  const findAgentId = async (contains: string[]) =>
    (await prisma.agent.findFirst({
      where: { workspaceId: workspace.id, OR: contains.map((n) => ({ name: { contains: n } })) },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    }))?.id
  const settingsPatch: Record<string, unknown> = {}
  if (!wsSettings.aiSuggestReplyAgentId) {
    const id = await findAgentId(['Sugest', 'sugest', 'reply'])
    if (id) settingsPatch.aiSuggestReplyAgentId = id
  }
  if (!wsSettings.aiDigestAgentId) {
    const id = await findAgentId(['Resumidor', 'digest', 'resumo'])
    if (id) settingsPatch.aiDigestAgentId = id
  }
  if (Object.keys(settingsPatch).length > 0) {
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { settings: { ...wsSettings, ...settingsPatch } as any },
    })
    console.log(`✅ Configurações de IA do workspace vinculadas aos agentes padrão`)
  }

  // ── Modelos de IA padrão ──────────────────────────────────────────────────
  // Recria os modelos que antes ficavam hardcoded no front. As keys de cada
  // provedor continuam sendo configuradas em Admin → Provedores de IA.
  const aiModels: Array<{
    provider: string; modelId: string; label: string; isDefault?: boolean
  }> = [
    // OpenRouter — gratuitos
    { provider: 'openrouter', modelId: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (Meta) — grátis' },
    { provider: 'openrouter', modelId: 'deepseek/deepseek-v4-flash:free',        label: 'DeepSeek V4 Flash — grátis' },
    { provider: 'openrouter', modelId: 'qwen/qwen3-coder:free',                  label: 'Qwen3 Coder — grátis' },
    { provider: 'openrouter', modelId: 'openai/gpt-oss-120b:free',               label: 'GPT-OSS 120B — grátis' },
    { provider: 'openrouter', modelId: 'z-ai/glm-4.5-air:free',                  label: 'GLM 4.5 Air — grátis' },
    // OpenRouter — pagos
    { provider: 'openrouter', modelId: 'openai/gpt-4o-mini',           label: 'GPT-4o Mini (OpenAI)' },
    { provider: 'openrouter', modelId: 'openai/gpt-4o',               label: 'GPT-4o (OpenAI)' },
    { provider: 'openrouter', modelId: 'anthropic/claude-3.5-haiku',  label: 'Claude 3.5 Haiku (Anthropic)' },
    { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6 (Anthropic)' },
    { provider: 'openrouter', modelId: 'google/gemini-2.5-pro',       label: 'Gemini 2.5 Pro (Google)' },
    // Gemini direto
    { provider: 'gemini', modelId: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash', isDefault: true },
    { provider: 'gemini', modelId: 'gemini-2.5-pro',        label: 'Gemini 2.5 Pro' },
    { provider: 'gemini', modelId: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' },
  ]

  // Garante a existência das configs de provedor (FK) — sem key ainda.
  for (const provider of ['gemini', 'openrouter'] as const) {
    await prisma.aiProviderConfig.upsert({
      where: { provider },
      update: {},
      create: { provider, enabled: false },
    })
  }

  for (const m of aiModels) {
    const { isDefault, ...rest } = m
    await prisma.aiModel.upsert({
      where: { provider_modelId: { provider: m.provider, modelId: m.modelId } },
      update: {},
      create: { ...rest, isDefault: isDefault ?? false },
    })
  }
  console.log(`✅ ${aiModels.length} modelos de IA semeados`)

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

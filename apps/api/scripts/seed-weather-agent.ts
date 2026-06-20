/**
 * Cria (ou atualiza) um agente de IA dedicado ao recado de bom dia com o clima,
 * e re-aponta o nó `ai_generate` do fluxo "Bom dia com o clima (cron)" para ele.
 *
 * Idempotente. Uso (na raiz do repo):
 *   pnpm --filter api seed:weather-agent
 */
import { prisma } from '../src/lib/prisma.js'

const AGENT_NAME = 'Recado Bom Dia (clima)'
const FLOW_NAME = 'Exemplo: Bom dia com o clima (cron)'

const SYSTEM_PROMPT = `Você escreve UMA saudação curta de bom dia em português do Brasil, calorosa e natural.
Regras:
- Receberá os dados de clima atuais (temperatura em °C e o weather_code WMO).
- Interprete o weather_code: 0 = céu limpo; 1-3 = parcialmente nublado; 45/48 = neblina; 51-67 = chuva/garoa; 71-77 = neve; 80-82 = pancadas de chuva; 95-99 = tempestade.
- Comente o tempo de forma amigável e dê UMA dica prática quando fizer sentido (ex: levar guarda-chuva se houver chuva, beber água se estiver quente, agasalho se estiver frio).
- No máximo 2 frases. Sem listas, sem markdown. No máximo 1 emoji, e só se combinar.
- Comece cumprimentando pelo nome quando ele for fornecido.`

async function main() {
  const ws = await prisma.workspace.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true } })
  if (!ws) { console.error('❌ Nenhum workspace encontrado.'); process.exit(1) }
  console.log(`🏢 Workspace: ${ws.name} (${ws.id})`)

  const existing = await prisma.agent.findFirst({
    where: { workspaceId: ws.id, name: AGENT_NAME },
    select: { id: true },
  })

  let agentId: string
  if (existing) {
    await prisma.agent.update({
      where: { id: existing.id },
      data: { systemPrompt: SYSTEM_PROMPT, provider: 'gemini', model: 'gemini-2.5-flash', temperature: 0.6, isActive: true },
    })
    agentId = existing.id
    console.log(`♻️  Agente atualizado: ${AGENT_NAME} (${agentId})`)
  } else {
    const created = await prisma.agent.create({
      data: {
        workspaceId: ws.id,
        name: AGENT_NAME,
        description: 'Monta o recado de bom dia interpretando o clima atual.',
        systemPrompt: SYSTEM_PROMPT,
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        temperature: 0.6,
        trigger: { type: 'manual' } as any, // usado via nó ai_generate; sem cron próprio
        enabledTools: [] as any,
        isActive: true,
      },
      select: { id: true },
    })
    agentId = created.id
    console.log(`✅ Agente criado: ${AGENT_NAME} (${agentId})`)
  }

  // Re-aponta o nó ai_generate do fluxo do clima para o novo agente.
  const flow = await prisma.flow.findFirst({
    where: { workspaceId: ws.id, name: FLOW_NAME },
    select: { id: true, graph: true, version: true },
  })
  if (!flow) {
    console.log(`ℹ️  Fluxo "${FLOW_NAME}" não encontrado — rode antes: pnpm --filter api seed:weather-flow`)
    return
  }
  const graph = flow.graph as any
  let touched = false
  for (const n of graph.nodes ?? []) {
    if (n.type === 'ai_generate') { n.data = { ...n.data, agentId }; touched = true }
  }
  if (touched) {
    await prisma.flow.update({ where: { id: flow.id }, data: { graph, version: flow.version + 1 } })
    console.log(`🔗 Nó de IA do fluxo apontado para o agente (${agentId}).`)
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1) })

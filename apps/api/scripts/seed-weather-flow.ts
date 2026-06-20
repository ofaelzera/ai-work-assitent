/**
 * Cria (ou atualiza) um fluxo PROATIVO de exemplo, disparado por CRON:
 *   start → http_request (clima, Open-Meteo) → ai_generate (IA monta o recado)
 *         → send_message (WhatsApp para um contato)
 *
 * Demonstra: trigger cron, runner proativo (sem conversa), http_request,
 * ai_generate e send_message. Usa a API pública Open-Meteo (sem API key).
 *
 * Criado INATIVO de propósito: edite o telefone de destino (nó "Enviar
 * mensagem") e o agente de IA no editor, depois PUBLIQUE para registrar o cron.
 * Para testar rápido, troque o schedule para "* /2 * * * *" (a cada 2 min).
 *
 * Uso (na raiz do repo):
 *   pnpm --filter api seed:weather-flow
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TEMPLATE FINANCEIRO (não criado aqui — monte no editor com estes nós):
 *   start
 *   → http_request  GET https://SEU-ERP/api/boletos?status=atrasado  (saveAs: 'fin')
 *   → set_variable  clientes = {{ fin.body.clientes }}
 *   → loop          itemsVar 'vars.clientes', itemVar 'cli'
 *        (corpo, saída 'loop'):
 *        → check_notified  matchBy 'to', value '{{cli.telefone}}', source 'cobranca', withinDays 2
 *             - 'notified'     → (nada; volta ao loop)
 *             - 'not_notified' → send_message WHATSAPP to '{{cli.telefone}}' source 'cobranca'
 *                                body 'Olá {{cli.nome}}, seu boleto vence em {{cli.vencimento}}...'
 *   O check_notified consulta CommMessage (source 'cobranca') e evita reenvio em 2 dias.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { prisma } from '../src/lib/prisma.js'

const FLOW_NAME = 'Exemplo: Bom dia com o clima (cron)'
// Latitude/longitude de São Paulo — ajuste para sua cidade.
const WEATHER_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=-23.55&longitude=-46.63&current=temperature_2m,weather_code'

function buildGraph(agentId: string) {
  return {
    nodes: [
      { id: 'start', type: 'start', position: { x: 300, y: 0 }, data: {} },
      {
        id: 'http_weather',
        type: 'http_request',
        position: { x: 280, y: 110 },
        data: { method: 'GET', url: WEATHER_URL, headers: {}, query: {}, saveAs: 'weather', timeoutMs: 10000, onError: 'handle' },
      },
      {
        id: 'ai_msg',
        type: 'ai_generate',
        position: { x: 285, y: 240 },
        data: {
          agentId, // se vazio, usa systemPrompt + provider padrão
          systemPrompt:
            'Você é um assistente que escreve uma saudação curta de bom dia em português do Brasil, comentando o clima de forma amigável e dando uma dica prática (ex: levar guarda-chuva se chover). Máximo 2 frases. Não use emojis em excesso.',
          promptTemplate:
            'Clima atual (Open-Meteo, weather_code WMO): {{weather.body.current}}. Escreva o recado de bom dia para Rafael.',
          saveAs: 'aiText',
        },
      },
      {
        id: 'send_wa',
        type: 'send_message',
        position: { x: 290, y: 370 },
        data: {
          channelType: 'WHATSAPP',
          // Responde na conversa quando disparado por mensagem/roteamento;
          // em cron (sem conversa) cai para o número fixo `to` abaixo.
          toMode: 'conversation',
          to: '5544988283016', // ← número de destino no modo cron (DDI+DDD+número)
          body: '{{aiText}}',
          source: 'flow:bomdia',
        },
      },
      { id: 'end_ok', type: 'end', position: { x: 200, y: 500 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'http_weather', sourceHandle: null },
      { id: 'e2', source: 'http_weather', target: 'ai_msg', sourceHandle: 'success' },
      { id: 'e3', source: 'ai_msg', target: 'send_wa', sourceHandle: null },
      { id: 'e4', source: 'send_wa', target: 'end_ok', sourceHandle: 'success' },
    ],
  }
}

const trigger = { type: 'cron' as const, schedule: '0 9 * * *' } // 09:00 UTC ~ 06:00 BRT

async function main() {
  const wsArg = process.argv[2]
  const ws = wsArg
    ? await prisma.workspace.findUnique({ where: { id: wsArg }, select: { id: true, name: true } })
    : await prisma.workspace.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true } })
  if (!ws) {
    console.error('❌ Nenhum workspace encontrado. Rode o seed principal antes.')
    process.exit(1)
  }
  console.log(`🏢 Workspace: ${ws.name} (${ws.id})`)

  // Tenta achar um agente ativo para o nó de IA (senão usa systemPrompt + provider padrão).
  const agent = await prisma.agent.findFirst({
    where: { workspaceId: ws.id, isActive: true },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  })
  if (agent) console.log(`🤖 Agente para o nó de IA: ${agent.name} (${agent.id})`)
  else console.log('🤖 Nenhum agente ativo — nó de IA usará systemPrompt + provider padrão.')

  const graph = buildGraph(agent?.id ?? '')

  const existing = await prisma.flow.findFirst({
    where: { workspaceId: ws.id, name: FLOW_NAME },
    select: { id: true, version: true },
  })

  if (existing) {
    await prisma.flow.update({
      where: { id: existing.id },
      data: { graph: graph as any, trigger: trigger as any, version: existing.version + 1 },
    })
    console.log(`♻️  Fluxo atualizado: ${FLOW_NAME} (${existing.id})`)
  } else {
    const created = await prisma.flow.create({
      data: {
        workspaceId: ws.id,
        name: FLOW_NAME,
        description: 'Cron diário: consulta o clima, IA monta o recado e envia no WhatsApp.',
        graph: graph as any,
        trigger: trigger as any,
        isActive: false, // criado inativo: edite o telefone e publique para registrar o cron
        priority: 100,
      },
      select: { id: true },
    })
    console.log(`✅ Fluxo criado (INATIVO): ${FLOW_NAME} (${created.id})`)
  }

  console.log('\n👉 No editor: ajuste o telefone no nó "Enviar mensagem" e (opcional) o agente de IA.')
  console.log('👉 Para testar agora: troque o schedule para "*/2 * * * *" e PUBLIQUE. Aguarde ~2 min.')
  console.log('👉 Confira AIExecutionLog (geração) e a Central de Comunicação / CommMessage (envio).')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })

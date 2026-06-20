/**
 * Cria (ou atualiza) um fluxo de EXEMPLO que demonstra os nós novos:
 *   start → message → input → http_request → (success|error) → message → end
 *
 * O exemplo pede um CEP no WhatsApp, consulta a API pública ViaCEP e responde
 * o endereço — exercitando captura validada, requisição HTTP, interpolação
 * {{...}} e a ramificação success/error.
 *
 * Idempotente: roda quantas vezes quiser (procura pelo nome e atualiza o grafo).
 * Trigger = manual: NÃO dispara sozinho; teste pelo botão de run / POST /flows/:id/run.
 *
 * Uso (na raiz do repo):
 *   pnpm --filter api exec dotenv -e ../../.env -- tsx scripts/seed-example-flow.ts
 */
import { prisma } from '../src/lib/prisma.js'

const FLOW_NAME = 'Exemplo: Consulta de CEP'

const graph = {
  nodes: [
    { id: 'start', type: 'start', position: { x: 300, y: 0 }, data: {} },
    {
      id: 'msg_welcome',
      type: 'message',
      position: { x: 280, y: 110 },
      data: { text: 'Olá! 👋 Me informe um CEP que eu consulto o endereço pra você.' },
    },
    {
      id: 'input_cep',
      type: 'input',
      position: { x: 290, y: 230 },
      data: {
        prompt: 'Digite o CEP (somente números, ex: 01310100):',
        varName: 'cep',
        inputType: 'text',
        retryMessage: '❌ Não entendi. Envie o CEP com 8 dígitos.',
        maxRetries: 2,
      },
    },
    {
      id: 'http_cep',
      type: 'http_request',
      position: { x: 285, y: 360 },
      data: {
        method: 'GET',
        url: 'https://viacep.com.br/ws/{{vars.cep}}/json/',
        headers: {},
        query: {},
        saveAs: 'via',
        timeoutMs: 10000,
        onError: 'handle',
      },
    },
    {
      id: 'msg_ok',
      type: 'message',
      position: { x: 120, y: 480 },
      data: {
        text: '📍 Encontrei!\nLogradouro: {{via.body.logradouro}}\nBairro: {{via.body.bairro}}\nCidade: {{via.body.localidade}} - {{via.body.uf}}',
      },
    },
    {
      id: 'msg_err',
      type: 'message',
      position: { x: 460, y: 480 },
      data: { text: '❌ Não consegui consultar esse CEP. Confira e tente novamente.' },
    },
    {
      id: 'menu_again',
      type: 'menu',
      position: { x: 285, y: 600 },
      data: {
        prompt: 'Deseja consultar outro CEP?',
        options: [
          { value: '1', label: '1️⃣ Sim, consultar outro' },
          { value: '2', label: '2️⃣ Não, encerrar' },
        ],
        timeoutMin: 0,
      },
    },
    {
      id: 'close_conv',
      type: 'close_conversation',
      position: { x: 300, y: 740 },
      data: {
        closingMessage: 'Atendimento finalizado. Sempre que precisar, é só chamar! 👋',
        finalizerLabel: 'Autoatendimento',
      },
    },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'msg_welcome', sourceHandle: null },
    { id: 'e2', source: 'msg_welcome', target: 'input_cep', sourceHandle: null },
    { id: 'e3', source: 'input_cep', target: 'http_cep', sourceHandle: null },
    { id: 'e4', source: 'http_cep', target: 'msg_ok', sourceHandle: 'success' },
    { id: 'e5', source: 'http_cep', target: 'msg_err', sourceHandle: 'error' },
    { id: 'e6', source: 'msg_ok', target: 'menu_again', sourceHandle: null },
    { id: 'e7', source: 'msg_err', target: 'menu_again', sourceHandle: null },
    // Loop: "Sim" volta a pedir o CEP; "Não" finaliza o atendimento.
    { id: 'e8', source: 'menu_again', target: 'input_cep', sourceHandle: '1' },
    { id: 'e9', source: 'menu_again', target: 'close_conv', sourceHandle: '2' },
  ],
}

const trigger = { type: 'manual' as const }

async function main() {
  // Workspace alvo: 1º argumento, ou o primeiro workspace do banco.
  const wsArg = process.argv[2]
  const ws = wsArg
    ? await prisma.workspace.findUnique({ where: { id: wsArg }, select: { id: true, name: true } })
    : await prisma.workspace.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true } })

  if (!ws) {
    console.error('❌ Nenhum workspace encontrado. Rode o seed principal antes (pnpm --filter api db:seed).')
    process.exit(1)
  }
  console.log(`🏢 Workspace: ${ws.name} (${ws.id})`)

  const existing = await prisma.flow.findFirst({
    where: { workspaceId: ws.id, name: FLOW_NAME },
    select: { id: true, version: true },
  })

  if (existing) {
    await prisma.flow.update({
      where: { id: existing.id },
      data: { graph: graph as any, trigger: trigger as any, isActive: true, version: existing.version + 1 },
    })
    console.log(`♻️  Fluxo atualizado: ${FLOW_NAME} (${existing.id})`)
  } else {
    const created = await prisma.flow.create({
      data: {
        workspaceId: ws.id,
        name: FLOW_NAME,
        description: 'Demo dos nós novos: input + http_request (ViaCEP) + interpolação + success/error.',
        graph: graph as any,
        trigger: trigger as any,
        isActive: true,
        priority: 100,
      },
      select: { id: true },
    })
    console.log(`✅ Fluxo criado: ${FLOW_NAME} (${created.id})`)
  }

  console.log('\n👉 Abra em /admin/flows, clique pra editar e veja o grafo montado.')
  console.log('👉 Para testar: rode manualmente numa conversa (POST /flows/:id/run) e responda com um CEP no WhatsApp.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })

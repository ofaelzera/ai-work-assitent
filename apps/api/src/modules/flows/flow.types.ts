/**
 * Tipos do Flow Engine — formato declarativo do grafo.
 *
 * O grafo é { nodes, edges } compatível com o que a UI react-flow produz.
 * Cada nó tem `type`, `data` (props específicas do tipo) e `position` (UI).
 * As edges podem ter `sourceHandle` quando o nó tem múltiplas saídas
 * (ex: menu: cada opção é um handle; condition: 'true' / 'false').
 */

export type FlowNodeType =
  | 'start'
  | 'message'
  | 'menu'
  | 'condition'
  | 'assign_team'
  | 'assign_user'
  | 'start_bot'
  | 'wait_for_human'
  | 'tag'
  | 'end'
  // ── Agenda ──
  | 'check_company_hours'
  | 'check_user_available'
  | 'find_free_slots'
  | 'create_appointment'
  // ── Conversa rica ──
  | 'input'
  // ── Integrações ──
  | 'http_request'
  // ── Lógica avançada ──
  | 'set_variable'
  | 'code'
  | 'switch'
  | 'loop'
  // ── Reuso ──
  | 'call_flow'
  // ── Encerramento ──
  | 'close_conversation'
  // ── Proativo (cron) ──
  | 'ai_generate'
  | 'send_message'
  | 'check_notified'

export interface FlowNodeBase<T extends FlowNodeType, D> {
  id: string
  type: T
  position?: { x: number; y: number }
  data: D
}

export interface MessageNodeData {
  text: string
  /** Atalho: quando true, interpola {{cliente}}, {{empresa}}, {{atendente}}. Default true. */
  interpolate?: boolean
}

export interface MenuOption {
  /** Chave que casa com sourceHandle das edges (ex: "1", "2", "comprar") */
  value: string
  /** O que aparece pro cliente (ex: "1️⃣ Suporte técnico") */
  label: string
}

export interface MenuNodeData {
  /** Texto do menu (apresentação + lista de opções) */
  prompt: string
  options: MenuOption[]
  /** Tempo máximo em minutos pra cliente responder. 0 = infinito. Default 0. */
  timeoutMin?: number
  /** sourceHandle a seguir se timeout. Default: 'timeout' */
  timeoutHandle?: string
  /** Quando true, aceita resposta livre que case com option.label (case-insensitive). Default true. */
  acceptLabelMatch?: boolean
}

export interface ConditionNodeData {
  /**
   * Expressão simples avaliada sobre o contexto.
   * Formato: { field, op, value }
   *   field: 'context.<key>' | 'contact.companyId' | 'contact.name' | 'contact.tags' | 'conv.isGroup'
   *   op:    'eq' | 'neq' | 'contains' | 'in' | 'gt' | 'lt' | 'exists' | 'matches_regex'
   *   value: any (depende do op)
   * Resultado vai por sourceHandle 'true' ou 'false'.
   */
  field: string
  op: 'eq' | 'neq' | 'contains' | 'in' | 'gt' | 'lt' | 'exists' | 'matches_regex'
  value?: unknown
}

export interface AssignTeamNodeData {
  teamId: string
  /** Opcional: nota anexada à transferência. */
  note?: string
}

export interface AssignUserNodeData {
  userId: string
  note?: string
}

export interface StartBotNodeData {
  agentId: string
  /** Quando true, aguarda o cliente responder antes de seguir a próxima edge. Default false. */
  awaitReply?: boolean
  /** Teto de turnos da conversa multi-turno antes de avançar à força. Default 6. */
  maxTurns?: number
}

export interface WaitForHumanNodeData {
  /** Time pra entrar na fila enquanto aguarda. null = fila do team atual da conv. */
  teamId?: string | null
}

export interface TagNodeData {
  /** Adiciona em Conversation.tags */
  conversationTags?: string[]
  /** Adiciona em Contact.metadata.tags */
  contactTags?: string[]
}

/**
 * Nós de agenda.
 *
 * `check_*` ramificam por sourceHandle 'true' / 'false'.
 * `find_free_slots` ramifica 'true' (achou) / 'false' (nada livre) e grava em
 *   ctx.vars: `freeSlots` (ISO[]), `freeSlotsText` (lista legível), `freeSlot` (1º).
 * `create_appointment` cria CalendarEvent na agenda do dono; usa
 *   ctx.vars.freeSlot (ou data.startVar) como início. Avança pela saída default.
 */
export interface CheckUserAvailableNodeData {
  /** ID do usuário cuja disponibilidade será checada. */
  userId: string
}

export interface FindFreeSlotsNodeData {
  userId: string
  /** Duração de cada slot em minutos. Default 30. */
  durationMin?: number
  /** Janela de busca a partir de hoje, em dias. Default 7. */
  daysAhead?: number
  /** Máximo de slots listados em freeSlotsText. Default 5. */
  maxSlots?: number
}

export interface CreateAppointmentNodeData {
  /** Dono do evento (agenda). */
  ownerId: string
  /** Título do compromisso. Suporta interpolação {{cliente}} etc. */
  title: string
  /** Duração em minutos. Default 30. */
  durationMin?: number
  /** Chave em ctx.vars com o início (ISO). Default 'freeSlot'. */
  startVar?: string
  /** Vincula o evento à conversa/contato atual. Default true. */
  linkToConversation?: boolean
}

/**
 * Política de erro/retry comum a nós com efeito colateral (http_request, code,
 * call_flow). Lida pelo loop de `runFlow`.
 *  - 'fail'     (default): erro derruba a execução (status FAILED)
 *  - 'continue': loga e avança pela saída default
 *  - 'handle':   avança pela saída 'error'
 */
export interface NodeErrorPolicy {
  retry?: { max: number; delayMs?: number }
  onError?: 'fail' | 'continue' | 'handle'
}

/** Nó de captura validada (estilo input block do Typebot). */
export interface InputNodeData extends NodeErrorPolicy {
  /** Pergunta enviada ao cliente. Suporta {{...}}. */
  prompt: string
  /** Nome da variável em ctx.vars onde o valor validado é gravado. */
  varName: string
  inputType?: 'text' | 'number' | 'email' | 'phone' | 'date' | 'url'
  /** Mensagem reenviada quando o valor é inválido. */
  retryMessage?: string
  /** Tentativas extras antes de seguir a saída 'invalid'. Default 2. */
  maxRetries?: number
}

/** Nó de requisição HTTP a serviço externo (estilo n8n HTTP Request). */
export interface HttpRequestNodeData extends NodeErrorPolicy {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** URL — suporta {{...}}. */
  url: string
  headers?: Record<string, string>
  query?: Record<string, string>
  /** Corpo (objeto ou string); valores de string passam por {{...}}. */
  body?: unknown
  /** Onde gravar a resposta em ctx.vars: { status, body }. Default 'http'. */
  saveAs?: string
  /** Timeout em ms. Default 10000, teto 30000. */
  timeoutMs?: number
}

/** Nó de atribuição de variáveis. */
export interface SetVariableNodeData {
  assignments: Array<{
    varName: string
    /** Expressão {{...}} OU literal. Se for {{...}} puro, preserva o tipo. */
    valueExpr: string
  }>
}

/** Nó de código JS em sandbox (node:vm). */
export interface CodeNodeData extends NodeErrorPolicy {
  /** Código JS. Recebe `vars` (cópia) e deve `return` um objeto. */
  code: string
  /** Se definido, grava o retorno em ctx.vars[saveAs]; senão mescla em vars. */
  saveAs?: string
  /** Timeout do sandbox em ms. Default 1000, teto 5000. */
  timeoutMs?: number
}

/** Nó switch — múltiplas cláusulas, cada uma com seu sourceHandle. */
export interface SwitchNodeData {
  clauses: Array<{
    handle: string
    field: string
    op: ConditionNodeData['op']
    value?: unknown
  }>
  /** sourceHandle quando nenhuma cláusula casa. Default 'default'. */
  defaultHandle?: string
}

/** Nó loop — itera sobre um array em ctx.vars executando a sub-cadeia. */
export interface LoopNodeData {
  /** Caminho do array (ex: 'vars.items' ou 'items'). */
  itemsVar: string
  /** Nome da var que recebe o item atual em cada iteração. Default 'item'. */
  itemVar?: string
  /** Teto de iterações (proteção). Default 100. */
  maxIterations?: number
}

/**
 * Nó que finaliza o atendimento (status RESOLVED). Registra no audit/timeline
 * que o encerramento foi automático (autoatendimento), sem atendente humano.
 * Como o ingest só reaproveita conversas OPEN/WAITING, a próxima mensagem do
 * cliente cria uma conversa nova e reinicia o fluxo automaticamente.
 */
export interface CloseConversationNodeData {
  /** Mensagem de despedida enviada antes de finalizar. Suporta {{...}}. */
  closingMessage?: string
  /** Rótulo de quem finalizou (timeline/audit). Default 'Autoatendimento'. */
  finalizerLabel?: string
}

/**
 * Nó que gera texto com um agente de IA SEM enviar para conversa — grava o
 * resultado em ctx.vars. Útil em fluxos proativos (cron): ex. interpretar
 * dados de uma API e montar a mensagem a enviar. Puro (não usa conversa).
 */
export interface AiGenerateNodeData extends NodeErrorPolicy {
  /** Agente cujo systemPrompt/model/provider serão usados (opcional). */
  agentId?: string
  /** Override do system prompt (se não usar agentId). */
  systemPrompt?: string
  /** Prompt do usuário — suporta {{...}} (ex: dados de http). */
  promptTemplate: string
  /** Var em ctx.vars onde o texto gerado é gravado. Default 'aiText'. */
  saveAs?: string
  provider?: string
  model?: string
}

/**
 * Nó de envio PROATIVO (WhatsApp/Email) via enqueueMessage — não exige conversa.
 * Ramifica 'success' (enfileirado) / 'error'. Todos os campos passam por {{...}}.
 */
export interface SendMessageNodeData extends NodeErrorPolicy {
  channelType: 'WHATSAPP' | 'EMAIL'
  /**
   * 'fixed' (default): envia para `to` via enqueueMessage (proativo/cron).
   * 'conversation': responde na conversa atual (sendSystemMessage). Se não
   * houver conversa (ex: cron), cai para `to`.
   */
  toMode?: 'fixed' | 'conversation'
  /** Destinatário: telefone (WhatsApp) ou email. */
  to: string
  /** Assunto (email). */
  subject?: string
  /** Corpo da mensagem. */
  body: string
  /** Contato vinculado (para histórico/dedup). Opcional. */
  contactId?: string
  /** Canal específico; vazio = auto-resolve o primeiro conectado do tipo. */
  channelId?: string
  /** Marca a origem (usado pelo check_notified). Default 'flow'. */
  source?: string
}

/**
 * Nó de dedup: ramifica conforme já houve envio recente para o destinatário.
 * Consulta CommMessage (status SENT, mesmo source, dentro de withinDays).
 * Saídas: 'notified' (já notificado) / 'not_notified'.
 */
export interface CheckNotifiedNodeData {
  /** Casa por contactId ou pelo destinatário cru (to). */
  matchBy: 'contactId' | 'to'
  /** Valor a casar — suporta {{...}}. */
  value: string
  /** Mesmo `source` usado no send_message. */
  source: string
  /** Janela em dias. Default 2. */
  withinDays?: number
}

/** Nó que chama outro fluxo como sub-rotina. */
export interface CallFlowNodeData extends NodeErrorPolicy {
  flowId: string
  /** Mapeia vars do pai → vars do filho: { childVar: 'parentExpr' }. */
  inputMapping?: Record<string, string>
  /** Mapeia vars do filho → vars do pai: { parentVar: 'childVar' }. */
  outputMapping?: Record<string, string>
}

export type FlowNode =
  | FlowNodeBase<'start', Record<string, never>>
  | FlowNodeBase<'message', MessageNodeData>
  | FlowNodeBase<'menu', MenuNodeData>
  | FlowNodeBase<'condition', ConditionNodeData>
  | FlowNodeBase<'assign_team', AssignTeamNodeData>
  | FlowNodeBase<'assign_user', AssignUserNodeData>
  | FlowNodeBase<'start_bot', StartBotNodeData>
  | FlowNodeBase<'wait_for_human', WaitForHumanNodeData>
  | FlowNodeBase<'tag', TagNodeData>
  | FlowNodeBase<'end', Record<string, never>>
  | FlowNodeBase<'check_company_hours', Record<string, never>>
  | FlowNodeBase<'check_user_available', CheckUserAvailableNodeData>
  | FlowNodeBase<'find_free_slots', FindFreeSlotsNodeData>
  | FlowNodeBase<'create_appointment', CreateAppointmentNodeData>
  | FlowNodeBase<'input', InputNodeData>
  | FlowNodeBase<'http_request', HttpRequestNodeData>
  | FlowNodeBase<'set_variable', SetVariableNodeData>
  | FlowNodeBase<'code', CodeNodeData>
  | FlowNodeBase<'switch', SwitchNodeData>
  | FlowNodeBase<'loop', LoopNodeData>
  | FlowNodeBase<'call_flow', CallFlowNodeData>
  | FlowNodeBase<'close_conversation', CloseConversationNodeData>
  | FlowNodeBase<'ai_generate', AiGenerateNodeData>
  | FlowNodeBase<'send_message', SendMessageNodeData>
  | FlowNodeBase<'check_notified', CheckNotifiedNodeData>

export interface FlowEdge {
  id: string
  source: string
  target: string
  /** Define qual saída do nó usar (ex: option.value, 'true'|'false'). null = saída default. */
  sourceHandle?: string | null
}

export interface FlowGraph {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export interface FlowTrigger {
  type: 'new_conversation' | 'message_received' | 'manual' | 'webhook' | 'cron'
  filters?: {
    channelIds?: string[]
    channelTypes?: string[]
    keywordsAny?: string[]
    companyIds?: string[]
  }
  /** Token secreto para o endpoint POST /flows/:id/webhook/:token (type 'webhook'). */
  webhookToken?: string
  /** Padrão cron para type 'cron'. Ex: '0 9 * * *'. Interpretado no fuso `scheduleTz`. */
  schedule?: string
  /** Fuso em que o cron é interpretado. Default 'America/Sao_Paulo'. */
  scheduleTz?: string
}

export interface FlowContext {
  /** Última resposta do cliente capturada por menu/condition. */
  lastUserInput?: string
  /** Resposta do último menu (opção escolhida). */
  lastMenuChoice?: string
  /** Vars custom acumuladas. */
  vars: Record<string, unknown>
  /**
   * Qual nó pausou a execução e por quê. Usado pela retomada generalizada
   * (`handleIncomingFlowMessage`) pra despachar a mensagem do cliente ao
   * handler do tipo correto. Ausente quando a execução não está pausada.
   *  - 'menu':  nó menu aguardando escolha
   *  - 'input': nó input aguardando valor validado
   *  - 'bot':   nó start_bot (awaitReply) aguardando resposta multi-turno
   */
  waiting?: {
    nodeId: string
    kind: 'menu' | 'input' | 'bot'
    /** Tentativas já feitas (usado por input.maxRetries). */
    attempts?: number
  }
}

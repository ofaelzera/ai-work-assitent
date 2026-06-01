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
  type: 'new_conversation' | 'message_received' | 'manual'
  filters?: {
    channelIds?: string[]
    channelTypes?: string[]
    keywordsAny?: string[]
    companyIds?: string[]
  }
}

export interface FlowContext {
  /** Última resposta do cliente capturada por menu/condition. */
  lastUserInput?: string
  /** Resposta do último menu (opção escolhida). */
  lastMenuChoice?: string
  /** Vars custom acumuladas. */
  vars: Record<string, unknown>
}

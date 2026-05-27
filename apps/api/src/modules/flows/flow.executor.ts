/**
 * flow.executor.ts
 *
 * Runtime do Flow Engine. Interpreta o grafo declarativo e executa nó-a-nó
 * até bater num nó que precisa de input (menu), num assign final, ou em `end`.
 *
 * Semântica:
 *  - `runFlow({flowExecutionId})` — avança a execução do nó atual em diante
 *  - `handleIncomingMessage` — chamado quando uma mensagem do cliente chega
 *    em uma conv com FlowExecution.status='WAITING_INPUT': interpreta como
 *    resposta de menu/condition e retoma
 *  - `startFlowForConversation({flowId, conversationId})` — cria FlowExecution
 *    e dispara `runFlow`
 *
 * Cada nó é uma função `(ctx) → NodeResult`:
 *    { advance: true,  nextHandle?: string }  — segue pela edge (sourceHandle)
 *    { advance: false, status: 'WAITING_INPUT' | 'COMPLETED' | 'FAILED' }
 *
 * Side effects (sendText, assignTeam, etc) acontecem dentro do nó usando
 * helpers idempotentes — mesmo se o worker re-roda o job, não duplica.
 */
import { prisma } from '../../lib/prisma.js'
import { Prisma } from '@prisma/client'
import { logger } from '../../lib/logger.js'
import { eventBus } from '../../lib/eventBus.js'
import { sendSystemMessage, createInternalEvent } from '../../lib/systemMessages.js'
import { resolveTeamEligibility } from '../teams/teams.service.js'
import type {
  FlowEdge,
  FlowGraph,
  FlowNode,
  MenuNodeData,
  ConditionNodeData,
  AssignTeamNodeData,
  AssignUserNodeData,
  WaitForHumanNodeData,
  TagNodeData,
  MessageNodeData,
  FlowContext,
} from './flow.types.js'

interface RunFlowArgs {
  flowExecutionId: string
  /** Cap pra não loopar — máximo de nós que avançamos sem precisar de input. */
  maxSteps?: number
}

interface NodeAdvance {
  advance: true
  nextHandle?: string | null
}
interface NodePause {
  advance: false
  status: 'WAITING_INPUT' | 'COMPLETED' | 'FAILED'
  reason?: string
}
type NodeResult = NodeAdvance | NodePause

const MAX_STEPS_DEFAULT = 30

/**
 * Cria FlowExecution e roda até pausar/completar.
 */
export async function startFlowForConversation(args: {
  workspaceId: string
  flowId: string
  conversationId: string
  initialContext?: Partial<FlowContext>
}) {
  const { workspaceId, flowId, conversationId } = args

  // Evita iniciar duas execuções concorrentes pro mesmo par flow/conv
  const existing = await prisma.flowExecution.findFirst({
    where: {
      flowId,
      conversationId,
      status: { in: ['RUNNING', 'WAITING_INPUT'] },
    },
    select: { id: true, status: true },
  })
  if (existing) {
    logger.info({ flowId, conversationId, existingId: existing.id }, 'Flow já em execução, ignora start')
    return existing
  }

  const flow = await prisma.flow.findFirst({
    where: { id: flowId, workspaceId, isActive: true },
    select: { id: true, graph: true },
  })
  if (!flow) {
    logger.warn({ flowId, workspaceId }, 'Flow não encontrado ou inativo')
    return null
  }

  const graph = flow.graph as unknown as FlowGraph
  const startNode = graph.nodes.find((n) => n.type === 'start')
  if (!startNode) {
    logger.error({ flowId }, 'Flow sem nó start — abortado')
    return null
  }

  const ctx: FlowContext = {
    vars: {},
    ...args.initialContext,
  }

  const exec = await prisma.flowExecution.create({
    data: {
      workspaceId,
      flowId,
      conversationId,
      currentNodeId: startNode.id,
      status: 'RUNNING',
      context: ctx as any,
      trace: [{ nodeId: startNode.id, at: new Date().toISOString() }] as any,
    },
  })

  await runFlow({ flowExecutionId: exec.id })
  return exec
}

/**
 * Executa a partir do `currentNodeId` (já gravado). Pode ser chamado:
 *  - na criação (após startFlowForConversation)
 *  - após receber resposta do cliente em menu (handleIncomingMessage)
 *  - retry por timeout etc
 */
export async function runFlow({ flowExecutionId, maxSteps = MAX_STEPS_DEFAULT }: RunFlowArgs) {
  const exec = await prisma.flowExecution.findUnique({
    where: { id: flowExecutionId },
    include: { flow: true, conversation: { select: { id: true, workspaceId: true } } },
  })
  if (!exec) return
  if (exec.status === 'COMPLETED' || exec.status === 'CANCELLED' || exec.status === 'FAILED') return

  const graph = exec.flow.graph as unknown as FlowGraph
  const ctx = ((exec.context as unknown) as FlowContext | null) ?? { vars: {} }
  const trace = Array.isArray(exec.trace) ? [...(exec.trace as any[])] : []

  let currentId: string | null = exec.currentNodeId
  let steps = 0
  let status: 'RUNNING' | 'WAITING_INPUT' | 'COMPLETED' | 'FAILED' | 'CANCELLED' = 'RUNNING'

  while (currentId && steps < maxSteps) {
    const node = graph.nodes.find((n) => n.id === currentId)
    if (!node) {
      logger.error({ flowExecutionId, nodeId: currentId }, 'Nó inexistente no grafo')
      status = 'FAILED'
      break
    }

    trace.push({ nodeId: node.id, type: node.type, at: new Date().toISOString() })
    const result = await executeNode(node, exec.conversation.id, exec.conversation.workspaceId, ctx)

    if (!result.advance) {
      status = result.status
      break
    }

    const nextId = pickNextNodeId(node.id, result.nextHandle ?? null, graph.edges)
    if (!nextId) {
      status = 'COMPLETED'
      currentId = null
      break
    }
    currentId = nextId
    steps += 1
  }

  if (steps >= maxSteps && status === 'RUNNING') {
    logger.warn({ flowExecutionId }, 'Flow atingiu maxSteps — pausando como FAILED')
    status = 'FAILED'
  }

  await prisma.flowExecution.update({
    where: { id: flowExecutionId },
    data: {
      currentNodeId: currentId,
      status,
      context: ctx as any,
      trace: trace as any,
      completedAt: status === 'COMPLETED' || status === 'FAILED' ? new Date() : null,
    },
  })
}

/**
 * Resposta de menu/condição. Chamado pelo worker de ingest quando uma msg INBOUND
 * chega numa conv com FlowExecution.status='WAITING_INPUT'.
 *
 * Resolve qual handle seguir baseado no input e retoma o flow.
 */
export async function handleIncomingFlowMessage(args: {
  conversationId: string
  messageBody: string
}) {
  const exec = await prisma.flowExecution.findFirst({
    where: { conversationId: args.conversationId, status: 'WAITING_INPUT' },
    include: { flow: true },
    orderBy: { startedAt: 'desc' },
  })
  if (!exec) return false

  const graph = exec.flow.graph as unknown as FlowGraph
  const node = graph.nodes.find((n) => n.id === exec.currentNodeId)
  if (!node || node.type !== 'menu') {
    // Só menu pausa em WAITING_INPUT; se chegou aqui é estado inconsistente
    logger.warn({ flowExecutionId: exec.id, nodeId: exec.currentNodeId }, 'Input recebido em estado não-menu — ignorado')
    return false
  }

  const menu = node.data as MenuNodeData
  const input = args.messageBody.trim()
  const inputLower = input.toLowerCase()

  // Tenta casar por value (exato) ou por label (case-insensitive, contém)
  let pickedHandle: string | null = null
  for (const opt of menu.options) {
    if (opt.value.toLowerCase() === inputLower) {
      pickedHandle = opt.value
      break
    }
  }
  if (!pickedHandle && menu.acceptLabelMatch !== false) {
    for (const opt of menu.options) {
      if (opt.label.toLowerCase().includes(inputLower) || inputLower.includes(opt.label.toLowerCase())) {
        pickedHandle = opt.value
        break
      }
    }
  }

  if (!pickedHandle) {
    // Resposta inválida — re-envia o menu uma vez (UX simples; sem retries)
    logger.info({ flowExecutionId: exec.id, input }, 'Resposta de menu não casou — re-apresenta')
    await sendSystemMessage({
      conversationId: args.conversationId,
      template: `❌ Opção inválida. Por favor, escolha uma das opções:\n\n${menu.prompt}`,
      kind: 'agent-welcome',
      userId: null,
    })
    return false
  }

  // Atualiza context com a escolha e avança
  const ctx = ((exec.context as unknown) as FlowContext | null) ?? { vars: {} }
  ctx.lastMenuChoice = pickedHandle
  ctx.lastUserInput = input

  const nextId = pickNextNodeId(node.id, pickedHandle, graph.edges)
  await prisma.flowExecution.update({
    where: { id: exec.id },
    data: {
      currentNodeId: nextId,
      context: ctx as any,
      status: nextId ? 'RUNNING' : 'COMPLETED',
    },
  })
  if (nextId) {
    await runFlow({ flowExecutionId: exec.id })
  }
  return true
}

/**
 * Cancela qualquer flow ativo da conversa (ex: humano assumiu e quer interromper).
 */
export async function cancelActiveFlows(conversationId: string, reason: string) {
  await prisma.flowExecution.updateMany({
    where: { conversationId, status: { in: ['RUNNING', 'WAITING_INPUT'] } },
    data: { status: 'CANCELLED', completedAt: new Date(), trace: { reason } as any },
  })
}

// ─── Execução de cada tipo de nó ─────────────────────────────────────────────

async function executeNode(
  node: FlowNode,
  conversationId: string,
  workspaceId: string,
  ctx: FlowContext,
): Promise<NodeResult> {
  switch (node.type) {
    case 'start':
      return { advance: true }

    case 'end':
      return { advance: false, status: 'COMPLETED' }

    case 'message': {
      const data = node.data as MessageNodeData
      await sendSystemMessage({
        conversationId,
        template: data.text,
        kind: 'agent-welcome',
        userId: null,
      })
      return { advance: true }
    }

    case 'menu': {
      const data = node.data as MenuNodeData
      const optionsText = data.options.map((o) => `${o.label}`).join('\n')
      await sendSystemMessage({
        conversationId,
        template: `${data.prompt}\n\n${optionsText}`,
        kind: 'agent-welcome',
        userId: null,
      })
      return { advance: false, status: 'WAITING_INPUT' }
    }

    case 'condition': {
      const data = node.data as ConditionNodeData
      const ok = await evaluateCondition(data, conversationId, ctx)
      return { advance: true, nextHandle: ok ? 'true' : 'false' }
    }

    case 'assign_team': {
      const data = node.data as AssignTeamNodeData
      const elig = await resolveTeamEligibility({ teamId: data.teamId })
      const eligible = elig.userIds.length > 0 ? elig.userIds : null
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          teamId: data.teamId,
          assigneeId: null,
          claimedAt: null,
          lastQueuedAt: new Date(),
          eligibleAssigneeIds: eligible ? (eligible as any) : Prisma.JsonNull,
        },
      })
      await prisma.conversationTransfer.create({
        data: {
          workspaceId,
          conversationId,
          toTeamId: data.teamId,
          kind: 'SYSTEM',
          reason: data.note ?? 'Flow: assign_team',
        },
      })
      const team = await prisma.team.findUnique({ where: { id: data.teamId }, select: { name: true } })
      await createInternalEvent({
        workspaceId,
        conversationId,
        kind: 'transfer',
        body: `Fluxo direcionou para o setor ${team?.name ?? data.teamId}`,
        meta: { toTeamId: data.teamId, source: 'flow' },
      })
      await eventBus.audit(workspaceId, 'conversation.transferred_team', {
        targetType: 'conversation',
        targetId: conversationId,
        payload: { toTeamId: data.teamId, source: 'flow' },
      })
      return { advance: true }
    }

    case 'assign_user': {
      const data = node.data as AssignUserNodeData
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          assigneeId: null,
          claimedAt: null,
          lastQueuedAt: new Date(),
          eligibleAssigneeIds: [data.userId] as any,
        },
      })
      await prisma.conversationTransfer.create({
        data: {
          workspaceId,
          conversationId,
          toUserId: data.userId,
          kind: 'SYSTEM',
          reason: data.note ?? 'Flow: assign_user',
        },
      })
      const user = await prisma.user.findUnique({ where: { id: data.userId }, select: { name: true, email: true } })
      const label = user?.name ?? user?.email ?? data.userId
      await createInternalEvent({
        workspaceId,
        conversationId,
        kind: 'transfer',
        body: `Fluxo direcionou para ${label}`,
        meta: { toUserId: data.userId, source: 'flow' },
      })
      return { advance: true }
    }

    case 'start_bot': {
      const data = node.data as any
      try {
        const lastMsg = await prisma.message.findFirst({
          where: { conversationId, direction: 'INBOUND' },
          orderBy: { receivedAt: 'desc' }
        })
        const text = lastMsg?.body ?? '(conversação iniciada)'
        
        const { runAgentWithTools } = await import('../ai/agents/runAgentWithTools.js')
        const res = await runAgentWithTools({
          workspaceId,
          agentId: data.agentId,
          userMessage: text,
          triggerEvent: { kind: 'flow', conversationId } as any
        })

        if (res.text && res.text.trim().length > 0) {
          await sendSystemMessage({
            conversationId,
            template: res.text,
            kind: 'agent-welcome',
            userId: null
          })
        }
      } catch (err) {
        logger.error({ err, agentId: data.agentId }, 'Erro ao executar agente no flow')
      }

      await eventBus.audit(workspaceId, 'flow.start_bot', {
        targetType: 'conversation', targetId: conversationId,
        payload: { agentId: data.agentId },
      })
      
      // Se awaitReply estivesse implementado, pausaria, mas por hora avançamos.
      return { advance: true }
    }

    case 'wait_for_human': {
      const data = node.data as WaitForHumanNodeData
      // Se forneceu teamId, garante que a conv está na fila desse team
      if (data.teamId) {
        const elig = await resolveTeamEligibility({ teamId: data.teamId })
        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            teamId: data.teamId,
            assigneeId: null,
            lastQueuedAt: new Date(),
            eligibleAssigneeIds: elig.userIds.length > 0 ? (elig.userIds as any) : Prisma.JsonNull,
          },
        })
      }
      // Encerra o flow — agora é humano
      return { advance: false, status: 'COMPLETED' }
    }

    case 'tag': {
      const data = node.data as TagNodeData
      if (data.conversationTags?.length) {
        const conv = await prisma.conversation.findUnique({
          where: { id: conversationId },
          select: { tags: true, contactId: true },
        })
        const existing = Array.isArray(conv?.tags) ? (conv!.tags as string[]) : []
        const merged = Array.from(new Set([...existing, ...data.conversationTags]))
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { tags: merged as any },
        })
        if (data.contactTags?.length && conv?.contactId) {
          const contact = await prisma.contact.findUnique({
            where: { id: conv.contactId },
            select: { metadata: true },
          })
          const meta = (contact?.metadata as Record<string, unknown> | null) ?? {}
          const existingTags = Array.isArray(meta.tags) ? (meta.tags as string[]) : []
          await prisma.contact.update({
            where: { id: conv.contactId },
            data: {
              metadata: {
                ...meta,
                tags: Array.from(new Set([...existingTags, ...data.contactTags])),
              } as any,
            },
          })
        }
      }
      return { advance: true }
    }

    default:
      logger.warn({ nodeType: (node as any).type }, 'Tipo de nó desconhecido — pulando')
      return { advance: true }
  }
}

function pickNextNodeId(fromNodeId: string, handle: string | null, edges: FlowEdge[]): string | null {
  // Procura edge com sourceHandle igual ao requerido; se handle null/undefined,
  // procura edge sem sourceHandle (saída default).
  const matchHandle = (e: FlowEdge) => {
    if (handle == null) return !e.sourceHandle
    return e.sourceHandle === handle
  }
  const found = edges.find((e) => e.source === fromNodeId && matchHandle(e))
  if (found) return found.target
  // Fallback: qualquer edge a partir desse nó (caso a UI não tenha gravado handles)
  const any = edges.find((e) => e.source === fromNodeId)
  return any?.target ?? null
}

async function evaluateCondition(
  data: ConditionNodeData,
  conversationId: string,
  ctx: FlowContext,
): Promise<boolean> {
  const value = await resolveFieldValue(data.field, conversationId, ctx)
  const target = data.value
  switch (data.op) {
    case 'eq':       return value === target
    case 'neq':      return value !== target
    case 'exists':   return value !== null && value !== undefined && value !== ''
    case 'contains': return String(value ?? '').toLowerCase().includes(String(target ?? '').toLowerCase())
    case 'in':       return Array.isArray(target) && (target as unknown[]).includes(value)
    case 'gt':       return typeof value === 'number' && typeof target === 'number' && value > target
    case 'lt':       return typeof value === 'number' && typeof target === 'number' && value < target
    case 'matches_regex': {
      try {
        return new RegExp(String(target)).test(String(value ?? ''))
      } catch {
        return false
      }
    }
    default:
      return false
  }
}

async function resolveFieldValue(field: string, conversationId: string, ctx: FlowContext): Promise<unknown> {
  if (field.startsWith('context.')) {
    const key = field.slice('context.'.length)
    if (key === 'lastUserInput') return ctx.lastUserInput
    if (key === 'lastMenuChoice') return ctx.lastMenuChoice
    return ctx.vars[key]
  }
  if (field.startsWith('contact.') || field.startsWith('conv.')) {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { contact: true },
    })
    if (!conv) return null
    if (field === 'conv.isGroup') return conv.isGroup
    if (field === 'contact.name') return conv.contact?.name ?? null
    if (field === 'contact.companyId') return conv.contact?.companyId ?? null
    if (field === 'contact.tags') {
      const meta = (conv.contact?.metadata as Record<string, unknown> | null) ?? {}
      return Array.isArray(meta.tags) ? meta.tags : []
    }
  }
  return null
}

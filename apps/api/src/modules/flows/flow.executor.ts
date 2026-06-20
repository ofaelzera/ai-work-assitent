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
import vm from 'node:vm'
import dns from 'node:dns/promises'
import net from 'node:net'
import axios from 'axios'
import { prisma } from '../../lib/prisma.js'
import { Prisma } from '@prisma/client'
import { logger } from '../../lib/logger.js'
import { eventBus } from '../../lib/eventBus.js'
import { sendSystemMessage, createInternalEvent } from '../../lib/systemMessages.js'
import { resolveTeamEligibility } from '../teams/teams.service.js'
import {
  isWithinCompanyHours,
  isWithinWorkingHours,
  findFreeSlots,
} from '../calendar/availability.service.js'
import { createCalendarEvent, CalendarConflictError } from '../calendar/calendar.service.js'
import { interpolate, resolveExpr, loadFlowScope, type FlowScope } from './expr.js'
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
  CheckUserAvailableNodeData,
  FindFreeSlotsNodeData,
  CreateAppointmentNodeData,
  StartBotNodeData,
  InputNodeData,
  HttpRequestNodeData,
  SetVariableNodeData,
  CodeNodeData,
  SwitchNodeData,
  LoopNodeData,
  CallFlowNodeData,
  CloseConversationNodeData,
  AiGenerateNodeData,
  SendMessageNodeData,
  CheckNotifiedNodeData,
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

  // Carrega o canal pra disponibilizar channelType no contexto (usado por
  // condições de horário/fora-do-expediente que variam por canal).
  const convForCtx = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { channel: { select: { type: true, label: true } } },
  })

  const ctx: FlowContext = {
    ...args.initialContext,
    vars: {
      ...(convForCtx?.channel
        ? { channelType: convForCtx.channel.type, channelLabel: convForCtx.channel.label }
        : {}),
      ...(args.initialContext?.vars ?? {}),
    },
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
  const scope = await loadFlowScope(exec.conversation.id, ctx)

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
    const result = await executeNodeWithPolicy(node, exec.conversation.id, exec.conversation.workspaceId, ctx, scope, graph)

    if (!result.advance) {
      status = result.status
      break
    }
    // Avançou: limpa qualquer marcação de espera anterior.
    if (ctx.waiting) delete ctx.waiting

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
  const ctxFull = ((exec.context as unknown) as FlowContext | null) ?? { vars: {} }
  const node = graph.nodes.find((n) => n.id === exec.currentNodeId)
  if (!node) {
    logger.warn({ flowExecutionId: exec.id, nodeId: exec.currentNodeId }, 'Nó atual inexistente — ignorado')
    return false
  }

  // Despacha pela razão da pausa (retomada generalizada). Fallback: o tipo do nó.
  const waitKind = ctxFull.waiting?.kind ?? (node.type === 'menu' ? 'menu' : null)

  if (waitKind === 'input') {
    return resumeInputNode(exec, node, ctxFull, graph, args)
  }
  if (waitKind === 'bot') {
    return resumeBotNode(exec, node, ctxFull, graph, args)
  }
  if (waitKind !== 'menu' || node.type !== 'menu') {
    logger.warn({ flowExecutionId: exec.id, nodeId: exec.currentNodeId, waitKind }, 'Input recebido em estado não-retomável — ignorado')
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
  const ctx = ctxFull
  ctx.lastMenuChoice = pickedHandle
  ctx.lastUserInput = input
  delete ctx.waiting

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

// ─── Retomada de nós que pausam (input, bot multi-turno) ─────────────────────

/**
 * Retoma um nó `input`: valida a resposta do cliente conforme `inputType`.
 * Em sucesso grava `ctx.vars[varName]` e avança pela saída default.
 * Em falha reenvia `retryMessage` até `maxRetries`; esgotado, segue handle 'invalid'.
 */
async function resumeInputNode(
  exec: { id: string },
  node: FlowNode,
  ctx: FlowContext,
  graph: FlowGraph,
  args: { conversationId: string; messageBody: string },
): Promise<boolean> {
  const data = node.data as InputNodeData
  const raw = args.messageBody.trim()
  const parsed = validateInput(raw, data.inputType ?? 'text')

  ctx.lastUserInput = raw

  if (parsed.ok) {
    ctx.vars[data.varName] = parsed.value
    delete ctx.waiting
    const nextId = pickNextNodeId(node.id, null, graph.edges)
    await prisma.flowExecution.update({
      where: { id: exec.id },
      data: { currentNodeId: nextId, context: ctx as any, status: nextId ? 'RUNNING' : 'COMPLETED' },
    })
    if (nextId) await runFlow({ flowExecutionId: exec.id })
    return true
  }

  // Inválido: conta tentativa
  const attempts = (ctx.waiting?.attempts ?? 0) + 1
  const maxRetries = data.maxRetries ?? 2
  if (attempts <= maxRetries) {
    ctx.waiting = { nodeId: node.id, kind: 'input', attempts }
    await prisma.flowExecution.update({ where: { id: exec.id }, data: { context: ctx as any } })
    await sendSystemMessage({
      conversationId: args.conversationId,
      template: data.retryMessage ?? '❌ Valor inválido, tente novamente.',
      kind: 'agent-welcome',
      userId: null,
    })
    return false
  }

  // Esgotou tentativas: segue saída 'invalid' (ou default se não houver)
  delete ctx.waiting
  const nextId = pickNextNodeId(node.id, 'invalid', graph.edges) ?? pickNextNodeId(node.id, null, graph.edges)
  await prisma.flowExecution.update({
    where: { id: exec.id },
    data: { currentNodeId: nextId, context: ctx as any, status: nextId ? 'RUNNING' : 'COMPLETED' },
  })
  if (nextId) await runFlow({ flowExecutionId: exec.id })
  return true
}

/**
 * Retoma um nó `start_bot` em modo awaitReply: realimenta a resposta do cliente
 * no agente. Continua aguardando se o agente devolver texto (pergunta); avança
 * quando o agente não retorna mais texto (encerrou) ou bate o teto de turnos.
 */
async function resumeBotNode(
  exec: { id: string; workspaceId: string },
  node: FlowNode,
  ctx: FlowContext,
  graph: FlowGraph,
  args: { conversationId: string; messageBody: string },
): Promise<boolean> {
  const data = node.data as StartBotNodeData & { maxTurns?: number }
  ctx.lastUserInput = args.messageBody.trim()
  const history = Array.isArray(ctx.vars._botHistory) ? (ctx.vars._botHistory as string[]) : []
  history.push(args.messageBody.trim())
  ctx.vars._botHistory = history
  const maxTurns = data.maxTurns ?? 6

  let advance = false
  try {
    const { runAgentWithTools } = await import('../ai/agents/runAgentWithTools.js')
    const res = await runAgentWithTools({
      workspaceId: exec.workspaceId,
      agentId: data.agentId,
      userMessage: args.messageBody.trim(),
      triggerEvent: { kind: 'flow', conversationId: args.conversationId } as any,
    })
    if (res.text && res.text.trim().length > 0 && history.length < maxTurns) {
      await sendSystemMessage({
        conversationId: args.conversationId,
        template: res.text,
        kind: 'agent-welcome',
        userId: null,
      })
    } else {
      advance = true
    }
  } catch (err) {
    logger.error({ err, agentId: data.agentId }, 'Erro ao retomar agente no flow')
    advance = true
  }

  if (!advance) {
    ctx.waiting = { nodeId: node.id, kind: 'bot' }
    await prisma.flowExecution.update({ where: { id: exec.id }, data: { context: ctx as any } })
    return false
  }

  delete ctx.waiting
  delete ctx.vars._botHistory
  const nextId = pickNextNodeId(node.id, null, graph.edges)
  await prisma.flowExecution.update({
    where: { id: exec.id },
    data: { currentNodeId: nextId, context: ctx as any, status: nextId ? 'RUNNING' : 'COMPLETED' },
  })
  if (nextId) await runFlow({ flowExecutionId: exec.id })
  return true
}

/** Valida/normaliza um valor de input conforme o tipo. */
function validateInput(
  raw: string,
  type: 'text' | 'number' | 'email' | 'phone' | 'date' | 'url',
): { ok: true; value: unknown } | { ok: false } {
  const v = raw.trim()
  if (!v) return { ok: false }
  switch (type) {
    case 'number': {
      const n = Number(v.replace(',', '.'))
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false }
    }
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? { ok: true, value: v } : { ok: false }
    case 'phone': {
      const digits = v.replace(/\D/g, '')
      return digits.length >= 8 ? { ok: true, value: digits } : { ok: false }
    }
    case 'date': {
      const d = new Date(v)
      return Number.isNaN(d.getTime()) ? { ok: false } : { ok: true, value: d.toISOString() }
    }
    case 'url':
      try {
        const u = new URL(v)
        return u.protocol === 'http:' || u.protocol === 'https:' ? { ok: true, value: v } : { ok: false }
      } catch {
        return { ok: false }
      }
    case 'text':
    default:
      return { ok: true, value: v }
  }
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

/**
 * Envelopa `executeNode` com a política de erro/retry do nó (Fase 4).
 * Nós sem `retry`/`onError` se comportam como antes (erro propaga = FAILED).
 */
async function executeNodeWithPolicy(
  node: FlowNode,
  conversationId: string,
  workspaceId: string,
  ctx: FlowContext,
  scope: FlowScope,
  graph: FlowGraph,
): Promise<NodeResult> {
  const policy = (node.data ?? {}) as { retry?: { max: number; delayMs?: number }; onError?: 'fail' | 'continue' | 'handle' }
  const maxAttempts = (policy.retry?.max ?? 0) + 1
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await executeNode(node, conversationId, workspaceId, ctx, scope, graph)
    } catch (err) {
      lastErr = err
      logger.warn({ err, nodeId: node.id, attempt }, 'Nó lançou erro')
      if (attempt < maxAttempts && policy.retry?.delayMs) {
        await new Promise((r) => setTimeout(r, policy.retry!.delayMs))
      }
    }
  }
  // Esgotou tentativas: aplica política
  const onError = policy.onError ?? 'fail'
  if (onError === 'continue') return { advance: true }
  if (onError === 'handle') return { advance: true, nextHandle: 'error' }
  logger.error({ err: lastErr, nodeId: node.id }, 'Nó falhou — execução abortada')
  return { advance: false, status: 'FAILED' }
}

async function executeNode(
  node: FlowNode,
  conversationId: string,
  workspaceId: string,
  ctx: FlowContext,
  scope: FlowScope,
  graph: FlowGraph,
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
        template: interpolate(data.text, scope),
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
        template: `${interpolate(data.prompt, scope)}\n\n${optionsText}`,
        kind: 'agent-welcome',
        userId: null,
      })
      ctx.waiting = { nodeId: node.id, kind: 'menu' }
      return { advance: false, status: 'WAITING_INPUT' }
    }

    case 'condition': {
      const data = node.data as ConditionNodeData
      const ok = evaluateCondition(data, scope)
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
      const data = node.data as StartBotNodeData
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

      // Modo multi-turno: pausa aguardando a resposta do cliente (retomado por resumeBotNode).
      if (data.awaitReply) {
        ctx.vars._botHistory = []
        ctx.waiting = { nodeId: node.id, kind: 'bot' }
        return { advance: false, status: 'WAITING_INPUT' }
      }
      return { advance: true }
    }

    case 'input': {
      const data = node.data as InputNodeData
      await sendSystemMessage({
        conversationId,
        template: interpolate(data.prompt, scope),
        kind: 'agent-welcome',
        userId: null,
      })
      ctx.waiting = { nodeId: node.id, kind: 'input', attempts: 0 }
      return { advance: false, status: 'WAITING_INPUT' }
    }

    case 'http_request':
      return executeHttpRequest(node.data as HttpRequestNodeData, ctx, scope)

    case 'set_variable': {
      const data = node.data as SetVariableNodeData
      for (const a of data.assignments ?? []) {
        ctx.vars[a.varName] = evalValueExpr(a.valueExpr, scope)
      }
      return { advance: true }
    }

    case 'code':
      return executeCodeNode(node.data as CodeNodeData, ctx)

    case 'switch': {
      const data = node.data as SwitchNodeData
      for (const c of data.clauses ?? []) {
        if (evaluateCondition({ field: c.field, op: c.op, value: c.value }, scope)) {
          return { advance: true, nextHandle: c.handle }
        }
      }
      return { advance: true, nextHandle: data.defaultHandle ?? 'default' }
    }

    case 'loop':
      return executeLoopNode(node, conversationId, workspaceId, ctx, scope, graph)

    case 'call_flow':
      return executeCallFlow(node.data as CallFlowNodeData, conversationId, workspaceId, ctx, scope)

    case 'close_conversation': {
      const data = node.data as CloseConversationNodeData
      const finalizer = data.finalizerLabel?.trim() || 'Autoatendimento'
      if (data.closingMessage?.trim()) {
        await sendSystemMessage({
          conversationId,
          template: interpolate(data.closingMessage, scope),
          kind: 'closing',
          userId: null,
        })
      }
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { status: 'RESOLVED', resolvedAt: new Date() },
      })
      await createInternalEvent({
        workspaceId,
        conversationId,
        kind: 'note',
        body: `Atendimento finalizado pelo ${finalizer}`,
        meta: { source: 'flow', finalizer, auto: true },
      })
      await eventBus.audit(workspaceId, 'conversation.status_changed', {
        targetType: 'conversation',
        targetId: conversationId,
        payload: { status: 'RESOLVED', source: 'flow', finalizer, auto: true },
      })
      // Encerrar o atendimento também encerra o fluxo.
      return { advance: false, status: 'COMPLETED' }
    }

    case 'ai_generate':
      return executeAiGenerate(node.data as AiGenerateNodeData, workspaceId, ctx, scope)

    case 'send_message':
      return executeSendMessage(node.data as SendMessageNodeData, workspaceId, conversationId, ctx, scope)

    case 'check_notified':
      return executeCheckNotified(node.data as CheckNotifiedNodeData, workspaceId, scope)

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

    case 'check_company_hours': {
      const open = await isWithinCompanyHours(workspaceId, new Date())
      return { advance: true, nextHandle: open ? 'true' : 'false' }
    }

    case 'check_user_available': {
      const data = node.data as CheckUserAvailableNodeData
      if (!data.userId) return { advance: true, nextHandle: 'false' }
      const available = await isWithinWorkingHours(workspaceId, data.userId, new Date())
      return { advance: true, nextHandle: available ? 'true' : 'false' }
    }

    case 'find_free_slots': {
      const data = node.data as FindFreeSlotsNodeData
      if (!data.userId) return { advance: true, nextHandle: 'false' }
      const durationMin = data.durationMin ?? 30
      const daysAhead = data.daysAhead ?? 7
      const maxSlots = data.maxSlots ?? 5
      const from = new Date()
      const to = new Date(from.getTime() + daysAhead * 24 * 60 * 60 * 1000)

      const slots = await findFreeSlots(workspaceId, data.userId, { from, to }, durationMin)
      const top = slots.slice(0, maxSlots)
      ctx.vars.freeSlots = top.map((s) => s.start.toISOString())
      ctx.vars.freeSlot = top[0]?.start.toISOString() ?? null
      ctx.vars.freeSlotsText = top
        .map((s, i) => {
          const d = s.start
          return `${i + 1}) ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
        })
        .join('\n')
      return { advance: true, nextHandle: top.length > 0 ? 'true' : 'false' }
    }

    case 'create_appointment': {
      const data = node.data as CreateAppointmentNodeData
      const startVar = data.startVar ?? 'freeSlot'
      const startIso = ctx.vars[startVar]
      if (typeof startIso !== 'string') {
        logger.warn({ startVar }, 'create_appointment sem horário no contexto — pulando')
        return { advance: true }
      }
      const durationMin = data.durationMin ?? 30
      const startAt = new Date(startIso)
      const endAt = new Date(startAt.getTime() + durationMin * 60_000)

      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { contactId: true },
      })
      const link = data.linkToConversation ?? true

      try {
        const event = await createCalendarEvent({
          workspaceId,
          ownerId: data.ownerId,
          accountId: 'auto',
          title: data.title || 'Compromisso',
          startAt,
          endAt,
          ...(link ? { conversationId, contactId: conv?.contactId ?? undefined } : {}),
        })
        ctx.vars.appointmentId = event.id
        await eventBus.audit(workspaceId, 'flow.create_appointment', {
          targetType: 'conversation',
          targetId: conversationId,
          payload: { eventId: event.id, ownerId: data.ownerId },
        })
      } catch (err) {
        if (err instanceof CalendarConflictError) {
          ctx.vars.appointmentConflict = true
          logger.info({ conversationId }, 'create_appointment: conflito de horário')
        } else {
          logger.error({ err }, 'Erro ao criar compromisso no flow')
        }
      }
      return { advance: true }
    }

    default:
      logger.warn({ nodeType: (node as any).type }, 'Tipo de nó desconhecido — pulando')
      return { advance: true }
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// ─── Helpers dos nós de lógica/integração ────────────────────────────────────

/**
 * Avalia o valueExpr de set_variable. Se for exatamente `{{ expr }}` (uma única
 * expressão), preserva o tipo resolvido; caso contrário interpola como string.
 */
function evalValueExpr(valueExpr: string, scope: FlowScope): unknown {
  const m = valueExpr.match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/)
  if (m) return resolveExpr(m[1], scope)
  return interpolate(valueExpr, scope)
}

/** Verifica se um IP literal está em faixa privada/loopback/link-local. */
function isPrivateIp(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase()
    return low === '::1' || low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe80') || low.startsWith('::ffff:')
  }
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true
  const [a, b] = parts
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 169 && b === 254) return true // link-local + metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

/** Bloqueia URLs que apontam pra rede interna (proteção SSRF). Lança em violação. */
async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    throw new Error(`URL inválida: ${rawUrl}`)
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Protocolo não permitido: ${u.protocol}`)
  }
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error(`Host interno bloqueado: ${host}`)
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error(`IP interno bloqueado: ${host}`)
    return u
  }
  // Hostname: resolve e valida todos os IPs.
  const records = await dns.lookup(host, { all: true })
  if (records.some((r) => isPrivateIp(r.address))) {
    throw new Error(`Host resolve para IP interno: ${host}`)
  }
  return u
}

async function executeHttpRequest(
  data: HttpRequestNodeData,
  ctx: FlowContext,
  scope: FlowScope,
): Promise<NodeResult> {
  const url = interpolate(data.url, scope)
  const timeout = Math.min(data.timeoutMs ?? 10_000, 30_000)
  const saveAs = data.saveAs ?? 'http'

  // Interpola headers/query/body
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(data.headers ?? {})) headers[k] = interpolate(v, scope)
  const params: Record<string, string> = {}
  for (const [k, v] of Object.entries(data.query ?? {})) params[k] = interpolate(v, scope)
  let body: unknown = data.body
  if (typeof data.body === 'string') body = interpolate(data.body, scope)

  try {
    await assertSafeUrl(url)
    const res = await axios.request({
      method: data.method,
      url,
      headers,
      params,
      data: body,
      timeout,
      maxContentLength: 5 * 1024 * 1024, // 5 MB
      maxBodyLength: 5 * 1024 * 1024,
      validateStatus: () => true, // tratamos status manualmente
    })
    ctx.vars[saveAs] = { status: res.status, body: res.data }
    const ok = res.status >= 200 && res.status < 300
    return { advance: true, nextHandle: ok ? 'success' : 'error' }
  } catch (err) {
    logger.warn({ err, url }, 'http_request falhou')
    ctx.vars[saveAs] = { status: 0, error: String((err as Error)?.message ?? err) }
    return { advance: true, nextHandle: 'error' }
  }
}

function executeCodeNode(data: CodeNodeData, ctx: FlowContext): NodeResult {
  const timeout = Math.min(data.timeoutMs ?? 1000, 5000)
  const sandbox: Record<string, unknown> = {
    vars: JSON.parse(JSON.stringify(ctx.vars ?? {})),
    result: undefined,
  }
  try {
    const script = new vm.Script(`result = (function(vars){ "use strict"; ${data.code}\n })(vars)`)
    const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } })
    script.runInContext(context, { timeout })
    const out = sandbox.result
    if (data.saveAs) {
      ctx.vars[data.saveAs] = out
    } else if (out && typeof out === 'object') {
      Object.assign(ctx.vars, out as Record<string, unknown>)
    }
    return { advance: true }
  } catch (err) {
    logger.warn({ err }, 'code node falhou')
    throw err // deixa a política de erro (executeNodeWithPolicy) decidir
  }
}

const MAX_FLOW_DEPTH = 5

/**
 * Executa uma sub-cadeia inline a partir de `startId`, no MESMO contexto.
 * Limitação: só nós que avançam (sem pausa). Se encontrar um nó que pausaria
 * (menu/input/bot), interrompe e loga — pausar dentro de loop/sub-flow não é
 * suportado nesta versão.
 */
async function runInlineChain(
  graph: FlowGraph,
  startId: string | null,
  conversationId: string,
  workspaceId: string,
  ctx: FlowContext,
  scope: FlowScope,
  maxSteps = MAX_STEPS_DEFAULT,
): Promise<void> {
  let currentId = startId
  let steps = 0
  while (currentId && steps < maxSteps) {
    const node = graph.nodes.find((n) => n.id === currentId)
    if (!node) break
    const result = await executeNodeWithPolicy(node, conversationId, workspaceId, ctx, scope, graph)
    if (!result.advance) {
      if (ctx.waiting) {
        logger.warn({ nodeId: node.id }, 'Nó que pausa dentro de loop/sub-flow não é suportado — interrompido')
        delete ctx.waiting
      }
      break
    }
    currentId = pickNextNodeId(node.id, result.nextHandle ?? null, graph.edges)
    steps += 1
  }
}

async function executeLoopNode(
  node: FlowNode,
  conversationId: string,
  workspaceId: string,
  ctx: FlowContext,
  scope: FlowScope,
  graph: FlowGraph,
): Promise<NodeResult> {
  const data = node.data as LoopNodeData
  const arr = resolveExpr(data.itemsVar, scope)
  if (!Array.isArray(arr)) {
    logger.warn({ itemsVar: data.itemsVar }, 'loop: var não é array — pula corpo')
    return { advance: true }
  }
  const itemVar = data.itemVar ?? 'item'
  const max = Math.min(data.maxIterations ?? 100, arr.length)
  const bodyStart = pickNextNodeId(node.id, 'loop', graph.edges)
  if (bodyStart) {
    for (let i = 0; i < max; i++) {
      ctx.vars[itemVar] = arr[i]
      ctx.vars[`${itemVar}Index`] = i
      await runInlineChain(graph, bodyStart, conversationId, workspaceId, ctx, scope)
    }
  }
  return { advance: true } // segue pela saída default (pós-loop)
}

async function executeCallFlow(
  data: CallFlowNodeData,
  conversationId: string,
  workspaceId: string,
  ctx: FlowContext,
  scope: FlowScope,
): Promise<NodeResult> {
  const depth = typeof ctx.vars._flowDepth === 'number' ? (ctx.vars._flowDepth as number) : 0
  if (depth >= MAX_FLOW_DEPTH) {
    logger.warn({ flowId: data.flowId }, 'call_flow: profundidade máxima atingida — abortado')
    return { advance: true, nextHandle: 'error' }
  }
  const child = await prisma.flow.findFirst({
    where: { id: data.flowId, workspaceId },
    select: { graph: true },
  })
  if (!child) {
    logger.warn({ flowId: data.flowId }, 'call_flow: sub-fluxo não encontrado')
    return { advance: true, nextHandle: 'error' }
  }
  const childGraph = child.graph as unknown as FlowGraph
  const childStart = childGraph.nodes.find((n) => n.type === 'start')
  if (!childStart) return { advance: true, nextHandle: 'error' }

  // Monta contexto do filho a partir do inputMapping
  const childCtx: FlowContext = { vars: { _flowDepth: depth + 1 } }
  for (const [childVar, parentExpr] of Object.entries(data.inputMapping ?? {})) {
    childCtx.vars[childVar] = resolveExpr(parentExpr, scope)
  }
  const childScope: FlowScope = { ctx: childCtx, conv: scope.conv, contact: scope.contact }
  await runInlineChain(childGraph, childStart.id, conversationId, workspaceId, childCtx, childScope)

  // Devolve vars do filho pro pai conforme outputMapping
  for (const [parentVar, childVar] of Object.entries(data.outputMapping ?? {})) {
    ctx.vars[parentVar] = childCtx.vars[childVar]
  }
  return { advance: true }
}

// ─── Nós proativos (cron / sem conversa) ─────────────────────────────────────

/** Gera texto com um agente de IA e grava em ctx.vars. Não envia nada. */
async function executeAiGenerate(
  data: AiGenerateNodeData,
  workspaceId: string,
  ctx: FlowContext,
  scope: FlowScope,
): Promise<NodeResult> {
  const { runAgent } = await import('../ai/agents/runAgent.js')
  const prompt = interpolate(data.promptTemplate, scope)
  const res = await runAgent({
    workspaceId,
    agentId: data.agentId,
    ...(data.systemPrompt ? { systemPrompt: interpolate(data.systemPrompt, scope) } : {}),
    ...(data.provider ? { provider: data.provider } : {}),
    ...(data.model ? { model: data.model } : {}),
    messages: [{ role: 'user', content: prompt }],
    responseFormat: 'text',
  })
  ctx.vars[data.saveAs ?? 'aiText'] = res.text
  return { advance: true }
}

/** Envia mensagem (proativa via enqueueMessage, ou responde na conversa atual). */
async function executeSendMessage(
  data: SendMessageNodeData,
  workspaceId: string,
  conversationId: string,
  ctx: FlowContext,
  scope: FlowScope,
): Promise<NodeResult> {
  // Modo "responder na conversa atual" — usa sendSystemMessage (WhatsApp).
  if (data.toMode === 'conversation' && conversationId) {
    await sendSystemMessage({
      conversationId,
      template: interpolate(data.body, scope),
      kind: 'agent-welcome',
      userId: null,
    })
    return { advance: true, nextHandle: 'success' }
  }

  const to = interpolate(data.to, scope).trim()
  if (!to) {
    logger.warn('send_message sem destinatário — pulando')
    return { advance: true, nextHandle: 'error' }
  }
  const contactId = data.contactId ? interpolate(data.contactId, scope).trim() || null : null
  // Canal: explícito (com {{...}}) ou, se vazio, o canal que disparou (ctx.vars.channelId).
  const resolvedChannelId = (data.channelId ? interpolate(data.channelId, scope).trim() : '')
    || (typeof ctx.vars.channelId === 'string' ? (ctx.vars.channelId as string) : '')
    || null
  try {
    const { enqueueMessage } = await import('../communication/communication.service.js')
    const res = await enqueueMessage({
      workspaceId,
      channelType: data.channelType,
      channelId: resolvedChannelId,
      to,
      subject: data.subject ? interpolate(data.subject, scope) : null,
      body: interpolate(data.body, scope),
      contactId,
      source: data.source || 'flow',
    })
    ctx.vars._lastSend = { messageId: (res as any)?.messageId ?? null, to }
    return { advance: true, nextHandle: 'success' }
  } catch (err) {
    logger.warn({ err, to }, 'send_message falhou ao enfileirar')
    return { advance: true, nextHandle: 'error' }
  }
}

/** Ramifica se já houve envio recente (dedup) consultando CommMessage. */
async function executeCheckNotified(
  data: CheckNotifiedNodeData,
  workspaceId: string,
  scope: FlowScope,
): Promise<NodeResult> {
  const value = interpolate(data.value, scope).trim()
  if (!value) return { advance: true, nextHandle: 'not_notified' }
  const withinDays = data.withinDays ?? 2
  const since = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000)
  const recent = await prisma.commMessage.findFirst({
    where: {
      workspaceId,
      status: 'SENT',
      source: data.source,
      sentAt: { gte: since },
      ...(data.matchBy === 'contactId' ? { contactId: value } : { to: value }),
    },
    select: { id: true },
  })
  return { advance: true, nextHandle: recent ? 'notified' : 'not_notified' }
}

/**
 * Runner PROATIVO (sem conversa): executa um fluxo disparado por cron.
 * Não cria FlowExecution nem conversa — roda o grafo em memória via
 * runInlineChain. Só faz sentido com nós puros + proativos (ai_generate,
 * send_message, http_request, loop, etc). Nós que dependem de conversa
 * (message/menu/input/...) são no-op aqui.
 */
export async function runFlowDetached(args: { workspaceId: string; flowId: string; vars?: Record<string, unknown> }) {
  const { workspaceId, flowId } = args
  const flow = await prisma.flow.findFirst({
    where: { id: flowId, workspaceId, isActive: true },
    select: { id: true, graph: true },
  })
  if (!flow) {
    logger.warn({ flowId, workspaceId }, 'runFlowDetached: flow não encontrado ou inativo')
    return
  }
  const graph = flow.graph as unknown as FlowGraph
  const start = graph.nodes.find((n) => n.type === 'start')
  if (!start) {
    logger.error({ flowId }, 'runFlowDetached: flow sem nó start')
    return
  }
  const ctx: FlowContext = { vars: { ...(args.vars ?? {}) } }
  const scope: FlowScope = { ctx, conv: null, contact: null }

  await eventBus.audit(workspaceId, 'flow.cron_run', {
    targetType: 'flow', targetId: flowId, payload: { startedAt: new Date().toISOString() },
  })
  try {
    await runInlineChain(graph, start.id, '', workspaceId, ctx, scope)
  } catch (err) {
    logger.error({ err, flowId }, 'runFlowDetached: erro na execução')
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

function evaluateCondition(data: ConditionNodeData, scope: FlowScope): boolean {
  const value = resolveExpr(data.field, scope)
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

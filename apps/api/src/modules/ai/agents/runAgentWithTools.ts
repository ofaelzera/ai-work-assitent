import { prisma } from '../../../lib/prisma.js'
import { logger } from '../../../lib/logger.js'
import { getProvider } from '../providers/index.js'
import type { AIMessage } from '../providers/types.js'
import { getEnabledTools, executeToolCall } from '../tools/registry.js'
import type { ToolCall, ToolContext, ToolExecutionResult } from '../tools/types.js'

export interface RunAgentWithToolsOptions {
  agentId: string
  workspaceId: string
  userMessage: string
  /**
   * Contexto do evento que disparou o agente. Inclui no system prompt
   * pra dar consciência ao modelo (ex: conversationId).
   */
  triggerEvent?: ToolContext['triggerEvent']
  dryRun?: boolean // se true, NÃO executa tools — só retorna o que faria
  maxIterations?: number // proteção contra loops (default 3)
}

export interface ToolInvocation {
  call: ToolCall
  result: ToolExecutionResult
}

export interface RunAgentWithToolsResult {
  text: string
  toolInvocations: ToolInvocation[]
  iterations: number
  tokensIn: number
  tokensOut: number
  logId: string
  dryRun: boolean
}

interface ModelJsonResponse {
  reply?: string
  toolCalls?: { name: string; params: unknown }[]
}

/**
 * Tenta extrair JSON {reply, toolCalls} do texto do modelo.
 * Tolerante a markdown fences e a texto solto antes/depois do JSON.
 */
function parseModelResponse(text: string): ModelJsonResponse {
  // Remove code fences
  let clean = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()

  // Se o modelo prefixou texto antes do JSON, pega o primeiro { ... }
  if (!clean.startsWith('{')) {
    const m = clean.match(/\{[\s\S]*\}/)
    if (m) clean = m[0]
  }

  try {
    const parsed = JSON.parse(clean)
    return {
      reply: typeof parsed.reply === 'string' ? parsed.reply : undefined,
      toolCalls: Array.isArray(parsed.toolCalls) ? parsed.toolCalls : undefined,
    }
  } catch {
    // Fallback: texto bruto vira reply
    return { reply: text }
  }
}

function buildSystemPrompt(originalSystem: string, tools: ReturnType<typeof getEnabledTools>): string {
  if (tools.length === 0) return originalSystem

  const toolDocs = tools.map((t) =>
    `### ${t.name}\n${t.description}\nParâmetros JSON-Schema:\n${JSON.stringify(t.parametersJsonSchema)}`,
  ).join('\n\n')

  return `${originalSystem}

---
Você tem acesso a ferramentas (tools) que pode chamar pra executar ações no sistema.

Tools disponíveis:

${toolDocs}

---
IMPORTANTE: Sua resposta DEVE ser um JSON com este formato exato:
{
  "reply": "mensagem de texto opcional (resumo do que fez)",
  "toolCalls": [
    { "name": "<nomeDoTool>", "params": { ...parâmetros conforme o schema do tool... } }
  ]
}

Regras:
- Se NÃO precisa chamar nenhum tool, use { "reply": "...", "toolCalls": [] }
- Os "params" devem respeitar exatamente o JSON-Schema do tool
- Não invente tools — só use os listados acima
- Retorne JSON puro (sem texto antes/depois, sem code fences)`
}

export async function runAgentWithTools(opts: RunAgentWithToolsOptions): Promise<RunAgentWithToolsResult> {
  const agent = await prisma.agent.findUnique({ where: { id: opts.agentId } })
  if (!agent) throw new Error(`Agent ${opts.agentId} não encontrado`)
  if (!agent.isActive) throw new Error(`Agent ${opts.agentId} está desativado`)

  const enabledNames = Array.isArray(agent.enabledTools) ? (agent.enabledTools as string[]) : []
  const tools = getEnabledTools(enabledNames)

  const ai = getProvider(agent.provider)
  const systemPrompt = buildSystemPrompt(agent.systemPrompt, tools)

  const triggerContext = opts.triggerEvent
    ? `\n\nContexto do trigger:\n${JSON.stringify(opts.triggerEvent, null, 2)}`
    : ''

  const messages: AIMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `${opts.userMessage}${triggerContext}` },
  ]

  const startMs = Date.now()
  let totalTokensIn = 0
  let totalTokensOut = 0
  let error: string | null = null
  let lastReply = ''
  const invocations: ToolInvocation[] = []
  const maxIter = opts.maxIterations ?? 3
  let iter = 0

  try {
    for (iter = 1; iter <= maxIter; iter++) {
      const out = await ai.generate({
        model: agent.model,
        messages,
        temperature: agent.temperature,
        responseFormat: tools.length > 0 ? 'json' : 'text',
      })
      totalTokensIn += out.tokensIn
      totalTokensOut += out.tokensOut

      // Se não tem tools habilitados, retorna texto direto
      if (tools.length === 0) {
        lastReply = out.text
        break
      }

      const parsed = parseModelResponse(out.text)
      lastReply = parsed.reply ?? out.text

      const calls = parsed.toolCalls ?? []
      if (calls.length === 0) break // nada a executar, terminou

      // Executa cada tool (ou simula se dryRun)
      const ctx: ToolContext = {
        workspaceId: opts.workspaceId,
        agentId: opts.agentId,
        triggerEvent: opts.triggerEvent,
      }

      const results: ToolInvocation[] = []
      for (const call of calls) {
        if (opts.dryRun) {
          results.push({ call, result: { ok: true, result: '[dry-run, não executado]' } })
        } else {
          const r = await executeToolCall(call, ctx)
          results.push({ call, result: r })
        }
      }
      invocations.push(...results)

      // Se foi dry-run, encerra após a primeira iteração
      if (opts.dryRun) break

      // Feed dos resultados de volta pro modelo pra próxima iteração
      messages.push({ role: 'assistant', content: out.text })
      messages.push({
        role: 'user',
        content: `Resultado dos tools:\n${JSON.stringify(results.map((r) => ({ tool: r.call.name, ok: r.result.ok, error: r.result.error })))}\n\nFaça mais alguma ação ou retorne { "toolCalls": [] } se terminou.`,
      })
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
    logger.error({ err, agentId: opts.agentId }, 'Erro em runAgentWithTools')
  }

  const log = await prisma.aIExecutionLog.create({
    data: {
      workspaceId: opts.workspaceId,
      agentId: opts.agentId,
      provider: agent.provider,
      model: agent.model,
      input: { userMessage: opts.userMessage.slice(0, 2000), triggerEvent: (opts.triggerEvent ?? null) as any },
      output: { reply: lastReply.slice(0, 5000), toolInvocations: invocations.slice(0, 20) } as any,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      latencyMs: Date.now() - startMs,
      error,
    },
  })

  if (error) throw new Error(error)

  return {
    text: lastReply,
    toolInvocations: invocations,
    iterations: iter,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    logId: log.id,
    dryRun: opts.dryRun ?? false,
  }
}

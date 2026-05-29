import { prisma } from '../../../lib/prisma.js'
import { logger } from '../../../lib/logger.js'
import { getProvider } from '../providers/index.js'
import type { AIMessage } from '../providers/types.js'

export interface RunAgentOptions {
  agentId?: string        // se fornecido, carrega config do DB
  workspaceId: string
  provider?: string       // override do provider
  model?: string          // override do model
  systemPrompt?: string   // override do system prompt
  temperature?: number
  messages: AIMessage[]
  responseFormat?: 'text' | 'json'
}

export interface RunAgentResult {
  text: string
  parsed?: unknown        // preenchido quando responseFormat=json e parse OK
  tokensIn: number
  tokensOut: number
  logId: string
}

export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  // Carrega configuração do agente do DB se agentId fornecido
  let agentConfig: { provider: string; model: string; systemPrompt: string; temperature: number } | null = null

  if (opts.agentId) {
    const agent = await prisma.agent.findUnique({ where: { id: opts.agentId } })
    if (agent) {
      agentConfig = {
        provider: agent.provider,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        temperature: agent.temperature,
      }
    }
  }

  const provider = opts.provider ?? agentConfig?.provider ?? 'gemini'
  const model    = opts.model    ?? agentConfig?.model    ?? 'gemini-2.5-flash'
  const temperature = opts.temperature ?? agentConfig?.temperature ?? 0.4

  // Monta lista de mensagens com system prompt
  const systemPrompt = opts.systemPrompt ?? agentConfig?.systemPrompt
  const messages: AIMessage[] = [
    ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
    ...opts.messages,
  ]

  const ai = await getProvider(provider)
  const startMs = Date.now()
  let output: Awaited<ReturnType<typeof ai.generate>> | null = null
  let error: string | null = null

  try {
    output = await ai.generate({ model, messages, temperature, responseFormat: opts.responseFormat })
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : String(err)
    logger.error({ err, provider, model }, 'Erro na execução do agente')
  }

  const latencyMs = Date.now() - startMs

  // Persiste log
  const log = await prisma.aIExecutionLog.create({
    data: {
      workspaceId: opts.workspaceId,
      agentId: opts.agentId ?? null,
      provider,
      model,
      input: { messages: messages.map(m => ({ role: m.role, content: m.content.slice(0, 2000) })) },
      output: output ? ({ text: output.text.slice(0, 5000) } as any) : undefined,
      tokensIn: output?.tokensIn ?? null,
      tokensOut: output?.tokensOut ?? null,
      latencyMs,
      error,
    },
  })

  if (error || !output) throw new Error(error ?? 'Sem resposta do provider')

  // Tenta parsear JSON se solicitado
  let parsed: unknown = undefined
  if (opts.responseFormat === 'json') {
    try {
      // Remove code fences se o modelo as incluir
      const clean = output.text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
      parsed = JSON.parse(clean)
    } catch {
      logger.warn({ text: output.text.slice(0, 200) }, 'runAgent: falha ao parsear JSON')
    }
  }

  return {
    text: output.text,
    parsed,
    tokensIn: output.tokensIn,
    tokensOut: output.tokensOut,
    logId: log.id,
  }
}

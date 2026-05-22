import type { ZodTypeAny, z } from 'zod'

export interface ToolContext {
  workspaceId: string
  agentId?: string | null
  agentRunId?: string | null
  // Contexto do evento que disparou o agente (quando aplicável)
  triggerEvent?: {
    type: string
    conversationId?: string
    messageId?: string
    contactId?: string
    channelId?: string
    payload?: Record<string, unknown>
  }
}

export interface ToolDef<S extends ZodTypeAny = ZodTypeAny> {
  name: string
  description: string
  parameters: S
  parametersJsonSchema: Record<string, unknown>
  execute(ctx: ToolContext, params: z.infer<S>): Promise<ToolExecutionResult>
}

export interface ToolCall {
  name: string
  params: unknown
}

export interface ToolExecutionResult {
  ok: boolean
  result?: unknown
  error?: string
}

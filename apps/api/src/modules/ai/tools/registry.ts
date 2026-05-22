import type { ToolDef, ToolContext, ToolCall, ToolExecutionResult } from './types.js'
import { notifyTool } from './notify.tool.js'
import { createCardTool } from './createCard.tool.js'
import { createTaskTool } from './createTask.tool.js'
import { createCalendarEventTool } from './createCalendarEvent.tool.js'
import { moveEmailTool } from './moveEmail.tool.js'
import { logger } from '../../../lib/logger.js'

// Registro central — adicione tools novos aqui
const ALL_TOOLS: ToolDef<any>[] = [
  notifyTool,
  createCardTool,
  createTaskTool,
  createCalendarEventTool,
  moveEmailTool,
]

const TOOL_MAP: Record<string, ToolDef<any>> = Object.fromEntries(ALL_TOOLS.map((t) => [t.name, t]))

export function listAvailableTools(): { name: string; description: string }[] {
  return ALL_TOOLS.map((t) => ({ name: t.name, description: t.description }))
}

export function getTool(name: string): ToolDef<any> | null {
  return TOOL_MAP[name] ?? null
}

export function getEnabledTools(enabledNames: string[] | null | undefined): ToolDef<any>[] {
  if (!enabledNames || enabledNames.length === 0) return []
  return enabledNames.map((n) => TOOL_MAP[n]).filter((t): t is ToolDef<any> => !!t)
}

/**
 * Executa um tool call com validação Zod. Nunca lança — retorna { ok: false, error } em falha.
 */
export async function executeToolCall(
  call: ToolCall,
  ctx: ToolContext,
): Promise<ToolExecutionResult> {
  const tool = getTool(call.name)
  if (!tool) {
    return { ok: false, error: `Tool desconhecida: ${call.name}` }
  }
  const parsed = tool.parameters.safeParse(call.params)
  if (!parsed.success) {
    return { ok: false, error: `Parâmetros inválidos: ${parsed.error.message}` }
  }
  try {
    return await tool.execute(ctx, parsed.data)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ err, tool: call.name }, 'Falha ao executar tool')
    return { ok: false, error: message }
  }
}

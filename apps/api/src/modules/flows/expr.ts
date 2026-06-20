/**
 * expr.ts — motor de expressões e interpolação do Flow Engine.
 *
 * Resolve caminhos pontilhados (`vars.x`, `contact.name`, `conv.isGroup`,
 * `lastUserInput`, ...) sobre um "escopo" do fluxo, e interpola templates
 * `{{ caminho }}` em qualquer campo de texto dos nós.
 *
 * Convenção de sintaxe:
 *   • `{{ ... }}` (chave dupla) → expressões de fluxo resolvidas aqui.
 *   • `{ ... }`  (chave simples) → variáveis legadas de mensagem
 *     ({cliente}, {atendente}, ...), resolvidas em `sendSystemMessage`
 *     no momento do envio. NÃO mexemos nelas aqui pra não duplicar.
 *
 * Caminhos suportados em `resolveExpr` (compatível com o formato `field`
 * de ConditionNodeData, que usa prefixos `context.` / `contact.` / `conv.`):
 *   lastUserInput, lastMenuChoice
 *   context.<key>  | vars.<key>        → ctx.vars[<key>] (suporta aninhado)
 *   contact.name | contact.companyId | contact.tags
 *   conv.isGroup
 */
import { prisma } from '../../lib/prisma.js'
import type { FlowContext } from './flow.types.js'

export interface FlowScope {
  /** Contexto vivo da execução — `vars` é mutado pelos nós, sempre atual. */
  ctx: FlowContext
  conv?: { id: string; isGroup: boolean } | null
  contact?: { name: string | null; companyId: string | null; tags: string[] } | null
}

/**
 * Carrega contato/conversa uma vez por execução para alimentar o escopo.
 * `ctx` é passado por referência — leituras de `vars` refletem o estado atual.
 */
export async function loadFlowScope(conversationId: string, ctx: FlowContext): Promise<FlowScope> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { contact: { select: { name: true, companyId: true, metadata: true } } },
  })
  if (!conv) return { ctx, conv: null, contact: null }
  const meta = (conv.contact?.metadata as Record<string, unknown> | null) ?? {}
  return {
    ctx,
    conv: { id: conv.id, isGroup: conv.isGroup },
    contact: {
      name: conv.contact?.name ?? null,
      companyId: conv.contact?.companyId ?? null,
      tags: Array.isArray(meta.tags) ? (meta.tags as string[]) : [],
    },
  }
}

/** Lê um caminho pontilhado (a.b.c) dentro de um objeto qualquer. */
function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj
  const parts = path.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

/**
 * Resolve uma expressão de caminho contra o escopo. Síncrono — o escopo já
 * foi carregado por `loadFlowScope`. Retorna `undefined` se não resolver.
 */
export function resolveExpr(field: string, scope: FlowScope): unknown {
  const f = field.trim()

  if (f === 'lastUserInput') return scope.ctx.lastUserInput
  if (f === 'lastMenuChoice') return scope.ctx.lastMenuChoice

  if (f.startsWith('context.')) {
    const key = f.slice('context.'.length)
    if (key === 'lastUserInput') return scope.ctx.lastUserInput
    if (key === 'lastMenuChoice') return scope.ctx.lastMenuChoice
    return getPath(scope.ctx.vars, key)
  }
  if (f.startsWith('vars.')) {
    return getPath(scope.ctx.vars, f.slice('vars.'.length))
  }
  if (f.startsWith('contact.')) {
    const key = f.slice('contact.'.length)
    if (key === 'name') return scope.contact?.name ?? null
    if (key === 'companyId') return scope.contact?.companyId ?? null
    if (key === 'tags') return scope.contact?.tags ?? []
    return undefined
  }
  if (f.startsWith('conv.')) {
    if (f === 'conv.isGroup') return scope.conv?.isGroup ?? null
    return undefined
  }

  // Sem prefixo: tenta direto em vars (atalho para {{ minhaVar }}).
  return getPath(scope.ctx.vars, f)
}

function stringifyValue(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/**
 * Interpola `{{ caminho }}` em um template. Expressões desconhecidas viram
 * string vazia. Não toca em `{ chave }` simples (interpolação legada).
 */
export function interpolate(template: string | null | undefined, scope: FlowScope): string {
  if (!template) return ''
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_full, expr: string) => {
    return stringifyValue(resolveExpr(expr, scope))
  })
}

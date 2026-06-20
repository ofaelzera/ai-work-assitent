'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  addEdge, applyEdgeChanges, applyNodeChanges,
  type Node, type Edge, type Connection, type NodeChange, type EdgeChange,
  Handle, Position,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  ArrowLeft, Play, Save, Plus, Trash2, MessageSquare,
  ListChecks, GitFork, Users2, User, Bot, Hand, Tag, Square, CircleDot,
  Clock, CalendarClock, CalendarSearch, CalendarPlus,
  Keyboard, Globe, Braces, Code, Split, Repeat, Workflow,
  History, X, RefreshCw, PhoneOff,
  Sparkles, Send, BellRing,
} from 'lucide-react'

type NodeType =
  | 'start' | 'message' | 'menu' | 'condition'
  | 'assign_team' | 'assign_user' | 'start_bot'
  | 'wait_for_human' | 'tag' | 'end'
  | 'check_company_hours' | 'check_user_available' | 'find_free_slots' | 'create_appointment'
  | 'input' | 'http_request' | 'set_variable' | 'code' | 'switch' | 'loop' | 'call_flow'
  | 'close_conversation'
  | 'ai_generate' | 'send_message' | 'check_notified'

const NODE_META: Record<NodeType, { label: string; icon: any; color: string }> = {
  start:          { label: 'Início',                icon: CircleDot,    color: '#10b981' },
  message:        { label: 'Mensagem',              icon: MessageSquare, color: '#6366f1' },
  menu:           { label: 'Menu de opções',        icon: ListChecks,   color: '#8b5cf6' },
  condition:      { label: 'Condição',              icon: GitFork,      color: '#f59e0b' },
  assign_team:    { label: 'Encaminhar setor',      icon: Users2,       color: '#0ea5e9' },
  assign_user:    { label: 'Atribuir usuário',      icon: User,         color: '#06b6d4' },
  start_bot:      { label: 'Iniciar bot IA',        icon: Bot,          color: '#ec4899' },
  wait_for_human: { label: 'Aguardar atendente',    icon: Hand,         color: '#f97316' },
  tag:            { label: 'Adicionar tag',         icon: Tag,          color: '#64748b' },
  end:            { label: 'Fim',                   icon: Square,       color: '#ef4444' },
  check_company_hours:  { label: 'Empresa aberta?',     icon: Clock,          color: '#14b8a6' },
  check_user_available: { label: 'Usuário disponível?', icon: CalendarClock,  color: '#14b8a6' },
  find_free_slots:      { label: 'Buscar horários',     icon: CalendarSearch, color: '#0d9488' },
  create_appointment:   { label: 'Agendar compromisso', icon: CalendarPlus,   color: '#0d9488' },
  input:         { label: 'Capturar entrada',   icon: Keyboard, color: '#6366f1' },
  http_request:  { label: 'Requisição HTTP',    icon: Globe,    color: '#0ea5e9' },
  set_variable:  { label: 'Definir variável',   icon: Braces,   color: '#a855f7' },
  code:          { label: 'Código (JS)',        icon: Code,     color: '#475569' },
  switch:        { label: 'Switch',             icon: Split,    color: '#f59e0b' },
  loop:          { label: 'Loop (lista)',       icon: Repeat,   color: '#d946ef' },
  call_flow:     { label: 'Chamar fluxo',       icon: Workflow, color: '#0891b2' },
  close_conversation: { label: 'Finalizar atendimento', icon: PhoneOff, color: '#ef4444' },
  ai_generate:   { label: 'Gerar com IA',       icon: Sparkles, color: '#ec4899' },
  send_message:  { label: 'Enviar mensagem',    icon: Send,     color: '#22c55e' },
  check_notified:{ label: 'Já notificado?',     icon: BellRing, color: '#f59e0b' },
}

const PALETTE: NodeType[] = [
  'message', 'menu', 'input', 'condition', 'switch',
  'assign_team', 'assign_user', 'start_bot', 'wait_for_human', 'tag',
  'http_request', 'ai_generate', 'send_message', 'check_notified',
  'set_variable', 'code', 'loop', 'call_flow',
  'check_company_hours', 'check_user_available', 'find_free_slots', 'create_appointment',
  'close_conversation', 'end',
]

function makeId(prefix: string) { return `${prefix}-${Math.random().toString(36).slice(2, 8)}` }

function defaultData(type: NodeType): any {
  switch (type) {
    case 'message':        return { text: 'Olá! Como podemos ajudar?', interpolate: true }
    case 'menu':           return { prompt: 'Escolha uma opção:', options: [
      { value: '1', label: '1️⃣ Suporte' },
      { value: '2', label: '2️⃣ Vendas' },
    ], timeoutMin: 0 }
    case 'condition':      return { field: 'context.lastMenuChoice', op: 'eq', value: '1' }
    case 'assign_team':    return { teamId: '', note: '' }
    case 'assign_user':    return { userId: '', note: '' }
    case 'start_bot':      return { agentId: '', awaitReply: false }
    case 'wait_for_human': return { teamId: null }
    case 'tag':            return { conversationTags: [], contactTags: [] }
    case 'check_company_hours':  return {}
    case 'check_user_available': return { userId: '' }
    case 'find_free_slots':      return { userId: '', durationMin: 30, daysAhead: 7, maxSlots: 5 }
    case 'create_appointment':   return { ownerId: '', title: 'Compromisso', durationMin: 30, startVar: 'freeSlot', linkToConversation: true }
    case 'input':         return { prompt: 'Qual seu e-mail?', varName: 'email', inputType: 'email', retryMessage: '❌ Valor inválido, tente novamente.', maxRetries: 2 }
    case 'http_request':  return { method: 'GET', url: 'https://', headers: {}, query: {}, saveAs: 'http', timeoutMs: 10000, onError: 'handle' }
    case 'set_variable':  return { assignments: [{ varName: 'minhaVar', valueExpr: '{{ vars.x }}' }] }
    case 'code':          return { code: 'return { dobro: vars.n * 2 }', saveAs: '', timeoutMs: 1000 }
    case 'switch':        return { clauses: [{ handle: 'caso1', field: 'context.lastUserInput', op: 'eq', value: '' }], defaultHandle: 'default' }
    case 'loop':          return { itemsVar: 'vars.items', itemVar: 'item', maxIterations: 100 }
    case 'call_flow':     return { flowId: '', inputMapping: {}, outputMapping: {} }
    case 'close_conversation': return { closingMessage: 'Atendimento finalizado. Sempre que precisar, é só chamar! 👋', finalizerLabel: 'Autoatendimento' }
    case 'ai_generate':   return { agentId: '', promptTemplate: 'Com base nestes dados: {{http.body}}\nEscreva uma mensagem curta e amigável.', saveAs: 'aiText' }
    case 'send_message':  return { channelType: 'WHATSAPP', to: '', body: '{{aiText}}', source: 'flow', contactId: '' }
    case 'check_notified':return { matchBy: 'to', value: '{{item.telefone}}', source: 'flow', withinDays: 2 }
    default: return {}
  }
}

// ─── Node visual ─────────────────────────────────────────────────────────────
function CustomNode({ data, selected }: { data: any; selected: boolean }) {
  const meta = NODE_META[data.type as NodeType]
  const Icon = meta?.icon ?? CircleDot
  const borderClass = data.traceCurrent
    ? 'border-blue-500 ring-2 ring-blue-500/40'
    : data.traceVisited
      ? 'border-emerald-500'
      : selected ? 'border-primary' : 'border-border'
  return (
    <div className={`relative rounded-lg border-2 bg-card shadow-sm min-w-[180px] transition ${borderClass} ${
      data.traceDimmed ? 'opacity-40' : ''
    }`}>
      {typeof data.traceOrder === 'number' && (
        <span className="absolute -top-2 -left-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">
          {data.traceOrder}
        </span>
      )}
      {data.type !== 'start' && <Handle type="target" position={Position.Top} className="w-2.5 h-2.5 bg-muted-foreground border-2 border-background" />}
      <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ color: meta?.color }}>
        <Icon className="h-3.5 w-3.5" />
        <span className="text-xs font-semibold">{meta?.label}</span>
      </div>
      <div className="px-3 py-2 text-[11px] text-muted-foreground line-clamp-2">
        {data.summary || '(configure...)'}
      </div>
      {(() => {
        const handles = sourceHandlesFor(data.type, data.config)
        return handles.map((h, i) => {
          const left = handles.length === 1 ? '50%' : `${((i + 1) / (handles.length + 1)) * 100}%`
          return (
            <Handle key={h.id ?? `default-${i}`} id={h.id ?? undefined} type="source"
              position={Position.Bottom} style={{ left, background: h.color }}
              title={h.id ?? 'saída'}
              className="w-2.5 h-2.5 border-2 border-background" />
          )
        })
      })()}
    </div>
  )
}

// Nós de agenda que ramificam por sourceHandle 'true' / 'false'.
const DUAL_HANDLE_TYPES = new Set<string>([
  'check_company_hours', 'check_user_available', 'find_free_slots',
])

function summarize(type: NodeType, d: any): string {
  switch (type) {
    case 'message':        return d.text?.slice(0, 60) ?? ''
    case 'menu':           return `${d.options?.length ?? 0} opções: ${(d.options ?? []).map((o: any) => o.label).join(' / ').slice(0, 60)}`
    case 'condition':      return `${d.field} ${d.op} ${JSON.stringify(d.value)}`
    case 'assign_team':    return d.teamId ? `→ team ${d.teamId}` : ''
    case 'assign_user':    return d.userId ? `→ user ${d.userId}` : ''
    case 'start_bot':      return d.agentId ? `bot ${d.agentId}` : ''
    case 'wait_for_human': return 'Aguarda humano'
    case 'tag':            return `tags: ${(d.conversationTags ?? []).join(', ')}`
    case 'end':            return 'Fim'
    case 'start':          return 'Início'
    case 'check_company_hours':  return 'Sim / Não'
    case 'check_user_available': return d.userId ? `user ${d.userId} (sim/não)` : '(escolha usuário)'
    case 'find_free_slots':      return d.userId ? `${d.durationMin ?? 30}min · ${d.daysAhead ?? 7}d` : '(escolha usuário)'
    case 'create_appointment':   return d.ownerId ? `${d.title} (${d.durationMin ?? 30}min)` : '(configure)'
    case 'input':         return `${d.inputType ?? 'text'} → ${d.varName ?? '?'}`
    case 'http_request':  return `${d.method ?? 'GET'} ${(d.url ?? '').slice(0, 40)}`
    case 'set_variable':  return (d.assignments ?? []).map((a: any) => a.varName).join(', ').slice(0, 50) || '(vars)'
    case 'code':          return `JS → ${d.saveAs || 'vars'}`
    case 'switch':        return `${(d.clauses ?? []).length} casos + default`
    case 'loop':          return `for ${d.itemVar ?? 'item'} of ${d.itemsVar ?? '?'}`
    case 'call_flow':     return d.flowId ? `→ fluxo ${d.flowId.slice(0, 8)}` : '(escolha fluxo)'
    case 'close_conversation': return 'Finaliza como Autoatendimento'
    case 'ai_generate':   return `IA → ${d.saveAs || 'aiText'}`
    case 'send_message':  return `${d.channelType ?? 'WHATSAPP'} → ${(d.to || '?').slice(0, 30)}`
    case 'check_notified':return `${d.withinDays ?? 2}d · ${d.source || 'flow'}`
    default: return ''
  }
}

/** Saídas (source handles) de cada tipo de nó, com posição e cor. */
function sourceHandlesFor(type: string, config: any): Array<{ id: string | null; color: string }> {
  if (type === 'end' || type === 'close_conversation') return []
  if (DUAL_HANDLE_TYPES.has(type)) return [{ id: 'true', color: '#10b981' }, { id: 'false', color: '#ef4444' }]
  if (type === 'http_request' || type === 'send_message') return [{ id: 'success', color: '#10b981' }, { id: 'error', color: '#ef4444' }]
  if (type === 'check_notified') return [{ id: 'notified', color: '#f59e0b' }, { id: 'not_notified', color: '#10b981' }]
  if (type === 'input') return [{ id: null, color: '#6366f1' }, { id: 'invalid', color: '#ef4444' }]
  if (type === 'loop') return [{ id: 'loop', color: '#8b5cf6' }, { id: null, color: '#6366f1' }]
  if (type === 'switch') {
    const hs = (config?.clauses ?? []).map((c: any) => ({ id: c.handle, color: '#f59e0b' }))
    hs.push({ id: config?.defaultHandle ?? 'default', color: '#64748b' })
    return hs
  }
  return [{ id: null, color: '#6366f1' }]
}

const nodeTypes = { custom: CustomNode as any }

// ─── Painel lateral de edição ────────────────────────────────────────────────
function NodeInspector({
  node, onChange, onDelete, teams, users, agents, flows,
}: {
  node: Node | null
  onChange: (data: any) => void
  onDelete: () => void
  teams: { id: string; name: string }[]
  users: { id: string; name: string }[]
  agents: { id: string; name: string; isActive?: boolean }[]
  flows: { id: string; name: string }[]
}) {
  if (!node) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        Selecione um nó pra editar.
      </div>
    )
  }
  const type = (node.data as any).type as NodeType
  const data = (node.data as any).config ?? {}

  function update(patch: any) {
    onChange({ ...data, ...patch })
  }

  return (
    <div className="p-4 space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-xs uppercase text-muted-foreground">{NODE_META[type]?.label}</h3>
        {type !== 'start' && (
          <button onClick={onDelete} className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {type === 'message' && (
        <div className="space-y-1.5">
          <label className="text-xs">Texto</label>
          <textarea value={data.text ?? ''} onChange={(e) => update({ text: e.target.value })}
            rows={5}
            className="w-full rounded-lg border bg-transparent px-3 py-2 text-xs resize-y" />
          <p className="text-[10px] text-muted-foreground">Variáveis: {'{{cliente}}'}, {'{{empresa}}'}, {'{{atendente}}'}</p>
        </div>
      )}

      {type === 'menu' && (
        <>
          <div className="space-y-1.5">
            <label className="text-xs">Pergunta</label>
            <textarea value={data.prompt ?? ''} onChange={(e) => update({ prompt: e.target.value })}
              rows={3}
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-xs resize-y" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs">Opções (cada uma vira uma saída)</label>
            {(data.options ?? []).map((opt: any, i: number) => (
              <div key={i} className="flex gap-1.5">
                <input value={opt.value} onChange={(e) => {
                  const next = [...(data.options ?? [])]
                  next[i] = { ...next[i], value: e.target.value }
                  update({ options: next })
                }}
                  placeholder="value"
                  className="w-16 rounded border bg-transparent px-2 py-1 text-xs" />
                <input value={opt.label} onChange={(e) => {
                  const next = [...(data.options ?? [])]
                  next[i] = { ...next[i], label: e.target.value }
                  update({ options: next })
                }}
                  placeholder="Rótulo (o que o cliente vê)"
                  className="flex-1 rounded border bg-transparent px-2 py-1 text-xs" />
                <button onClick={() => {
                  const next = (data.options ?? []).filter((_: any, j: number) => j !== i)
                  update({ options: next })
                }} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            <button onClick={() => update({ options: [...(data.options ?? []), { value: String((data.options?.length ?? 0) + 1), label: '' }] })}
              className="text-xs text-primary flex items-center gap-1 mt-1">
              <Plus className="h-3 w-3" /> opção
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Conecte uma edge para cada opção (sourceHandle = value).
          </p>
        </>
      )}

      {type === 'condition' && (
        <>
          <div className="space-y-1.5">
            <label className="text-xs">Campo</label>
            <select value={data.field ?? ''} onChange={(e) => update({ field: e.target.value })}
              className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs">
              <option value="context.lastMenuChoice">Última escolha de menu</option>
              <option value="context.lastUserInput">Última mensagem do cliente</option>
              <option value="contact.companyId">Empresa do contato</option>
              <option value="contact.name">Nome do contato</option>
              <option value="contact.tags">Tags do contato</option>
              <option value="conv.isGroup">É grupo?</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label className="text-xs">Operador</label>
              <select value={data.op ?? 'eq'} onChange={(e) => update({ op: e.target.value })}
                className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs">
                <option value="eq">=</option>
                <option value="neq">≠</option>
                <option value="contains">contém</option>
                <option value="in">em (lista)</option>
                <option value="gt">&gt;</option>
                <option value="lt">&lt;</option>
                <option value="exists">existe</option>
                <option value="matches_regex">regex</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs">Valor</label>
              <input value={String(data.value ?? '')} onChange={(e) => update({ value: e.target.value })}
                className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Saídas: <code>true</code> / <code>false</code>
          </p>
        </>
      )}

      {type === 'assign_team' && (
        <div className="space-y-1.5">
          <label className="text-xs">Setor</label>
          <select value={data.teamId ?? ''} onChange={(e) => update({ teamId: e.target.value })}
            className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs">
            <option value="">— selecione —</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}

      {type === 'assign_user' && (
        <div className="space-y-1.5">
          <label className="text-xs">Usuário</label>
          <select value={data.userId ?? ''} onChange={(e) => update({ userId: e.target.value })}
            className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs">
            <option value="">— selecione —</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      )}

      {type === 'start_bot' && (
        <>
          <div className="space-y-1.5">
            <label className="text-xs">Agente IA</label>
            <select value={data.agentId ?? ''} onChange={(e) => update({ agentId: e.target.value })}
              className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs">
              <option value="">— selecione —</option>
              {agents.filter(a => a.isActive || a.id === data.agentId).map((a) => <option key={a.id} value={a.id}>{a.name}{!a.isActive ? ' (inativo)' : ''}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={data.awaitReply ?? false}
              onChange={(e) => update({ awaitReply: e.target.checked })} className="h-3.5 w-3.5" />
            Conversa multi-turno (aguardar respostas do cliente)
          </label>
          {data.awaitReply && (
            <div className="space-y-1.5">
              <label className="text-xs">Máx. de turnos</label>
              <input type="number" value={data.maxTurns ?? 6} onChange={(e) => update({ maxTurns: Number(e.target.value) })}
                className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
            </div>
          )}
        </>
      )}

      {type === 'wait_for_human' && (
        <div className="space-y-1.5">
          <label className="text-xs">Setor (opcional)</label>
          <select value={data.teamId ?? ''} onChange={(e) => update({ teamId: e.target.value || null })}
            className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs">
            <option value="">— mantém o atual —</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}

      {type === 'tag' && (
        <>
          <div className="space-y-1.5">
            <label className="text-xs">Tags na conversa (separadas por vírgula)</label>
            <input value={(data.conversationTags ?? []).join(', ')}
              onChange={(e) => update({ conversationTags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs">Tags no contato</label>
            <input value={(data.contactTags ?? []).join(', ')}
              onChange={(e) => update({ contactTags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
          </div>
        </>
      )}

      {type === 'check_company_hours' && (
        <p className="text-[10px] text-muted-foreground">
          Verifica o horário de funcionamento da empresa agora.
          Saídas: <code>true</code> (aberto) / <code>false</code> (fechado).
        </p>
      )}

      {type === 'check_user_available' && (
        <>
          <div className="space-y-1.5">
            <label className="text-xs">Usuário</label>
            <select value={data.userId ?? ''} onChange={(e) => update({ userId: e.target.value })}
              className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs">
              <option value="">— selecione —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Saídas: <code>true</code> (disponível) / <code>false</code>.
          </p>
        </>
      )}

      {type === 'find_free_slots' && (
        <>
          <div className="space-y-1.5">
            <label className="text-xs">Usuário (agenda)</label>
            <select value={data.userId ?? ''} onChange={(e) => update({ userId: e.target.value })}
              className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs">
              <option value="">— selecione —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <label className="text-xs">Duração (min)</label>
              <input type="number" value={data.durationMin ?? 30} onChange={(e) => update({ durationMin: Number(e.target.value) })}
                className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs">Dias à frente</label>
              <input type="number" value={data.daysAhead ?? 7} onChange={(e) => update({ daysAhead: Number(e.target.value) })}
                className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs">Máx. slots</label>
              <input type="number" value={data.maxSlots ?? 5} onChange={(e) => update({ maxSlots: Number(e.target.value) })}
                className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Grava <code>{'{{freeSlotsText}}'}</code> e <code>freeSlot</code> no contexto.
            Saídas: <code>true</code> (achou) / <code>false</code>.
          </p>
        </>
      )}

      {type === 'create_appointment' && (
        <>
          <div className="space-y-1.5">
            <label className="text-xs">Dono da agenda</label>
            <select value={data.ownerId ?? ''} onChange={(e) => update({ ownerId: e.target.value })}
              className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs">
              <option value="">— selecione —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs">Título</label>
            <input value={data.title ?? ''} onChange={(e) => update({ title: e.target.value })}
              className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label className="text-xs">Duração (min)</label>
              <input type="number" value={data.durationMin ?? 30} onChange={(e) => update({ durationMin: Number(e.target.value) })}
                className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs">Var. de início</label>
              <input value={data.startVar ?? 'freeSlot'} onChange={(e) => update({ startVar: e.target.value })}
                className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={data.linkToConversation ?? true}
              onChange={(e) => update({ linkToConversation: e.target.checked })} className="h-3.5 w-3.5" />
            Vincular à conversa/contato atual
          </label>
          <p className="text-[10px] text-muted-foreground">
            Usa <code>ctx.vars.{data.startVar ?? 'freeSlot'}</code> (ISO) como início.
            Sincroniza no Google do dono se conectado.
          </p>
        </>
      )}

      {type === 'input' && (
        <>
          <div className="space-y-1.5">
            <label className="text-xs">Pergunta ao cliente</label>
            <textarea value={data.prompt ?? ''} onChange={(e) => update({ prompt: e.target.value })} rows={3}
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-xs resize-y" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label className="text-xs">Tipo</label>
              <select value={data.inputType ?? 'text'} onChange={(e) => update({ inputType: e.target.value })}
                className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs">
                {['text', 'number', 'email', 'phone', 'date', 'url'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs">Salvar em var</label>
              <input value={data.varName ?? ''} onChange={(e) => update({ varName: e.target.value })}
                className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs">Mensagem de erro</label>
            <input value={data.retryMessage ?? ''} onChange={(e) => update({ retryMessage: e.target.value })}
              className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs">Tentativas extras (depois segue saída "invalid")</label>
            <input type="number" value={data.maxRetries ?? 2} onChange={(e) => update({ maxRetries: Number(e.target.value) })}
              className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
          </div>
          <p className="text-[10px] text-muted-foreground">Saídas: <code>default</code> (válido) / <code>invalid</code>.</p>
        </>
      )}

      {type === 'http_request' && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <label className="text-xs">Método</label>
              <select value={data.method ?? 'GET'} onChange={(e) => update({ method: e.target.value })}
                className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs">
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="text-xs">URL</label>
              <input value={data.url ?? ''} onChange={(e) => update({ url: e.target.value })}
                className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs">Headers (JSON)</label>
            <textarea value={JSON.stringify(data.headers ?? {}, null, 0)}
              onChange={(e) => { try { update({ headers: JSON.parse(e.target.value || '{}') }) } catch {} }}
              rows={2} className="w-full rounded-lg border bg-transparent px-2 py-2 text-[11px] font-mono resize-y" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs">Body (texto ou JSON, suporta {'{{...}}'})</label>
            <textarea value={typeof data.body === 'string' ? data.body : JSON.stringify(data.body ?? '', null, 0)}
              onChange={(e) => update({ body: e.target.value })}
              rows={3} className="w-full rounded-lg border bg-transparent px-2 py-2 text-[11px] font-mono resize-y" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label className="text-xs">Salvar em var</label>
              <input value={data.saveAs ?? 'http'} onChange={(e) => update({ saveAs: e.target.value })}
                className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs">Timeout (ms)</label>
              <input type="number" value={data.timeoutMs ?? 10000} onChange={(e) => update({ timeoutMs: Number(e.target.value) })}
                className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Grava <code>{'{{' + (data.saveAs ?? 'http') + '.body}}'}</code>. Saídas: <code>success</code> / <code>error</code>.
          </p>
        </>
      )}

      {type === 'set_variable' && (
        <div className="space-y-1.5">
          <label className="text-xs">Atribuições</label>
          {(data.assignments ?? []).map((a: any, i: number) => (
            <div key={i} className="flex gap-1.5">
              <input value={a.varName} placeholder="var" onChange={(e) => {
                const next = [...(data.assignments ?? [])]; next[i] = { ...next[i], varName: e.target.value }; update({ assignments: next })
              }} className="w-20 rounded border bg-transparent px-2 py-1 text-xs" />
              <input value={a.valueExpr} placeholder="{{ vars.x }} ou literal" onChange={(e) => {
                const next = [...(data.assignments ?? [])]; next[i] = { ...next[i], valueExpr: e.target.value }; update({ assignments: next })
              }} className="flex-1 rounded border bg-transparent px-2 py-1 text-xs font-mono" />
              <button onClick={() => update({ assignments: (data.assignments ?? []).filter((_: any, j: number) => j !== i) })}
                className="p-1 rounded hover:bg-destructive/10 text-muted-foreground"><Trash2 className="h-3 w-3" /></button>
            </div>
          ))}
          <button onClick={() => update({ assignments: [...(data.assignments ?? []), { varName: '', valueExpr: '' }] })}
            className="text-xs text-primary flex items-center gap-1 mt-1"><Plus className="h-3 w-3" /> atribuição</button>
        </div>
      )}

      {type === 'code' && (
        <>
          <div className="space-y-1.5">
            <label className="text-xs">Código JS (recebe <code>vars</code>, deve <code>return</code> objeto)</label>
            <textarea value={data.code ?? ''} onChange={(e) => update({ code: e.target.value })} rows={6}
              className="w-full rounded-lg border bg-transparent px-2 py-2 text-[11px] font-mono resize-y" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs">Salvar em var (vazio = mescla em vars)</label>
            <input value={data.saveAs ?? ''} onChange={(e) => update({ saveAs: e.target.value })}
              className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
          </div>
          <p className="text-[10px] text-muted-foreground">Sandbox isolado, sem acesso a rede/arquivos. Timeout {data.timeoutMs ?? 1000}ms.</p>
        </>
      )}

      {type === 'switch' && (
        <>
          <label className="text-xs">Cláusulas (cada uma vira uma saída)</label>
          {(data.clauses ?? []).map((c: any, i: number) => (
            <div key={i} className="border rounded-lg p-2 space-y-1.5">
              <div className="flex gap-1.5">
                <input value={c.handle} placeholder="saída" onChange={(e) => {
                  const next = [...(data.clauses ?? [])]; next[i] = { ...next[i], handle: e.target.value }; update({ clauses: next })
                }} className="w-20 rounded border bg-transparent px-2 py-1 text-xs" />
                <input value={c.field} placeholder="campo" onChange={(e) => {
                  const next = [...(data.clauses ?? [])]; next[i] = { ...next[i], field: e.target.value }; update({ clauses: next })
                }} className="flex-1 rounded border bg-transparent px-2 py-1 text-xs font-mono" />
                <button onClick={() => update({ clauses: (data.clauses ?? []).filter((_: any, j: number) => j !== i) })}
                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground"><Trash2 className="h-3 w-3" /></button>
              </div>
              <div className="flex gap-1.5">
                <select value={c.op ?? 'eq'} onChange={(e) => {
                  const next = [...(data.clauses ?? [])]; next[i] = { ...next[i], op: e.target.value }; update({ clauses: next })
                }} className="w-24 rounded border bg-transparent px-2 py-1 text-xs">
                  {['eq', 'neq', 'contains', 'in', 'gt', 'lt', 'exists', 'matches_regex'].map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                <input value={String(c.value ?? '')} placeholder="valor" onChange={(e) => {
                  const next = [...(data.clauses ?? [])]; next[i] = { ...next[i], value: e.target.value }; update({ clauses: next })
                }} className="flex-1 rounded border bg-transparent px-2 py-1 text-xs" />
              </div>
            </div>
          ))}
          <button onClick={() => update({ clauses: [...(data.clauses ?? []), { handle: `caso${(data.clauses?.length ?? 0) + 1}`, field: 'context.lastUserInput', op: 'eq', value: '' }] })}
            className="text-xs text-primary flex items-center gap-1"><Plus className="h-3 w-3" /> cláusula</button>
          <p className="text-[10px] text-muted-foreground">Saída <code>{data.defaultHandle ?? 'default'}</code> quando nenhuma casa.</p>
        </>
      )}

      {type === 'loop' && (
        <>
          <div className="space-y-1.5">
            <label className="text-xs">Var do array (ex: vars.items)</label>
            <input value={data.itemsVar ?? ''} onChange={(e) => update({ itemsVar: e.target.value })}
              className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs font-mono" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label className="text-xs">Var do item</label>
              <input value={data.itemVar ?? 'item'} onChange={(e) => update({ itemVar: e.target.value })}
                className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs">Máx. iterações</label>
              <input type="number" value={data.maxIterations ?? 100} onChange={(e) => update({ maxIterations: Number(e.target.value) })}
                className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Saída <code>loop</code> = corpo (executado por item); saída padrão = após o loop.
            Nós que pausam não são suportados dentro do loop.
          </p>
        </>
      )}

      {type === 'call_flow' && (
        <div className="space-y-1.5">
          <label className="text-xs">Sub-fluxo</label>
          <select value={data.flowId ?? ''} onChange={(e) => update({ flowId: e.target.value })}
            className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs">
            <option value="">— selecione —</option>
            {flows.filter((f) => f.id !== node.id).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <p className="text-[10px] text-muted-foreground">
            Executa outro fluxo como sub-rotina (mesma conversa). Variáveis de entrada/saída via mapeamento (JSON em data).
          </p>
        </div>
      )}

      {type === 'close_conversation' && (
        <>
          <div className="space-y-1.5">
            <label className="text-xs">Mensagem de despedida (opcional)</label>
            <textarea value={data.closingMessage ?? ''} onChange={(e) => update({ closingMessage: e.target.value })} rows={3}
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-xs resize-y" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs">Quem finalizou (registro)</label>
            <input value={data.finalizerLabel ?? 'Autoatendimento'} onChange={(e) => update({ finalizerLabel: e.target.value })}
              className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Define a conversa como <code>RESOLVED</code> e registra no histórico que foi o autoatendimento.
            Nova mensagem do cliente abre um ticket novo e reinicia o fluxo. Nó terminal (sem saída).
          </p>
        </>
      )}

      {type === 'ai_generate' && (
        <>
          <div className="space-y-1.5">
            <label className="text-xs">Agente IA (usa o prompt/modelo dele)</label>
            <select value={data.agentId ?? ''} onChange={(e) => update({ agentId: e.target.value })}
              className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs">
              <option value="">— nenhum (use prompt abaixo) —</option>
              {agents.filter(a => a.isActive || a.id === data.agentId).map((a) => <option key={a.id} value={a.id}>{a.name}{!a.isActive ? ' (inativo)' : ''}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs">Prompt (suporta {'{{...}}'})</label>
            <textarea value={data.promptTemplate ?? ''} onChange={(e) => update({ promptTemplate: e.target.value })} rows={5}
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-[11px] resize-y" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs">Salvar texto gerado em var</label>
            <input value={data.saveAs ?? 'aiText'} onChange={(e) => update({ saveAs: e.target.value })}
              className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
          </div>
          <p className="text-[10px] text-muted-foreground">Não envia nada — só gera e grava em <code>{'{{' + (data.saveAs || 'aiText') + '}}'}</code>.</p>
        </>
      )}

      {type === 'send_message' && (
        <>
          <div className="space-y-1.5">
            <label className="text-xs">Destino</label>
            <select value={data.toMode ?? 'fixed'} onChange={(e) => update({ toMode: e.target.value })}
              className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs">
              <option value="fixed">Número/email fixo (proativo / cron)</option>
              <option value="conversation">Responder na conversa atual</option>
            </select>
            {data.toMode === 'conversation' && (
              <p className="text-[10px] text-muted-foreground">Responde quem disparou o fluxo (WhatsApp). Em cron, cai para o número fixo abaixo.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label className="text-xs">Canal</label>
              <select value={data.channelType ?? 'WHATSAPP'} onChange={(e) => update({ channelType: e.target.value })}
                className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs">
                <option value="WHATSAPP">WhatsApp</option>
                <option value="EMAIL">Email</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs">Origem (source)</label>
              <input value={data.source ?? 'flow'} onChange={(e) => update({ source: e.target.value })}
                className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs">Destinatário {data.toMode === 'conversation' ? '(fallback p/ cron)' : ''} ({data.channelType === 'EMAIL' ? 'email' : 'telefone'}) — {'{{...}}'}</label>
            <input value={data.to ?? ''} onChange={(e) => update({ to: e.target.value })}
              placeholder={data.channelType === 'EMAIL' ? 'cliente@ex.com' : '5511999999999'}
              className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs font-mono" />
          </div>
          {data.channelType === 'EMAIL' && (
            <div className="space-y-1.5">
              <label className="text-xs">Assunto</label>
              <input value={data.subject ?? ''} onChange={(e) => update({ subject: e.target.value })}
                className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs">Mensagem (suporta {'{{...}}'})</label>
            <textarea value={data.body ?? ''} onChange={(e) => update({ body: e.target.value })} rows={4}
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-xs resize-y" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs">Contato vinculado (opcional, p/ dedup)</label>
            <input value={data.contactId ?? ''} onChange={(e) => update({ contactId: e.target.value })}
              placeholder="{{item.contactId}}"
              className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs font-mono" />
          </div>
          <p className="text-[10px] text-muted-foreground">Envio proativo (sem conversa). Saídas: <code>success</code> / <code>error</code>.</p>
        </>
      )}

      {type === 'check_notified' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label className="text-xs">Casar por</label>
              <select value={data.matchBy ?? 'to'} onChange={(e) => update({ matchBy: e.target.value })}
                className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs">
                <option value="to">Destinatário (to)</option>
                <option value="contactId">Contato (id)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs">Janela (dias)</label>
              <input type="number" value={data.withinDays ?? 2} onChange={(e) => update({ withinDays: Number(e.target.value) })}
                className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs">Valor ({'{{...}}'})</label>
            <input value={data.value ?? ''} onChange={(e) => update({ value: e.target.value })}
              className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs font-mono" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs">Origem (mesmo source do envio)</label>
            <input value={data.source ?? 'flow'} onChange={(e) => update({ source: e.target.value })}
              className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs" />
          </div>
          <p className="text-[10px] text-muted-foreground">Saídas: <code>notified</code> (já enviado na janela) / <code>not_notified</code>.</p>
        </>
      )}
    </div>
  )
}

// ─── Agendador visual (cron amigável) ────────────────────────────────────────
const SCHED_WDAYS = [
  { v: 1, l: 'Seg' }, { v: 2, l: 'Ter' }, { v: 3, l: 'Qua' }, { v: 4, l: 'Qui' },
  { v: 5, l: 'Sex' }, { v: 6, l: 'Sáb' }, { v: 0, l: 'Dom' },
]
type SchedFreq = 'daily' | 'weekly' | 'monthly' | 'hourly' | 'minutely' | 'advanced'
interface SchedState { freq: SchedFreq; time: string; days: number[]; dom: number; everyN: number; raw: string }

const pad2s = (n: number) => String(n).padStart(2, '0')

function parseSchedule(cron: string): SchedState {
  const def: SchedState = { freq: 'daily', time: '09:00', days: [1, 2, 3, 4, 5], dom: 1, everyN: 1, raw: cron || '0 9 * * *' }
  const parts = (cron || '').trim().split(/\s+/)
  if (parts.length !== 5) return def
  const [mi, ho, dom, mon, dow] = parts
  const mMin = mi.match(/^\*\/(\d+)$/)
  if (mMin && ho === '*' && dom === '*' && mon === '*' && dow === '*') return { ...def, freq: 'minutely', everyN: Number(mMin[1]) }
  const hMin = ho.match(/^\*\/(\d+)$/)
  if (/^\d+$/.test(mi) && hMin && dom === '*' && mon === '*' && dow === '*') return { ...def, freq: 'hourly', everyN: Number(hMin[1]) }
  if (/^\d+$/.test(mi) && /^\d+$/.test(ho) && mon === '*') {
    const time = `${pad2s(Number(ho))}:${pad2s(Number(mi))}`
    if (/^\d+$/.test(dom) && dow === '*') return { ...def, freq: 'monthly', time, dom: Number(dom) }
    if (dom === '*' && dow !== '*') {
      const days = dow.split(',').map(Number).filter((n) => !Number.isNaN(n))
      return { ...def, freq: 'weekly', time, days }
    }
    if (dom === '*' && dow === '*') return { ...def, freq: 'daily', time }
  }
  return { ...def, freq: 'advanced', raw: cron }
}

function buildSchedule(s: SchedState): string {
  const [h, m] = s.time.split(':').map(Number)
  const hh = h || 0, mm = m || 0
  switch (s.freq) {
    case 'daily': return `${mm} ${hh} * * *`
    case 'weekly': return `${mm} ${hh} * * ${s.days.length ? [...s.days].sort((a, b) => a - b).join(',') : '*'}`
    case 'monthly': return `${mm} ${hh} ${s.dom} * *`
    case 'hourly': return `0 */${Math.max(1, s.everyN)} * * *`
    case 'minutely': return `*/${Math.max(1, s.everyN)} * * * *`
    case 'advanced': return s.raw.trim()
  }
}

function describeSchedule(s: SchedState): string {
  switch (s.freq) {
    case 'daily': return `Todos os dias às ${s.time}`
    case 'weekly': {
      if (!s.days.length) return `Todos os dias às ${s.time}`
      if (s.days.length === 5 && [1, 2, 3, 4, 5].every((d) => s.days.includes(d))) return `Dias úteis às ${s.time}`
      const labels = SCHED_WDAYS.filter((d) => s.days.includes(d.v)).map((d) => d.l).join(', ')
      return `${labels} às ${s.time}`
    }
    case 'monthly': return `Todo dia ${s.dom} às ${s.time}`
    case 'hourly': return `A cada ${s.everyN}h`
    case 'minutely': return `A cada ${s.everyN}min`
    case 'advanced': return `Avançado: ${s.raw}`
  }
}

function ScheduleBuilder({ value, onChange }: { value: string; onChange: (cron: string) => void }) {
  const [open, setOpen] = useState(false)
  const [st, setSt] = useState<SchedState>(() => parseSchedule(value))
  // Re-sincroniza quando o valor muda EXTERNAMENTE (ex: fluxo carregou), sem
  // brigar com as edições internas (que já batem com buildSchedule(st)).
  useEffect(() => { if (value !== buildSchedule(st)) setSt(parseSchedule(value)) }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  const update = (patch: Partial<SchedState>) => { const next = { ...st, ...patch }; setSt(next); onChange(buildSchedule(next)) }
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className="text-xs border rounded px-2 py-1 bg-background flex items-center gap-1.5 hover:bg-accent">
        <Clock className="h-3 w-3 text-muted-foreground" /> {describeSchedule(st)}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 right-0 w-72 rounded-lg border bg-card shadow-xl p-3 space-y-2.5 text-xs">
            <div className="space-y-1">
              <label className="font-medium text-muted-foreground">Repetir</label>
              <select value={st.freq} onChange={(e) => update({ freq: e.target.value as SchedFreq })}
                className="w-full rounded border bg-transparent px-2 py-1.5">
                <option value="daily">Todos os dias</option>
                <option value="weekly">Dias da semana</option>
                <option value="monthly">Todo mês (dia fixo)</option>
                <option value="hourly">A cada X horas</option>
                <option value="minutely">A cada X minutos</option>
                <option value="advanced">Avançado (cron)</option>
              </select>
            </div>

            {(st.freq === 'daily' || st.freq === 'weekly' || st.freq === 'monthly') && (
              <div className="flex items-center gap-2">
                <label className="font-medium text-muted-foreground">Horário</label>
                <input type="time" value={st.time} onChange={(e) => update({ time: e.target.value })}
                  className="rounded border bg-transparent px-2 py-1" />
                <span className="text-[10px] text-muted-foreground">Brasília</span>
              </div>
            )}

            {st.freq === 'weekly' && (
              <div className="flex flex-wrap gap-1">
                {SCHED_WDAYS.map((d) => (
                  <button key={d.v}
                    onClick={() => update({ days: st.days.includes(d.v) ? st.days.filter((x) => x !== d.v) : [...st.days, d.v] })}
                    className={`px-2 py-1 rounded-full border ${st.days.includes(d.v) ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'}`}>
                    {d.l}
                  </button>
                ))}
              </div>
            )}

            {st.freq === 'monthly' && (
              <div className="flex items-center gap-2">
                <label className="font-medium text-muted-foreground">Dia do mês</label>
                <input type="number" min={1} max={28} value={st.dom}
                  onChange={(e) => update({ dom: Math.min(28, Math.max(1, Number(e.target.value))) })}
                  className="w-16 rounded border bg-transparent px-2 py-1" />
                <span className="text-[10px] text-muted-foreground">(1–28)</span>
              </div>
            )}

            {(st.freq === 'hourly' || st.freq === 'minutely') && (
              <div className="flex items-center gap-2">
                <label className="font-medium text-muted-foreground">A cada</label>
                <input type="number" min={1} value={st.everyN}
                  onChange={(e) => update({ everyN: Math.max(1, Number(e.target.value)) })}
                  className="w-16 rounded border bg-transparent px-2 py-1" />
                <span>{st.freq === 'hourly' ? 'horas' : 'minutos'}</span>
              </div>
            )}

            {st.freq === 'advanced' && (
              <div className="space-y-1">
                <input value={st.raw} onChange={(e) => update({ raw: e.target.value })} placeholder="0 9 * * *"
                  className="w-full rounded border bg-transparent px-2 py-1 font-mono" />
                <p className="text-[10px] text-muted-foreground">cron: minuto hora dia mês diadasemana (fuso Brasília).</p>
              </div>
            )}

            <div className="border-t pt-2 flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground truncate">{describeSchedule(st)}</span>
              <code className="text-[10px] text-muted-foreground shrink-0">{buildSchedule(st)}</code>
            </div>
            <button onClick={() => setOpen(false)} className="w-full rounded bg-primary text-primary-foreground py-1.5 font-medium">Pronto</button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Editor principal ────────────────────────────────────────────────────────
function EditorInner() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data: flow } = useQuery<any>({
    queryKey: ['flow', id],
    queryFn: () => apiFetch(`/flows/${id}`),
  })

  const { data: teams = [] } = useQuery<any[]>({ queryKey: ['teams', 'opt'], queryFn: () => apiFetch('/teams/options') })
  const { data: users = [] } = useQuery<any[]>({ queryKey: ['users-list'], queryFn: () => apiFetch('/users') })
  const { data: agents = [] } = useQuery<any[]>({ queryKey: ['agents-list'], queryFn: () => apiFetch('/ai/agents') })
  const { data: channels = [] } = useQuery<any[]>({ queryKey: ['channels-list'], queryFn: () => apiFetch('/channels') })
  const { data: flowsList = [] } = useQuery<any[]>({ queryKey: ['flows'], queryFn: () => apiFetch('/flows') })

  const [showExecPanel, setShowExecPanel] = useState(false)
  const [selectedExecId, setSelectedExecId] = useState<string | null>(null)
  const { data: executions = [], refetch: refetchExecs, isFetching: execsFetching } = useQuery<any[]>({
    queryKey: ['flow-execs', id],
    queryFn: () => apiFetch(`/flows/${id}/executions?limit=50`),
    enabled: showExecPanel,
  })

  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [triggerType, setTriggerType] = useState('new_conversation')
  const [triggerChannelIds, setTriggerChannelIds] = useState<string[]>([])
  const [webhookToken, setWebhookToken] = useState('')
  const [cronSchedule, setCronSchedule] = useState('0 9 * * *')

  useEffect(() => {
    if (!flow) return
    setName(flow.name)
    setTriggerType(flow.trigger?.type ?? 'new_conversation')
    setTriggerChannelIds(flow.trigger?.filters?.channelIds ?? [])
    setWebhookToken(flow.trigger?.webhookToken ?? '')
    setCronSchedule(flow.trigger?.schedule ?? '0 9 * * *')
    const g = flow.graph ?? { nodes: [], edges: [] }
    setNodes((g.nodes ?? []).map((n: any) => ({
      id: n.id,
      type: 'custom',
      position: n.position ?? { x: 100, y: 100 },
      data: { type: n.type, config: n.data ?? {}, summary: summarize(n.type, n.data ?? {}) },
    })))
    setEdges((g.edges ?? []).map((e: any) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      label: e.sourceHandle ?? undefined,
      type: 'default',
    })))
  }, [flow])

  const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)), [])
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)), [])
  const onConnect = useCallback((c: Connection) => setEdges((eds) => addEdge({ ...c, label: c.sourceHandle ?? undefined }, eds)), [])

  function addNode(type: NodeType) {
    const id = makeId(type)
    const d = defaultData(type)
    setNodes((nds) => [...nds, {
      id, type: 'custom', position: { x: 200 + nds.length * 30, y: 200 + nds.length * 30 },
      data: { type, config: d, summary: summarize(type, d) },
    }])
  }

  function updateSelectedNode(config: any) {
    if (!selected) return
    const type = (nodes.find((n) => n.id === selected)?.data as any).type as NodeType
    setNodes((nds) => nds.map((n) =>
      n.id === selected ? { ...n, data: { type, config, summary: summarize(type, config) } } : n
    ))
  }

  function deleteSelected() {
    if (!selected) return
    setNodes((nds) => nds.filter((n) => n.id !== selected))
    setEdges((eds) => eds.filter((e) => e.source !== selected && e.target !== selected))
    setSelected(null)
  }

  const save = useMutation({
    mutationFn: () => apiFetch(`/flows/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: name.trim(),
        trigger: {
          type: triggerType,
          filters: triggerChannelIds.length > 0 ? { channelIds: triggerChannelIds } : undefined,
          webhookToken: triggerType === 'webhook' ? (webhookToken || undefined) : undefined,
          schedule: triggerType === 'cron' ? (cronSchedule || undefined) : undefined,
          scheduleTz: triggerType === 'cron' ? 'America/Sao_Paulo' : undefined,
        },
        graph: {
          nodes: nodes.map((n) => ({
            id: n.id,
            type: (n.data as any).type,
            position: n.position,
            data: (n.data as any).config,
          })),
          edges: edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: (e.sourceHandle ?? null) as any,
          })),
        },
      }),
    }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['flow', id] })
      queryClient.invalidateQueries({ queryKey: ['flows'] })
      const warnings: string[] = res?.warnings ?? []
      if (warnings.length > 0) {
        toast.warning(`Salvo com avisos: ${warnings.join(' · ')}`)
      } else {
        toast.success('Fluxo salvo')
      }
    },
  })

  const publish = useMutation({
    mutationFn: () => apiFetch(`/flows/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !flow?.isActive }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flow', id] })
      toast.success(flow?.isActive ? 'Despublicado' : 'Publicado')
    },
  })

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selected) ?? null, [nodes, selected])

  const selectedExec = useMemo(
    () => executions.find((e: any) => e.id === selectedExecId) ?? null,
    [executions, selectedExecId],
  )

  // Mapa de nó → ordem da 1ª visita no trace da execução selecionada.
  const traceOrder = useMemo(() => {
    const m = new Map<string, number>()
    const trace: any[] = Array.isArray(selectedExec?.trace) ? selectedExec.trace : []
    let i = 0
    for (const t of trace) {
      if (t?.nodeId && !m.has(t.nodeId)) m.set(t.nodeId, ++i)
    }
    return m
  }, [selectedExec])

  // Nós com overlay do trace (cor/ordem/nó atual). Derivado — não muta o estado.
  const displayNodes = useMemo(() => {
    if (!selectedExec) return nodes
    return nodes.map((n) => {
      const order = traceOrder.get(n.id)
      const isCurrent = selectedExec.currentNodeId === n.id
      return {
        ...n,
        data: {
          ...(n.data as any),
          traceVisited: order != null,
          traceCurrent: isCurrent,
          traceDimmed: order == null && !isCurrent,
          traceOrder: order,
        },
      }
    })
  }, [nodes, selectedExec, traceOrder])

  if (!flow) return <div className="p-8 text-sm text-muted-foreground">Carregando...</div>

  return (
    <div className="h-screen flex flex-col">
      {/* Topbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0 bg-card">
        <button onClick={() => router.push('/admin/flows')} className="p-1 rounded hover:bg-accent">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <input value={name} onChange={(e) => setName(e.target.value)}
          className="text-sm font-semibold bg-transparent border-b border-transparent hover:border-border focus:border-primary outline-none px-1 flex-1" />
        <select value={triggerType} onChange={(e) => setTriggerType(e.target.value)}
          className="text-xs border rounded px-2 py-1 bg-background">
          <option value="new_conversation">Trigger: nova conversa</option>
          <option value="manual">Trigger: manual</option>
          <option value="message_received">Trigger: mensagem recebida</option>
          <option value="webhook">Trigger: webhook</option>
          <option value="cron">Trigger: cron (agendado)</option>
        </select>
        {triggerType === 'webhook' && (
          <input value={webhookToken} onChange={(e) => setWebhookToken(e.target.value)}
            placeholder="token do webhook (mín. 8)"
            className="text-xs border rounded px-2 py-1 bg-background w-48" />
        )}
        {triggerType === 'cron' && (
          <ScheduleBuilder value={cronSchedule} onChange={setCronSchedule} />
        )}
        <button onClick={() => { setShowExecPanel((v) => !v); if (showExecPanel) setSelectedExecId(null) }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium ${
            showExecPanel ? 'border-primary text-primary' : 'hover:bg-accent'
          }`}>
          <History className="h-3.5 w-3.5" /> Execuções
        </button>
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50">
          <Save className="h-3.5 w-3.5" /> Salvar
        </button>
        <button onClick={() => publish.mutate()}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium ${
            flow.isActive ? 'border-green-500 text-green-600' : 'hover:bg-accent'
          }`}>
          <Play className="h-3.5 w-3.5" /> {flow.isActive ? 'Despublicar' : 'Publicar'}
        </button>
      </div>

      {/* Workspace */}
      <div className="flex-1 flex min-h-0">
        {/* Paleta */}
        <div className="w-48 border-r bg-muted/20 p-2 overflow-y-auto shrink-0">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-2">Adicionar nó</p>
          <div className="space-y-1">
            {PALETTE.map((t) => {
              const meta = NODE_META[t]
              const Icon = meta.icon
              return (
                <button key={t} onClick={() => addNode(t)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-accent text-left"
                  style={{ color: meta.color }}>
                  <Icon className="h-3.5 w-3.5" />
                  <span className="text-foreground">{meta.label}</span>
                </button>
              )
            })}
          </div>

          {triggerType === 'new_conversation' && channels.length > 0 && (
            <>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase mt-4 mb-2">Canais (filtros)</p>
              {channels.map((c: any) => (
                <label key={c.id} className="flex items-center gap-2 text-xs py-1 cursor-pointer">
                  <input type="checkbox"
                    checked={triggerChannelIds.includes(c.id)}
                    onChange={() => setTriggerChannelIds((prev) =>
                      prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]
                    )}
                    className="accent-primary" />
                  <span className="truncate">{c.label}</span>
                </label>
              ))}
            </>
          )}
        </div>

        {/* Painel de execuções (debug visual) */}
        {showExecPanel && (
          <div className="w-72 border-r bg-muted/10 flex flex-col shrink-0">
            <div className="flex items-center justify-between px-3 py-2 border-b">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase">Execuções</span>
              <div className="flex items-center gap-1">
                <button onClick={() => refetchExecs()} className="p-1 rounded hover:bg-accent text-muted-foreground" title="Atualizar">
                  <RefreshCw className={`h-3 w-3 ${execsFetching ? 'animate-spin' : ''}`} />
                </button>
                <button onClick={() => { setShowExecPanel(false); setSelectedExecId(null) }} className="p-1 rounded hover:bg-accent text-muted-foreground">
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {executions.length === 0 && (
                <p className="p-3 text-[11px] text-muted-foreground">Nenhuma execução ainda.</p>
              )}
              {executions.map((e: any) => {
                const active = e.id === selectedExecId
                const statusColor: Record<string, string> = {
                  RUNNING: 'text-blue-600', WAITING_INPUT: 'text-amber-600',
                  COMPLETED: 'text-emerald-600', FAILED: 'text-red-600', CANCELLED: 'text-muted-foreground',
                }
                return (
                  <button key={e.id} onClick={() => setSelectedExecId(active ? null : e.id)}
                    className={`w-full text-left px-3 py-2 border-b hover:bg-accent ${active ? 'bg-accent' : ''}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] font-bold ${statusColor[e.status] ?? ''}`}>{e.status}</span>
                      <span className="text-[10px] text-muted-foreground">{new Date(e.startedAt).toLocaleString('pt-BR')}</span>
                    </div>
                    <div className="text-[11px] truncate mt-0.5">
                      {e.conversation?.contact?.name ?? e.conversation?.contact?.phone ?? e.conversationId}
                    </div>
                  </button>
                )
              })}
            </div>
            {selectedExec && (
              <div className="border-t p-3 space-y-2 max-h-64 overflow-y-auto">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase">Contexto</p>
                <pre className="text-[10px] font-mono whitespace-pre-wrap break-all bg-muted/40 rounded p-2">
                  {JSON.stringify((selectedExec.context as any)?.vars ?? {}, null, 2)}
                </pre>
                <p className="text-[10px] text-muted-foreground">
                  {traceOrder.size} nós percorridos · atual: <code>{selectedExec.currentNodeId ?? '—'}</code>
                </p>
              </div>
            )}
          </div>
        )}

        {/* Canvas */}
        <div className="flex-1">
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelected(n.id)}
            onPaneClick={() => setSelected(null)}
            nodeTypes={nodeTypes}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable nodeColor={(n: any) => NODE_META[(n.data as any).type as NodeType]?.color ?? '#999'} />
          </ReactFlow>
        </div>

        {/* Inspector */}
        <div className="w-72 border-l bg-card overflow-y-auto shrink-0">
          <NodeInspector
            node={selectedNode}
            onChange={updateSelectedNode}
            onDelete={deleteSelected}
            teams={teams.map((t: any) => ({ id: t.id, name: t.name }))}
            users={users.map((u: any) => ({ id: u.id, name: u.name }))}
            agents={agents.map((a: any) => ({ id: a.id, name: a.name, isActive: a.isActive }))}
            flows={flowsList.map((f: any) => ({ id: f.id, name: f.name }))}
          />
        </div>
      </div>
    </div>
  )
}

export default function FlowEditorPage() {
  return (
    <ReactFlowProvider>
      <EditorInner />
    </ReactFlowProvider>
  )
}

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
} from 'lucide-react'

type NodeType =
  | 'start' | 'message' | 'menu' | 'condition'
  | 'assign_team' | 'assign_user' | 'start_bot'
  | 'wait_for_human' | 'tag' | 'end'
  | 'check_company_hours' | 'check_user_available' | 'find_free_slots' | 'create_appointment'

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
}

const PALETTE: NodeType[] = [
  'message', 'menu', 'condition', 'assign_team', 'assign_user', 'start_bot', 'wait_for_human', 'tag', 'end',
  'check_company_hours', 'check_user_available', 'find_free_slots', 'create_appointment',
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
    default: return {}
  }
}

// ─── Node visual ─────────────────────────────────────────────────────────────
function CustomNode({ data, selected }: { data: any; selected: boolean }) {
  const meta = NODE_META[data.type as NodeType]
  const Icon = meta?.icon ?? CircleDot
  return (
    <div className={`rounded-lg border-2 bg-card shadow-sm min-w-[180px] transition ${
      selected ? 'border-primary' : 'border-border'
    }`}>
      {data.type !== 'start' && <Handle type="target" position={Position.Top} className="w-2.5 h-2.5 bg-muted-foreground border-2 border-background" />}
      <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ color: meta?.color }}>
        <Icon className="h-3.5 w-3.5" />
        <span className="text-xs font-semibold">{meta?.label}</span>
      </div>
      <div className="px-3 py-2 text-[11px] text-muted-foreground line-clamp-2">
        {data.summary || '(configure...)'}
      </div>
      {DUAL_HANDLE_TYPES.has(data.type) ? (
        <>
          <Handle id="true" type="source" position={Position.Bottom} style={{ left: '30%' }}
            className="w-2.5 h-2.5 bg-emerald-500 border-2 border-background" />
          <Handle id="false" type="source" position={Position.Bottom} style={{ left: '70%' }}
            className="w-2.5 h-2.5 bg-red-500 border-2 border-background" />
        </>
      ) : (
        data.type !== 'end' && <Handle type="source" position={Position.Bottom} className="w-2.5 h-2.5 bg-primary border-2 border-background" />
      )}
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
    default: return ''
  }
}

const nodeTypes = { custom: CustomNode as any }

// ─── Painel lateral de edição ────────────────────────────────────────────────
function NodeInspector({
  node, onChange, onDelete, teams, users, agents,
}: {
  node: Node | null
  onChange: (data: any) => void
  onDelete: () => void
  teams: { id: string; name: string }[]
  users: { id: string; name: string }[]
  agents: { id: string; name: string; isActive?: boolean }[]
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
        <div className="space-y-1.5">
          <label className="text-xs">Agente IA</label>
          <select value={data.agentId ?? ''} onChange={(e) => update({ agentId: e.target.value })}
            className="w-full rounded-lg border bg-transparent px-2 py-2 text-xs">
            <option value="">— selecione —</option>
            {agents.filter(a => a.isActive || a.id === data.agentId).map((a) => <option key={a.id} value={a.id}>{a.name}{!a.isActive ? ' (inativo)' : ''}</option>)}
          </select>
        </div>
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

  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [triggerType, setTriggerType] = useState('new_conversation')
  const [triggerChannelIds, setTriggerChannelIds] = useState<string[]>([])

  useEffect(() => {
    if (!flow) return
    setName(flow.name)
    setTriggerType(flow.trigger?.type ?? 'new_conversation')
    setTriggerChannelIds(flow.trigger?.filters?.channelIds ?? [])
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
        </select>
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

        {/* Canvas */}
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
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

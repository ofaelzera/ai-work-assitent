'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Power, GitBranch, X, Download, Upload } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { AdminPageLayout } from '@/components/admin/AdminPageLayout'

interface Flow {
  id: string
  name: string
  description: string | null
  trigger: any
  isActive: boolean
  priority: number
  version: number
  updatedAt: string
  _count: { executions: number }
}

function NewFlowModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const create = useMutation({
    mutationFn: () => apiFetch<{ id: string }>('/flows', {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(),
        description: description.trim() || null,
        trigger: { type: 'new_conversation' },
        graph: {
          nodes: [
            { id: 'start', type: 'start', position: { x: 100, y: 100 }, data: {} },
          ],
          edges: [],
        },
        isActive: false,
      }),
    }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['flows'] })
      toast.success('Flow criado — vamos editar')
      onCreated(data.id)
    },
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="modal-surface rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-sm">Novo fluxo</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Nome</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Triagem inicial WhatsApp"
              autoFocus
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Descrição (opcional)</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm hover:bg-accent">Cancelar</button>
          <button onClick={() => name.trim() && create.mutate()} disabled={!name.trim() || create.isPending}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50">
            Criar e editar
          </button>
        </div>
      </div>
    </div>
  )
}

export default function FlowsPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [creating, setCreating] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: flows = [] } = useQuery<Flow[]>({
    queryKey: ['flows'],
    queryFn: () => apiFetch('/flows'),
  })

  async function exportFlow(id: string, name: string) {
    try {
      const data = await apiFetch<Record<string, unknown>>(`/flows/${id}/export`)
      const slug = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '') || 'fluxo'
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${slug}.flow.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      toast.error(e?.message ?? 'Falha ao exportar')
    }
  }

  const importFlow = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text()
      let json: unknown
      try { json = JSON.parse(text) } catch { throw new Error('Arquivo não é um JSON válido') }
      return apiFetch<{ id: string; name: string; warnings: string[] }>('/flows/import', {
        method: 'POST', body: JSON.stringify(json),
      })
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['flows'] })
      if (res.warnings?.length) {
        toast.warning(`Importado com avisos — revise no editor:\n${res.warnings.join('\n')}`, { duration: 9000 })
      } else {
        toast.success('Fluxo importado (inativo) — revise e publique')
      }
      window.location.href = `/admin/flows/${res.id}/edit`
    },
    onError: (e: any) => toast.error(e?.message ?? 'Falha ao importar fluxo'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/flows/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flows'] })
      toast.success('Flow removido')
    },
  })

  const toggle = useMutation({
    mutationFn: (vars: { id: string; isActive: boolean }) =>
      apiFetch(`/flows/${vars.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: vars.isActive }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['flows'] }),
  })

  return (
    <>
      <AdminPageLayout
        title="Fluxos de atendimento"
        icon={GitBranch}
        description="Crie jornadas com menus, condições e direcionamento automático."
        action={
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" accept="application/json,.json" className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) importFlow.mutate(file)
                e.target.value = '' // permite reimportar o mesmo arquivo
              }} />
            <button onClick={() => fileInputRef.current?.click()} disabled={importFlow.isPending}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium hover:bg-accent disabled:opacity-50">
              <Upload className="h-3.5 w-3.5" /> {importFlow.isPending ? 'Importando...' : 'Importar'}
            </button>
            <button onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
              <Plus className="h-3.5 w-3.5" /> Novo fluxo
            </button>
          </div>
        }
      >
        {flows.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            Nenhum fluxo criado ainda. Crie um para automatizar a triagem inicial das conversas.
          </div>
        ) : (
          <div className="space-y-2">
            {flows.map((f) => (
              <div key={f.id} className="rounded-xl border bg-card p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <GitBranch className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm">{f.name}</p>
                    {!f.isActive && (
                      <span className="text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
                        RASCUNHO
                      </span>
                    )}
                    <span className="text-[10px] font-mono text-muted-foreground">v{f.version}</span>
                  </div>
                  {f.description && <p className="text-xs text-muted-foreground">{f.description}</p>}
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Trigger: {f.trigger?.type ?? '—'} · {f._count.executions} execuçõe(s)
                  </p>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button onClick={() => toggle.mutate({ id: f.id, isActive: !f.isActive })}
                    className={`p-2 rounded hover:bg-accent ${f.isActive ? 'text-green-600' : 'text-muted-foreground'}`}
                    title={f.isActive ? 'Despublicar' : 'Publicar'}>
                    <Power className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => exportFlow(f.id, f.name)}
                    className="p-2 rounded hover:bg-accent text-muted-foreground" title="Exportar (JSON)">
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  <Link href={`/admin/flows/${f.id}/edit`} className="p-2 rounded hover:bg-accent text-muted-foreground" title="Editar">
                    <Pencil className="h-3.5 w-3.5" />
                  </Link>
                  <button onClick={async () => {
                      const ok = await confirm({ type: 'danger', title: `Remover "${f.name}"?`, confirmLabel: 'Remover' })
                      if (ok) remove.mutate(f.id)
                    }}
                    className="p-2 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="Remover">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </AdminPageLayout>

      {creating && (
        <NewFlowModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            window.location.href = `/admin/flows/${id}/edit`
          }}
        />
      )}
    </>
  )
}

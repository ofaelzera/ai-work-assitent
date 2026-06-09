'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { Plus, Trash2, Copy, KeyRound } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { CommApiKey } from './types'
import { Modal, Field, inputCls } from './CampaignsTab'

export function ApiKeysTab() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [createdSecret, setCreatedSecret] = useState<string | null>(null)

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['comm-api-keys'],
    queryFn: () => apiFetch<CommApiKey[]>('/comm/api-keys'),
  })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['comm-api-keys'] })

  const createMutation = useMutation({
    mutationFn: () => apiFetch<{ secret: string }>('/comm/api-keys', { method: 'POST', body: JSON.stringify({ name: name.trim() }) }),
    onSuccess: (r) => { invalidate(); setCreatedSecret(r.secret); setCreateOpen(false); setName('') },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao criar'),
  })
  const revokeMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/comm/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => { invalidate(); toast.success('API key revogada') },
    onError: () => toast.error('Erro ao revogar'),
  })

  async function revoke(k: CommApiKey) {
    const ok = await confirm({ title: 'Revogar API key?', message: `"${k.name}" deixará de funcionar imediatamente.`, type: 'danger', confirmLabel: 'Revogar' })
    if (ok) revokeMutation.mutate(k.id)
  }

  function copy(text: string) { navigator.clipboard.writeText(text); toast.success('Copiado') }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Chaves para integração externa via <code className="font-mono text-xs">POST /api/v1/messages</code> (header <code className="font-mono text-xs">X-Api-Key</code>).</p>
        <button onClick={() => setCreateOpen(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium shrink-0">
          <Plus className="h-4 w-4" /> Nova API key
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : keys.length === 0 ? (
        <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">Nenhuma API key criada.</div>
      ) : (
        <div className="rounded-xl border bg-card divide-y">
          {keys.map((k) => (
            <div key={k.id} className="flex items-center gap-3 px-4 py-3">
              <KeyRound className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm truncate">{k.name} {k.revokedAt && <span className="text-xs text-red-600">(revogada)</span>}</p>
                <p className="text-xs text-muted-foreground">
                  <code className="font-mono">cck_{k.prefix}…</code> · {k.scopes.join(', ')}
                  {k.lastUsedAt ? ` · usada ${new Date(k.lastUsedAt).toLocaleString('pt-BR')}` : ' · nunca usada'}
                </p>
              </div>
              {!k.revokedAt && (
                <button title="Revogar" onClick={() => revoke(k)} className="p-1.5 rounded-lg hover:bg-muted shrink-0"><Trash2 className="h-4 w-4 text-destructive" /></button>
              )}
            </div>
          ))}
        </div>
      )}

      {createOpen && (
        <Modal onClose={() => setCreateOpen(false)} title="Nova API key">
          <Field label="Nome" required>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Integração Faturamento" />
          </Field>
          <div className="flex justify-end gap-2 mt-6">
            <button onClick={() => setCreateOpen(false)} className="px-4 py-2 rounded-lg border text-sm">Cancelar</button>
            <button onClick={() => name.trim() ? createMutation.mutate() : toast.error('Nome obrigatório')} disabled={createMutation.isPending} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">Criar</button>
          </div>
        </Modal>
      )}

      {createdSecret && (
        <Modal onClose={() => setCreatedSecret(null)} title="API key criada">
          <p className="text-sm text-muted-foreground mb-3">Copie agora — o segredo completo não será exibido novamente.</p>
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
            <code className="font-mono text-xs break-all flex-1">{createdSecret}</code>
            <button onClick={() => copy(createdSecret)} className="p-1.5 rounded hover:bg-muted shrink-0"><Copy className="h-4 w-4" /></button>
          </div>
          <div className="flex justify-end mt-6">
            <button onClick={() => setCreatedSecret(null)} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Entendi</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

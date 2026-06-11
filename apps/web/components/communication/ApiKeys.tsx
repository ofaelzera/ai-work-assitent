'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { getApiUrl } from '@/lib/runtime-config'
import { toast } from 'sonner'
import { Plus, Trash2, Copy, KeyRound, Code2, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { CommApiKey } from './types'
import { Modal, Field, inputCls } from './ui'

export function ApiKeys() {
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
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Chaves para integração externa via <code className="font-mono text-xs">POST /api/v1/messages</code> (header <code className="font-mono text-xs">X-Api-Key</code>).</p>
        <button onClick={() => setCreateOpen(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium shrink-0">
          <Plus className="h-4 w-4" /> Nova API key
        </button>
      </div>

      <IntegrationDocs onCopy={copy} />

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

// ─── Documentação de integração (exemplos de payload) ─────────────────────────
function IntegrationDocs({ onCopy }: { onCopy: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'json' | 'form'>('json')
  const base = getApiUrl()
  const endpoint = `${base}/api/v1/messages`

  const jsonExample = `POST ${endpoint}
X-Api-Key: cck_sua_chave_aqui
Content-Type: application/json

{
  "canal": "whatsapp",                      // "whatsapp" ou "email"
  "canal_id": "cmq...",                     // opcional: conexão específica (veja abaixo)
  "destinatario": "5511999999999",          // telefone (WhatsApp) ou email
  "assunto": "Seu relatório",               // opcional, usado em e-mail
  "mensagem": "Olá! Segue o que você pediu.",
  "agendar_para": "2026-06-10 09:00:00",    // opcional (envio imediato se omitido)
  "anexos": [
    { "tipo": "url", "nome": "relatorio.pdf", "arquivo": "https://cdn.exemplo.com/relatorio.pdf" },
    { "tipo": "base64", "nome": "contrato.pdf", "mime_type": "application/pdf", "arquivo": "JVBERi0xLjQK..." }
  ]
}`

  const jsonResponse = `{
  "success": true,
  "message_id": "cmq6...",
  "status": "queued"        // ou "scheduled" se agendado
}`

  const formExample = `POST ${endpoint}
X-Api-Key: cck_sua_chave_aqui
Content-Type: multipart/form-data

canal=email
canal_id=cmq...                  # opcional: conexão específica
destinatario=cliente@empresa.com
assunto=Segue o relatório
mensagem=Olá, segue em anexo o relatório do mês.
arquivo1=@relatorio.pdf          # qualquer campo de ARQUIVO vira anexo
arquivo2=@planilha.xlsx`

  const curlExample = `curl -X POST "${endpoint}" \\
  -H "X-Api-Key: cck_sua_chave_aqui" \\
  -H "Content-Type: application/json" \\
  -d '{"canal":"whatsapp","destinatario":"5511999999999","mensagem":"Teste"}'`

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-muted/40 transition-colors">
        <Code2 className="h-4 w-4 text-primary" />
        Como integrar — exemplos de requisição
        <ChevronDown className={cn('h-4 w-4 ml-auto text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t pt-3">
          <div className="text-xs text-muted-foreground">
            Endpoint: <code className="font-mono text-foreground">POST {endpoint}</code><br />
            Autenticação: header <code className="font-mono text-foreground">X-Api-Key: &lt;sua chave&gt;</code> (ou <code className="font-mono text-foreground">Authorization: Bearer &lt;chave&gt;</code>).
          </div>
          <div className="text-xs rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 text-amber-800 dark:text-amber-300 p-3">
            ⚠️ Use exatamente o host acima (<code className="font-mono">{base}</code>) — é o endereço da <strong>API</strong>. Não use o endereço do painel no navegador: ele é o app web e não atende <code className="font-mono">/api/v1</code> (retorna 404).
          </div>

          <div className="flex items-center gap-1">
            <Tab active={tab === 'json'} onClick={() => setTab('json')}>JSON</Tab>
            <Tab active={tab === 'form'} onClick={() => setTab('form')}>Form-data (upload)</Tab>
          </div>

          {tab === 'json' ? (
            <>
              <CodeBlock title="Requisição (JSON)" code={jsonExample} onCopy={onCopy} />
              <CodeBlock title="Resposta" code={jsonResponse} onCopy={onCopy} />
              <CodeBlock title="Exemplo com cURL" code={curlExample} onCopy={onCopy} />
            </>
          ) : (
            <>
              <CodeBlock title="Requisição (multipart/form-data)" code={formExample} onCopy={onCopy} />
              <p className="text-xs text-muted-foreground">
                Campos de texto: <code className="font-mono">canal</code>, <code className="font-mono">destinatario</code>, <code className="font-mono">assunto</code>, <code className="font-mono">mensagem</code>, <code className="font-mono">agendar_para</code>.
                Qualquer campo de <strong>arquivo</strong> é tratado como anexo (armazenado e enviado ao destinatário).
              </p>
            </>
          )}

          <div className="text-xs text-muted-foreground rounded-lg bg-muted/40 p-3 space-y-1">
            <p><strong>canal</strong>: <code className="font-mono">whatsapp</code> | <code className="font-mono">email</code></p>
            <p><strong>canal_id</strong> (opcional): use uma conexão específica em vez da primeira conectada do tipo. Copie o ID em <strong>Configurações › Canais conectados</strong> (botão "ID:" em cada canal). Se omitido, o sistema usa automaticamente a 1ª conexão conectada do canal.</p>
            <p><strong>destinatario</strong>: telefone com DDI (ex: 5511999999999) para WhatsApp, ou e-mail.</p>
            <p><strong>anexos</strong> (JSON): cada item é <code className="font-mono">url</code> ou <code className="font-mono">base64</code>. Tudo é armazenado antes do envio.</p>
            <p><strong>agendar_para</strong>: <code className="font-mono">YYYY-MM-DD HH:mm:ss</code> ou ISO 8601. Omita para envio imediato.</p>
          </div>
        </div>
      )}
    </div>
  )
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn('px-3 py-1 rounded-lg text-xs font-medium transition-colors', active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}>
      {children}
    </button>
  )
}

function CodeBlock({ title, code, onCopy }: { title: string; code: string; onCopy: (t: string) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <button onClick={() => onCopy(code)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><Copy className="h-3.5 w-3.5" /> Copiar</button>
      </div>
      <pre className="rounded-lg border bg-black/5 dark:bg-white/5 p-3 text-xs font-mono overflow-x-auto whitespace-pre">{code}</pre>
    </div>
  )
}

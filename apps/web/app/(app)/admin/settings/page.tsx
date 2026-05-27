'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { maskPhone, maskCNPJ } from '@/lib/masks'
import { toast } from 'sonner'
import { Shield, Plug, Key, Save, RefreshCw, CheckCircle2, AlertCircle, Users, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth'
import { AdminPageLayout } from '@/components/admin/AdminPageLayout'
import { AdminSection } from '@/components/admin/AdminSection'

interface Channel {
  id: string
  type: string
  label: string
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR'
}

interface Me {
  sub: string
  workspaceId: string
  role: 'ADMIN' | 'MEMBER'
}



function StatusDot({ status }: { status: Channel['status'] }) {
  return (
    <span
      className={cn(
        'h-2 w-2 rounded-full',
        status === 'CONNECTED' && 'bg-emerald-500',
        status === 'DISCONNECTED' && 'bg-yellow-500',
        status === 'ERROR' && 'bg-red-500',
      )}
    />
  )
}

const CHANNEL_TYPE_LABEL: Record<string, string> = {
  WHATSAPP: 'WhatsApp',
  IMAP_SMTP: 'Email (SMTP/IMAP)',
  GMAIL: 'Gmail',
}

// ─── Manutenção: dedup de contatos e conversas ───────────────────────────────
function MaintenancePanel() {
  const dedupConvs = useMutation({
    mutationFn: () => apiFetch<{ merged: number; checked: number }>('/conversations/dedup', { method: 'POST' }),
    onSuccess: (r) => {
      if (r.merged > 0) toast.success(`${r.merged} conversa(s) duplicada(s) mesclada(s) (${r.checked} verificadas)`)
      else toast.info(`Nenhuma duplicata encontrada (${r.checked} verificadas)`)
    },
    onError: () => toast.error('Erro ao deduplicar conversas'),
  })

  const dedupContacts = useMutation({
    mutationFn: () => apiFetch<{ merged: number; checked: number }>('/contacts/dedup', { method: 'POST' }),
    onSuccess: (r) => {
      if (r.merged > 0) toast.success(`${r.merged} contato(s) mesclado(s) (${r.checked} verificados)`)
      else toast.info(`Nenhum contato duplicado encontrado (${r.checked} verificados)`)
    },
    onError: () => toast.error('Erro ao deduplicar contatos'),
  })

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Estas rotinas rodam automaticamente após cada sincronização. Use os botões abaixo para forçar uma execução manual quando perceber dados duplicados.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={() => dedupConvs.mutate()}
          disabled={dedupConvs.isPending}
          className="flex items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3 text-left hover:border-primary/40 transition-colors disabled:opacity-50">
          <div>
            <p className="text-sm font-medium">Deduplicar conversas</p>
            <p className="text-xs text-muted-foreground">Mescla convs LIVE abertas do mesmo chat/contato</p>
          </div>
          {dedupConvs.isPending
            ? <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
            : <RefreshCw className="h-4 w-4 text-muted-foreground" />
          }
        </button>

        <button
          onClick={() => dedupContacts.mutate()}
          disabled={dedupContacts.isPending}
          className="flex items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3 text-left hover:border-primary/40 transition-colors disabled:opacity-50">
          <div>
            <p className="text-sm font-medium">Deduplicar contatos</p>
            <p className="text-xs text-muted-foreground">Funde LIDs do WhatsApp com seu PN correspondente</p>
          </div>
          {dedupContacts.isPending
            ? <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
            : <RefreshCw className="h-4 w-4 text-muted-foreground" />
          }
        </button>
      </div>
    </div>
  )
}

// ─── Dados da empresa ─────────────────────────────────────────────────────────
function CompanyDataPanel({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()

  type CompanySettings = {
    razaoSocial?: string | null
    cnpj?: string | null
    companyPhone?: string | null
    companyEmail?: string | null
    companyAddress?: string | null
  }

  const { data: settings, isLoading } = useQuery<Record<string, unknown>>({
    queryKey: ['workspace-settings'],
    queryFn: () => apiFetch<Record<string, unknown>>('/workspace/settings'),
  })

  const [form, setForm] = useState<CompanySettings>({
    razaoSocial: '',
    cnpj: '',
    companyPhone: '',
    companyEmail: '',
    companyAddress: '',
  })

  useEffect(() => {
    if (settings) {
      setForm({
        razaoSocial:    typeof settings.razaoSocial    === 'string' ? settings.razaoSocial    : '',
        cnpj:           typeof settings.cnpj           === 'string' ? settings.cnpj           : '',
        companyPhone:   typeof settings.companyPhone   === 'string' ? settings.companyPhone   : '',
        companyEmail:   typeof settings.companyEmail   === 'string' ? settings.companyEmail   : '',
        companyAddress: typeof settings.companyAddress === 'string' ? settings.companyAddress : '',
      })
    }
  }, [settings])

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<CompanySettings>) =>
      apiFetch('/workspace/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-settings'] })
      toast.success('Dados da empresa salvos')
    },
    onError: () => toast.error('Erro ao salvar dados da empresa'),
  })

  const dirty = settings && (
    form.razaoSocial    !== (typeof settings.razaoSocial    === 'string' ? settings.razaoSocial    : '') ||
    form.cnpj           !== (typeof settings.cnpj           === 'string' ? settings.cnpj           : '') ||
    form.companyPhone   !== (typeof settings.companyPhone   === 'string' ? settings.companyPhone   : '') ||
    form.companyEmail   !== (typeof settings.companyEmail   === 'string' ? settings.companyEmail   : '') ||
    form.companyAddress !== (typeof settings.companyAddress === 'string' ? settings.companyAddress : '')
  )

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>

  const field = (key: keyof CompanySettings, label: string, placeholder: string, mask?: (v: string) => string) => (
    <div>
      <label className="text-xs font-medium">{label}</label>
      <input
        value={mask ? mask(form[key] ?? '') : form[key] ?? ''}
        onChange={e => {
            const val = mask ? e.target.value.replace(/\D/g, '') : e.target.value;
            setForm(p => ({ ...p, [key]: val }))
        }}
        placeholder={placeholder}
        disabled={!isAdmin}
        className="mt-1.5 w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60"
      />
    </div>
  )

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Disponíveis como variáveis nos templates de mensagem: <code className="font-mono text-xs bg-muted px-1 rounded">{'{razao_social}'}</code>, <code className="font-mono text-xs bg-muted px-1 rounded">{'{cnpj}'}</code>
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field('razaoSocial',    'Razão Social',  'Empresa S.A.')}
        {field('cnpj',           'CNPJ',          '00.000.000/0001-00', maskCNPJ)}
        {field('companyPhone',   'Telefone',      '+55 (11) 99999-9999', maskPhone)}
        {field('companyEmail',   'E-mail',        'contato@empresa.com.br')}
      </div>
      {field('companyAddress', 'Endereço', 'Rua Exemplo, 123 – São Paulo/SP')}

      <div className="flex justify-end pt-2 border-t">
        <button
          onClick={() => saveMutation.mutate(form)}
          disabled={!dirty || !isAdmin || saveMutation.isPending}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
        </button>
      </div>

      {!isAdmin && (
        <p className="text-xs text-muted-foreground italic">Apenas administradores podem alterar estes dados.</p>
      )}
    </div>
  )
}

// ─── Regras globais do workspace ──────────────────────────────────────────────
function Toggle({ label, description, value, onChange, disabled }: {
  label: string
  description?: string
  value: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={cn('flex items-start gap-3 cursor-pointer', disabled && 'opacity-50 cursor-not-allowed')}>
      <div className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={value}
          onChange={e => !disabled && onChange(e.target.checked)}
          disabled={disabled}
        />
        <div className="w-9 h-5 bg-muted rounded-full peer peer-checked:bg-primary transition-colors" />
        <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
      </div>
      <div>
        <p className="text-sm font-medium leading-none">{label}</p>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </div>
    </label>
  )
}

function AiSettingsPanel({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()

  type WsSettings = {
    aiSuggestReplyEnabled?: boolean
  }

  const { data: settings, isLoading } = useQuery<WsSettings>({
    queryKey: ['workspace-settings'],
    queryFn: () => apiFetch<WsSettings>('/workspace/settings'),
  })

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<WsSettings>) =>
      apiFetch('/workspace/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-settings'] })
      toast.success('Configurações salvas')
    },
    onError: () => toast.error('Erro ao salvar configurações'),
  })

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>

  const s: WsSettings = settings ?? {}
  const patch = (update: Partial<WsSettings>) => saveMutation.mutate(update)

  return (
    <div className="space-y-5">
      <Toggle
        label="Permitir Sugestão de Resposta com IA"
        description="Habilita o botão mágico no chat para os atendentes pedirem ajuda à IA para redigir ou melhorar respostas."
        value={s.aiSuggestReplyEnabled ?? true} // Default true
        onChange={v => patch({ aiSuggestReplyEnabled: v })}
        disabled={!isAdmin || saveMutation.isPending}
      />
    </div>
  )
}

export default function SettingsPage() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'ADMIN'

  // ── Workspace name ──
  const [workspaceName, setWorkspaceName] = useState('')

  // ── Password change ──
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [pwSaving, setPwSaving] = useState(false)

  const { data: channels = [], isLoading: chLoading } = useQuery({
    queryKey: ['channels'],
    queryFn: () => apiFetch<Channel[]>('/channels'),
  })

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<Me>('/auth/me'),
  })

  const handleSaveWorkspace = async () => {
    if (!workspaceName.trim()) return
    try {
      await apiFetch('/workspaces/me', { method: 'PATCH', body: JSON.stringify({ name: workspaceName }) })
      toast.success('Nome do workspace salvo!')
    } catch (e: any) {
      toast.error(e?.message ?? 'Endpoint não disponível ainda')
    }
  }

  const handleChangePassword = async () => {
    if (pwForm.next !== pwForm.confirm) {
      toast.error('As senhas não coincidem')
      return
    }
    if (pwForm.next.length < 8) {
      toast.error('A nova senha deve ter ao menos 8 caracteres')
      return
    }
    setPwSaving(true)
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ current: pwForm.current, next: pwForm.next }),
      })
      toast.success('Senha alterada com sucesso!')
      setPwForm({ current: '', next: '', confirm: '' })
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao alterar senha')
    } finally {
      setPwSaving(false)
    }
  }

  const connected = channels.filter(c => c.status === 'CONNECTED')
  const disconnected = channels.filter(c => c.status !== 'CONNECTED')

  return (
    <AdminPageLayout
      title="Configurações"
      description="Gerencie as configurações do workspace"
    >
      {/* Workspace */}
      <AdminSection title="Workspace" icon={Shield} description="Configurações gerais do espaço de trabalho">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium">Nome do workspace</label>
            <div className="mt-1.5 flex gap-2">
              <input
                value={workspaceName}
                onChange={e => setWorkspaceName(e.target.value)}
                placeholder={`ID: ${me?.workspaceId ?? '...'}`}
                className="flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button
                onClick={handleSaveWorkspace}
                disabled={!workspaceName.trim() || !isAdmin}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" /> Salvar
              </button>
            </div>
            {!isAdmin && (
              <p className="mt-1.5 text-xs text-muted-foreground">Apenas administradores podem alterar o nome do workspace.</p>
            )}
          </div>

          <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-xs space-y-1">
            <p className="text-muted-foreground">Workspace ID: <span className="font-mono text-foreground">{me?.workspaceId ?? '—'}</span></p>
            <p className="text-muted-foreground">Seu perfil: <span className="font-semibold text-foreground">{user?.role ?? '—'}</span></p>
          </div>
        </div>
      </AdminSection>

      {/* Dados da empresa */}
      <AdminSection title="Dados da empresa" icon={Building2} description="Informações usadas nos templates de mensagem automática">
        <CompanyDataPanel isAdmin={isAdmin} />
      </AdminSection>

      {/* Inteligência Artificial */}
      {isAdmin && (
        <AdminSection title="Inteligência Artificial" icon={Users} description="Configurações globais de recursos inteligentes">
          <AiSettingsPanel isAdmin={isAdmin} />
        </AdminSection>
      )}

      {/* Segurança */}
      <AdminSection title="Segurança" icon={Shield} description="Altere sua senha de acesso">
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Senha atual</label>
            <input
              type="password"
              value={pwForm.current}
              onChange={e => setPwForm(p => ({ ...p, current: e.target.value }))}
              placeholder="••••••••"
              className="mt-1.5 w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium">Nova senha</label>
              <input
                type="password"
                value={pwForm.next}
                onChange={e => setPwForm(p => ({ ...p, next: e.target.value }))}
                placeholder="Mínimo 8 caracteres"
                className="mt-1.5 w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Confirmar senha</label>
              <input
                type="password"
                value={pwForm.confirm}
                onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))}
                placeholder="Repita a nova senha"
                className={cn(
                  'mt-1.5 w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2',
                  pwForm.confirm && pwForm.next !== pwForm.confirm
                    ? 'border-destructive focus:ring-destructive/50'
                    : 'focus:ring-primary/50',
                )}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleChangePassword}
              disabled={!pwForm.current || !pwForm.next || !pwForm.confirm || pwSaving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {pwSaving ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Alterando...</> : <><Save className="h-3.5 w-3.5" /> Alterar senha</>}
            </button>
          </div>
        </div>
      </AdminSection>

      {/* Integrações */}
      <AdminSection title="Integrações" icon={Plug} description="Resumo dos canais conectados">
        {chLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

        {!chLoading && channels.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum canal configurado. Vá para Admin → Canais.</p>
        )}

        {channels.length > 0 && (
          <div className="space-y-2">
            {channels.map(ch => (
              <div key={ch.id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                <StatusDot status={ch.status} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{ch.label}</p>
                  <p className="text-xs text-muted-foreground">{CHANNEL_TYPE_LABEL[ch.type] ?? ch.type}</p>
                </div>
                <div className="flex items-center gap-1 text-xs">
                  {ch.status === 'CONNECTED' ? (
                    <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /><span className="text-emerald-600">Conectado</span></>
                  ) : (
                    <><AlertCircle className="h-3.5 w-3.5 text-yellow-500" /><span className="text-yellow-600">{ch.status === 'ERROR' ? 'Erro' : 'Desconectado'}</span></>
                  )}
                </div>
              </div>
            ))}

            <div className="mt-3 text-xs text-muted-foreground">
              {connected.length} conectado(s) · {disconnected.length} desconectado(s)
            </div>
          </div>
        )}
      </AdminSection>

      {/* Manutenção (admin) */}
      {isAdmin && (
        <AdminSection title="Manutenção" icon={RefreshCw} description="Ferramentas de limpeza de dados">
          <MaintenancePanel />
        </AdminSection>
      )}

      {/* Vault Master Key */}
      <AdminSection title="Vault Master Key" icon={Key} description="Chave mestra de criptografia">
        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 p-4 text-sm text-amber-800 dark:text-amber-300 space-y-2">
          <p className="font-semibold flex items-center gap-2">
            <Key className="h-4 w-4" /> Configuração via variável de ambiente
          </p>
          <p>
            A chave mestra do cofre (<code className="font-mono bg-amber-100 dark:bg-amber-900/30 px-1 rounded text-xs">VAULT_MASTER_KEY</code>) é definida exclusivamente via variável de ambiente no servidor. Ela não pode ser alterada pela interface por razões de segurança.
          </p>
          <p className="text-xs">
            Para rotacionar a chave, atualize a variável de ambiente e reinicie o servidor. Todos os segredos precisarão ser re-criptografados.
          </p>
        </div>
      </AdminSection>
    </AdminPageLayout>
  )
}

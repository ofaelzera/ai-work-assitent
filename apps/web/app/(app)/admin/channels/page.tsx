'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { RefreshCw, Trash2, QrCode, X, Download, UserCircle, Plus, CheckCircle2, AlertCircle, Clock, Zap, PenLine, ChevronDown, ChevronUp, Bell, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import MessageTemplateField from '@/components/MessageTemplateField'
import RichEditor from '@/components/RichEditor'

interface Channel {
  id: string
  type: string
  label: string
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR'
  createdAt: string
}

interface QrData {
  base64?: string
  code?: string
}

// ─── Ícones SVG dos canais ────────────────────────────────────────────────────
function WhatsAppIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path fill="#25D366" d="M12 2C6.477 2 2 6.477 2 12c0 1.89.524 3.655 1.438 5.168L2 22l4.978-1.406A9.956 9.956 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2Z"/>
      <path fill="#fff" d="M16.75 14.51c-.25-.125-1.478-.728-1.707-.811-.228-.083-.394-.125-.56.125-.166.25-.645.811-.79.977-.146.166-.291.187-.54.063-.25-.125-1.054-.388-2.007-1.238-.742-.661-1.243-1.477-1.388-1.727-.145-.25-.015-.385.109-.51.112-.11.25-.291.374-.437.125-.146.167-.25.25-.416.084-.167.042-.313-.02-.438-.063-.125-.561-1.352-.769-1.852-.202-.486-.407-.42-.56-.428-.145-.007-.312-.009-.478-.009-.167 0-.437.063-.666.313-.229.25-.875.853-.875 2.08 0 1.229.896 2.416 1.021 2.582.125.166 1.764 2.693 4.273 3.779.597.257 1.063.411 1.427.527.599.19 1.145.163 1.576.099.48-.072 1.478-.605 1.687-1.188.208-.583.208-1.083.146-1.188-.063-.104-.23-.167-.48-.292Z"/>
    </svg>
  )
}

function EmailIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#4F46E5"/>
      <path d="M4 8l8 5 8-5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/>
      <rect x="4" y="7" width="16" height="11" rx="1.5" stroke="#fff" strokeWidth="1.5"/>
    </svg>
  )
}

function GmailIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6Z" fill="#fff"/>
      <path d="M22 6l-10 7L2 6" stroke="#EA4335" strokeWidth="2"/>
      <path d="M2 6h20v12H2z" fill="none"/>
      <path d="M2 6l10 7 10-7" fill="#EA4335"/>
    </svg>
  )
}

function TelegramIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" fill="#2AABEE"/>
      <path d="M17.5 7.5L5.5 12l3.5 1.5 1.5 4.5 2.5-2 3 2.5 2-10.5Z" fill="#fff"/>
    </svg>
  )
}

// ─── Catálogo de integrações disponíveis ──────────────────────────────────────
const AVAILABLE_INTEGRATIONS = [
  {
    key: 'whatsapp',
    name: 'WhatsApp',
    description: 'Via Evolution API. Envie e receba mensagens do WhatsApp.',
    Icon: WhatsAppIcon,
    color: 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-900',
    badge: 'Disponível',
    badgeColor: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  },
  {
    key: 'smtp',
    name: 'Email (SMTP/IMAP)',
    description: 'Integração de email temporariamente desativada.',
    Icon: EmailIcon,
    color: 'bg-indigo-50 border-indigo-200 dark:bg-indigo-950/20 dark:border-indigo-900',
    badge: 'Em breve',
    badgeColor: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
    disabled: true,
  },
  {
    key: 'gmail',
    name: 'Gmail (OAuth)',
    description: 'Conecte sua conta Gmail com autenticação segura via Google OAuth.',
    Icon: GmailIcon,
    color: 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900',
    badge: 'Em breve',
    badgeColor: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
    disabled: true,
  },
  {
    key: 'telegram',
    name: 'Telegram',
    description: 'Conecte um bot do Telegram para atendimento via chat.',
    Icon: TelegramIcon,
    color: 'bg-sky-50 border-sky-200 dark:bg-sky-950/20 dark:border-sky-900',
    badge: 'Em breve',
    badgeColor: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
    disabled: true,
  },
]

// ─── Modal WhatsApp ───────────────────────────────────────────────────────────
function WhatsAppModal({ onClose, onCreate }: { onClose: () => void; onCreate: (label: string) => void; isPending: boolean }) {
  const [label, setLabel] = useState('')
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <WhatsAppIcon size={32} />
            <div>
              <h2 className="font-semibold">Conectar WhatsApp</h2>
              <p className="text-xs text-muted-foreground">Via Evolution API</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nome do canal</label>
          <input
            autoFocus
            value={label}
            onChange={e => setLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && label && onCreate(label)}
            placeholder="Ex: WhatsApp Principal"
            className="w-full rounded-lg border bg-transparent px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
          Após criar, um QR Code será exibido. Escaneie com o WhatsApp em <strong>Dispositivos vinculados → Vincular dispositivo</strong>.
        </p>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-accent">Cancelar</button>
          <button
            onClick={() => label && onCreate(label)}
            disabled={!label}
            className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
          >
            <Plus className="h-3.5 w-3.5" />
            Criar canal
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Campo de formulário (fora do modal para evitar perda de foco no re-render) ─
function SmtpField({ label, field, placeholder, type = 'text', value, onChange }: {
  label: string; field: string; placeholder: string; type?: string
  value: string; onChange: (field: string, value: string) => void
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(field, e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
      />
    </div>
  )
}

// ─── Modal SMTP ───────────────────────────────────────────────────────────────
function SmtpModal({ onClose, onSave, isPending }: { onClose: () => void; onSave: (data: any) => void; isPending: boolean }) {
  const [form, setForm] = useState({
    label: '', smtpHost: '', smtpPort: '587', smtpUser: '', smtpPass: '',
    imapHost: '', imapPort: '993', fromName: '', fromEmail: '',
  })
  const handleChange = (field: string, value: string) => setForm(f => ({ ...f, [field]: value }))

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const canSubmit = form.label && form.smtpHost && form.smtpUser && form.smtpPass && form.fromEmail

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div className="flex items-center gap-3">
            <EmailIcon size={32} />
            <div>
              <h2 className="font-semibold">Conectar Email</h2>
              <p className="text-xs text-muted-foreground">SMTP para envio • IMAP para recebimento</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <SmtpField label="Nome do canal *" field="label" placeholder="Ex: Gmail Trabalho" value={form.label} onChange={handleChange} />

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Configuração SMTP (envio)</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2"><SmtpField label="Servidor SMTP *" field="smtpHost" placeholder="smtp.gmail.com" value={form.smtpHost} onChange={handleChange} /></div>
              <SmtpField label="Porta *" field="smtpPort" placeholder="587" value={form.smtpPort} onChange={handleChange} />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <SmtpField label="Usuário *" field="smtpUser" placeholder="voce@gmail.com" value={form.smtpUser} onChange={handleChange} />
              <SmtpField label="Senha / App Password *" field="smtpPass" placeholder="••••••••" type="password" value={form.smtpPass} onChange={handleChange} />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <SmtpField label="Email remetente *" field="fromEmail" placeholder="voce@gmail.com" value={form.fromEmail} onChange={handleChange} />
              <SmtpField label="Nome remetente" field="fromName" placeholder="Meu Nome" value={form.fromName} onChange={handleChange} />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Configuração IMAP (recebimento)</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2"><SmtpField label="Servidor IMAP" field="imapHost" placeholder="imap.gmail.com" value={form.imapHost} onChange={handleChange} /></div>
              <SmtpField label="Porta" field="imapPort" placeholder="993" value={form.imapPort} onChange={handleChange} />
            </div>
          </div>

          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300 space-y-1">
            <p className="font-semibold">💡 Gmail — use App Password</p>
            <p>Conta Google → Segurança → Verificação em duas etapas → Senhas de app</p>
            <p className="text-muted-foreground">SMTP: smtp.gmail.com:587 • IMAP: imap.gmail.com:993</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-accent">Cancelar</button>
          <button
            onClick={() => onSave(form)}
            disabled={!canSubmit || isPending}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 flex items-center gap-2"
          >
            {isPending ? (
              <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Testando conexão...</>
            ) : (
              <><CheckCircle2 className="h-3.5 w-3.5" /> Conectar</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Toggle booleano simples ──────────────────────────────────────────────────
function Toggle({ value, onChange, label, description }: {
  value: boolean; onChange: (v: boolean) => void; label: string; description?: string
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none',
          value ? 'bg-primary' : 'bg-muted-foreground/30',
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
            value ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </button>
    </div>
  )
}

// ─── Painel de regras do canal ────────────────────────────────────────────────
function ChannelRulesPanel({ channelId, channelType }: { channelId: string; channelType: string }) {
  const queryClient = useQueryClient()
  const isWa = channelType === 'WHATSAPP'

  type Settings = {
    ignoreGroups?: boolean
    archiveGroups?: boolean
    autoResolveOnRead?: boolean
    prefixSenderName?: boolean
    distributionMode?: 'all' | 'fixed' | 'round_robin'
    defaultAssigneeId?: string | null
    roundRobinUserIds?: string[]
    welcomeMessage?: string | null
    closingMessage?: string | null
    sendClosingOnAdminFinalize?: boolean
  }

  const { data: settings, isLoading } = useQuery<Settings>({
    queryKey: ['channel-settings', channelId],
    queryFn: () => apiFetch<Settings>(`/channels/${channelId}/settings`),
  })

  const { data: users = [] } = useQuery<{ id: string; name: string | null; email: string }[]>({
    queryKey: ['users'],
    queryFn: () => apiFetch('/users'),
  })

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<Settings>) =>
      apiFetch(`/channels/${channelId}/settings`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channel-settings', channelId] })
      toast.success('Regras salvas')
    },
    onError: () => toast.error('Erro ao salvar regras'),
  })

  if (isLoading) return <div className="px-4 py-3 text-xs text-muted-foreground">Carregando...</div>

  const s: Settings = settings ?? {}
  const distMode = s.distributionMode ?? 'all'

  const patch = (update: Partial<Settings>) => saveMutation.mutate(update)

  const userLabel = (id: string) => {
    const u = users.find(u => u.id === id)
    return u?.name ?? u?.email ?? id
  }

  return (
    <div className="border-t px-4 py-4 space-y-5 bg-muted/20">
      <p className="text-sm font-semibold flex items-center gap-1.5">
        <Settings2 className="h-4 w-4 text-muted-foreground" />
        Regras do canal
      </p>

      {/* WhatsApp-only */}
      {isWa && (
        <div className="space-y-4">
          <Toggle
            value={s.ignoreGroups ?? false}
            onChange={(v) => patch({ ignoreGroups: v })}
            label="Ignorar grupos"
            description="Mensagens de grupos não criam novas conversas"
          />
          <Toggle
            value={s.archiveGroups ?? false}
            onChange={(v) => patch({ archiveGroups: v })}
            label="Arquivar grupos automaticamente"
            description="Conversas de grupos entram direto no arquivo — visíveis só para admins"
          />
          <Toggle
            value={s.autoResolveOnRead ?? false}
            onChange={(v) => patch({ autoResolveOnRead: v })}
            label="Finalizar ao ler no celular"
            description="Conversa é resolvida automaticamente quando lida no WhatsApp"
          />
          <Toggle
            value={s.prefixSenderName ?? true}
            onChange={(v) => patch({ prefixSenderName: v })}
            label="Identificar atendente nas mensagens"
            description='Adiciona "*Nome:*" antes da mensagem para o cliente saber quem está atendendo'
          />
        </div>
      )}

      {/* Mensagens automáticas — só WhatsApp */}
      {isWa && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Mensagens automáticas</p>
          <p className="text-[11px] text-muted-foreground">
            Enviadas pelo bot do canal. Use as variáveis pra personalizar.
            A mensagem pessoal do atendente (configurada no perfil dele) é enviada adicionalmente.
          </p>
          <MessageTemplateField
            label="Boas-vindas (1ª mensagem do canal)"
            helperText="Enviada quando o cliente abre uma nova conversa, antes de algum atendente assumir."
            value={typeof s.welcomeMessage === 'string' ? s.welcomeMessage : ''}
            onChange={(v) => patch({ welcomeMessage: v })}
            placeholder="Olá {cliente}! Bem-vindo ao atendimento. Em breve um de nossos atendentes vai te responder."
          />
          <MessageTemplateField
            label="Finalização (fallback)"
            helperText="Usada ao finalizar a conversa SE o atendente não tiver mensagem personalizada de fechamento."
            value={typeof s.closingMessage === 'string' ? s.closingMessage : ''}
            onChange={(v) => patch({ closingMessage: v })}
            placeholder="Atendimento finalizado às {hora}. Protocolo: {protocolo}. Obrigado pelo contato!"
          />
          <Toggle
            value={s.sendClosingOnAdminFinalize ?? false}
            onChange={(v) => patch({ sendClosingOnAdminFinalize: v })}
            label="Enviar finalização mesmo quando admin finaliza sem assumir"
            description="Padrão desligado: se admin finalizar conversa da fila (ninguém atendeu) NÃO envia mensagem de finalização — evita 'obrigado pelo atendimento' sem atendimento real."
          />
        </div>
      )}

      {/* Distribuição — funciona para todos os tipos */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Distribuição de conversas</p>
        <div className="space-y-2">
          {(['all', 'fixed', 'round_robin'] as const).map((mode) => (
            <label key={mode} className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="radio"
                name={`dist-${channelId}`}
                checked={distMode === mode}
                onChange={() => patch({ distributionMode: mode })}
                className="accent-primary"
              />
              <div>
                <span className="text-sm">
                  {mode === 'all' ? 'Todos os atendentes' : mode === 'fixed' ? 'Atendente fixo' : 'Revezamento (round-robin)'}
                </span>
              </div>
            </label>
          ))}
        </div>

        {/* Seletor de atendente fixo */}
        {distMode === 'fixed' && (
          <select
            value={s.defaultAssigneeId ?? ''}
            onChange={(e) => patch({ defaultAssigneeId: e.target.value || null })}
            className="w-full rounded-lg border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="">Selecione um atendente...</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.name ?? u.email}</option>
            ))}
          </select>
        )}

        {/* Multi-select para round-robin */}
        {distMode === 'round_robin' && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Selecione os atendentes em revezamento:</p>
            {users.map(u => {
              const ids = s.roundRobinUserIds ?? []
              const checked = ids.includes(u.id)
              return (
                <label key={u.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const next = checked ? ids.filter(id => id !== u.id) : [...ids, u.id]
                      patch({ roundRobinUserIds: next })
                    }}
                    className="accent-primary"
                  />
                  <span className="text-sm">{u.name ?? u.email}</span>
                </label>
              )
            })}
          </div>
        )}
      </div>

      {saveMutation.isPending && (
        <p className="text-xs text-muted-foreground animate-pulse">Salvando...</p>
      )}
    </div>
  )
}

// ─── Card de canal conectado ──────────────────────────────────────────────────
function ConnectedChannelCard({
  ch, onQr, onSync, onAvatars, onStatus, onDelete, onUpdateWebhook, syncPending, avatarPending, statusPending, webhookPending,
}: {
  ch: Channel
  onQr: () => void
  onSync: () => void
  onAvatars: () => void
  onStatus: () => void
  onDelete: () => void
  onUpdateWebhook: () => void
  syncPending: boolean
  avatarPending: boolean
  statusPending: boolean
  webhookPending: boolean
}) {
  const isWa = ch.type === 'WHATSAPP'
  const isEmail = ch.type === 'IMAP_SMTP' || ch.type === 'GMAIL'
  const [showSignature, setShowSignature] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [signature, setSignature] = useState('')
  const [savingSignature, setSavingSignature] = useState(false)

  const statusConfig = {
    CONNECTED: { label: 'Conectado', dot: 'bg-green-500', color: 'text-green-600' },
    DISCONNECTED: { label: 'Desconectado', dot: 'bg-yellow-500', color: 'text-yellow-600' },
    ERROR: { label: 'Erro', dot: 'bg-red-500', color: 'text-red-600' },
  }[ch.status]

  const handleSaveSignature = async () => {
    setSavingSignature(true)
    try {
      await apiFetch(`/channels/${ch.id}/signature`, {
        method: 'PATCH',
        body: JSON.stringify({ signature }),
      })
      toast.success('Assinatura salva!')
      setShowSignature(false)
    } catch {
      toast.error('Erro ao salvar assinatura')
    } finally {
      setSavingSignature(false)
    }
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* ── Linha principal ── */}
      <div className="p-4 flex items-center gap-4">
        <div className="shrink-0">
          {isWa ? <WhatsAppIcon size={36} /> : <EmailIcon size={36} />}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{ch.label}</p>
          <p className="text-xs text-muted-foreground">{isWa ? 'WhatsApp via Evolution' : 'Email via SMTP/IMAP'}</p>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={cn('h-1.5 w-1.5 rounded-full', statusConfig.dot)} />
            <span className={cn('text-xs font-medium', statusConfig.color)}>{statusConfig.label}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {ch.status !== 'CONNECTED' && isWa && (
            <button onClick={onQr} className="p-2 rounded-lg hover:bg-accent text-muted-foreground" title="Escanear QR Code">
              <QrCode className="h-4 w-4" />
            </button>
          )}
          {ch.status === 'CONNECTED' && (
            <>
              <button onClick={onSync} disabled={syncPending} className="p-2 rounded-lg hover:bg-accent text-muted-foreground disabled:opacity-50" title="Sincronizar mensagens">
                <Download className={cn('h-4 w-4', syncPending && 'animate-bounce')} />
              </button>
              {isWa && (
                <>
                  <button onClick={onAvatars} disabled={avatarPending} className="p-2 rounded-lg hover:bg-accent text-muted-foreground disabled:opacity-50" title="Sincronizar fotos de perfil">
                    <UserCircle className={cn('h-4 w-4', avatarPending && 'animate-pulse')} />
                  </button>
                  <button onClick={onUpdateWebhook} disabled={webhookPending} className="p-2 rounded-lg hover:bg-accent text-muted-foreground disabled:opacity-50" title="Ativar status de entrega (✓✓)">
                    <Bell className={cn('h-4 w-4', webhookPending && 'animate-pulse')} />
                  </button>
                </>
              )}
              {isEmail && (
                <button
                  onClick={() => setShowSignature(v => !v)}
                  className={cn('p-2 rounded-lg hover:bg-accent transition-colors', showSignature ? 'text-primary bg-primary/5' : 'text-muted-foreground')}
                  title="Configurar assinatura"
                >
                  <PenLine className="h-4 w-4" />
                </button>
              )}
            </>
          )}
          <button
            onClick={() => { setShowRules(v => !v); setShowSignature(false) }}
            className={cn('p-2 rounded-lg hover:bg-accent transition-colors', showRules ? 'text-primary bg-primary/5' : 'text-muted-foreground')}
            title="Configurar regras"
          >
            <Settings2 className="h-4 w-4" />
          </button>
          <button onClick={onStatus} disabled={statusPending} className="p-2 rounded-lg hover:bg-accent text-muted-foreground" title="Verificar status">
            <RefreshCw className={cn('h-4 w-4', statusPending && 'animate-spin')} />
          </button>
          <button onClick={onDelete} className="p-2 rounded-lg hover:bg-accent text-red-500" title="Remover canal">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Painel de assinatura (email) ── */}
      {showSignature && isEmail && (
        <div className="border-t px-4 py-4 space-y-3 bg-muted/20">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <PenLine className="h-4 w-4 text-muted-foreground" />
              Assinatura do email
            </p>
            <button onClick={() => setShowSignature(false)} className="p-1 rounded hover:bg-accent text-muted-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Será inserida automaticamente ao redigir novos emails.
          </p>
          <RichEditor
            value={signature}
            onChange={setSignature}
            placeholder="Ex: Att,\nJoão Silva\nEmpresa XYZ"
            minHeight={100}
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowSignature(false)} className="px-3 py-1.5 rounded-lg text-sm hover:bg-accent">
              Cancelar
            </button>
            <button
              onClick={handleSaveSignature}
              disabled={savingSignature}
              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {savingSignature ? 'Salvando...' : 'Salvar assinatura'}
            </button>
          </div>
        </div>
      )}
      {/* ── Painel de regras ── */}
      {showRules && (
        <ChannelRulesPanel channelId={ch.id} channelType={ch.type} />
      )}
    </div>
  )
}

// ─── Modal: Importar histórico após conectar canal ──────────────────────────
function ImportHistoryModal({
  channelLabel,
  isPending,
  onImport,
  onSkip,
}: {
  channelLabel: string
  isPending: boolean
  onImport: () => void
  onSkip: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <h2 className="font-semibold text-base">Canal conectado!</h2>
            <p className="text-xs text-muted-foreground">{channelLabel}</p>
          </div>
        </div>

        <div className="text-sm text-muted-foreground leading-relaxed space-y-2">
          <p>Deseja importar o <strong>histórico</strong> de contatos e conversas anteriores deste WhatsApp?</p>
          <p className="text-xs">
            As conversas antigas serão importadas como <strong>histórico já finalizado</strong>, sem entrar no fluxo
            ativo de atendimento. Novas mensagens continuam sendo recebidas normalmente.
          </p>
        </div>

        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300">
          <p>⚠️ Dependendo do tamanho do histórico, pode demorar alguns minutos.</p>
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onSkip}
            disabled={isPending}
            className="px-4 py-2 rounded-lg text-sm hover:bg-accent disabled:opacity-50"
          >
            Pular
          </button>
          <button
            onClick={onImport}
            disabled={isPending}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
          >
            {isPending ? (
              <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Importando...</>
            ) : (
              <><Download className="h-3.5 w-3.5" /> Importar histórico</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function ChannelsPage() {
  const queryClient = useQueryClient()
  const [modal, setModal] = useState<null | 'whatsapp' | 'smtp'>(null)
  const [smtp, setSmtp] = useState<any>(null)
  const [qr, setQr] = useState<{ channelId: string; data: QrData } | null>(null)
  // Quando QR resolve pra CONNECTED, abre prompt de importar histórico
  const [importPrompt, setImportPrompt] = useState<{ channelId: string; label: string } | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!qr) { if (pollRef.current) clearInterval(pollRef.current); return }
    const poll = async () => {
      try {
        const res = await apiFetch<{ status: string }>(`/channels/${qr.channelId}/status`)
        queryClient.invalidateQueries({ queryKey: ['channels'] })
        if (res.status === 'CONNECTED') {
          const connectedChannelId = qr.channelId
          setQr(null)
          toast.success('WhatsApp conectado!')
          clearInterval(pollRef.current!)
          // Busca o canal pra pegar o label e abre o prompt de importar histórico
          try {
            const fresh = await apiFetch<Channel[]>('/channels')
            const ch = fresh.find(c => c.id === connectedChannelId)
            if (ch) setImportPrompt({ channelId: ch.id, label: ch.label })
          } catch {}
        }
      } catch {}
    }
    pollRef.current = setInterval(poll, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [qr?.channelId])

  const importHistoryMutation = useMutation({
    mutationFn: (channelId: string) =>
      apiFetch<{ chats: number; messagesImported: number; newHistoricalConvs: number; newContacts: number }>(
        `/channels/${channelId}/sync`,
        { method: 'POST', body: JSON.stringify({ importHistory: true }) },
      ),
    onSuccess: (data) => {
      toast.success(
        `Importação concluída: ${data.newHistoricalConvs} conversas, ${data.messagesImported} mensagens, ${data.newContacts} novos contatos`,
        { duration: 6000 },
      )
      queryClient.invalidateQueries({ queryKey: ['channels'] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      setImportPrompt(null)
    },
    onError: (e: any) => {
      toast.error(e?.message ?? 'Erro ao importar histórico')
    },
  })

  const { data: channels = [], isLoading } = useQuery({
    queryKey: ['channels'],
    queryFn: () => apiFetch<Channel[]>('/channels'),
  })

  const createWa = useMutation({
    mutationFn: (label: string) => apiFetch<Channel>('/channels/whatsapp', { method: 'POST', body: JSON.stringify({ label }) }),
    onSuccess: (ch) => {
      queryClient.invalidateQueries({ queryKey: ['channels'] })
      setModal(null)
      toast.success(`Canal "${ch.label}" criado!`)
      loadQr(ch.id)
    },
    onError: () => toast.error('Erro ao criar canal'),
  })

  const createSmtp = useMutation({
    mutationFn: (data: any) => apiFetch<Channel>('/channels/smtp', {
      method: 'POST',
      body: JSON.stringify({ ...data, smtpPort: Number(data.smtpPort), imapPort: data.imapPort ? Number(data.imapPort) : undefined, imapHost: data.imapHost || undefined, fromName: data.fromName || undefined }),
    }),
    onSuccess: (ch) => {
      queryClient.invalidateQueries({ queryKey: ['channels'] })
      setModal(null)
      toast.success(`Canal "${ch.label}" conectado!`)
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro: verifique as credenciais SMTP'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/channels/${id}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['channels'] }); toast.success('Canal removido') },
  })

  const statusMutation = useMutation({
    mutationFn: (id: string) => apiFetch<{ status: string }>(`/channels/${id}/status`),
    onSuccess: (data) => { queryClient.invalidateQueries({ queryKey: ['channels'] }); toast.info(`Status: ${data.status}`) },
  })

  const syncMutation = useMutation({
    mutationFn: (id: string) => apiFetch<{ chats: number; messages: number }>(`/channels/${id}/sync`, { method: 'POST' }),
    onMutate: () => toast.loading('Sincronizando...', { id: 'sync' }),
    onSuccess: (data) => { toast.dismiss('sync'); toast.success(`${data.messages} mensagens em ${data.chats} conversas`) },
    onError: () => { toast.dismiss('sync'); toast.error('Erro ao sincronizar') },
  })

  const avatarMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/channels/${id}/sync-avatars`, { method: 'POST' }),
    onMutate: () => toast.loading('Buscando fotos...', { id: 'avatars' }),
    onSuccess: () => { toast.dismiss('avatars'); toast.success('Fotos sendo buscadas em background') },
    onError: () => { toast.dismiss('avatars'); toast.error('Erro ao buscar fotos') },
  })

  const webhookMutation = useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: boolean; instanceName: string }>(`/channels/${id}/update-webhook`, { method: 'POST' }),
    onSuccess: (data) => toast.success(`Webhook atualizado para "${data.instanceName}"`),
    onError: () => toast.error('Erro ao atualizar webhook'),
  })

  const loadQr = async (channelId: string) => {
    try { setQr({ channelId, data: await apiFetch<QrData>(`/channels/${channelId}/qr`) }) }
    catch { toast.error('Erro ao carregar QR Code') }
  }

  const anyModalOpen = modal !== null || qr !== null

  return (
    <>
    <div className={cn("p-6 max-w-4xl space-y-8 h-full", anyModalOpen ? "overflow-hidden" : "overflow-y-auto")}>
      {/* ── Canais conectados ── */}
      <div>
        <h1 className="text-xl font-bold mb-1">Canais</h1>
        <p className="text-sm text-muted-foreground mb-4">Gerencie suas integrações de mensagens</p>

        {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

        {!isLoading && channels.length === 0 && (
          <div className="rounded-xl border border-dashed bg-card/50 p-8 text-center">
            <Zap className="h-8 w-8 mx-auto mb-3 text-muted-foreground opacity-40" />
            <p className="text-sm font-medium text-muted-foreground">Nenhum canal conectado ainda</p>
            <p className="text-xs text-muted-foreground mt-1">Adicione uma integração abaixo para começar</p>
          </div>
        )}

        <div className="space-y-3">
          {channels.map(ch => (
            <ConnectedChannelCard
              key={ch.id}
              ch={ch}
              onQr={() => loadQr(ch.id)}
              onSync={() => syncMutation.mutate(ch.id)}
              onAvatars={() => avatarMutation.mutate(ch.id)}
              onStatus={() => statusMutation.mutate(ch.id)}
              onDelete={() => { if (confirm(`Remover "${ch.label}"?`)) deleteMutation.mutate(ch.id) }}
              onUpdateWebhook={() => webhookMutation.mutate(ch.id)}
              syncPending={syncMutation.isPending}
              avatarPending={avatarMutation.isPending}
              statusPending={statusMutation.isPending}
              webhookPending={webhookMutation.isPending && webhookMutation.variables === ch.id}
            />
          ))}
        </div>
      </div>

      {/* ── Integrações disponíveis ── */}
      <div>
        <h2 className="text-base font-semibold mb-1">Adicionar integração</h2>
        <p className="text-sm text-muted-foreground mb-4">Escolha um canal para conectar</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {AVAILABLE_INTEGRATIONS.map(intg => (
            <div
              key={intg.key}
              className={cn(
                'rounded-xl border p-5 flex flex-col gap-3 transition-shadow select-none',
                intg.color,
                intg.disabled ? 'opacity-60' : 'hover:shadow-md cursor-pointer active:opacity-90',
              )}
              onClick={() => !intg.disabled && setModal(intg.key as any)}
            >
              <div className="flex items-start justify-between">
                <intg.Icon size={40} />
                <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', intg.badgeColor)}>
                  {intg.badge}
                </span>
              </div>
              <div>
                <p className="font-semibold text-sm">{intg.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{intg.description}</p>
              </div>
              {!intg.disabled && (
                <button
                  onClick={e => { e.stopPropagation(); setModal(intg.key as any) }}
                  className="mt-auto self-start flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/80 dark:bg-black/20 border text-xs font-medium hover:bg-white dark:hover:bg-black/40 transition-colors"
                >
                  <Plus className="h-3 w-3" /> Conectar
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>

    {/* ── Modais — fora do container scrollável para overlay limpo ── */}
    {modal === 'whatsapp' && (
      <WhatsAppModal
        onClose={() => setModal(null)}
        onCreate={(label) => createWa.mutate(label)}
        isPending={createWa.isPending}
      />
    )}
    {modal === 'smtp' && (
      <SmtpModal
        onClose={() => setModal(null)}
        onSave={(data) => createSmtp.mutate(data)}
        isPending={createSmtp.isPending}
      />
    )}

    {/* ── Modal QR Code ── */}
    {qr && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-card rounded-xl p-6 space-y-4 max-w-sm w-full shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <WhatsAppIcon size={24} />
              <p className="font-semibold text-sm">Escanear QR Code</p>
            </div>
            <button onClick={() => setQr(null)} className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-accent">
              <X className="h-4 w-4" />
            </button>
          </div>
          {qr.data.base64 ? (
            <img
              src={qr.data.base64.startsWith('data:') ? qr.data.base64 : `data:image/png;base64,${qr.data.base64}`}
              alt="QR Code WhatsApp"
              className="w-full rounded-lg border"
            />
          ) : (
            <div className="rounded-lg border p-4 text-center bg-muted">
              <p className="text-xs text-muted-foreground break-all font-mono">{qr.data.code}</p>
            </div>
          )}
          <p className="text-xs text-center text-muted-foreground">
            WhatsApp → <strong>Dispositivos vinculados</strong> → Vincular dispositivo
          </p>
          <button onClick={() => loadQr(qr.channelId)} className="w-full flex items-center justify-center gap-2 rounded-lg border py-2 text-sm hover:bg-accent">
            <RefreshCw className="h-3.5 w-3.5" /> Atualizar QR
          </button>
        </div>
      </div>
    )}

    {/* ── Modal: importar histórico (após conectar) ── */}
    {importPrompt && (
      <ImportHistoryModal
        channelLabel={importPrompt.label}
        isPending={importHistoryMutation.isPending}
        onImport={() => importHistoryMutation.mutate(importPrompt.channelId)}
        onSkip={() => setImportPrompt(null)}
      />
    )}
    </>
  )
}

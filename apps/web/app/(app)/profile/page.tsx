'use client'

import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { Save, UserRound, MessageSquare, KeyRound, Calendar as CalendarIcon, Plug, Trash2, Camera, Upload, Clock, LayoutDashboard } from 'lucide-react'
import MessageTemplateField from '@/components/MessageTemplateField'
import { WeeklyHoursEditor, type HoursRow } from '@/components/WeeklyHoursEditor'
import { useAuthStore } from '@/store/auth'

interface MeProfile {
  id: string; name: string; email: string; role: string
  googleId?: string | null
  settings?: { avatarUrl?: string | null } & Record<string, unknown> | null
}
interface UserSettings {
  welcomeMessage?: string | null
  closingMessage?: string | null
  signature?: string | null
  avatarUrl?: string | null
  ignoreGroupsWelcome?: boolean | null
  ignoreGroupsClosing?: boolean | null
}
interface CalendarAccount { id: string; provider: string; createdAt: string }

function Section({ title, description, icon: Icon, children }: {
  title: string
  description?: string
  icon: React.ElementType
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b bg-muted/20 flex items-center gap-2.5">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <div>
          <p className="font-semibold text-sm">{title}</p>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// ─── Foto de perfil ──────────────────────────────────────────────────────────
function initials(name?: string | null, email?: string | null): string {
  const src = (name ?? email ?? '?').trim()
  const parts = src.split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function AvatarUploader({ profile }: { profile: MeProfile }) {
  const qc = useQueryClient()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const avatarUrl = profile.settings?.avatarUrl ?? null

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('Selecione uma imagem'); return }
    if (file.size > 2 * 1024 * 1024) { toast.error('Máximo 2 MB'); return }
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      await apiFetch('/users/me/avatar', { method: 'POST', body: form })
      await qc.invalidateQueries({ queryKey: ['me-profile'] })
      await qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('Foto atualizada')
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao enviar foto')
    } finally {
      setUploading(false)
    }
  }

  const remove = useMutation({
    mutationFn: () => apiFetch('/users/me/avatar', { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me-profile'] })
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('Foto removida')
    },
    onError: () => toast.error('Erro ao remover'),
  })

  return (
    <div className="flex items-center gap-4">
      <div className="relative group">
        <input
          ref={inputRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
        />
        <button
          type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          className="relative h-20 w-20 rounded-full overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          title="Clique para trocar a foto"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt={profile.name} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-2xl font-bold text-primary-foreground bg-gradient-to-br from-primary to-secondary">
              {initials(profile.name, profile.email)}
            </div>
          )}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <Camera className="h-5 w-5 text-white" />
          </div>
        </button>
      </div>
      <div className="flex-1 space-y-1">
        <p className="text-sm font-medium">Foto de perfil</p>
        <p className="text-xs text-muted-foreground">JPG, PNG ou GIF — até 2 MB.</p>
        <div className="flex gap-2 pt-1">
          <button
            type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
            className="flex items-center gap-1.5 text-xs border rounded px-2.5 py-1.5 hover:bg-accent disabled:opacity-50">
            <Upload className="h-3 w-3" /> {uploading ? 'Enviando...' : avatarUrl ? 'Trocar' : 'Enviar foto'}
          </button>
          {avatarUrl && (
            <button
              type="button" onClick={() => { if (confirm('Remover foto?')) remove.mutate() }}
              disabled={remove.isPending}
              className="flex items-center gap-1.5 text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded px-2.5 py-1.5">
              <Trash2 className="h-3 w-3" /> Remover
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Identidade (nome + email) ───────────────────────────────────────────────
function IdentityForm({ profile }: { profile: MeProfile }) {
  const qc = useQueryClient()
  const [name, setName] = useState(profile.name ?? '')
  const [email, setEmail] = useState(profile.email ?? '')

  useEffect(() => {
    setName(profile.name ?? '')
    setEmail(profile.email ?? '')
  }, [profile.id, profile.name, profile.email])

  const save = useMutation({
    mutationFn: (patch: { name?: string; email?: string }) =>
      apiFetch('/users/me', { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me-profile'] })
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('Perfil atualizado')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao salvar'),
  })

  const dirty = name !== (profile.name ?? '') || email !== (profile.email ?? '')

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium">Nome</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40" />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Função: <span className="font-semibold text-foreground">{profile.role}</span>
        <span className="ml-2 italic">(só admin pode alterar a função)</span>
      </p>
      <div className="flex justify-end pt-2 border-t">
        <button onClick={() => save.mutate({ name: name.trim(), email: email.trim() })}
          disabled={!dirty || save.isPending}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
          <Save className="h-3.5 w-3.5" />
          {save.isPending ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}

// ─── Senha ──────────────────────────────────────────────────────────────────
function PasswordForm() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')

  const save = useMutation({
    mutationFn: () =>
      apiFetch('/users/me/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      }),
    onSuccess: () => {
      toast.success('Senha alterada')
      setCurrent(''); setNext(''); setConfirm('')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao alterar senha'),
  })

  const tooShort = next.length > 0 && next.length < 8
  const mismatch = confirm.length > 0 && next !== confirm
  const canSubmit = !!current && next.length >= 8 && next === confirm

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium">Senha atual</label>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Nova senha</label>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password" minLength={8}
            className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          {tooShort && <p className="text-[10px] text-rose-600">Mínimo 8 caracteres</p>}
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Confirmar</label>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          {mismatch && <p className="text-[10px] text-rose-600">Senhas não conferem</p>}
        </div>
      </div>
      <div className="flex justify-end pt-2 border-t">
        <button onClick={() => save.mutate()} disabled={!canSubmit || save.isPending}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
          <KeyRound className="h-3.5 w-3.5" />
          {save.isPending ? 'Salvando...' : 'Alterar senha'}
        </button>
      </div>
    </div>
  )
}

// ─── Google Calendar ─────────────────────────────────────────────────────────
function GoogleAccounts({ profile }: { profile: MeProfile }) {
  const qc = useQueryClient()
  const { data: accounts = [], isLoading } = useQuery<CalendarAccount[]>({
    queryKey: ['calendar-accounts'],
    queryFn: () => apiFetch('/calendar/accounts'),
  })

  const connect = async () => {
    try {
      const { url } = await apiFetch<{ url: string }>('/calendar/auth')
      window.location.href = url
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao iniciar OAuth')
    }
  }

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/calendar/accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-accounts'] })
      toast.success('Conta desconectada')
    },
    onError: () => toast.error('Erro ao desconectar'),
  })

  const isGoogleLoginLinked = !!profile.googleId

  return (
    <div className="space-y-4">
      {/* Status do login com Google */}
      <div className="flex items-center justify-between rounded-lg border px-4 py-3 bg-muted/20">
        <div className="flex items-center gap-3">
          <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${isGoogleLoginLinked ? 'bg-green-100 dark:bg-green-900/30' : 'bg-muted'}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84Z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53Z" fill="#EA4335"/>
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium">Login com Google</p>
            <p className="text-[11px] text-muted-foreground">
              {isGoogleLoginLinked
                ? 'Conta vinculada — você pode entrar com o botão Google'
                : 'Não vinculado — faça login com Google para vincular'}
            </p>
          </div>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${isGoogleLoginLinked ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}>
          {isGoogleLoginLinked ? 'Vinculado' : 'Não vinculado'}
        </span>
      </div>

      {/* Contas de calendário */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Agenda (Google Calendar)</p>

        {isLoading && <p className="text-xs text-muted-foreground">Carregando...</p>}

        {!isLoading && accounts.length === 0 && (
          <div className="rounded-lg bg-muted/30 p-4 text-center space-y-2">
            <p className="text-xs text-muted-foreground">Nenhuma conta Google de agenda conectada.</p>
            <p className="text-[11px] text-muted-foreground/80">
              {isGoogleLoginLinked
                ? 'Sua conta de login já tem acesso ao Calendar. Clique em "Conectar" abaixo para sincronizar.'
                : 'Conecte sua conta para criar eventos sincronizados e habilitar agentes IA no Google Calendar.'}
            </p>
          </div>
        )}

        {accounts.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                <CalendarIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate capitalize">{a.provider}</p>
                <p className="text-[11px] text-muted-foreground">
                  Conectada em {new Date(a.createdAt).toLocaleDateString('pt-BR')}
                </p>
              </div>
            </div>
            <button
              onClick={() => { if (confirm('Desconectar esta conta?')) remove.mutate(a.id) }}
              disabled={remove.isPending}
              className="flex items-center gap-1 text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded px-2 py-1.5"
            >
              <Trash2 className="h-3 w-3" /> Desconectar
            </button>
          </div>
        ))}

        <button
          onClick={connect}
          className="w-full flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/40 text-sm py-3 hover:bg-primary/5 transition-colors text-primary font-medium"
        >
          <Plug className="h-4 w-4" />
          {accounts.length > 0 ? 'Conectar outra conta Google' : 'Conectar conta Google'}
        </button>
      </div>
    </div>
  )
}

// ─── Toggle simples ───────────────────────────────────────────────────────────
function Toggle({ label, description, value, onChange }: {
  label: string
  description?: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <div className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={value}
          onChange={e => onChange(e.target.checked)}
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

// ─── Mensagens automáticas ───────────────────────────────────────────────────
function MessageTemplates() {
  const qc = useQueryClient()
  const { data: settings, isLoading } = useQuery<UserSettings>({
    queryKey: ['user-settings'],
    queryFn: () => apiFetch('/users/me/settings'),
  })

  const [welcome, setWelcome] = useState('')
  const [closing, setClosing] = useState('')
  const [ignoreGroupsWelcome, setIgnoreGroupsWelcome] = useState(false)
  const [ignoreGroupsClosing, setIgnoreGroupsClosing] = useState(false)

  useEffect(() => {
    if (settings) {
      setWelcome(settings.welcomeMessage ?? '')
      setClosing(settings.closingMessage ?? '')
      setIgnoreGroupsWelcome(settings.ignoreGroupsWelcome ?? false)
      setIgnoreGroupsClosing(settings.ignoreGroupsClosing ?? false)
    }
  }, [settings])

  const save = useMutation({
    mutationFn: (patch: Partial<UserSettings>) =>
      apiFetch('/users/me/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-settings'] })
      toast.success('Mensagens salvas')
    },
    onError: () => toast.error('Erro ao salvar'),
  })

  const dirty =
    welcome !== (settings?.welcomeMessage ?? '') ||
    closing !== (settings?.closingMessage ?? '') ||
    ignoreGroupsWelcome !== (settings?.ignoreGroupsWelcome ?? false) ||
    ignoreGroupsClosing !== (settings?.ignoreGroupsClosing ?? false)

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <MessageTemplateField
          label="Apresentação ao assumir conversa"
          helperText="Enviada quando você clica em 'Assumir atendimento'. Adicional à mensagem de boas-vindas do canal."
          value={welcome}
          onChange={setWelcome}
          placeholder="Olá {cliente}, aqui é {atendente} 👋 Em que posso ajudar?"
        />
        <Toggle
          label="Não enviar em grupos"
          description="Suprime esta mensagem quando a conversa for um grupo do WhatsApp"
          value={ignoreGroupsWelcome}
          onChange={setIgnoreGroupsWelcome}
        />
      </div>

      <div className="space-y-3">
        <MessageTemplateField
          label="Mensagem ao finalizar conversa"
          helperText="Substitui a mensagem padrão do canal. Deixe vazio pra usar a do canal."
          value={closing}
          onChange={setClosing}
          placeholder="Por hoje encerro o atendimento. Qualquer dúvida estou à disposição! - {atendente}"
        />
        <Toggle
          label="Não enviar em grupos"
          description="Suprime esta mensagem quando a conversa for um grupo do WhatsApp"
          value={ignoreGroupsClosing}
          onChange={setIgnoreGroupsClosing}
        />
      </div>

      <div className="flex justify-end pt-2 border-t">
        <button
          onClick={() => save.mutate({
            welcomeMessage: welcome.trim() || null,
            closingMessage: closing.trim() || null,
            ignoreGroupsWelcome,
            ignoreGroupsClosing,
          })}
          disabled={!dirty || save.isPending}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
          <Save className="h-3.5 w-3.5" />
          {save.isPending ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}

// ─── Personalizar dashboard ──────────────────────────────────────────────────
const DASHBOARD_WIDGET_LABELS: Record<string, { label: string; description: string }> = {
  weather: { label: 'Previsão do tempo', description: 'Clima do endereço da empresa' },
  quotes: { label: 'Cotações', description: 'Dólar, euro, bitcoin e bolsa' },
  converter: { label: 'Conversor de moeda', description: 'Converte valores entre moedas' },
  translator: { label: 'Tradutor', description: 'Tradução rápida de textos' },
  calculator: { label: 'Calculadora', description: 'Calculadora utilitária' },
}

function DashboardWidgetsPanel() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<{ widgets: Record<string, boolean>; available: Record<string, boolean> }>({
    queryKey: ['dashboard-widgets'],
    queryFn: () => apiFetch('/integrations/widgets'),
  })

  const save = useMutation({
    mutationFn: (patch: Record<string, boolean>) =>
      apiFetch('/users/me/preferences', { method: 'PATCH', body: JSON.stringify({ dashboardWidgets: patch }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard-widgets'] })
      qc.invalidateQueries({ queryKey: ['me-profile'] })
      toast.success('Preferências salvas')
    },
    onError: () => toast.error('Erro ao salvar'),
  })

  if (isLoading || !data) return <p className="text-sm text-muted-foreground">Carregando...</p>

  // Só os widgets que o admin deixou disponíveis
  const availableKeys = Object.keys(data.available).filter(k => data.available[k])
  if (availableKeys.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum widget disponível. O administrador pode habilitá-los em Configurações → Integrações / APIs.</p>
  }

  return (
    <div className="space-y-4">
      {availableKeys.map(key => {
        const meta = DASHBOARD_WIDGET_LABELS[key] ?? { label: key, description: '' }
        return (
          <Toggle
            key={key}
            label={meta.label}
            description={meta.description}
            value={data.widgets[key] !== false}
            onChange={(v) => save.mutate({ [key]: v })}
          />
        )
      })}
    </div>
  )
}

// ─── Página ──────────────────────────────────────────────────────────────────
// ─── Horário de trabalho ──────────────────────────────────────────────────────
function WorkingHoursPanel({ userId }: { userId: string }) {
  const qc = useQueryClient()
  const { data: rows = [], isLoading } = useQuery<HoursRow[]>({
    queryKey: ['working-hours', userId],
    queryFn: () => apiFetch(`/calendar/working-hours/${userId}`),
    enabled: !!userId,
  })
  const save = useMutation({
    mutationFn: (r: HoursRow[]) =>
      apiFetch(`/calendar/working-hours/${userId}`, { method: 'PUT', body: JSON.stringify({ rows: r }) }),
    onSuccess: () => {
      toast.success('Horário de trabalho salvo')
      qc.invalidateQueries({ queryKey: ['working-hours', userId] })
    },
    onError: (e: Error) => toast.error(e.message ?? 'Erro ao salvar'),
  })
  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>
  return <WeeklyHoursEditor rows={rows} onSave={(r) => save.mutate(r)} saving={save.isPending} />
}

export default function ProfilePage() {
  // Mount guard: evita hydration mismatch — várias subseções dependem de estado
  // assíncrono (auth, queries, OAuth account list) que diverge entre SSR e CSR.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const meAuth = useAuthStore((s) => s.user)
  const qc = useQueryClient()
  const { data: profile, isLoading } = useQuery<MeProfile>({
    queryKey: ['me-profile'],
    queryFn: () => apiFetch('/users/me'),
    enabled: mounted && !!meAuth?.sub,
  })

  // Handle Google Calendar OAuth redirect result
  useEffect(() => {
    if (!mounted) return
    const params = new URLSearchParams(window.location.search)
    const googleOk = params.get('google')
    const googleErr = params.get('google_error')
    if (googleOk === 'connected') {
      toast.success('Google Calendar conectado!')
      qc.invalidateQueries({ queryKey: ['calendar-accounts'] })
      qc.invalidateQueries({ queryKey: ['me-profile'] })
      window.history.replaceState({}, '', '/profile')
    } else if (googleErr) {
      toast.error(`Erro ao conectar Google: ${decodeURIComponent(googleErr)}`)
      window.history.replaceState({}, '', '/profile')
    }
  }, [mounted])

  if (!mounted) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Carregando perfil...
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold">Meu perfil</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Gerencie sua identidade, senha, integrações e mensagens automáticas.
          </p>
        </div>

        <Section title="Foto de perfil" icon={Camera} description="Aparece no menu lateral e ao lado das suas mensagens">
          {isLoading || !profile
            ? <p className="text-sm text-muted-foreground">Carregando...</p>
            : <AvatarUploader profile={profile} />}
        </Section>

        <Section title="Identidade" icon={UserRound} description="Como você aparece pra clientes e colegas">
          {isLoading || !profile
            ? <p className="text-sm text-muted-foreground">Carregando...</p>
            : <IdentityForm profile={profile} />}
        </Section>

        <Section title="Senha" icon={KeyRound} description="Altere sua senha de acesso ao sistema">
          <PasswordForm />
        </Section>

        <Section title="Google" icon={CalendarIcon}
          description="Login com Google e sincronização da Agenda">
          {isLoading || !profile
            ? <p className="text-sm text-muted-foreground">Carregando...</p>
            : <GoogleAccounts profile={profile} />}
        </Section>

        <Section title="Horário de trabalho" icon={Clock}
          description="Define sua disponibilidade. Usado no cálculo de horários livres e agendamentos.">
          {isLoading || !profile
            ? <p className="text-sm text-muted-foreground">Carregando...</p>
            : <WorkingHoursPanel userId={profile.id} />}
        </Section>

        <Section title="Personalizar dashboard" icon={LayoutDashboard}
          description="Escolha quais widgets aparecem no seu dashboard, entre os disponibilizados pelo administrador.">
          <DashboardWidgetsPanel />
        </Section>

        <Section title="Mensagens automáticas" icon={MessageSquare}
          description="Enviadas em momentos específicos do atendimento. Use variáveis pra personalizar.">
          <MessageTemplates />
        </Section>
      </div>
    </div>
  )
}

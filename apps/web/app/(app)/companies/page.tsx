'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { displayPhone, type PhoneType } from '@/lib/phone'
import { maskPhone, maskCNPJ } from '@/lib/masks'
import { toast } from 'sonner'
import { Building2, Plus, Pencil, Trash2, Users, X, Phone, Mail, UserMinus, Search, MessageSquare, Camera, Globe, FileText, MapPin, UserCog, Trash } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePermission } from '@/lib/usePermission'
import { PermissionGate } from '@/components/PermissionGate'

interface Company {
  id: string
  name: string
  color: string
  domain: string | null
  logoUrl?: string | null
  _count: { contactLinks: number; conversations?: number }
}

interface Contact {
  id: string
  name: string | null
  phone: string | null
  phoneType?: PhoneType | null
  lid?: string | null
  email: string | null
  companyId: string | null
  metadata?: { avatarUrl?: string } | null
}

interface GroupConversation {
  id: string
  isGroup: boolean
  subject: string | null
  externalId: string
  companyId: string | null
  channel: { id: string; type: string; label: string }
  contact: { id: string; name: string | null; metadata?: { avatarUrl?: string } | null } | null
}

const PRESET_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#06b6d4',
  '#64748b', '#1e293b',
]

const AVATAR_COLORS = ['bg-violet-500','bg-blue-500','bg-green-500','bg-amber-500','bg-rose-500','bg-cyan-500','bg-orange-500','bg-teal-500']
function stringToColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h); return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length] }
function initials(s: string) { const p = s.trim().split(/\s+/); return p.length === 1 ? p[0].slice(0,2).toUpperCase() : (p[0][0]+p[p.length-1][0]).toUpperCase() }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

function ContactAvatar({ contact, size = 'sm' }: { contact: Contact; size?: 'sm' | 'md' }) {
  const label = contact.name ?? contact.phone ?? contact.email ?? '?'
  const sizeClass = size === 'md' ? 'h-10 w-10 text-sm' : 'h-8 w-8 text-xs'
  if (contact.metadata?.avatarUrl) {
    return (
      <img src={contact.metadata.avatarUrl} alt={label}
        className={cn('rounded-full object-cover shrink-0', sizeClass)}
        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
    )
  }
  return (
    <div className={cn('rounded-full flex items-center justify-center font-semibold text-white shrink-0', stringToColor(label), sizeClass)}>
      {initials(label)}
    </div>
  )
}

// ─── Modal de empresa (criação + edição com contatos vinculados) ───────────────
interface CompanyFormData {
  name: string
  color: string
  domain?: string | null
  cnpj?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  address?: string | null
  notes?: string | null
}

interface CompanyDetail extends Company {
  logoUrl: string | null
  cnpj: string | null
  phone: string | null
  email: string | null
  website: string | null
  address: string | null
  notes: string | null
}

function CompanyFormModal({ company, onClose, onSave, isPending }: {
  company?: Company
  onClose: () => void
  onSave: (data: CompanyFormData) => void
  isPending: boolean
}) {
  const queryClient = useQueryClient()

  // Quando editando, busca os campos completos (o list endpoint não retorna tudo)
  const { data: detail } = useQuery({
    queryKey: ['company', company?.id],
    queryFn: () => apiFetch<CompanyDetail>(`/companies/${company!.id}`),
    enabled: !!company,
  })

  const [name, setName]   = useState(company?.name ?? '')
  const [color, setColor] = useState(company?.color ?? '#6366f1')
  const [domain, setDomain] = useState(company?.domain ?? '')
  const [cnpj, setCnpj] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [contactSearch, setContactSearch] = useState('')

  // Sincroniza state com detail quando carrega
  useEffect(() => {
    if (detail) {
      setCnpj(detail.cnpj ? maskCNPJ(detail.cnpj) : '')
      setPhone(detail.phone ? maskPhone(detail.phone) : '')
      setEmail(detail.email ?? '')
      setWebsite(detail.website ?? '')
      setAddress(detail.address ?? '')
      setNotes(detail.notes ?? '')
      setLogoUrl(detail.logoUrl ?? null)
    }
  }, [detail])

  // Lista de usuários (para fixed / round_robin)
  const { data: users = [] } = useQuery<{ id: string; name: string | null; email: string }[]>({
    queryKey: ['users'],
    queryFn: () => apiFetch('/users'),
    staleTime: 60_000,
  })

  // Logo upload
  const logoMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return apiFetch<{ id: string; logoUrl: string }>(`/companies/${company!.id}/logo`, { method: 'POST', body: form })
    },
    onSuccess: (data) => {
      setLogoUrl(data.logoUrl)
      queryClient.invalidateQueries({ queryKey: ['company', company?.id] })
      queryClient.invalidateQueries({ queryKey: ['companies'] })
      toast.success('Logo atualizada')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao enviar logo'),
  })

  const removeLogoMutation = useMutation({
    mutationFn: () => apiFetch(`/companies/${company!.id}/logo`, { method: 'DELETE' }),
    onSuccess: () => {
      setLogoUrl(null)
      queryClient.invalidateQueries({ queryKey: ['company', company?.id] })
      queryClient.invalidateQueries({ queryKey: ['companies'] })
      toast.success('Logo removida')
    },
  })

  // Contatos vinculados a esta empresa (só quando editando)
  const { data: linkedContactsData } = useQuery({
    queryKey: ['contacts', 'company', company?.id],
    queryFn: () => apiFetch<{ items: Contact[] }>(`/contacts?companyId=${company!.id}&limit=200`),
    enabled: !!company,
  })
  const linkedContacts: Contact[] = linkedContactsData?.items ?? []

  // Contatos para vincular (busca geral)
  const { data: searchResultsData } = useQuery({
    queryKey: ['contacts', contactSearch, 'assign'],
    queryFn: () => apiFetch<{ items: Contact[] }>(`/contacts?q=${encodeURIComponent(contactSearch)}&limit=30`),
    enabled: contactSearch.length > 0,
  })
  const searchResults: Contact[] = searchResultsData?.items ?? []

  const assignMutation = useMutation({
    mutationFn: ({ contactId, companyId }: { contactId: string; companyId: string | null }) =>
      apiFetch(`/contacts/${contactId}`, { method: 'PATCH', body: JSON.stringify({ companyId }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      queryClient.invalidateQueries({ queryKey: ['companies'] })
    },
    onError: () => toast.error('Erro ao atualizar empresa do contato'),
  })

  // ─── Grupos vinculados ────────────────────────────────────────────────────
  const [groupSearch, setGroupSearch] = useState('')

  const { data: linkedGroupsData } = useQuery({
    queryKey: ['conversations', 'company-groups', company?.id],
    queryFn: () =>
      apiFetch<{ conversations: GroupConversation[] }>(
        `/conversations?filter=groups&companyId=${company!.id}&limit=200&includeImported=true`,
      ),
    enabled: !!company,
  })
  const linkedGroups: GroupConversation[] = linkedGroupsData?.conversations ?? []

  const { data: groupSearchData } = useQuery({
    queryKey: ['conversations', 'groups-search', groupSearch],
    queryFn: () =>
      apiFetch<{ conversations: GroupConversation[] }>(
        `/conversations?filter=groups&q=${encodeURIComponent(groupSearch)}&limit=30&includeImported=true`,
      ),
    enabled: groupSearch.length > 0 && !!company,
  })
  const groupSearchResults: GroupConversation[] = groupSearchData?.conversations ?? []

  const assignGroupMutation = useMutation({
    mutationFn: ({ conversationId, companyId }: { conversationId: string; companyId: string | null }) =>
      apiFetch(`/conversations/${conversationId}/company`, {
        method: 'PATCH',
        body: JSON.stringify({ companyId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      queryClient.invalidateQueries({ queryKey: ['companies'] })
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao vincular grupo'),
  })

  // Grupos da busca que não estão vinculados a esta empresa
  const unlinkedGroups = groupSearchResults.filter(
    g => g.companyId !== company?.id && !linkedGroups.find(l => l.id === g.id),
  )

  const filteredLinkedGroups = linkedGroups.filter(g => {
    const q = groupSearch.toLowerCase()
    if (!q) return true
    return (g.subject ?? '').toLowerCase().includes(q)
  })

  const filteredLinked = linkedContacts.filter(c => {
    const q = contactSearch.toLowerCase()
    if (!q) return true
    return (c.name ?? '').toLowerCase().includes(q)
      || (c.phone ?? '').includes(q)
      || (c.email ?? '').toLowerCase().includes(q)
  })

  // Contatos da busca que ainda não estão vinculados
  const unlinked = searchResults.filter(c => c.companyId !== company?.id && !linkedContacts.find(l => l.id === c.id))

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={cn('bg-card rounded-xl shadow-2xl w-full flex flex-col', company ? 'max-w-lg max-h-[90vh]' : 'max-w-sm')}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg flex items-center justify-center overflow-hidden" style={{ background: color }}>
              {logoUrl
                ? <img src={logoUrl} alt="" className="h-full w-full object-cover" />
                : <Building2 className="h-4 w-4 text-white" />}
            </div>
            <h2 className="font-semibold text-sm">{company ? 'Editar empresa' : 'Nova empresa'}</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* ── Logo + Identidade ── */}
          <div className="px-5 py-4 space-y-4">
            {/* Logo (só ao editar — precisa de companyId) */}
            {company && (
              <div className="flex items-center gap-4">
                <div className="relative group/logo shrink-0">
                  <div className="h-20 w-20 rounded-xl overflow-hidden flex items-center justify-center text-white"
                    style={{ background: color }}>
                    {logoUrl
                      ? <img src={logoUrl} alt="Logo" className="h-full w-full object-cover" />
                      : <Building2 className="h-8 w-8" />}
                  </div>
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    disabled={logoMutation.isPending}
                    title="Trocar logo"
                    className="absolute inset-0 rounded-xl bg-black/50 opacity-0 group-hover/logo:opacity-100 transition-opacity flex items-center justify-center text-white disabled:opacity-30"
                  >
                    <Camera className="h-5 w-5" />
                  </button>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (f) logoMutation.mutate(f)
                      if (e.target) e.target.value = ''
                    }}
                  />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Logo</p>
                  <p className="text-xs text-muted-foreground">
                    Recomendado: PNG ou JPG quadrado, mín. 256×256.
                  </p>
                  {logoUrl && (
                    <button
                      onClick={() => removeLogoMutation.mutate()}
                      disabled={removeLogoMutation.isPending}
                      className="text-xs text-red-500 hover:underline mt-1 inline-flex items-center gap-1"
                    >
                      <Trash className="h-3 w-3" /> Remover logo
                    </button>
                  )}
                </div>
              </div>
            )}

            <Field label="Nome *">
              <input autoFocus value={name} onChange={e => setName(e.target.value)}
                placeholder="Ex: Acme Corp"
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </Field>

            <Field label="Cor">
              <div className="flex flex-wrap gap-2 pt-1">
                {PRESET_COLORS.map(c => (
                  <button key={c} onClick={() => setColor(c)}
                    className={cn('h-7 w-7 rounded-full transition-all', color === c && 'ring-2 ring-offset-2 ring-foreground/30 scale-110')}
                    style={{ background: c }} />
                ))}
              </div>
            </Field>
          </div>

          {/* ── Informações cadastrais ── */}
          {company && (
            <div className="border-t px-5 py-4 space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                Informações cadastrais
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <Field label="CNPJ">
                  <input value={cnpj} onChange={e => setCnpj(maskCNPJ(e.target.value))}
                    placeholder="00.000.000/0000-00"
                    inputMode="numeric"
                    maxLength={18}
                    className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
                </Field>
                <Field label="Domínio">
                  <input value={domain} onChange={e => setDomain(e.target.value)}
                    placeholder="acme.com.br"
                    className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
                </Field>
              </div>
            </div>
          )}

          {/* ── Contato ── */}
          {company && (
            <div className="border-t px-5 py-4 space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" />
                Contato
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Telefone">
                  <input value={phone} onChange={e => setPhone(maskPhone(e.target.value))}
                    placeholder="(11) 99999-9999"
                    inputMode="tel"
                    maxLength={20}
                    className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
                </Field>
                <Field label="Email">
                  <input value={email} onChange={e => setEmail(e.target.value)}
                    type="email"
                    placeholder="contato@empresa.com"
                    className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
                </Field>
              </div>
              <Field label="Website">
                <div className="relative">
                  <Globe className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <input value={website} onChange={e => setWebsite(e.target.value)}
                    placeholder="https://empresa.com.br"
                    className="w-full rounded-lg border bg-transparent pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
                </div>
              </Field>
            </div>
          )}

          {/* ── Endereço ── */}
          {company && (
            <div className="border-t px-5 py-4 space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                Endereço
              </h3>
              <Field label="">
                <textarea value={address} onChange={e => setAddress(e.target.value)}
                  rows={2}
                  placeholder="Rua, número, bairro, cidade, estado, CEP"
                  className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none" />
              </Field>
            </div>
          )}



          {/* ── Observações ── */}
          {company && (
            <div className="border-t px-5 py-4 space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                Observações
              </h3>
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                rows={3}
                placeholder="Notas internas sobre a empresa..."
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none" />
            </div>
          )}

          {/* Seção de contatos (apenas ao editar) */}
          {company && (
            <div className="border-t">
              <div className="px-5 py-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  Contatos vinculados
                  {linkedContacts.length > 0 && (
                    <span className="ml-1 text-xs font-normal px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {linkedContacts.length}
                    </span>
                  )}
                </h3>
              </div>

              {/* Busca de contatos */}
              <div className="px-5 pb-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    value={contactSearch}
                    onChange={e => setContactSearch(e.target.value)}
                    placeholder="Buscar e vincular contatos..."
                    className="w-full rounded-lg border bg-transparent pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
              </div>

              {/* Sugestões de adição (busca ativa) */}
              {contactSearch && unlinked.length > 0 && (
                <div className="px-5 pb-2">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Adicionar</p>
                  <div className="rounded-lg border divide-y">
                    {unlinked.slice(0, 5).map(c => {
                      const label = c.name ?? c.phone ?? c.email ?? 'Sem nome'
                      return (
                        <div key={c.id} className="flex items-center gap-2.5 px-3 py-2">
                          <ContactAvatar contact={c} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{label}</p>
                            {displayPhone(c) && <p className="text-xs text-muted-foreground">{displayPhone(c)}</p>}
                          </div>
                          <button
                            onClick={() => assignMutation.mutate({ contactId: c.id, companyId: company.id })}
                            disabled={assignMutation.isPending}
                            className="shrink-0 text-xs px-2.5 py-1 rounded-full border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 disabled:opacity-50">
                            + Vincular
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Lista de vinculados */}
              <div className="max-h-52 overflow-y-auto">
                {filteredLinked.length === 0 && (
                  <p className="text-center text-xs text-muted-foreground py-6">
                    {contactSearch ? 'Nenhum contato vinculado encontrado' : 'Nenhum contato vinculado ainda'}
                  </p>
                )}
                {filteredLinked.map(c => {
                  const label = c.name ?? c.phone ?? c.email ?? 'Sem nome'
                  const sub = [displayPhone(c), c.email].filter(Boolean).join(' · ')
                  return (
                    <div key={c.id}
                      className="flex items-center gap-2.5 px-5 py-2 hover:bg-accent/40 group/contact transition-colors">
                      <ContactAvatar contact={c} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{label}</p>
                        {sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}
                      </div>
                      <button
                        onClick={() => assignMutation.mutate({ contactId: c.id, companyId: null })}
                        disabled={assignMutation.isPending}
                        title="Remover da empresa"
                        className="shrink-0 p-1 rounded hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/20 text-muted-foreground opacity-0 group-hover/contact:opacity-100 transition-all">
                        <UserMinus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Seção de grupos (apenas ao editar) */}
          {company && (
            <div className="border-t">
              <div className="px-5 py-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  Grupos vinculados
                  {linkedGroups.length > 0 && (
                    <span className="ml-1 text-xs font-normal px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {linkedGroups.length}
                    </span>
                  )}
                </h3>
              </div>

              <div className="px-5 pb-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    value={groupSearch}
                    onChange={e => setGroupSearch(e.target.value)}
                    placeholder="Buscar e vincular grupos..."
                    className="w-full rounded-lg border bg-transparent pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
              </div>

              {/* Sugestões de adição (busca ativa) */}
              {groupSearch && unlinkedGroups.length > 0 && (
                <div className="px-5 pb-2">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Adicionar</p>
                  <div className="rounded-lg border divide-y">
                    {unlinkedGroups.slice(0, 5).map(g => {
                      const label = g.subject ?? '(sem nome)'
                      const avatar = g.contact?.metadata?.avatarUrl ?? null
                      return (
                        <div key={g.id} className="flex items-center gap-2.5 px-3 py-2">
                          <div className="h-8 w-8 rounded-full bg-muted overflow-hidden flex items-center justify-center text-xs shrink-0">
                            {avatar
                              ? <img src={avatar} alt={label} className="h-full w-full object-cover" />
                              : <Users className="h-3.5 w-3.5 text-muted-foreground" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{label}</p>
                            <p className="text-xs text-muted-foreground truncate">📱 {g.channel.label}</p>
                          </div>
                          <button
                            onClick={() => assignGroupMutation.mutate({ conversationId: g.id, companyId: company.id })}
                            disabled={assignGroupMutation.isPending}
                            className="shrink-0 text-xs px-2.5 py-1 rounded-full border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 disabled:opacity-50">
                            + Vincular
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Lista de grupos vinculados */}
              <div className="max-h-52 overflow-y-auto">
                {filteredLinkedGroups.length === 0 && (
                  <p className="text-center text-xs text-muted-foreground py-6">
                    {groupSearch ? 'Nenhum grupo vinculado encontrado' : 'Nenhum grupo vinculado ainda'}
                  </p>
                )}
                {filteredLinkedGroups.map(g => {
                  const label = g.subject ?? '(sem nome)'
                  const avatar = g.contact?.metadata?.avatarUrl ?? null
                  return (
                    <div key={g.id}
                      className="flex items-center gap-2.5 px-5 py-2 hover:bg-accent/40 group/grp transition-colors">
                      <div className="h-8 w-8 rounded-full bg-muted overflow-hidden flex items-center justify-center text-xs shrink-0">
                        {avatar
                          ? <img src={avatar} alt={label} className="h-full w-full object-cover" />
                          : <Users className="h-3.5 w-3.5 text-muted-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{label}</p>
                        <p className="text-xs text-muted-foreground truncate">📱 {g.channel.label}</p>
                      </div>
                      <button
                        onClick={() => assignGroupMutation.mutate({ conversationId: g.id, companyId: null })}
                        disabled={assignGroupMutation.isPending}
                        title="Remover da empresa"
                        className="shrink-0 p-1 rounded hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/20 text-muted-foreground opacity-0 group-hover/grp:opacity-100 transition-all">
                        <UserMinus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 justify-end px-5 py-4 border-t shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-accent">Cancelar</button>
          <button onClick={() => {
              if (!name) return
              const payload: CompanyFormData = {
                name, color,
                domain: domain || null,
              }
              // Campos extras só fazem sentido ao editar (precisam de companyId pra logo etc),
              // mas mandamos no PATCH também
              if (company) {
                payload.cnpj = cnpj || null
                payload.phone = phone || null
                payload.email = email || null
                payload.website = website || null
                payload.address = address || null
                payload.notes = notes || null
              }
              onSave(payload)
            }}
            disabled={!name || isPending}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
            {isPending ? 'Salvando...' : 'Salvar empresa'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function CompaniesPage() {
  return (
    <PermissionGate perm="companies.view">
      <CompaniesPageInner />
    </PermissionGate>
  )
}

function CompaniesPageInner() {
  const queryClient = useQueryClient()
  const canManage = usePermission('companies.manage')
  const [formModal, setFormModal] = useState<null | 'new' | Company>(null)

  const { data: companies = [], isLoading } = useQuery({
    queryKey: ['companies'],
    queryFn: () => apiFetch<Company[]>('/companies'),
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => apiFetch('/companies', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['companies'] }); setFormModal(null); toast.success('Empresa criada!') },
    onError: () => toast.error('Erro ao criar empresa'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: any) => apiFetch(`/companies/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: (_d, vars: any) => {
      queryClient.invalidateQueries({ queryKey: ['companies'] })
      queryClient.invalidateQueries({ queryKey: ['company', vars.id] })
      setFormModal(null)
      toast.success('Atualizado!')
    },
    onError: () => toast.error('Erro ao atualizar'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/companies/${id}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['companies'] }); toast.success('Empresa removida') },
    onError: () => toast.error('Erro ao remover'),
  })

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Building2 className="h-5 w-5 text-muted-foreground" /> Empresas
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Agrupe contatos por empresa para organizar o atendimento
            </p>
          </div>
          {canManage && (
            <button onClick={() => setFormModal('new')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
              <Plus className="h-4 w-4" /> Nova empresa
            </button>
          )}
        </div>

        {/* Estado vazio */}
        {isLoading && <div className="text-center text-sm text-muted-foreground py-8">Carregando...</div>}
        {!isLoading && companies.length === 0 && (
          <div className="rounded-xl border border-dashed p-12 text-center space-y-4">
            <div className="h-14 w-14 mx-auto rounded-2xl bg-muted flex items-center justify-center">
              <Building2 className="h-7 w-7 text-muted-foreground opacity-50" />
            </div>
            <div>
              <p className="font-medium text-sm">Nenhuma empresa cadastrada</p>
              <p className="text-xs text-muted-foreground mt-1">
                Crie empresas para organizar seus contatos e filtrar conversas por cliente
              </p>
            </div>
            <button onClick={() => setFormModal('new')}
              className="mx-auto flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">
              <Plus className="h-4 w-4" /> Criar primeira empresa
            </button>
          </div>
        )}

        {/* Lista de empresas */}
        <div className="space-y-2">
          {companies.map(company => {
            const count = company._count.contactLinks
            const convCount = company._count.conversations ?? 0
            return (
              <div key={company.id}
                className="group rounded-xl border bg-card p-4 flex items-center gap-4 hover:shadow-sm transition-shadow">
                {/* Logo ou ícone colorido */}
                <div className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0 text-white overflow-hidden"
                  style={{ background: company.color }}>
                  {company.logoUrl
                    ? <img src={company.logoUrl} alt={company.name} className="h-full w-full object-cover" />
                    : <Building2 className="h-5 w-5" />}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm">{company.name}</p>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                      {count} contato{count !== 1 ? 's' : ''}
                    </span>
                    {convCount > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                        {convCount} grupo{convCount !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  {company.domain && (
                    <p className="text-xs text-muted-foreground mt-0.5">{company.domain}</p>
                  )}
                </div>

                {/* Ações */}
                {canManage && (
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setFormModal(company)}
                      className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground transition-colors"
                      title="Editar empresa e gerenciar contatos">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => { if (confirm(`Remover "${company.name}"?`)) deleteMutation.mutate(company.id) }}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-500 dark:hover:bg-red-950/20 transition-colors"
                      title="Remover">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Modal */}
      {formModal !== null && (
        <CompanyFormModal
          company={formModal !== 'new' ? (formModal as Company) : undefined}
          onClose={() => setFormModal(null)}
          onSave={data => {
            if (formModal === 'new') createMutation.mutate(data)
            else updateMutation.mutate({ id: (formModal as Company).id, ...data })
          }}
          isPending={createMutation.isPending || updateMutation.isPending}
        />
      )}
    </div>
  )
}

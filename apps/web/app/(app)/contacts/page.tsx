'use client'

import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { formatPhone, displayPhone, isInternalId, type PhoneType } from '@/lib/phone'
import { maskPhone, maskCPF } from '@/lib/masks'
import { isValidCpf } from '@aiwa/shared'
import { toast } from 'sonner'
import {
  Users, Search, Plus, Pencil, Trash2, X, Building2,
  Phone, Mail, MessageSquare, GitMerge, Shuffle, Camera, Link2Off, Lock, EyeOff, Eye, BadgeCheck, ShieldQuestion,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePermission } from '@/lib/usePermission'
import { PermissionGate } from '@/components/PermissionGate'

interface Company { id: string; name: string; color: string }
interface ContactCompanyLink { source: 'MANUAL' | 'GROUP_SYNC'; company: Company }

interface Contact {
  id: string
  name: string | null
  phone: string | null
  phoneType?: PhoneType | null
  lid?: string | null
  email: string | null
  metadata?: { avatarUrl?: string; notes?: string } | null
  companyId: string | null
  company: Company | null
  companies?: ContactCompanyLink[]
  verified?: boolean
  cpf?: string | null
  birthDate?: string | null
  addrStreet?: string | null
  addrNumber?: string | null
  addrComplement?: string | null
  addrDistrict?: string | null
  addrCity?: string | null
  addrState?: string | null
  addrZip?: string | null
  _count: { conversations: number }
}

// ─── Avatar helpers ───────────────────────────────────────────────────────────
const AVATAR_COLORS = ['bg-violet-500','bg-blue-500','bg-green-500','bg-amber-500','bg-rose-500','bg-cyan-500','bg-orange-500','bg-teal-500']
function stringToColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h); return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length] }
function initials(s: string) { const p = s.trim().split(/\s+/); return p.length === 1 ? p[0].slice(0,2).toUpperCase() : (p[0][0]+p[p.length-1][0]).toUpperCase() }

function ContactAvatar({ contact, size = 'md' }: { contact: Contact; size?: 'sm' | 'md' | 'lg' }) {
  const label = contact.name ?? displayPhone(contact) ?? contact.email ?? '?'
  const colorClass = stringToColor(label)
  const sizeClass = size === 'lg' ? 'h-20 w-20 text-2xl' : size === 'sm' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm'
  const avatarUrl = contact.metadata?.avatarUrl

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={label}
        className={cn('rounded-full object-cover shrink-0', sizeClass)}
        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
      />
    )
  }
  return (
    <div className={cn('rounded-full flex items-center justify-center font-semibold text-white shrink-0', colorClass, sizeClass)}>
      {initials(label)}
    </div>
  )
}

// ─── Field helper ─────────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

// ─── Modal de cadastro completo de contato ────────────────────────────────────
function ContactFormModal({ contact, companies, onClose, onSave, isPending }: {
  contact?: Contact
  companies: Company[]
  onClose: () => void
  onSave: (data: {
    name?: string; phone?: string; email?: string
    companyIds?: string[]; metadata?: Record<string, unknown>
    verified?: boolean
    cpf?: string | null; birthDate?: string | null
    addrStreet?: string | null; addrNumber?: string | null; addrComplement?: string | null
    addrDistrict?: string | null; addrCity?: string | null; addrState?: string | null; addrZip?: string | null
  }) => void
  isPending: boolean
}) {
  const rawPhone = contact?.phone ?? null
  const phoneIsId = rawPhone ? isInternalId(rawPhone) : false

  const [name, setName]     = useState(contact?.name ?? '')
  const [phone, setPhone]   = useState(phoneIsId ? '' : (rawPhone ?? ''))
  const [email, setEmail]   = useState(contact?.email ?? '')
  const [notes, setNotes]   = useState(contact?.metadata?.notes ?? '')
  const [avatarUrl, setAvatarUrl] = useState(contact?.metadata?.avatarUrl ?? '')
  // Vínculos de empresa N:N — separa os manuais (editáveis) dos derivados de grupo (read-only)
  const initialManual = (contact?.companies ?? []).filter(c => c.source === 'MANUAL').map(c => c.company.id)
  const groupLinks = (contact?.companies ?? []).filter(c => c.source === 'GROUP_SYNC')
  const [companyIds, setCompanyIds] = useState<string[]>(initialManual)
  // Cadastro estendido (RF01)
  const [cpf, setCpf] = useState(contact?.cpf ?? '')
  const [birthDate, setBirthDate] = useState(contact?.birthDate ? contact.birthDate.slice(0, 10) : '')
  const [addrStreet, setAddrStreet] = useState(contact?.addrStreet ?? '')
  const [addrNumber, setAddrNumber] = useState(contact?.addrNumber ?? '')
  const [addrComplement, setAddrComplement] = useState(contact?.addrComplement ?? '')
  const [addrDistrict, setAddrDistrict] = useState(contact?.addrDistrict ?? '')
  const [addrCity, setAddrCity] = useState(contact?.addrCity ?? '')
  const [addrState, setAddrState] = useState(contact?.addrState ?? '')
  const [addrZip, setAddrZip] = useState(contact?.addrZip ?? '')
  const [syncingAvatar, setSyncingAvatar] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const isVerified = contact?.verified ?? (!contact) // novo contato manual nasce verificado
  const cpfInvalid = cpf.replace(/\D/g, '').length > 0 && !isValidCpf(cpf)

  const addCompany = (id: string) => { if (id && !companyIds.includes(id)) setCompanyIds([...companyIds, id]) }
  const removeCompany = (id: string) => setCompanyIds(companyIds.filter(c => c !== id))

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !contact) return
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await apiFetch<{ avatarUrl: string }>(`/contacts/${contact.id}/avatar`, { method: 'POST', body: form })
      setAvatarUrl(res.avatarUrl)
      toast.success('Foto atualizada!')
    } catch {
      toast.error('Erro ao fazer upload')
    }
    e.target.value = ''
  }

  const handleSyncAvatar = async () => {
    if (!contact) return
    setSyncingAvatar(true)
    try {
      const res = await apiFetch<{ avatarUrl: string }>(`/contacts/${contact.id}/sync-avatar`, { method: 'POST' })
      setAvatarUrl(res.avatarUrl)
      toast.success('Foto sincronizada com o WhatsApp!')
    } catch (err: any) {
      toast.error(err?.message ?? 'Não foi possível buscar a foto do WhatsApp')
    } finally {
      setSyncingAvatar(false)
    }
  }

  const displayName = name || (phone ? formatPhone(phone) : email) || 'Contato'
  const hasContent  = !!(name || phone || email)

  function handleSave() {
    if (cpfInvalid) { toast.error('CPF inválido'); return }
    const meta: Record<string, unknown> = { ...(contact?.metadata ?? {}) }
    if (notes) meta.notes = notes
    if (avatarUrl) meta.avatarUrl = avatarUrl
    else delete meta.avatarUrl

    onSave({
      name:      name || undefined,
      phone:     phone || undefined,
      email:     email || undefined,
      companyIds,
      metadata:  Object.keys(meta).length ? meta : undefined,
      cpf:       cpf ? cpf.replace(/\D/g, '') : null,
      birthDate: birthDate || null,
      addrStreet: addrStreet || null,
      addrNumber: addrNumber || null,
      addrComplement: addrComplement || null,
      addrDistrict: addrDistrict || null,
      addrCity: addrCity || null,
      addrState: addrState || null,
      addrZip: addrZip || null,
    })
  }

  // Promove contato não verificado a verificado (RF05)
  function handleVerify() {
    if (cpfInvalid) { toast.error('CPF inválido'); return }
    onSave({
      verified: true,
      name: name || undefined,
      email: email || undefined,
      companyIds,
      cpf: cpf ? cpf.replace(/\D/g, '') : null,
      birthDate: birthDate || null,
      addrStreet: addrStreet || null,
      addrNumber: addrNumber || null,
      addrComplement: addrComplement || null,
      addrDistrict: addrDistrict || null,
      addrCity: addrCity || null,
      addrState: addrState || null,
      addrZip: addrZip || null,
    })
  }

  const selectedCompanies = companyIds
    .map(id => companies.find(c => c.id === id))
    .filter((c): c is Company => !!c)

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>

        {/* Header com avatar grande */}
        <div className="relative px-6 pt-6 pb-4 border-b bg-gradient-to-b from-muted/40 to-transparent rounded-t-xl">
          <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-accent text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-4">
            {/* Avatar preview + upload */}
            <div className="flex flex-col items-center gap-2">
              <div className="relative group">
                <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
                <div className={cn(
                  'h-20 w-20 rounded-full flex items-center justify-center text-2xl font-semibold text-white shrink-0 overflow-hidden',
                  !avatarUrl && stringToColor(displayName),
                )}>
                  {avatarUrl
                    ? <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" onError={() => setAvatarUrl('')} />
                    : initials(displayName)
                  }
                </div>
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                  title="Fazer upload de foto">
                  <Camera className="h-5 w-5 text-white" />
                </button>
              </div>
              {/* Sincronizar foto do WhatsApp — só para contatos com número real */}
              {contact && !phoneIsId && rawPhone && (
                <button
                  type="button"
                  onClick={handleSyncAvatar}
                  disabled={syncingAvatar}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground border rounded-full px-2.5 py-0.5 transition-colors disabled:opacity-50 whitespace-nowrap"
                  title="Buscar foto do WhatsApp">
                  <span>📱</span>
                  {syncingAvatar ? 'Buscando...' : 'Sync WhatsApp'}
                </button>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-base truncate">{displayName}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {contact ? 'Editar informações do contato' : 'Novo contato'}
              </p>
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                {/* Status de verificação (RF02/RF05) */}
                <span className={cn(
                  'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full',
                  isVerified
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
                )}>
                  {isVerified ? <BadgeCheck className="h-2.5 w-2.5" /> : <ShieldQuestion className="h-2.5 w-2.5" />}
                  {isVerified ? 'Verificado' : 'Não verificado'}
                </span>
                {selectedCompanies.map(c => (
                  <span key={c.id}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full text-white"
                    style={{ background: c.color }}>
                    <Building2 className="h-2.5 w-2.5" />
                    {c.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Dados básicos */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nome">
              <input autoFocus value={name} onChange={e => setName(e.target.value)}
                placeholder="Nome completo"
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </Field>

            <Field label={phoneIsId ? 'Telefone (ID WA)' : 'Telefone (WhatsApp)'}>
              <input value={maskPhone(phone)} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
                placeholder="+55 (11) 99999-9999"
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </Field>
          </div>

          {phoneIsId && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-2">
              ID WA: <span className="font-mono">{rawPhone}</span> — o número real não está disponível via API. Digite-o acima com DDI.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Email">
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="email@exemplo.com"
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </Field>
            <Field label="CPF">
              <input value={maskCPF(cpf)} onChange={e => setCpf(e.target.value.replace(/\D/g, ''))}
                placeholder="000.000.000-00"
                className={cn(
                  'w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40',
                  cpfInvalid && 'border-red-400 focus:ring-red-300',
                )} />
              {cpfInvalid && <p className="text-[11px] text-red-500 mt-0.5">CPF inválido</p>}
            </Field>
          </div>

          <Field label="Data de nascimento">
            <input type="date" value={birthDate} onChange={e => setBirthDate(e.target.value)}
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </Field>

          {/* Empresas (N:N) */}
          <Field label="Empresas">
            <div className="space-y-2">
              {selectedCompanies.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedCompanies.map(c => (
                    <span key={c.id}
                      className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full text-white"
                      style={{ background: c.color }}>
                      <Building2 className="h-3 w-3" />
                      {c.name}
                      <button type="button" onClick={() => removeCompany(c.id)} title="Remover" className="ml-0.5 hover:opacity-70">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <select
                value=""
                onChange={e => { addCompany(e.target.value); e.target.value = '' }}
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
                <option value="">+ Adicionar empresa…</option>
                {companies.filter(c => !companyIds.includes(c.id)).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {groupLinks.length > 0 && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Link2Off className="h-3 w-3" />
                  {groupLinks.length} vínculo(s) automático(s) por grupo de WhatsApp: {groupLinks.map(g => g.company.name).join(', ')}
                </p>
              )}
            </div>
          </Field>

          {/* Endereço (RF01) */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><Field label="Logradouro">
              <input value={addrStreet} onChange={e => setAddrStreet(e.target.value)} placeholder="Rua/Av."
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </Field></div>
            <Field label="Número">
              <input value={addrNumber} onChange={e => setAddrNumber(e.target.value)} placeholder="123"
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Complemento">
              <input value={addrComplement} onChange={e => setAddrComplement(e.target.value)} placeholder="Apto, bloco…"
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </Field>
            <Field label="Bairro">
              <input value={addrDistrict} onChange={e => setAddrDistrict(e.target.value)}
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><Field label="Cidade">
              <input value={addrCity} onChange={e => setAddrCity(e.target.value)}
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </Field></div>
            <Field label="UF">
              <input value={addrState} onChange={e => setAddrState(e.target.value.toUpperCase().slice(0, 2))} placeholder="SP" maxLength={2}
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </Field>
          </div>
          <Field label="CEP">
            <input value={addrZip} onChange={e => setAddrZip(e.target.value)} placeholder="00000-000"
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </Field>

          {/* Notas */}
          <Field label="Observações">
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Informações adicionais sobre o contato..."
              rows={3}
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none" />
          </Field>

          {/* Remover foto */}
          {avatarUrl && (
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Camera className="h-3 w-3 shrink-0" />
              <span className="truncate flex-1">Foto definida</span>
              <button onClick={() => setAvatarUrl('')} className="shrink-0 hover:text-destructive flex items-center gap-1">
                <X className="h-3 w-3" /> Remover
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 justify-end px-6 py-4 border-t">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-accent">Cancelar</button>
          {contact && !isVerified && (
            <button
              onClick={handleVerify}
              disabled={isPending || cpfInvalid}
              title="Promover a cliente verificado"
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-emerald-300 text-emerald-700 dark:text-emerald-400 text-sm font-medium hover:bg-emerald-50 dark:hover:bg-emerald-950/20 disabled:opacity-50">
              <BadgeCheck className="h-4 w-4" /> Verificar
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!hasContent || isPending || cpfInvalid}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
            {isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── MergeModal ───────────────────────────────────────────────────────────────
function MergeModal({ contact, onClose, onMerge, isPending }: {
  contact: Contact
  onClose: () => void
  onMerge: (mergeWithId: string) => void
  isPending: boolean
}) {
  const [search, setSearch] = useState('')

  const { data: contactsData } = useQuery({
    queryKey: ['contacts', search, 'merge'],
    queryFn: () => apiFetch<{ items: Contact[]; hiddenCount: number } | Contact[]>(
      `/contacts?q=${encodeURIComponent(search)}&limit=30`,
    ),
  })
  // A API devolve { items, hiddenCount }; tolera array por segurança.
  const contacts: Contact[] = Array.isArray(contactsData) ? contactsData : contactsData?.items ?? []

  const others = contacts.filter(c => c.id !== contact.id)
  const displayName = contact.name ?? displayPhone(contact) ?? contact.email ?? 'Sem nome'

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div>
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <GitMerge className="h-4 w-4" /> Mesclar contato
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Escolha com qual contato mesclar <strong>{displayName}</strong>
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 py-3 border-b shrink-0">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar contato..."
            className="w-full rounded-lg border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>

        <div className="flex-1 overflow-y-auto">
          {others.length === 0 && (
            <p className="text-center text-sm text-muted-foreground p-6">Nenhum contato encontrado</p>
          )}
          {others.map(c => {
            const label = c.name ?? displayPhone(c) ?? c.email ?? 'Sem nome'
            const sub = [displayPhone(c), c.email].filter(Boolean).join(' · ')
            return (
              <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50">
                <ContactAvatar contact={c} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{label}</p>
                  {sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}
                </div>
                <button
                  onClick={() => onMerge(c.id)}
                  disabled={isPending}
                  className="shrink-0 px-3 py-1 rounded-full text-xs font-medium border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 disabled:opacity-50">
                  Mesclar
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function ContactsPage() {
  return (
    <PermissionGate perm="contacts.view">
      <ContactsPageInner />
    </PermissionGate>
  )
}

function ContactsPageInner() {
  const queryClient = useQueryClient()
  const canEditContact   = usePermission('contacts.edit')
  const canDeleteContact = usePermission('contacts.delete')
  const [search, setSearch]     = useState('')
  const [showLid, setShowLid]   = useState(false)
  const [includeUnverified, setIncludeUnverified] = useState(false)
  const [formModal, setFormModal]   = useState<null | 'new' | Contact>(null)
  const [mergeModal, setMergeModal] = useState<Contact | null>(null)
  const [deduping, setDeduping]     = useState(false)

  const { data: result, isLoading } = useQuery({
    queryKey: ['contacts', search, showLid, includeUnverified],
    queryFn: () => apiFetch<{ items: Contact[]; hiddenCount: number; unverifiedCount: number }>(
      `/contacts?q=${encodeURIComponent(search)}&limit=100&excludeLid=${!showLid}&includeUnverified=${includeUnverified}`
    ),
  })
  const contacts = result?.items ?? []
  const hiddenCount = result?.hiddenCount ?? 0
  const unverifiedCount = result?.unverifiedCount ?? 0

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => apiFetch<Company[]>('/companies'),
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => apiFetch('/contacts', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['contacts'] }); setFormModal(null); toast.success('Contato criado!') },
    onError: () => toast.error('Erro ao criar contato'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: any) => apiFetch(`/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['contacts'] }); setFormModal(null); toast.success('Contato atualizado!') },
    onError: () => toast.error('Erro ao atualizar'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/contacts/${id}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['contacts'] }); toast.success('Contato removido') },
    onError: () => toast.error('Erro ao remover'),
  })

  const mergeMutation = useMutation({
    mutationFn: ({ id, mergeWithId }: { id: string; mergeWithId: string }) =>
      apiFetch(`/contacts/${id}/merge`, { method: 'POST', body: JSON.stringify({ mergeWithId }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      setMergeModal(null)
      toast.success('Contatos mesclados!')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleDedup = async () => {
    if (!confirm('Deduplicar automaticamente todos os contatos com mesmo telefone? Essa ação não pode ser desfeita.')) return
    setDeduping(true)
    try {
      const result = await apiFetch<{ merged: number; checked: number }>('/contacts/dedup', { method: 'POST' })
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      toast.success(`${result.merged} duplicata(s) mesclada(s) de ${result.checked} contatos verificados`)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDeduping(false)
    }
  }

  function handleSave(data: any) {
    if (formModal === 'new') {
      createMutation.mutate(data)
    } else {
      updateMutation.mutate({ id: (formModal as Contact).id, ...data })
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" /> Contatos
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {contacts.length} contato{contacts.length !== 1 ? 's' : ''}
              {!showLid && hiddenCount > 0 && (
                <span className="ml-1 text-muted-foreground/60">
                  · {hiddenCount} sem número oculto{hiddenCount !== 1 ? 's' : ''}
                </span>
              )}
              {!includeUnverified && unverifiedCount > 0 && (
                <span className="ml-1 text-muted-foreground/60">
                  · {unverifiedCount} não verificado{unverifiedCount !== 1 ? 's' : ''} oculto{unverifiedCount !== 1 ? 's' : ''}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              onClick={() => setIncludeUnverified(v => !v)}
              title={includeUnverified ? 'Ocultar contatos não verificados' : 'Incluir contatos não verificados'}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-colors whitespace-nowrap shrink-0',
                includeUnverified
                  ? 'bg-accent text-foreground border-primary/20'
                  : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {includeUnverified ? <BadgeCheck className="h-4 w-4 shrink-0" /> : <ShieldQuestion className="h-4 w-4 shrink-0" />}
              {includeUnverified ? 'Com não verificados' : 'Só verificados'}
            </button>
            <button
              onClick={() => setShowLid(v => !v)}
              title={showLid ? 'Ocultar contatos sem número' : 'Mostrar contatos sem número'}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-colors whitespace-nowrap shrink-0',
                showLid
                  ? 'bg-accent text-foreground border-primary/20'
                  : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {showLid ? <Eye className="h-4 w-4 shrink-0" /> : <EyeOff className="h-4 w-4 shrink-0" />}
              {showLid ? 'Todos' : 'Sem número'}
            </button>
            {canEditContact && (
              <button
                onClick={handleDedup}
                disabled={deduping}
                title="Detectar e mesclar contatos duplicados automaticamente"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm text-muted-foreground hover:bg-accent disabled:opacity-50 transition-colors whitespace-nowrap shrink-0">
                <Shuffle className="h-4 w-4 shrink-0" />
                {deduping ? 'Deduplicando...' : 'Deduplicar'}
              </button>
            )}
            {canEditContact && (
              <button onClick={() => setFormModal('new')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors whitespace-nowrap shrink-0">
                <Plus className="h-4 w-4 shrink-0" /> Novo contato
              </button>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, telefone ou email..."
            className="w-full rounded-lg border bg-card pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
        </div>

        {/* Loading */}
        {isLoading && <div className="text-center text-sm text-muted-foreground py-8">Carregando...</div>}

        {/* Empty */}
        {!isLoading && contacts.length === 0 && (
          <div className="rounded-xl border border-dashed p-12 text-center space-y-4">
            <div className="h-14 w-14 mx-auto rounded-2xl bg-muted flex items-center justify-center">
              <Users className="h-7 w-7 text-muted-foreground opacity-50" />
            </div>
            <div>
              <p className="font-medium text-sm">
                {search ? 'Nenhum contato encontrado' : 'Nenhum contato cadastrado'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {search ? 'Tente buscar com outros termos' : 'Contatos são criados automaticamente quando chegam mensagens'}
              </p>
            </div>
          </div>
        )}

        {/* Lista */}
        <div className="space-y-1.5">
          {contacts.map(contact => {
            const isLid = contact.phoneType === 'LID'
            const phoneText = displayPhone(contact)
            const label = contact.name ?? phoneText ?? contact.email ?? 'Sem nome'
            const convCount = contact._count.conversations
            const notes = contact.metadata?.notes

            return (
              <div key={contact.id}
                className="group rounded-xl border bg-card p-3.5 flex items-center gap-3 hover:shadow-sm transition-shadow">

                {/* Avatar */}
                <ContactAvatar contact={contact} />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm">{label}</p>
                    {isLid && (
                      <span
                        title="Telefone protegido pelo WhatsApp — sem número real disponível. Edite o contato para adicionar manualmente."
                        className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 leading-none">
                        <Lock className="h-2.5 w-2.5" />
                        sem número
                      </span>
                    )}
                    {contact.verified === false && (
                      <span
                        title="Contato não verificado — clique em editar para verificar"
                        className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 leading-none">
                        <ShieldQuestion className="h-2.5 w-2.5" />
                        não verificado
                      </span>
                    )}
                    {(contact.companies && contact.companies.length > 0
                      ? contact.companies.map(l => l.company)
                      : contact.company ? [contact.company] : []
                    ).map(co => (
                      <span key={co.id}
                        className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white leading-none"
                        style={{ background: co.color }}>
                        <Building2 className="h-2.5 w-2.5" />
                        {co.name}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    {phoneText && (
                      <span className={cn(
                        'flex items-center gap-1 text-xs',
                        isLid ? 'text-muted-foreground/60 italic' : 'text-muted-foreground',
                      )}>
                        {isLid ? <Lock className="h-3 w-3" /> : <Phone className="h-3 w-3" />}
                        {phoneText}
                      </span>
                    )}
                    {contact.email && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Mail className="h-3 w-3" /> {contact.email}
                      </span>
                    )}
                    {convCount > 0 && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MessageSquare className="h-3 w-3" /> {convCount} conversa{convCount !== 1 ? 's' : ''}
                      </span>
                    )}
                    {notes && (
                      <span className="text-xs text-muted-foreground truncate max-w-[200px]" title={notes}>
                        {notes}
                      </span>
                    )}
                  </div>
                </div>

                {/* Ações (aparecem no hover) */}
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {convCount > 0 && (
                    <a
                      href={`/inbox`}
                      className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground transition-colors"
                      title="Ver conversas">
                      <MessageSquare className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {canEditContact && (
                    <button onClick={() => setMergeModal(contact)}
                      className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground transition-colors"
                      title="Mesclar com outro contato">
                      <GitMerge className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {canEditContact && (
                    <button onClick={() => setFormModal(contact)}
                      className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground transition-colors"
                      title="Editar">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {canDeleteContact && (
                  <button
                    onClick={() => { if (confirm(`Remover "${label}"?`)) deleteMutation.mutate(contact.id) }}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-500 dark:hover:bg-red-950/20 transition-colors"
                    title="Remover">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Modais */}
      {formModal !== null && (
        <ContactFormModal
          contact={formModal !== 'new' ? (formModal as Contact) : undefined}
          companies={companies}
          onClose={() => setFormModal(null)}
          onSave={handleSave}
          isPending={isPending}
        />
      )}
      {mergeModal && (
        <MergeModal
          contact={mergeModal}
          onClose={() => setMergeModal(null)}
          onMerge={mergeWithId => mergeMutation.mutate({ id: mergeModal.id, mergeWithId })}
          isPending={mergeMutation.isPending}
        />
      )}
    </div>
  )
}

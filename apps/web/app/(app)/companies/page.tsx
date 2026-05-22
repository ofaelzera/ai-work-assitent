'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { displayPhone, type PhoneType } from '@/lib/phone'
import { toast } from 'sonner'
import { Building2, Plus, Pencil, Trash2, Users, X, Phone, Mail, UserMinus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePermission } from '@/lib/usePermission'

interface Company {
  id: string
  name: string
  color: string
  domain: string | null
  _count: { contacts: number }
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
function CompanyFormModal({ company, onClose, onSave, isPending }: {
  company?: Company
  onClose: () => void
  onSave: (data: { name: string; color: string; domain?: string }) => void
  isPending: boolean
}) {
  const queryClient = useQueryClient()
  const [name, setName]   = useState(company?.name ?? '')
  const [color, setColor] = useState(company?.color ?? '#6366f1')
  const [domain, setDomain] = useState(company?.domain ?? '')
  const [contactSearch, setContactSearch] = useState('')

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
            <div className="h-7 w-7 rounded-lg flex items-center justify-center" style={{ background: color }}>
              <Building2 className="h-4 w-4 text-white" />
            </div>
            <h2 className="font-semibold text-sm">{company ? 'Editar empresa' : 'Nova empresa'}</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* Dados da empresa */}
          <div className="px-5 py-4 space-y-4">
            <Field label="Nome *">
              <input autoFocus value={name} onChange={e => setName(e.target.value)}
                placeholder="Ex: Acme Corp"
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </Field>

            <Field label="Domínio (opcional)">
              <input value={domain} onChange={e => setDomain(e.target.value)}
                placeholder="acme.com.br"
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
        </div>

        {/* Footer */}
        <div className="flex gap-2 justify-end px-5 py-4 border-t shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-accent">Cancelar</button>
          <button onClick={() => name && onSave({ name, color, domain: domain || undefined })}
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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['companies'] }); setFormModal(null); toast.success('Atualizado!') },
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
            const count = company._count.contacts
            return (
              <div key={company.id}
                className="group rounded-xl border bg-card p-4 flex items-center gap-4 hover:shadow-sm transition-shadow">
                {/* Ícone colorido */}
                <div className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0 text-white"
                  style={{ background: company.color }}>
                  <Building2 className="h-5 w-5" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm">{company.name}</p>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                      {count} contato{count !== 1 ? 's' : ''}
                    </span>
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

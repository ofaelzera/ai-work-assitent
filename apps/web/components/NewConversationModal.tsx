'use client'

import { useState, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { X, Search, MessageSquare, Mail, Phone, UserPlus, CheckCircle2, AlertCircle, Loader2, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { maskPhone } from '@/lib/masks'
import { ChatInput } from '@/components/ChatInput'

interface Channel { id: string; type: string; label: string; status: string }
interface Contact {
  id: string; name: string | null; phone: string | null; email: string | null
  metadata?: { avatarUrl?: string } | null
  conversations: Array<{ id: string; channel: { id: string; type: string; label: string } }>
}
interface GroupItem {
  id: string                       // groupJid (xxx@g.us)
  subject: string
  conversationId?: string | null   // se já existir conversa
  pictureUrl?: string | null
}

interface NewConversationModalProps {
  onClose: () => void
  onCreated: (conversationId: string) => void
}

function Avatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  const colors = ['bg-violet-500','bg-blue-500','bg-green-500','bg-amber-500','bg-rose-500']
  let hash = 0; for (const c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash)
  const color = colors[Math.abs(hash) % colors.length]
  const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()

  if (avatarUrl) return <img src={avatarUrl} alt={name} className="h-9 w-9 rounded-full object-cover shrink-0" />
  return (
    <div className={cn('h-9 w-9 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0', color)}>
      {initials}
    </div>
  )
}

export default function NewConversationModal({ onClose, onCreated }: NewConversationModalProps) {
  const [search, setSearch] = useState('')
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<GroupItem | null>(null)
  const [selectedChannelId, setSelectedChannelId] = useState('')
  const [text, setText] = useState('')
  const [subject, setSubject] = useState('')
  const [manualPhone, setManualPhone] = useState('')
  const [manualEmail, setManualEmail] = useState('')
  const [step, setStep] = useState<'pick-contact' | 'compose'>('pick-contact')
  const [waCheck, setWaCheck] = useState<'idle' | 'checking' | 'yes' | 'no'>('idle')
  const [targetMode, setTargetMode] = useState<'contact' | 'group'>('contact')
  const waCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const { data: channels = [] } = useQuery({
    queryKey: ['channels'],
    queryFn: () => apiFetch<Channel[]>('/channels'),
  })
  const connectedChannels = channels.filter(c => c.status === 'CONNECTED')

  // Em canais WhatsApp (ou sem canal definido), só faz sentido mostrar contatos
  // com número cadastrado — quem não tem telefone não pode receber a mensagem.
  const wantPhoneOnly = connectedChannels.find(c => c.id === selectedChannelId)?.type !== 'IMAP_SMTP'

  // Só busca quando tem termo de pesquisa (evita listar 500 contatos sem nome)
  // Backend já filtra LIDs sem nome por padrão via excludeLid=true
  const { data: contactsData, isLoading } = useQuery({
    queryKey: ['contacts', search, wantPhoneOnly],
    queryFn: () => apiFetch<{ items: Contact[] } | Contact[]>(
      `/contacts?q=${encodeURIComponent(search)}&excludeLid=true&limit=20${wantPhoneOnly ? '&hasPhone=true' : ''}`,
    ),
    enabled: search.trim().length >= 2,
  })
  const contacts: Contact[] = Array.isArray(contactsData)
    ? contactsData
    : contactsData?.items ?? []

  const selectedChannel = connectedChannels.find(c => c.id === selectedChannelId)
  const isWhatsAppChannel = selectedChannel?.type === 'WHATSAPP'

  // Debounce do termo de busca de grupos (300ms) — fetchAllGroups é pesado
  const [groupSearchDebounced, setGroupSearchDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setGroupSearchDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  // Busca grupos quando modo=group e canal é WhatsApp
  const queryClient = useQueryClient()
  const { data: groupsData, isLoading: isLoadingGroups, isFetching: isFetchingGroups } = useQuery({
    queryKey: ['conv-groups-search', selectedChannelId, groupSearchDebounced],
    queryFn: () => apiFetch<{ items: GroupItem[] }>(
      `/conversations/groups/search?channelId=${selectedChannelId}&q=${encodeURIComponent(groupSearchDebounced)}`,
    ),
    enabled: targetMode === 'group' && !!selectedChannelId && isWhatsAppChannel,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  })
  const groups: GroupItem[] = groupsData?.items ?? []
  const groupsBusy = isLoadingGroups || isFetchingGroups

  // Pré-aquecimento: ao trocar pra aba Grupo, dispara já uma busca com q vazio,
  // que faz o backend popular o cache do fetchAllGroups (TTL 5min).
  useEffect(() => {
    if (targetMode !== 'group' || !selectedChannelId || !isWhatsAppChannel) return
    queryClient.prefetchQuery({
      queryKey: ['conv-groups-search', selectedChannelId, ''],
      queryFn: () => apiFetch<{ items: GroupItem[] }>(
        `/conversations/groups/search?channelId=${selectedChannelId}&q=`,
      ),
      staleTime: 5 * 60_000,
    })
  }, [targetMode, selectedChannelId, isWhatsAppChannel, queryClient])

  // Reseta seleções quando troca de modo ou canal não-WA
  useEffect(() => {
    if (!isWhatsAppChannel && targetMode === 'group') setTargetMode('contact')
    if (targetMode === 'contact') setSelectedGroup(null)
    if (targetMode === 'group') {
      setSelectedContact(null)
      setManualPhone('')
      setManualEmail('')
    }
  }, [targetMode, isWhatsAppChannel])

  // Auto-select first compatible channel when contact selected
  useEffect(() => {
    if (!selectedContact) return
    const compatible = connectedChannels.find(ch => {
      if (ch.type === 'WHATSAPP') return !!selectedContact.phone
      return !!selectedContact.email
    })
    if (compatible) setSelectedChannelId(compatible.id)
  }, [selectedContact])

  // Verifica se o número tem WhatsApp quando um canal WA é selecionado e há número digitado
  useEffect(() => {
    const digits = manualPhone.replace(/\D/g, '')
    if (selectedChannel?.type !== 'WHATSAPP' || digits.length < 10) {
      setWaCheck('idle')
      return
    }
    setWaCheck('checking')
    if (waCheckTimer.current) clearTimeout(waCheckTimer.current)
    waCheckTimer.current = setTimeout(async () => {
      try {
        const result = await apiFetch<Array<{ exists: boolean; number: string }>>(
          `/channels/${selectedChannelId}/check-numbers`,
          { method: 'POST', body: JSON.stringify({ numbers: [digits] }) },
        )
        setWaCheck(result[0]?.exists ? 'yes' : 'no')
      } catch {
        setWaCheck('idle')
      }
    }, 800)
    return () => { if (waCheckTimer.current) clearTimeout(waCheckTimer.current) }
  }, [manualPhone, selectedChannelId, selectedChannel?.type])

  const sendMutation = useMutation({
    mutationFn: () => {
      const isWa = selectedChannel?.type === 'WHATSAPP'
      return apiFetch<{ conversation: { id: string }; message: { id: string } }>('/conversations/new', {
        method: 'POST',
        body: JSON.stringify({
          channelId: selectedChannelId,
          contactId: selectedContact?.id,
          phone: isWa && targetMode === 'contact' ? (selectedContact?.phone ?? manualPhone) : undefined,
          email: !isWa ? (selectedContact?.email ?? manualEmail) : undefined,
          groupJid: targetMode === 'group' ? selectedGroup?.id : undefined,
          subject: subject || (targetMode === 'group' ? selectedGroup?.subject : undefined),
          text,
        }),
      })
    },
    onSuccess: (data) => {
      toast.success('Conversa iniciada!')
      onCreated(data.conversation.id)
      onClose()
    },
    onError: (err: any) => toast.error(err?.message ?? 'Erro ao iniciar conversa'),
  })

  const canSend = selectedChannelId && text.trim() && (
    targetMode === 'group'
      ? !!selectedGroup
      : (selectedContact ?? manualPhone ?? manualEmail)
  )

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-sm">Nova conversa</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Seleção de canal */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Canal</label>
            <div className="flex flex-wrap gap-2">
              {connectedChannels.map(ch => (
                <button
                  key={ch.id}
                  onClick={() => setSelectedChannelId(ch.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors',
                    selectedChannelId === ch.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'hover:bg-accent text-muted-foreground',
                  )}
                >
                  {ch.type === 'WHATSAPP' ? <Phone className="h-3 w-3" /> : <Mail className="h-3 w-3" />}
                  {ch.label}
                </button>
              ))}
              {connectedChannels.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhum canal conectado</p>
              )}
            </div>
          </div>

          {/* Toggle Contato/Grupo (apenas WhatsApp) */}
          {isWhatsAppChannel && !selectedContact && !selectedGroup && (
            <div className="flex gap-1 p-0.5 rounded-lg bg-muted/50 w-fit">
              <button
                onClick={() => setTargetMode('contact')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors',
                  targetMode === 'contact' ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <UserPlus className="h-3 w-3" /> Contato
              </button>
              <button
                onClick={() => setTargetMode('group')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors',
                  targetMode === 'group' ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Users className="h-3 w-3" /> Grupo
              </button>
            </div>
          )}

          {/* Grupo selecionado */}
          {targetMode === 'group' && selectedGroup && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Grupo selecionado</label>
              <div className="flex items-center gap-3 p-2.5 rounded-lg border bg-primary/5">
                <Avatar name={selectedGroup.subject} avatarUrl={selectedGroup.pictureUrl} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{selectedGroup.subject}</p>
                  <p className="text-xs text-muted-foreground truncate">{selectedGroup.id}</p>
                </div>
                <button onClick={() => setSelectedGroup(null)} className="p-1 hover:bg-accent rounded">
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>
          )}

          {/* Busca de grupos */}
          {targetMode === 'group' && !selectedGroup && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Buscar grupo</label>
              <div className="relative mb-2">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  autoFocus
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Nome do grupo..."
                  className="w-full rounded-md border bg-transparent pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="rounded-lg border overflow-hidden max-h-48 overflow-y-auto">
                {!selectedChannelId && (
                  <p className="text-xs text-muted-foreground p-3 text-center">Selecione um canal WhatsApp</p>
                )}
                {selectedChannelId && groupsBusy && groups.length === 0 && (
                  <p className="text-xs text-muted-foreground p-3">Buscando grupos...</p>
                )}
                {selectedChannelId && !groupsBusy && groups.length === 0 && (
                  <p className="text-xs text-muted-foreground p-3 text-center">
                    {search.trim() ? 'Nenhum grupo encontrado' : 'Nenhum grupo disponível'}
                  </p>
                )}
                {groups.map(g => (
                  <button
                    key={g.id}
                    onClick={() => {
                      if (g.conversationId) {
                        // Já existe conversa: abre direto
                        onCreated(g.conversationId)
                        onClose()
                        return
                      }
                      setSelectedGroup(g)
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-accent transition-colors text-left"
                  >
                    <Avatar name={g.subject} avatarUrl={g.pictureUrl} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{g.subject}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {g.conversationId ? 'Abrir conversa existente' : 'Iniciar nova conversa'}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Busca de contato */}
          {targetMode === 'contact' && (
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
              {selectedContact ? 'Contato selecionado' : 'Buscar contato'}
            </label>

            {selectedContact ? (
              <div className="flex items-center gap-3 p-2.5 rounded-lg border bg-primary/5">
                <Avatar name={selectedContact.name ?? selectedContact.phone ?? '?'} avatarUrl={(selectedContact.metadata as any)?.avatarUrl} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{selectedContact.name ?? 'Sem nome'}</p>
                  <p className="text-xs text-muted-foreground truncate">{selectedContact.phone ?? selectedContact.email}</p>
                </div>
                <button onClick={() => setSelectedContact(null)} className="p-1 hover:bg-accent rounded">
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            ) : (
              <>
                <div className="relative mb-2">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    autoFocus
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Nome, telefone ou email..."
                    className="w-full rounded-md border bg-transparent pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                {/* Lista de contatos */}
                <div className="rounded-lg border overflow-hidden max-h-40 overflow-y-auto">
                  {search.trim().length < 2 && (
                    <p className="text-xs text-muted-foreground p-3 text-center">
                      Digite ao menos 2 caracteres para buscar
                    </p>
                  )}
                  {search.trim().length >= 2 && isLoading && (
                    <p className="text-xs text-muted-foreground p-3">Buscando...</p>
                  )}
                  {search.trim().length >= 2 && !isLoading && contacts.length === 0 && (
                    <p className="text-xs text-muted-foreground p-3 text-center">
                      Nenhum contato encontrado
                    </p>
                  )}
                  {contacts.map(c => {
                    const label =
                      c.name?.trim()
                      || (c.phone ? `📱 ${c.phone}` : null)
                      || c.email
                      || 'Contato sem identificação'
                    return (
                      <button
                        key={c.id}
                        onClick={() => setSelectedContact(c)}
                        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-accent transition-colors text-left"
                      >
                        <Avatar name={label} avatarUrl={(c.metadata as any)?.avatarUrl} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{label}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {c.name && c.phone && <span className="mr-2">📱 {c.phone}</span>}
                            {c.email && <span>✉️ {c.email}</span>}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>

                {/* Número/email manual */}
                {selectedChannel?.type === 'WHATSAPP' && (
                  <div className="mt-2">
                    <label className="text-xs text-muted-foreground block mb-1">Ou digite um número diretamente:</label>
                    <div className="relative">
                      <input
                        value={maskPhone(manualPhone)}
                        onChange={e => { setManualPhone(e.target.value.replace(/\D/g, '')); setWaCheck('idle') }}
                        placeholder="+55 (11) 99999-9999"
                        className={cn(
                          'w-full rounded-md border bg-transparent px-3 py-1.5 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring',
                          waCheck === 'no' && 'border-amber-400',
                          waCheck === 'yes' && 'border-green-400',
                        )}
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        {waCheck === 'checking' && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                        {waCheck === 'yes' && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                        {waCheck === 'no' && <AlertCircle className="h-3.5 w-3.5 text-amber-500" />}
                      </div>
                    </div>
                    {waCheck === 'no' && (
                      <p className="text-[11px] text-amber-600 mt-1">Número não encontrado no WhatsApp</p>
                    )}
                    {waCheck === 'yes' && (
                      <p className="text-[11px] text-green-600 mt-1">Número tem WhatsApp ativo</p>
                    )}
                  </div>
                )}
                {selectedChannel && selectedChannel.type !== 'WHATSAPP' && (
                  <div className="mt-2">
                    <label className="text-xs text-muted-foreground block mb-1">Ou digite um email diretamente:</label>
                    <input
                      type="email"
                      value={manualEmail}
                      onChange={e => setManualEmail(e.target.value)}
                      placeholder="exemplo@email.com"
                      className="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                )}
              </>
            )}
          </div>
          )}

          {/* Assunto (só para email) */}
          {selectedChannel && selectedChannel.type !== 'WHATSAPP' && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Assunto</label>
              <input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="Assunto do email"
                className="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}

          {/* Mensagem */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Mensagem</label>
            <ChatInput
              value={text}
              onChange={setText}
              onSend={() => { if (canSend && !sendMutation.isPending) sendMutation.mutate() }}
              disabled={sendMutation.isPending}
              placeholder="Digite sua mensagem..."
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-md text-sm hover:bg-accent">Cancelar</button>
          <button
            onClick={() => sendMutation.mutate()}
            disabled={!canSend || sendMutation.isPending}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {sendMutation.isPending ? 'Enviando...' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  )
}

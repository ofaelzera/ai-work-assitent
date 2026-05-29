'use client'

import { useState, useEffect, useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { X, Search, Users, Phone, Plus, UserPlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { maskPhone } from '@/lib/masks'

interface Channel { id: string; type: string; label: string; status: string }
interface Contact {
  id: string; name: string | null; phone: string | null; email: string | null
  metadata?: { avatarUrl?: string } | null
}
interface Participant {
  phone: string                   // só dígitos
  label: string                   // nome do contato ou "Manual"
  avatarUrl?: string | null
  contactId?: string
}

interface CreateGroupModalProps {
  onClose: () => void
  onCreated: (conversationId: string) => void
}

function Avatar({ name, avatarUrl, size = 'md' }: { name: string; avatarUrl?: string | null; size?: 'sm' | 'md' }) {
  const colors = ['bg-violet-500', 'bg-blue-500', 'bg-green-500', 'bg-amber-500', 'bg-rose-500']
  let hash = 0; for (const c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash)
  const color = colors[Math.abs(hash) % colors.length]
  const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const dim = size === 'sm' ? 'h-7 w-7 text-[10px]' : 'h-9 w-9 text-xs'
  if (avatarUrl) return <img src={avatarUrl} alt={name} className={cn('rounded-full object-cover shrink-0', dim)} />
  return (
    <div className={cn('rounded-full flex items-center justify-center text-white font-semibold shrink-0', color, dim)}>
      {initials}
    </div>
  )
}

export default function CreateGroupModal({ onClose, onCreated }: CreateGroupModalProps) {
  const [selectedChannelId, setSelectedChannelId] = useState('')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [firstMessage, setFirstMessage] = useState('')
  const [participants, setParticipants] = useState<Participant[]>([])
  const [search, setSearch] = useState('')
  const [manualPhone, setManualPhone] = useState('')

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const { data: channels = [] } = useQuery({
    queryKey: ['channels'],
    queryFn: () => apiFetch<Channel[]>('/channels'),
  })
  const waChannels = channels.filter(c => c.type === 'WHATSAPP' && c.status === 'CONNECTED')

  // Auto-seleciona primeiro canal WA disponível
  useEffect(() => {
    if (!selectedChannelId && waChannels.length > 0) setSelectedChannelId(waChannels[0].id)
  }, [waChannels.length])

  const { data: contactsData, isLoading } = useQuery({
    queryKey: ['contacts', search],
    queryFn: () => apiFetch<{ items: Contact[] } | Contact[]>(
      `/contacts?q=${encodeURIComponent(search)}&excludeLid=true&limit=20`,
    ),
    enabled: search.trim().length >= 2,
  })
  const contacts: Contact[] = Array.isArray(contactsData) ? contactsData : contactsData?.items ?? []

  function addParticipant(p: Participant) {
    if (!p.phone || p.phone.length < 8) return
    if (participants.some(x => x.phone === p.phone)) {
      toast.info('Participante já adicionado')
      return
    }
    setParticipants(prev => [...prev, p])
  }
  function removeParticipant(phone: string) {
    setParticipants(prev => prev.filter(p => p.phone !== phone))
  }
  function handleAddManual() {
    const digits = manualPhone.replace(/\D/g, '')
    if (digits.length < 8) {
      toast.error('Número inválido')
      return
    }
    addParticipant({ phone: digits, label: `+${digits}` })
    setManualPhone('')
  }

  const createMutation = useMutation({
    mutationFn: () => apiFetch<{ conversation: { id: string }; groupJid: string }>(
      '/conversations/new/group',
      {
        method: 'POST',
        body: JSON.stringify({
          channelId: selectedChannelId,
          subject: subject.trim(),
          description: description.trim() || undefined,
          participants: participants.map(p => p.phone),
          firstMessage: firstMessage.trim() || undefined,
        }),
      },
    ),
    onSuccess: (data) => {
      toast.success('Grupo criado!')
      onCreated(data.conversation.id)
      onClose()
    },
    onError: (err: any) => toast.error(err?.message ?? 'Erro ao criar grupo'),
  })

  const canCreate = selectedChannelId && subject.trim().length >= 1 && participants.length >= 1

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-sm">Criar grupo no WhatsApp</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Canal */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Canal</label>
            <div className="flex flex-wrap gap-2">
              {waChannels.map(ch => (
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
                  <Phone className="h-3 w-3" />
                  {ch.label}
                </button>
              ))}
              {waChannels.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhum canal WhatsApp conectado</p>
              )}
            </div>
          </div>

          {/* Nome do grupo */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Nome do grupo</label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              maxLength={100}
              placeholder="Ex: Cliente X - Implantação"
              className="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Descrição */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
              Descrição <span className="text-muted-foreground/60 normal-case font-normal">(opcional)</span>
            </label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={500}
              placeholder="Objetivo do grupo"
              className="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Participantes */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
              Participantes ({participants.length})
            </label>

            {participants.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {participants.map(p => (
                  <div key={p.phone} className="flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full border bg-primary/5 text-xs">
                    <Avatar name={p.label} avatarUrl={p.avatarUrl} size="sm" />
                    <span className="truncate max-w-[140px]">{p.label}</span>
                    <button onClick={() => removeParticipant(p.phone)} className="p-0.5 hover:bg-accent rounded-full">
                      <X className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Buscar contato */}
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar contato pra adicionar..."
                className="w-full rounded-md border bg-transparent pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            {search.trim().length >= 2 && (
              <div className="rounded-lg border overflow-hidden max-h-40 overflow-y-auto mb-2">
                {isLoading && <p className="text-xs text-muted-foreground p-3">Buscando...</p>}
                {!isLoading && contacts.length === 0 && (
                  <p className="text-xs text-muted-foreground p-3 text-center">Nenhum contato encontrado</p>
                )}
                {contacts.filter(c => !!c.phone).map(c => {
                  const phoneDigits = (c.phone ?? '').replace(/\D/g, '')
                  const already = participants.some(p => p.phone === phoneDigits)
                  const label = c.name?.trim() || `+${phoneDigits}`
                  return (
                    <button
                      key={c.id}
                      disabled={already}
                      onClick={() => {
                        addParticipant({
                          phone: phoneDigits,
                          label,
                          avatarUrl: (c.metadata as any)?.avatarUrl,
                          contactId: c.id,
                        })
                        setSearch('')
                      }}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2 transition-colors text-left',
                        already ? 'opacity-40 cursor-not-allowed' : 'hover:bg-accent',
                      )}
                    >
                      <Avatar name={label} avatarUrl={(c.metadata as any)?.avatarUrl} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{label}</p>
                        <p className="text-xs text-muted-foreground truncate">📱 {c.phone}</p>
                      </div>
                      {already && <span className="text-[10px] text-muted-foreground">adicionado</span>}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Manual */}
            <div className="flex gap-2">
              <input
                value={maskPhone(manualPhone)}
                onChange={e => setManualPhone(e.target.value.replace(/\D/g, ''))}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddManual())}
                placeholder="Ou digite um número (com DDI)"
                className="flex-1 rounded-md border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                onClick={handleAddManual}
                disabled={manualPhone.replace(/\D/g, '').length < 8}
                className="px-3 py-1.5 rounded-md border text-xs font-medium hover:bg-accent disabled:opacity-50 flex items-center gap-1"
              >
                <Plus className="h-3 w-3" /> Adicionar
              </button>
            </div>
          </div>

          {/* Mensagem inicial */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
              Mensagem inicial <span className="text-muted-foreground/60 normal-case font-normal">(opcional)</span>
            </label>
            <textarea
              value={firstMessage}
              onChange={e => setFirstMessage(e.target.value)}
              placeholder="Saudação enviada ao criar o grupo..."
              rows={3}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-md text-sm hover:bg-accent">Cancelar</button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!canCreate || createMutation.isPending}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {createMutation.isPending ? 'Criando...' : 'Criar grupo'}
          </button>
        </div>
      </div>
    </div>
  )
}

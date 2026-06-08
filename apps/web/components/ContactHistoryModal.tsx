import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { apiFetch } from '@/lib/api'
import {
  X,
  Search,
  MessageSquare,
  Calendar,
  Clock,
  Ticket,
  Loader2,
  CalendarDays,
  Plus
} from 'lucide-react'
import { Message, MediaBubble } from '@/app/(app)/inbox/[conversationId]/_components/WhatsappView'
import NewConversationModal from './NewConversationModal'

interface ContactHistoryModalProps {
  contactId: string
  contactName: string
  onClose: () => void
}

interface KPIs {
  totalTickets: number
  totalMessages: number
  avgSlaSeconds: number
}

interface Conversation {
  id: string
  subject: string | null
  status: string
  createdAt: string
  lastMessageAt: string | null
  unreadCount: number
  channel: { type: string; label: string | null } | null
}

function formatDuration(seconds: number) {
  if (!seconds) return '--'
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const hours = Math.floor(seconds / 3600)
  const mins = Math.round((seconds % 3600) / 60)
  return `${hours}h ${mins}m`
}

export function ContactHistoryModal({ contactId, contactName, onClose }: ContactHistoryModalProps) {
  const router = useRouter()
  const [selectedConvId, setSelectedConvId] = useState<string | null>('ALL')
  const [newConvOpen, setNewConvOpen] = useState(false)
  const [q, setQ] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')

  // Debounce simple for search
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQ(e.target.value)
    setTimeout(() => setDebouncedQ(e.target.value), 500)
  }

  // Queries
  const { data: kpis, isLoading: kpisLoading } = useQuery<KPIs>({
    queryKey: ['contacts', contactId, 'kpis'],
    queryFn: () => apiFetch(`/contacts/${contactId}/kpis`)
  })

  const { data: convsData, isLoading: convsLoading } = useQuery<{ conversations: Conversation[] }>({
    queryKey: ['conversations', { contactId, status: 'all', filter: 'all', noDedup: true }],
    queryFn: () => apiFetch(`/conversations?contactId=${contactId}&status=all&filter=all&limit=100&noDedup=true`)
  })

  const { data: msgsData, isLoading: msgsLoading } = useQuery<{ messages: Message[] }>({
    queryKey: ['conversations', selectedConvId, 'messages', debouncedQ, startDate, endDate],
    queryFn: () => {
      let url = selectedConvId === 'ALL'
        ? `/contacts/${contactId}/messages?limit=200`
        : `/conversations/${selectedConvId}/messages?limit=200`
        
      if (debouncedQ) url += `&q=${encodeURIComponent(debouncedQ)}`
      if (startDate) url += `&startDate=${startDate}T00:00:00.000Z`
      if (endDate) url += `&endDate=${endDate}T23:59:59.999Z`
      return apiFetch(url)
    },
    enabled: !!selectedConvId
  })

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center py-6 bg-black/70 overflow-y-auto px-4" onClick={onClose}>
      <div 
        className="bg-white dark:bg-[#1c1d2e] rounded-2xl shadow-2xl w-full max-w-6xl min-h-[500px] max-h-[90vh] flex flex-col overflow-hidden ring-1 ring-black/8 dark:ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-6 pt-5 pb-4 border-b border-black/8 dark:border-white/8">
          <div className="flex-1 min-w-0 space-y-1.5">
            <h2 className="text-lg font-semibold text-foreground">Histórico de Atendimentos</h2>
            <p className="text-sm text-muted-foreground">{contactName}</p>
          </div>
          <button
            onClick={() => setNewConvOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> Novo Atendimento
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col md:flex-row flex-1 min-h-0">
          
          {/* Left Column (KPIs & Ticket List) */}
          <div className="w-full md:w-1/3 border-r border-black/8 dark:border-white/8 flex flex-col min-h-0">
            {/* KPIs */}
            <div className="p-4 border-b border-black/8 dark:border-white/8 grid grid-cols-3 gap-2 bg-black/3 dark:bg-white/5">
              <div className="bg-white dark:bg-[#252636] p-3 rounded-lg border border-black/8 dark:border-white/10 shadow-sm flex flex-col items-center justify-center text-center">
                <Ticket className="w-4 h-4 text-primary mb-1" />
                <span className="text-xl font-bold">{kpisLoading ? '-' : kpis?.totalTickets || 0}</span>
                <span className="text-[10px] text-muted-foreground uppercase font-medium">Tickets</span>
              </div>
              <div className="bg-white dark:bg-[#252636] p-3 rounded-lg border border-black/8 dark:border-white/10 shadow-sm flex flex-col items-center justify-center text-center">
                <MessageSquare className="w-4 h-4 text-blue-500 mb-1" />
                <span className="text-xl font-bold">{kpisLoading ? '-' : kpis?.totalMessages || 0}</span>
                <span className="text-[10px] text-muted-foreground uppercase font-medium">Mensagens</span>
              </div>
              <div className="bg-white dark:bg-[#252636] p-3 rounded-lg border border-black/8 dark:border-white/10 shadow-sm flex flex-col items-center justify-center text-center">
                <Clock className="w-4 h-4 text-amber-500 mb-1" />
                <span className="text-xl font-bold">{kpisLoading ? '-' : formatDuration(kpis?.avgSlaSeconds || 0)}</span>
                <span className="text-[10px] text-muted-foreground uppercase font-medium">SLA Médio</span>
              </div>
            </div>

            {/* Ticket List */}
            <div className="flex-1 overflow-y-auto p-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2 pt-2">
                Atendimentos
              </h3>
              
              <div className="space-y-1 mb-2">
                <button
                  onClick={() => setSelectedConvId('ALL')}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    selectedConvId === 'ALL' ? 'bg-primary/12 border-primary/25' : 'bg-transparent hover:bg-black/5 dark:hover:bg-white/5 border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm truncate pr-2 text-foreground">
                      Todas as Conversas
                    </span>
                  </div>
                  <div className="flex items-center text-xs text-muted-foreground">
                    <MessageSquare className="w-3 h-3 mr-1" />
                    Histórico completo
                  </div>
                </button>
              </div>

              {convsLoading ? (
                <div className="flex justify-center p-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : convsData?.conversations.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">Nenhum atendimento encontrado.</div>
              ) : (
                <div className="space-y-1">
                  {convsData?.conversations.map(conv => (
                    <button
                      key={conv.id}
                      onClick={() => setSelectedConvId(conv.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        selectedConvId === conv.id ? 'bg-primary/12 border-primary/25' : 'bg-transparent hover:bg-black/5 dark:hover:bg-white/5 border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm truncate pr-2 text-foreground">
                          {conv.subject || (conv.channel ? (conv.channel.label || conv.channel.type) : 'Atendimento')}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          conv.status === 'RESOLVED' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                        }`}>
                          {conv.status === 'RESOLVED' ? 'Finalizado' : 'Aberto'}
                        </span>
                      </div>
                      <div className="flex items-center text-xs text-muted-foreground">
                        <Calendar className="w-3 h-3 mr-1" />
                        {format(new Date(conv.createdAt), "dd MMM yyyy, HH:mm", { locale: ptBR })}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column (Message Viewer & Filters) */}
          <div className="w-full md:w-2/3 flex flex-col min-h-0 bg-black/3 dark:bg-white/[0.02]">
            {!selectedConvId ? (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
                <MessageSquare className="w-12 h-12 mb-4 opacity-20" />
                <p>Selecione um atendimento na lista ao lado para ver as mensagens.</p>
              </div>
            ) : (
              <>
                {/* Filters */}
                <div className="p-3 border-b border-black/8 dark:border-white/8 bg-white dark:bg-[#1c1d2e] flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Localizar mensagem..."
                      value={q}
                      onChange={handleSearchChange}
                      className="w-full pl-9 h-9 text-sm rounded-lg border border-black/10 dark:border-white/10 bg-black/3 dark:bg-white/5 px-3 py-1 shadow-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 text-foreground"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CalendarDays className="w-4 h-4 text-muted-foreground" />
                    <input
                      type="date"
                      value={startDate}
                      onChange={e => setStartDate(e.target.value)}
                      className="h-9 text-sm rounded-lg border border-black/10 dark:border-white/10 bg-black/3 dark:bg-white/5 px-2 py-1 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 text-foreground"
                    />
                    <span className="text-muted-foreground text-sm">até</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={e => setEndDate(e.target.value)}
                      className="h-9 text-sm rounded-lg border border-black/10 dark:border-white/10 bg-black/3 dark:bg-white/5 px-2 py-1 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 text-foreground"
                    />
                  </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {msgsLoading ? (
                    <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                  ) : msgsData?.messages.length === 0 ? (
                    <div className="text-center p-8 text-muted-foreground text-sm">
                      {q || startDate || endDate ? 'Nenhuma mensagem encontrada para os filtros.' : 'Atendimento sem mensagens.'}
                    </div>
                  ) : (
                    <div className="space-y-4 flex flex-col-reverse">
                      {msgsData?.messages.map(msg => {
                        const isOutbound = msg.direction === 'OUTBOUND'
                        return (
                          <div key={msg.id} className={`flex flex-col max-w-[80%] ${isOutbound ? 'self-end items-end' : 'self-start items-start'}`}>
                            <div className={`p-3 rounded-2xl ${isOutbound ? 'bg-primary text-primary-foreground rounded-tr-sm shadow-sm' : 'bg-white dark:bg-white/10 border border-black/10 dark:border-white/5 shadow-sm rounded-tl-sm text-foreground'}`}>
                              <MediaBubble msg={msg as any} />
                            </div>
                            <span className="text-[10px] text-muted-foreground mt-1 px-1">
                              {format(new Date(msg.sentAt), "dd/MM/yyyy HH:mm")}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {newConvOpen && (
        <NewConversationModal
          initialContactId={contactId}
          onClose={() => setNewConvOpen(false)}
          onCreated={(convId) => {
            setNewConvOpen(false)
            onClose() // Fecha modal de histórico
            router.push(`/inbox/${convId}`)
          }}
        />
      )}
    </div>
  )
}

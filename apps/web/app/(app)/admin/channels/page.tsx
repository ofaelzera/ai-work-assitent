'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { Plus, RefreshCw, Trash2, QrCode, X, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

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
  pairingCode?: string
  count?: number
}

export default function ChannelsPage() {
  const queryClient = useQueryClient()
  const [newLabel, setNewLabel] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [qr, setQr] = useState<{ channelId: string; data: QrData } | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Poll status enquanto modal QR está aberto
  useEffect(() => {
    if (!qr) {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }
    const poll = async () => {
      try {
        const res = await apiFetch<{ status: string }>(`/channels/${qr.channelId}/status`)
        queryClient.invalidateQueries({ queryKey: ['channels'] })
        if (res.status === 'CONNECTED') {
          setQr(null)
          toast.success('WhatsApp conectado com sucesso!')
          if (pollRef.current) clearInterval(pollRef.current)
        }
      } catch {
        // silencioso
      }
    }
    pollRef.current = setInterval(poll, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [qr?.channelId])

  const { data: channels = [], isLoading } = useQuery({
    queryKey: ['channels'],
    queryFn: () => apiFetch<Channel[]>('/channels'),
  })

  const createMutation = useMutation({
    mutationFn: (label: string) =>
      apiFetch<Channel>('/channels/whatsapp', {
        method: 'POST',
        body: JSON.stringify({ label }),
      }),
    onSuccess: (ch) => {
      queryClient.invalidateQueries({ queryKey: ['channels'] })
      setNewLabel('')
      setShowForm(false)
      toast.success(`Canal "${ch.label}" criado! Escaneie o QR Code para conectar.`)
      // Carregar QR automaticamente
      loadQr(ch.id)
    },
    onError: () => toast.error('Erro ao criar canal'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/channels/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels'] })
      toast.success('Canal removido')
    },
    onError: () => toast.error('Erro ao remover canal'),
  })

  const syncMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ status: string }>(`/channels/${id}/status`),
    onSuccess: (data, id) => {
      queryClient.invalidateQueries({ queryKey: ['channels'] })
      toast.info(`Status: ${data.status}`)
    },
  })

  const loadQr = async (channelId: string) => {
    try {
      const data = await apiFetch<QrData>(`/channels/${channelId}/qr`)
      setQr({ channelId, data })
    } catch {
      toast.error('Erro ao carregar QR Code')
    }
  }

  const statusColor = {
    CONNECTED: 'text-green-600',
    DISCONNECTED: 'text-yellow-600',
    ERROR: 'text-red-600',
  }

  const statusLabel = {
    CONNECTED: 'Conectado',
    DISCONNECTED: 'Desconectado',
    ERROR: 'Erro',
  }

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Canais</h1>
          <p className="text-sm text-muted-foreground">Gerencie suas integrações de mensagens</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Novo canal
        </button>
      </div>

      {/* Formulário novo canal */}
      {showForm && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <p className="font-medium text-sm">Conectar WhatsApp</p>
          <div className="flex gap-2">
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Nome do canal (ex: WhatsApp Principal)"
              className="flex-1 rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              onKeyDown={(e) => e.key === 'Enter' && newLabel && createMutation.mutate(newLabel)}
            />
            <button
              onClick={() => newLabel && createMutation.mutate(newLabel)}
              disabled={!newLabel || createMutation.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {createMutation.isPending ? 'Criando...' : 'Criar'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Lista de canais */}
      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      {!isLoading && channels.length === 0 && (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          Nenhum canal conectado ainda. Clique em "Novo canal" para começar.
        </div>
      )}

      <div className="space-y-3">
        {channels.map((ch) => (
          <div key={ch.id} className="rounded-lg border bg-card p-4 flex items-center gap-4">
            <div className="text-2xl">{ch.type === 'WHATSAPP' ? '📱' : '📧'}</div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{ch.label}</p>
              <p className="text-xs text-muted-foreground">{ch.type}</p>
            </div>
            <span className={cn('text-xs font-medium', statusColor[ch.status])}>
              {statusLabel[ch.status]}
            </span>
            <div className="flex items-center gap-1.5">
              {ch.status !== 'CONNECTED' && (
                <button
                  onClick={() => loadQr(ch.id)}
                  className="p-1.5 rounded hover:bg-accent text-muted-foreground"
                  title="QR Code"
                >
                  <QrCode className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={() => syncMutation.mutate(ch.id)}
                disabled={syncMutation.isPending}
                className="p-1.5 rounded hover:bg-accent text-muted-foreground"
                title="Verificar status"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  if (confirm(`Remover canal "${ch.label}"?`)) deleteMutation.mutate(ch.id)
                }}
                className="p-1.5 rounded hover:bg-accent text-red-500"
                title="Remover"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal QR Code */}
      {qr && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl p-6 space-y-4 max-w-sm w-full mx-4 shadow-xl">
            <div className="flex items-center justify-between">
              <p className="font-semibold">QR Code — WhatsApp</p>
              <button onClick={() => setQr(null)} className="text-muted-foreground hover:text-foreground">
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
              <div className="rounded-lg border p-4 text-center">
                <p className="text-xs text-muted-foreground break-all font-mono">{qr.data.code}</p>
              </div>
            )}
            <p className="text-xs text-center text-muted-foreground">
              Abra o WhatsApp → Dispositivos vinculados → Vincular dispositivo
            </p>
            <button
              onClick={() => loadQr(qr.channelId)}
              className="w-full flex items-center justify-center gap-2 rounded-md border py-2 text-sm hover:bg-accent"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Atualizar QR
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

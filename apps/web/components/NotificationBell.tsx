'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Check, CheckCheck, X } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { NOTIFICATION_SSE, type NotificationPriority } from '@aiwa/shared'
import { apiFetch } from '@/lib/api'
import { useSSE } from '@/lib/sse'
import { useAuthStore } from '@/store/auth'
import { cn } from '@/lib/utils'

interface NotificationItem {
  id: string
  eventType: string
  category: string
  priority: NotificationPriority
  title: string
  body: string | null
  link: string | null
  readAt: string | null
  dismissedAt: string | null
  createdAt: string
}

const PRIORITY_STYLES: Record<NotificationPriority, string> = {
  LOW: 'border-l-muted-foreground/40',
  MEDIUM: 'border-l-primary',
  HIGH: 'border-l-amber-500',
  CRITICAL: 'border-l-red-500',
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export function NotificationBell() {
  const router = useRouter()
  const qc = useQueryClient()
  const userId = useAuthStore((s) => s.user?.sub)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const { data: countData } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => apiFetch<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 120_000,
    staleTime: 10_000,
  })

  const { data: list } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => apiFetch<NotificationItem[]>('/notifications?limit=30'),
    enabled: open,
    staleTime: 5_000,
  })

  // Atualização instantânea via SSE (filtra pelo usuário logado).
  useSSE((ev) => {
    if (
      ev.type === NOTIFICATION_SSE.NEW ||
      ev.type === NOTIFICATION_SSE.READ ||
      ev.type === NOTIFICATION_SSE.DISMISSED
    ) {
      const p = ev.payload as { userId?: string } | undefined
      if (p?.userId && userId && p.userId !== userId) return
      qc.invalidateQueries({ queryKey: ['notifications', 'unread-count'] })
      qc.invalidateQueries({ queryKey: ['notifications', 'list'] })
    }
  })

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const count = countData?.count ?? 0

  const markRead = async (id: string) => {
    await apiFetch(`/notifications/${id}/read`, { method: 'POST' })
    qc.invalidateQueries({ queryKey: ['notifications', 'unread-count'] })
    qc.invalidateQueries({ queryKey: ['notifications', 'list'] })
  }

  const dismiss = async (id: string) => {
    await apiFetch(`/notifications/${id}/dismiss`, { method: 'POST' })
    qc.invalidateQueries({ queryKey: ['notifications', 'unread-count'] })
    qc.invalidateQueries({ queryKey: ['notifications', 'list'] })
  }

  const markAll = async () => {
    await apiFetch('/notifications/read-all', { method: 'POST' })
    qc.invalidateQueries({ queryKey: ['notifications', 'unread-count'] })
    qc.invalidateQueries({ queryKey: ['notifications', 'list'] })
  }

  const openItem = async (n: NotificationItem) => {
    if (!n.readAt) await markRead(n.id)
    if (n.link) {
      router.push(n.link)
      setOpen(false)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        aria-label="Notificações"
        title="Notificações"
      >
        <Bell className="h-[18px] w-[18px]" />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[360px] max-w-[90vw] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg shadow-black/10 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="text-sm font-semibold">Notificações</span>
            {count > 0 && (
              <button
                onClick={markAll}
                className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Marcar todas como lidas
              </button>
            )}
          </div>

          <div className="max-h-[420px] overflow-y-auto custom-scrollbar">
            {!list || list.length === 0 ? (
              <div className="px-4 py-10 text-center text-[13px] text-muted-foreground">
                Nenhuma notificação por aqui.
              </div>
            ) : (
              list.map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    'group flex gap-2 border-b border-l-2 px-3 py-2.5 transition-colors last:border-b-0',
                    PRIORITY_STYLES[n.priority],
                    n.readAt ? 'bg-transparent' : 'bg-primary/[0.04]',
                  )}
                >
                  <button onClick={() => openItem(n)} className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      {!n.readAt && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                      <span className="text-[13px] font-medium leading-tight">{n.title}</span>
                    </div>
                    {n.body && (
                      <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{n.body}</p>
                    )}
                    <span className="mt-1 block text-[10px] text-muted-foreground/70">{timeAgo(n.createdAt)}</span>
                  </button>
                  <div className="flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    {!n.readAt && (
                      <button
                        onClick={() => markRead(n.id)}
                        title="Marcar como lida"
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => dismiss(n.id)}
                      title="Dispensar"
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

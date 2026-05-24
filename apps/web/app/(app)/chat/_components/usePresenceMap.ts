'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchPresence } from '@/lib/chat'
import { useSSE } from '@/lib/sse'
import { useEffect, useState } from 'react'

/**
 * Mantém um Set de userIds online no workspace.
 * - Bootstrap via GET /chat/presence
 * - Atualiza incremental via eventos SSE `chat.presence` { userId, status }
 */
export function usePresenceMap(): Set<string> {
  const [online, setOnline] = useState<Set<string>>(new Set())

  const { data } = useQuery({
    queryKey: ['chat', 'presence'],
    queryFn: fetchPresence,
    refetchInterval: 60_000,
    staleTime: 10_000,
  })

  useEffect(() => {
    if (data?.onlineUserIds) setOnline(new Set(data.onlineUserIds))
  }, [data])

  useSSE((ev) => {
    if (ev.type !== 'chat.presence') return
    const p = ev.payload as { userId: string; status: 'online' | 'offline' }
    setOnline((prev) => {
      const next = new Set(prev)
      if (p.status === 'online') next.add(p.userId)
      else next.delete(p.userId)
      return next
    })
  })

  return online
}

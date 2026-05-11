'use client'

import { useEffect, useRef } from 'react'
import { getAccessToken } from './api'

interface SSEEvent {
  type: string
  payload: unknown
  workspaceId?: string
}

export function useSSE(onEvent: (event: SSEEvent) => void, enabled = true) {
  const cbRef = useRef(onEvent)
  cbRef.current = onEvent

  useEffect(() => {
    if (!enabled) return

    const token = getAccessToken()
    if (!token) return

    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333'
    const url = `${apiUrl}/sse`

    const es = new EventSource(`${url}?token=${token}`)

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as SSEEvent
        cbRef.current(data)
      } catch {
        // ignorar parse errors
      }
    }

    es.onerror = () => {
      // EventSource tenta reconectar automaticamente
    }

    return () => es.close()
  }, [enabled])
}

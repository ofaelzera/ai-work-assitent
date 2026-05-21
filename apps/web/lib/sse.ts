'use client'

import { useEffect, useRef } from 'react'
import { getAccessToken, setAccessToken } from './api'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333'

interface SSEEvent {
  type: string
  payload: unknown
  workspaceId?: string
}

/**
 * Faz refresh do access token usando o cookie httpOnly.
 * Retorna o novo token, ou null se falhar.
 */
async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!res.ok) return null
    const data = await res.json()
    setAccessToken(data.accessToken)
    return data.accessToken as string
  } catch {
    return null
  }
}

export function useSSE(onEvent: (event: SSEEvent) => void, enabled = true) {
  const cbRef = useRef(onEvent)
  cbRef.current = onEvent

  useEffect(() => {
    if (!enabled) return

    let es: EventSource | null = null
    let retryTimeout: ReturnType<typeof setTimeout> | null = null
    let retries = 0
    const MAX_RETRIES = 10
    let destroyed = false

    function connect(token: string) {
      if (destroyed) return
      es = new EventSource(`${API_URL}/sse?token=${encodeURIComponent(token)}`)

      es.onmessage = (e) => {
        retries = 0 // reset no sucesso
        try {
          const data = JSON.parse(e.data) as SSEEvent
          cbRef.current(data)
        } catch {
          // ignorar parse errors
        }
      }

      es.onerror = async () => {
        es?.close()
        es = null
        if (destroyed) return

        // Token pode ter expirado → tenta refresh antes de reconectar
        const newToken = await refreshAccessToken()
        if (!newToken || destroyed) return

        if (retries >= MAX_RETRIES) return // desiste após muitas tentativas

        const delay = Math.min(1000 * 2 ** retries, 30_000) // backoff exponencial, max 30s
        retries++
        retryTimeout = setTimeout(() => connect(newToken), delay)
      }
    }

    // Pega token atual ou tenta refresh
    const token = getAccessToken()
    if (token) {
      connect(token)
    } else {
      // Token ainda não disponível (ex: refresh pendente) → aguarda um tick
      refreshAccessToken().then((t) => {
        if (t && !destroyed) connect(t)
      })
    }

    return () => {
      destroyed = true
      if (retryTimeout) clearTimeout(retryTimeout)
      es?.close()
    }
  }, [enabled])
}

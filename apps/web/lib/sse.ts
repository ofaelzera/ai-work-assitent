'use client'

import { useEffect, useRef } from 'react'
import { getAccessToken, setAccessToken } from './api'
import { getApiUrl } from './runtime-config'

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
    const res = await fetch(`${getApiUrl()}/auth/refresh`, {
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

// ─── Conexão SSE única e compartilhada ────────────────────────────────────
// Antes cada `useSSE` abria seu próprio EventSource. Em telas com vários hooks
// (ex.: /chat tem 6 — Layout × 2 badges, RoomList, ChatView, usePresenceMap × 2)
// isso estourava o limite de ~6 conexões HTTP/1.1 do navegador por origin,
// deixando fetches comuns enfileirados pra sempre. Era o bug do
// LibraryPickerModal que nunca terminava de carregar. Agora há 1 EventSource
// para toda a aba e cada hook só assina um callback in-memory.
type Listener = (event: SSEEvent) => void

const listeners = new Set<Listener>()
let sharedEs: EventSource | null = null
let connecting = false
let retries = 0
let retryTimeout: ReturnType<typeof setTimeout> | null = null
let teardownTimeout: ReturnType<typeof setTimeout> | null = null
const MAX_RETRIES = 10

function dispatch(event: SSEEvent) {
  for (const l of listeners) {
    try { l(event) } catch { /* listener isolado */ }
  }
}

function openConnection(token: string) {
  if (sharedEs || connecting) return
  connecting = true
  const es = new EventSource(`${getApiUrl()}/sse?token=${encodeURIComponent(token)}`)
  sharedEs = es

  es.onopen = () => { retries = 0; connecting = false }
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as SSEEvent
      dispatch(data)
    } catch { /* parse error */ }
  }
  es.onerror = async () => {
    es.close()
    sharedEs = null
    connecting = false
    if (listeners.size === 0) return         // ninguém ouvindo, não reabre
    if (retries >= MAX_RETRIES) return       // desistiu
    const newToken = await refreshAccessToken()
    if (!newToken) return
    if (listeners.size === 0) return         // pode ter limpado durante o refresh
    const delay = Math.min(1000 * 2 ** retries, 30_000)
    retries++
    retryTimeout = setTimeout(() => openConnection(newToken), delay)
  }
}

function ensureConnection() {
  // Se estávamos prestes a derrubar por idle, cancela.
  if (teardownTimeout) { clearTimeout(teardownTimeout); teardownTimeout = null }
  if (sharedEs || connecting) return
  const token = getAccessToken()
  if (token) {
    openConnection(token)
  } else {
    refreshAccessToken().then((t) => { if (t && listeners.size > 0) openConnection(t) })
  }
}

function scheduleTeardown() {
  if (teardownTimeout) clearTimeout(teardownTimeout)
  // Pequeno atraso: em StrictMode / route change, hooks remontam quase
  // imediatamente; não vale a pena fechar a conexão pra reabrir em 50ms.
  teardownTimeout = setTimeout(() => {
    teardownTimeout = null
    if (listeners.size > 0) return
    if (retryTimeout) { clearTimeout(retryTimeout); retryTimeout = null }
    if (sharedEs) { sharedEs.close(); sharedEs = null }
    connecting = false
    retries = 0
  }, 200)
}

export function useSSE(onEvent: (event: SSEEvent) => void, enabled = true) {
  const cbRef = useRef(onEvent)
  cbRef.current = onEvent

  useEffect(() => {
    if (!enabled) return

    const listener: Listener = (ev) => cbRef.current(ev)
    listeners.add(listener)
    ensureConnection()

    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) scheduleTeardown()
    }
  }, [enabled])
}

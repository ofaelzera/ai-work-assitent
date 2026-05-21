'use client'

import { useEffect, useRef, useState } from 'react'

export type PresenceState = 'composing' | 'recording' | 'available' | 'unavailable' | 'paused'

interface PresencePayload {
  jid: string
  conversationId: string | null
  presence: PresenceState
}

/**
 * Retorna o estado de presença atual de uma conversa.
 * Recebe eventos SSE de presence.update e expira automaticamente após 8s
 * (o WhatsApp para de emitir "composing" quando o usuário para de digitar).
 */
export function usePresence(
  conversationId: string | undefined,
  sseEvent: { type: string; payload: unknown } | null,
): PresenceState | null {
  const [presence, setPresence] = useState<PresenceState | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!sseEvent || sseEvent.type !== 'presence.update') return
    const p = sseEvent.payload as PresencePayload
    if (!conversationId || p.conversationId !== conversationId) return

    const state = p.presence

    // "available" e "unavailable" não precisam expirar — são estados fixos
    if (state === 'available' || state === 'unavailable') {
      if (timerRef.current) clearTimeout(timerRef.current)
      setPresence(state)
      return
    }

    // "composing", "recording", "paused" expiram após 8 s
    setPresence(state === 'paused' ? null : state)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setPresence(null), 8_000)
  }, [sseEvent, conversationId])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  return presence
}

/** Label amigável para exibir na UI */
export function presenceLabel(p: PresenceState | null): string | null {
  if (!p) return null
  if (p === 'composing') return 'digitando...'
  if (p === 'recording') return 'gravando áudio 🎤'
  if (p === 'available') return 'online'
  return null
}

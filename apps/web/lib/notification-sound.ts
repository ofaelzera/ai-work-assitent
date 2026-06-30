'use client'

import { getAccessToken } from '@/lib/api'
import { getApiUrl } from '@/lib/runtime-config'

/**
 * Reprodução de som das notificações da central.
 *
 * • Quando há um som da galeria (soundId), busca o áudio autenticado como blob
 *   (apiFetch envia o token), cacheia o object-URL e toca.
 * • Sem som configurado, sintetiza um tom curto distinto por categoria via Web
 *   Audio API — propositalmente diferente do som de novas mensagens, sem
 *   depender de arquivos em /public.
 */

const blobUrlCache = new Map<string, string>()

// Frequência base (Hz) por categoria — dá identidade sonora a cada tipo.
const CATEGORY_TONE: Record<string, number> = {
  task: 660,
  card: 520,
  calendar: 784,
  reminder: 600,
  system: 880,
}

async function getSoundUrl(soundId: string): Promise<string | null> {
  const cached = blobUrlCache.get(soundId)
  if (cached) return cached
  try {
    const token = getAccessToken()
    const res = await fetch(`${getApiUrl()}/notifications/sounds/${soundId}/audio`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    })
    if (!res.ok) return null
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    blobUrlCache.set(soundId, url)
    return url
  } catch {
    return null
  }
}

function playSynthesizedTone(category: string) {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const freq = CATEGORY_TONE[category] ?? 700
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    osc.connect(gain)
    gain.connect(ctx.destination)
    const now = ctx.currentTime
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02)
    // duas batidas curtas
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18)
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.24)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42)
    osc.start(now)
    osc.stop(now + 0.45)
    osc.onended = () => ctx.close().catch(() => {})
  } catch {
    /* navegador bloqueou áudio sem interação — ignora */
  }
}

export async function playNotificationSound(soundId: string | null, category: string): Promise<void> {
  if (soundId) {
    const url = await getSoundUrl(soundId)
    if (url) {
      try {
        const audio = new Audio(url)
        await audio.play()
        return
      } catch {
        /* fallback pro tom sintetizado */
      }
    }
  }
  playSynthesizedTone(category)
}

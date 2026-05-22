/**
 * Helpers compartilhados pra Google Calendar API.
 * Movido de calendar.routes.ts pra permitir uso em tools de agentes (createCalendarEvent).
 */

import { prisma } from '../../lib/prisma.js'
import { encryptJson, decryptJson } from '../../lib/crypto.js'
import { env } from '../../config/env.js'

export interface GoogleTokens {
  access_token: string
  refresh_token: string
  expiry_date: number
  token_type: string
}

interface EncryptedBlob {
  ciphertext: { type: 'Buffer'; data: number[] } | number[]
  iv: { type: 'Buffer'; data: number[] } | number[]
  authTag: { type: 'Buffer'; data: number[] } | number[]
}

function toBuffer(val: EncryptedBlob['ciphertext']): Buffer {
  if (Array.isArray(val)) return Buffer.from(val)
  return Buffer.from((val as { type: 'Buffer'; data: number[] }).data)
}

/**
 * Retorna access_token válido. Faz refresh automático via OAuth se expirado/perto de expirar.
 */
export async function getValidGoogleToken(account: { id: string; tokens: unknown }): Promise<string> {
  const raw = account.tokens as EncryptedBlob
  const tokens = decryptJson<GoogleTokens>(
    toBuffer(raw.ciphertext),
    toBuffer(raw.iv),
    toBuffer(raw.authTag),
  )

  if (tokens.expiry_date > Date.now() + 60_000) {
    return tokens.access_token
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status}`)

  const refreshed = (await res.json()) as Partial<GoogleTokens>

  const newTokens: GoogleTokens = {
    access_token: refreshed.access_token ?? tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: Date.now() + ((refreshed as any).expires_in ?? 3600) * 1000,
    token_type: refreshed.token_type ?? tokens.token_type,
  }

  const encrypted = encryptJson(newTokens)

  await prisma.calendarAccount.update({
    where: { id: account.id },
    data: {
      tokens: {
        ciphertext: Array.from(encrypted.ciphertext),
        iv: Array.from(encrypted.iv),
        authTag: Array.from(encrypted.authTag),
      },
    },
  })

  return newTokens.access_token
}

/**
 * Wrapper minimalista pra Google Calendar API v3.
 */
export async function googleCalendarFetch(
  accessToken: string,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
}

/**
 * Cria evento no calendário primário (`primary`) da conta.
 * Retorna o evento criado (raw response do Google).
 */
export async function createGoogleEvent(
  account: { id: string; tokens: unknown },
  payload: { summary: string; description?: string | null; startAt: Date; endAt: Date },
): Promise<{ id: string }> {
  const accessToken = await getValidGoogleToken(account)
  const res = await googleCalendarFetch(accessToken, '/calendars/primary/events', {
    method: 'POST',
    body: JSON.stringify({
      summary: payload.summary,
      description: payload.description ?? undefined,
      start: { dateTime: payload.startAt.toISOString() },
      end: { dateTime: payload.endAt.toISOString() },
    }),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Google Calendar create error: ${errText}`)
  }
  return (await res.json()) as { id: string }
}

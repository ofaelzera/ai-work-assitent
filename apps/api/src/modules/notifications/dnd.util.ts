/**
 * Avaliação de janelas de "não perturbe" (DND). Horários em "HH:MM" no fuso do
 * workspace (default America/Sao_Paulo). Suporta janelas que cruzam a meia-noite
 * (ex.: 22:00 → 07:00).
 */

const TZ = 'America/Sao_Paulo'

interface NowParts {
  minutes: number // minutos desde 00:00
  weekday: number // 0=domingo .. 6=sábado
}

function nowParts(now: Date): NowParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  })
  const parts = fmt.formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const hour = parseInt(get('hour'), 10) % 24
  const minute = parseInt(get('minute'), 10)
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { minutes: hour * 60 + minute, weekday: wdMap[get('weekday')] ?? 0 }
}

function parseHHMM(s: string | null | undefined): number | null {
  if (!s) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

export interface DndConfig {
  enabled?: boolean
  start?: string | null
  end?: string | null
  weekdays?: number[] | null // dias em que o DND vale (vazio/null = todos os dias)
}

/** True se `now` está dentro da janela de não-perturbe configurada. */
export function isWithinDnd(cfg: DndConfig, now: Date = new Date()): boolean {
  if (!cfg.enabled) return false
  const start = parseHHMM(cfg.start)
  const end = parseHHMM(cfg.end)
  if (start === null || end === null) return false

  const { minutes, weekday } = nowParts(now)

  if (Array.isArray(cfg.weekdays) && cfg.weekdays.length > 0 && !cfg.weekdays.includes(weekday)) {
    return false
  }

  if (start === end) return false // janela vazia
  if (start < end) return minutes >= start && minutes < end
  // janela cruzando meia-noite (ex.: 22:00 → 07:00)
  return minutes >= start || minutes < end
}

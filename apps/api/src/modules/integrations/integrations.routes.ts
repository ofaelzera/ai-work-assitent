import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { hasPermission } from '../../lib/acl.js'

/**
 * Integrações de APIs públicas usadas pelos widgets do dashboard.
 *
 * Arquitetura em duas camadas:
 *  - ADMIN (SystemSettings.integrations): define o que está DISPONÍVEL no workspace
 *    + guarda chaves (ex.: brapiToken da bolsa). Nunca exposto a não-admins.
 *  - USUÁRIO (User.settings.dashboardWidgets): entre os disponíveis, o que ele quer exibir.
 *
 * Visibilidade efetiva = (admin habilitou) E (usuário não ocultou) → GET /integrations/widgets.
 *
 * Todas as chamadas externas passam por aqui (proxy) com cache em memória + TTL,
 * usando APIs gratuitas/keyless: Open-Meteo + Nominatim (tempo), AwesomeAPI (moedas),
 * brapi.dev (bolsa, token opcional), MyMemory (tradução).
 */

// Ferramentas (APIs públicas) + seções do dashboard — todas tratadas como "widgets"
// opcionais: admin habilita a disponibilidade, usuário escolhe exibir no perfil.
export const WIDGET_KEYS = [
  'weather', 'quotes', 'converter', 'translator', 'calculator',
  'conversations', 'cards', 'channelStats', 'aiExecutions',
] as const
export type WidgetKey = (typeof WIDGET_KEYS)[number]

interface IntegrationsConfig {
  widgets: Record<WidgetKey, boolean>
  brapiToken?: string
}

function defaultConfig(): IntegrationsConfig {
  const widgets = {} as Record<WidgetKey, boolean>
  for (const k of WIDGET_KEYS) widgets[k] = true
  return { widgets, brapiToken: '' }
}

async function readConfig(): Promise<IntegrationsConfig> {
  const row = await prisma.systemSettings.findUnique({
    where: { id: 'default' },
    select: { integrations: true },
  })
  const raw = (row?.integrations as Partial<IntegrationsConfig> | null) ?? null
  const def = defaultConfig()
  if (!raw) return def
  return {
    widgets: { ...def.widgets, ...(raw.widgets ?? {}) },
    brapiToken: typeof raw.brapiToken === 'string' ? raw.brapiToken : '',
  }
}

// ─── Cache em memória simples com TTL ──────────────────────────────────────────
const cache = new Map<string, { value: unknown; expires: number }>()
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.value as T
  const value = await fn()
  cache.set(key, { value, expires: Date.now() + ttlMs })
  return value
}

const UA = 'AI-Work-Assistant/1.0 (dashboard widgets)'

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': UA, Accept: 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`)
  return (await res.json()) as T
}

// ─── Geocodificação do endereço da empresa (Nominatim) ─────────────────────────
async function geocode(address: string): Promise<{ lat: number; lon: number; label: string } | null> {
  const trimmed = address.trim()
  if (!trimmed) return null
  return cached(`geo:${trimmed}`, 24 * 60 * 60_000, async () => {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(trimmed)}`
    const data = await fetchJson<Array<{ lat: string; lon: string; display_name: string }>>(url)
    const first = data[0]
    if (!first) return null
    return {
      lat: Number(first.lat),
      lon: Number(first.lon),
      label: first.display_name.split(',').slice(0, 2).join(',').trim(),
    }
  })
}

export const integrationsRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── Config (admin) ─────────────────────────────────────────────────────────
  app.get('/integrations/settings', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!(await hasPermission(req.user, 'admin.settings'))) {
      return reply.forbidden('Apenas administradores')
    }
    return readConfig()
  })

  app.put(
    '/integrations/settings',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          widgets: z.record(z.string(), z.boolean()).optional(),
          brapiToken: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      if (!(await hasPermission(req.user, 'admin.settings'))) {
        return reply.forbidden('Apenas administradores')
      }
      const current = await readConfig()
      const next: IntegrationsConfig = {
        widgets: { ...current.widgets, ...(req.body.widgets ?? {}) },
        brapiToken: req.body.brapiToken ?? current.brapiToken,
      }
      await prisma.systemSettings.upsert({
        where: { id: 'default' },
        update: { integrations: next as any },
        create: { id: 'default', integrations: next as any },
      })
      cache.delete('quotes') // token da bolsa pode ter mudado
      return next
    },
  )

  // ── Visibilidade efetiva (qualquer usuário) ──────────────────────────────────
  app.get('/integrations/widgets', { onRequest: [app.authenticate] }, async (req) => {
    const config = await readConfig()
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: { settings: true },
    })
    const prefs =
      ((user?.settings as Record<string, unknown> | null)?.dashboardWidgets as
        | Record<string, boolean>
        | undefined) ?? {}

    const widgets = {} as Record<WidgetKey, boolean>
    for (const key of WIDGET_KEYS) {
      // disponível pelo admin E não ocultado pelo usuário (default = exibir)
      widgets[key] = config.widgets[key] && prefs[key] !== false
    }
    // available = o que o admin liberou (para a tela de perfil montar os toggles)
    return { widgets, available: config.widgets }
  })

  // ── Previsão do tempo (Open-Meteo + Nominatim) ───────────────────────────────
  app.get('/integrations/weather', { onRequest: [app.authenticate] }, async (req, reply) => {
    const config = await readConfig()
    if (!config.widgets.weather) return reply.send({ enabled: false })

    const ws = await prisma.workspace.findUnique({
      where: { id: req.user.workspaceId },
      select: { settings: true },
    })
    const address = ((ws?.settings as Record<string, unknown> | null)?.companyAddress as string) ?? ''
    if (!address.trim()) return reply.send({ enabled: true, configured: false })

    try {
      const data = await cached(`weather:${address.trim()}`, 30 * 60_000, async () => {
        const geo = await geocode(address)
        if (!geo) return null
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}` +
          `&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m` +
          `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
          `&timezone=auto&forecast_days=1`
        const w = await fetchJson<{
          current: { temperature_2m: number; weather_code: number; relative_humidity_2m: number; wind_speed_10m: number }
          daily: { weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] }
        }>(url)
        return {
          city: geo.label,
          temp: Math.round(w.current.temperature_2m),
          code: w.current.weather_code,
          humidity: w.current.relative_humidity_2m,
          wind: Math.round(w.current.wind_speed_10m),
          min: Math.round(w.daily.temperature_2m_min[0]),
          max: Math.round(w.daily.temperature_2m_max[0]),
        }
      })
      if (!data) return reply.send({ enabled: true, configured: false })
      return reply.send({ enabled: true, configured: true, ...data })
    } catch (err) {
      req.log.warn({ err }, 'weather widget falhou')
      return reply.send({ enabled: true, configured: false, error: true })
    }
  })

  // ── Cotações (AwesomeAPI + brapi opcional) ───────────────────────────────────
  app.get('/integrations/quotes', { onRequest: [app.authenticate] }, async (req, reply) => {
    const config = await readConfig()
    if (!config.widgets.quotes) return reply.send({ enabled: false })

    try {
      const data = await cached('quotes', 5 * 60_000, async () => {
        const fx = await fetchJson<Record<string, { bid: string; pctChange: string; name: string }>>(
          'https://economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL,BTC-BRL',
        )
        const items: Array<{ key: string; label: string; value: number; change: number; unit: string }> = []
        const push = (k: string, label: string) => {
          const q = fx[k]
          if (q) items.push({ key: k, label, value: Number(q.bid), change: Number(q.pctChange), unit: 'R$' })
        }
        push('USDBRL', 'Dólar')
        push('EURBRL', 'Euro')
        push('BTCBRL', 'Bitcoin')

        if (config.brapiToken) {
          try {
            const b = await fetchJson<{ results: Array<{ regularMarketPrice: number; regularMarketChangePercent: number }> }>(
              `https://brapi.dev/api/quote/%5EBVSP?token=${encodeURIComponent(config.brapiToken)}`,
            )
            const r = b.results?.[0]
            if (r) items.push({ key: 'IBOV', label: 'Ibovespa', value: r.regularMarketPrice, change: r.regularMarketChangePercent, unit: 'pts' })
          } catch (err) {
            req.log.warn({ err }, 'brapi (bolsa) falhou')
          }
        }
        return items
      })
      return reply.send({ enabled: true, items: data })
    } catch (err) {
      req.log.warn({ err }, 'quotes widget falhou')
      return reply.send({ enabled: true, items: [], error: true })
    }
  })

  // ── Conversor de moeda (AwesomeAPI) ──────────────────────────────────────────
  app.get(
    '/integrations/convert',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          from: z.string().min(3).max(4),
          to: z.string().min(3).max(4),
          amount: z.coerce.number().positive(),
        }),
      },
    },
    async (req, reply) => {
      const config = await readConfig()
      if (!config.widgets.converter) return reply.send({ enabled: false })
      const { to, amount } = req.query
      const fromCur = req.query.from.toUpperCase()
      const toCur = to.toUpperCase()
      if (fromCur === toCur) {
        return reply.send({ enabled: true, rate: 1, result: amount, from: fromCur, to: toCur })
      }
      try {
        const data = await cached(`fx:${fromCur}-${toCur}`, 5 * 60_000, () =>
          fetchJson<Record<string, { bid: string }>>(
            `https://economia.awesomeapi.com.br/last/${fromCur}-${toCur}`,
          ),
        )
        const quote = data[`${fromCur}${toCur}`]
        if (!quote) return reply.send({ enabled: true, error: 'Par de moedas não suportado' })
        const rate = Number(quote.bid)
        return reply.send({ enabled: true, rate, result: amount * rate, from: fromCur, to: toCur })
      } catch (err) {
        req.log.warn({ err }, 'convert falhou')
        return reply.send({ enabled: true, error: 'Não foi possível converter agora' })
      }
    },
  )

  // ── Tradutor (MyMemory) ──────────────────────────────────────────────────────
  app.post(
    '/integrations/translate',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          text: z.string().min(1).max(500),
          source: z.string().min(2).max(5),
          target: z.string().min(2).max(5),
        }),
      },
    },
    async (req, reply) => {
      const config = await readConfig()
      if (!config.widgets.translator) return reply.send({ enabled: false })
      const { text, source, target } = req.body
      try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(source)}|${encodeURIComponent(target)}`
        const data = await fetchJson<{ responseData: { translatedText: string } }>(url)
        return reply.send({ enabled: true, translated: data.responseData.translatedText })
      } catch (err) {
        req.log.warn({ err }, 'translate falhou')
        return reply.send({ enabled: true, error: 'Não foi possível traduzir agora' })
      }
    },
  )
}

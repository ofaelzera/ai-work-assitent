'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  Cloud, CloudRain, CloudSnow, CloudLightning, Sun, CloudSun, Wind, Droplets,
  TrendingUp, TrendingDown, ArrowRightLeft, Languages, Calculator as CalcIcon, MapPin,
} from 'lucide-react'

// ─── Card base ────────────────────────────────────────────────────────────────
function WidgetCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-3xl border bg-card/50 backdrop-blur-sm p-5 shadow-sm', className)}>
      {children}
    </div>
  )
}

function WidgetTitle({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-xs font-bold text-foreground/70 tracking-wide uppercase mb-3">
      <Icon className="h-4 w-4 text-primary" /> {children}
    </h3>
  )
}

// ─── Previsão do tempo ─────────────────────────────────────────────────────────
interface WeatherData {
  enabled: boolean; configured?: boolean; error?: boolean
  city?: string; temp?: number; code?: number; humidity?: number; wind?: number; min?: number; max?: number
}

function weatherVisual(code: number): { icon: React.ElementType; label: string } {
  if (code === 0) return { icon: Sun, label: 'Céu limpo' }
  if (code <= 2) return { icon: CloudSun, label: 'Parcialmente nublado' }
  if (code === 3) return { icon: Cloud, label: 'Nublado' }
  if (code >= 45 && code <= 48) return { icon: Cloud, label: 'Neblina' }
  if (code >= 51 && code <= 67) return { icon: CloudRain, label: 'Chuva' }
  if (code >= 71 && code <= 77) return { icon: CloudSnow, label: 'Neve' }
  if (code >= 80 && code <= 82) return { icon: CloudRain, label: 'Pancadas de chuva' }
  if (code >= 95) return { icon: CloudLightning, label: 'Tempestade' }
  return { icon: Cloud, label: 'Tempo' }
}

export function WeatherWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['integrations-weather'],
    queryFn: () => apiFetch<WeatherData>('/integrations/weather'),
    refetchInterval: 30 * 60_000,
    staleTime: 25 * 60_000,
  })

  return (
    <WidgetCard className="relative overflow-hidden">
      <div className="absolute -top-10 -right-8 opacity-[0.07] pointer-events-none">
        {data?.code != null ? (() => { const V = weatherVisual(data.code).icon; return <V className="h-40 w-40" /> })() : <Cloud className="h-40 w-40" />}
      </div>
      <WidgetTitle icon={Cloud}>Tempo</WidgetTitle>
      {isLoading && <div className="h-16 animate-pulse bg-muted rounded-xl" />}
      {!isLoading && data?.configured === false && (
        <p className="text-sm text-muted-foreground">
          Preencha o endereço da empresa em <span className="font-medium">Configurações → Dados da empresa</span> para ver a previsão.
        </p>
      )}
      {!isLoading && data?.configured && data.temp != null && (
        <div className="relative z-10">
          <div className="flex items-end gap-3">
            <span className="text-5xl font-black tracking-tight text-foreground">{data.temp}°</span>
            <div className="pb-1.5">
              <p className="text-sm font-semibold text-foreground/80">{weatherVisual(data.code!).label}</p>
              <p className="text-xs text-muted-foreground">{data.min}° / {data.max}°</p>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
            {data.city && <span className="flex items-center gap-1 truncate max-w-[60%]"><MapPin className="h-3 w-3" /> {data.city}</span>}
            <span className="flex items-center gap-1"><Droplets className="h-3 w-3" /> {data.humidity}%</span>
            <span className="flex items-center gap-1"><Wind className="h-3 w-3" /> {data.wind} km/h</span>
          </div>
        </div>
      )}
    </WidgetCard>
  )
}

// ─── Cotações ──────────────────────────────────────────────────────────────────
interface QuoteItem { key: string; label: string; value: number; change: number; unit: string }

export function QuotesWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['integrations-quotes'],
    queryFn: () => apiFetch<{ enabled: boolean; items: QuoteItem[] }>('/integrations/quotes'),
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
  })

  const fmt = (v: number, unit: string) =>
    unit === 'R$'
      ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })

  return (
    <WidgetCard>
      <WidgetTitle icon={TrendingUp}>Cotações</WidgetTitle>
      {isLoading && <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-8 animate-pulse bg-muted rounded-lg" />)}</div>}
      {!isLoading && (
        <div className="space-y-2.5">
          {data?.items?.map(q => {
            const up = q.change >= 0
            return (
              <div key={q.key} className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground/80">{q.label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold tabular-nums text-foreground">{q.unit === 'R$' ? 'R$ ' : ''}{fmt(q.value, q.unit)}</span>
                  <span className={cn('text-[11px] font-bold flex items-center gap-0.5 tabular-nums', up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                    {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {Math.abs(q.change).toFixed(2)}%
                  </span>
                </div>
              </div>
            )
          })}
          {!data?.items?.length && <p className="text-sm text-muted-foreground">Cotações indisponíveis no momento.</p>}
        </div>
      )}
    </WidgetCard>
  )
}

// ─── Conversor de moeda ──────────────────────────────────────────────────────────
const CURRENCIES = ['USD', 'BRL', 'EUR', 'GBP', 'BTC', 'ARS', 'JPY']

export function CurrencyConverter() {
  const [amount, setAmount] = useState('100')
  const [from, setFrom] = useState('USD')
  const [to, setTo] = useState('BRL')

  const convert = useMutation({
    mutationFn: () =>
      apiFetch<{ enabled: boolean; result?: number; rate?: number; error?: string }>(
        `/integrations/convert?from=${from}&to=${to}&amount=${encodeURIComponent(amount || '0')}`,
      ),
  })

  const swap = () => { setFrom(to); setTo(from); convert.reset() }

  return (
    <WidgetCard>
      <WidgetTitle icon={ArrowRightLeft}>Conversor de moeda</WidgetTitle>
      <div className="flex items-center gap-2">
        <input
          type="number" value={amount} onChange={e => setAmount(e.target.value)}
          className="w-24 rounded-lg border bg-transparent px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <select value={from} onChange={e => setFrom(e.target.value)} className="rounded-lg border bg-transparent px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
          {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={swap} className="p-2 rounded-lg hover:bg-accent transition-colors shrink-0" title="Inverter">
          <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
        </button>
        <select value={to} onChange={e => setTo(e.target.value)} className="rounded-lg border bg-transparent px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
          {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <button onClick={() => convert.mutate()} disabled={convert.isPending}
        className="mt-3 w-full py-2 rounded-lg bg-primary/10 text-primary text-sm font-semibold hover:bg-primary/20 transition-colors disabled:opacity-50">
        {convert.isPending ? 'Convertendo...' : 'Converter'}
      </button>
      {convert.data?.result != null && (
        <p className="mt-3 text-center text-lg font-bold text-foreground">
          {Number(amount).toLocaleString('pt-BR')} {from} = {convert.data.result.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} {to}
        </p>
      )}
      {convert.data?.error && <p className="mt-2 text-center text-xs text-red-500">{convert.data.error}</p>}
    </WidgetCard>
  )
}

// ─── Tradutor ──────────────────────────────────────────────────────────────────
const LANGS = [
  { code: 'pt', label: 'Português' }, { code: 'en', label: 'Inglês' },
  { code: 'es', label: 'Espanhol' }, { code: 'fr', label: 'Francês' },
  { code: 'de', label: 'Alemão' }, { code: 'it', label: 'Italiano' },
]

export function TranslatorWidget() {
  const [text, setText] = useState('')
  const [source, setSource] = useState('pt')
  const [target, setTarget] = useState('en')

  const translate = useMutation({
    mutationFn: () =>
      apiFetch<{ enabled: boolean; translated?: string; error?: string }>('/integrations/translate', {
        method: 'POST', body: JSON.stringify({ text, source, target }),
      }),
  })

  return (
    <WidgetCard>
      <WidgetTitle icon={Languages}>Tradutor</WidgetTitle>
      <div className="flex items-center gap-2 mb-2">
        <select value={source} onChange={e => setSource(e.target.value)} className="flex-1 rounded-lg border bg-transparent px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
          {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <button onClick={() => { setSource(target); setTarget(source); translate.reset() }} className="p-1.5 rounded-lg hover:bg-accent transition-colors shrink-0">
          <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <select value={target} onChange={e => setTarget(e.target.value)} className="flex-1 rounded-lg border bg-transparent px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
          {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      </div>
      <textarea
        value={text} onChange={e => setText(e.target.value)} rows={2} maxLength={500}
        placeholder="Digite o texto..."
        className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
      />
      <button onClick={() => translate.mutate()} disabled={translate.isPending || !text.trim()}
        className="mt-2 w-full py-2 rounded-lg bg-primary/10 text-primary text-sm font-semibold hover:bg-primary/20 transition-colors disabled:opacity-50">
        {translate.isPending ? 'Traduzindo...' : 'Traduzir'}
      </button>
      {translate.data?.translated && (
        <p className="mt-3 p-3 rounded-lg bg-muted/50 text-sm text-foreground">{translate.data.translated}</p>
      )}
      {translate.data?.error && <p className="mt-2 text-center text-xs text-red-500">{translate.data.error}</p>}
    </WidgetCard>
  )
}

// ─── Calculadora (client-side) ───────────────────────────────────────────────────
export function Calculator() {
  const [display, setDisplay] = useState('0')
  const [prev, setPrev] = useState<number | null>(null)
  const [op, setOp] = useState<string | null>(null)
  const [fresh, setFresh] = useState(true)

  const inputDigit = (d: string) => {
    if (fresh) { setDisplay(d === '.' ? '0.' : d); setFresh(false); return }
    if (d === '.' && display.includes('.')) return
    setDisplay(display === '0' && d !== '.' ? d : display + d)
  }

  const compute = (a: number, b: number, o: string) =>
    o === '+' ? a + b : o === '−' ? a - b : o === '×' ? a * b : o === '÷' ? (b === 0 ? NaN : a / b) : b

  const chooseOp = (o: string) => {
    const cur = parseFloat(display)
    if (prev != null && op && !fresh) {
      const r = compute(prev, cur, op)
      setPrev(r); setDisplay(String(r))
    } else {
      setPrev(cur)
    }
    setOp(o); setFresh(true)
  }

  const equals = () => {
    if (prev == null || !op) return
    const cur = parseFloat(display)
    const r = compute(prev, cur, op)
    setDisplay(Number.isNaN(r) ? 'Erro' : String(r))
    setPrev(null); setOp(null); setFresh(true)
  }

  const clear = () => { setDisplay('0'); setPrev(null); setOp(null); setFresh(true) }

  const Btn = ({ children, onClick, variant }: { children: React.ReactNode; onClick: () => void; variant?: 'op' | 'eq' | 'fn' }) => (
    <button onClick={onClick}
      className={cn('h-11 rounded-xl text-sm font-semibold transition-colors',
        variant === 'op' && 'bg-primary/10 text-primary hover:bg-primary/20',
        variant === 'eq' && 'bg-primary text-primary-foreground hover:bg-primary/90',
        variant === 'fn' && 'bg-muted text-muted-foreground hover:bg-muted/70',
        !variant && 'bg-background border hover:bg-accent',
      )}>
      {children}
    </button>
  )

  return (
    <WidgetCard>
      <WidgetTitle icon={CalcIcon}>Calculadora</WidgetTitle>
      <div className="mb-3 px-3 py-3 rounded-xl bg-muted/40 text-right text-2xl font-bold tabular-nums text-foreground truncate">{display}</div>
      <div className="grid grid-cols-4 gap-2">
        <Btn variant="fn" onClick={clear}>C</Btn>
        <Btn variant="fn" onClick={() => setDisplay(String(parseFloat(display) * -1))}>±</Btn>
        <Btn variant="fn" onClick={() => setDisplay(String(parseFloat(display) / 100))}>%</Btn>
        <Btn variant="op" onClick={() => chooseOp('÷')}>÷</Btn>
        {['7', '8', '9'].map(d => <Btn key={d} onClick={() => inputDigit(d)}>{d}</Btn>)}
        <Btn variant="op" onClick={() => chooseOp('×')}>×</Btn>
        {['4', '5', '6'].map(d => <Btn key={d} onClick={() => inputDigit(d)}>{d}</Btn>)}
        <Btn variant="op" onClick={() => chooseOp('−')}>−</Btn>
        {['1', '2', '3'].map(d => <Btn key={d} onClick={() => inputDigit(d)}>{d}</Btn>)}
        <Btn variant="op" onClick={() => chooseOp('+')}>+</Btn>
        <button onClick={() => inputDigit('0')} className="h-11 col-span-2 rounded-xl text-sm font-semibold bg-background border hover:bg-accent transition-colors">0</button>
        <Btn onClick={() => inputDigit('.')}>.</Btn>
        <Btn variant="eq" onClick={equals}>=</Btn>
      </div>
    </WidgetCard>
  )
}

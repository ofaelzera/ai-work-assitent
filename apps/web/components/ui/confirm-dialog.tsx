'use client'

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { AlertTriangle, AlertCircle, Info, X, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ConfirmType = 'danger' | 'warning' | 'info' | 'success'

export interface ConfirmOptions {
  title: string
  message?: string
  /** Lista de bullets pra detalhar o impacto (ex: "12 cards", "3 anexos") */
  details?: string[]
  /** Texto adicional abaixo dos detalhes — fica destacado em vermelho pra danger */
  warning?: string
  type?: ConfirmType
  confirmLabel?: string
  cancelLabel?: string
  /** Pede pro user digitar o nome do recurso pra confirmar (ex: "principal") */
  requireTypedConfirmation?: string
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void }

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [typed, setTyped] = useState('')

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setTyped('')
      setPending({ ...opts, resolve })
    })
  }, [])

  const close = (ok: boolean) => {
    pending?.resolve(ok)
    setPending(null)
    setTyped('')
  }

  const type: ConfirmType = pending?.type ?? 'warning'
  const Icon = type === 'danger' ? AlertCircle
    : type === 'warning' ? AlertTriangle
    : type === 'success' ? CheckCircle2
    : Info
  const iconBg = type === 'danger' ? 'bg-red-100 dark:bg-red-950/40 text-red-600'
    : type === 'warning' ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-600'
    : type === 'success' ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600'
    : 'bg-blue-100 dark:bg-blue-950/40 text-blue-600'
  const confirmBg = type === 'danger' ? 'bg-red-600 hover:bg-red-700'
    : type === 'warning' ? 'bg-amber-600 hover:bg-amber-700'
    : type === 'success' ? 'bg-emerald-600 hover:bg-emerald-700'
    : 'bg-primary hover:bg-primary/90'

  const requiredText = pending?.requireTypedConfirmation?.trim().toLowerCase() ?? ''
  const typedOk = !requiredText || typed.trim().toLowerCase() === requiredText

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => close(false)}
        >
          <div
            className="modal-surface rounded-2xl shadow-2xl w-full max-w-md flex flex-col animate-in zoom-in-95 duration-150"
            onClick={e => e.stopPropagation()}
          >
            {/* Ícone + close */}
            <div className="flex items-start justify-between p-5 pb-3">
              <div className={cn('h-12 w-12 rounded-full flex items-center justify-center', iconBg)}>
                <Icon className="h-6 w-6" />
              </div>
              <button onClick={() => close(false)}
                className="p-1 rounded hover:bg-accent text-muted-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Texto */}
            <div className="px-5 pb-5 space-y-3">
              <h2 className="text-lg font-semibold">{pending.title}</h2>
              {pending.message && (
                <p className="text-sm text-muted-foreground leading-relaxed">{pending.message}</p>
              )}

              {pending.details && pending.details.length > 0 && (
                <ul className="text-sm rounded-lg bg-muted/40 px-4 py-3 space-y-1.5">
                  {pending.details.map((d, i) => (
                    <li key={i} className="flex items-start gap-2 text-muted-foreground">
                      <span className="text-muted-foreground/60 mt-0.5">•</span>
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
              )}

              {pending.warning && (
                <p className={cn(
                  'text-xs rounded-lg px-3 py-2 leading-relaxed border',
                  type === 'danger'
                    ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300'
                    : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300',
                )}>
                  ⚠️ {pending.warning}
                </p>
              )}

              {pending.requireTypedConfirmation && (
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">
                    Para confirmar, digite <strong className="text-foreground">{pending.requireTypedConfirmation}</strong>
                  </label>
                  <input
                    value={typed}
                    onChange={e => setTyped(e.target.value)}
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Enter' && typedOk) close(true)
                      if (e.key === 'Escape') close(false)
                    }}
                    className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t bg-muted/20 rounded-b-2xl">
              <button onClick={() => close(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-accent">
                {pending.cancelLabel ?? 'Cancelar'}
              </button>
              <button
                onClick={() => typedOk && close(true)}
                disabled={!typedOk}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                  confirmBg,
                )}>
                {pending.confirmLabel ?? 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm precisa de <ConfirmProvider>')
  return ctx
}

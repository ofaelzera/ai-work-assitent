'use client'

import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const inputCls = 'w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50'

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium">{label} {required && <span className="text-destructive">*</span>}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

export function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick} className="p-1.5 rounded-lg hover:bg-muted transition-colors">{children}</button>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="modal-surface rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <p className="font-semibold">{title}</p>
          <button onClick={onClose} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10"><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── Avatar de contato (foto se houver, senão iniciais coloridas) ─────────────
const AVATAR_COLORS = ['bg-violet-500', 'bg-blue-500', 'bg-green-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-orange-500', 'bg-teal-500']
function stringToColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h); return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length] }
function initials(s: string) { const p = s.trim().split(/\s+/); return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase() }

export function ContactAvatar({ name, avatarUrl, size = 'md' }: { name: string; avatarUrl?: string | null; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'sm' ? 'h-8 w-8 text-xs' : 'h-9 w-9 text-sm'
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} className={cn('rounded-full object-cover shrink-0', sizeClass)} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
  }
  return (
    <div className={cn('rounded-full flex items-center justify-center font-semibold text-white shrink-0', stringToColor(name), sizeClass)}>
      {initials(name || '?')}
    </div>
  )
}

export function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'emerald' | 'amber' | 'red' }) {
  const toneCls = tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : tone === 'red' ? 'text-red-600' : ''
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-xl font-bold mt-0.5', toneCls)}>{value}</p>
    </div>
  )
}

'use client'

import { cn } from '@/lib/utils'
import { Users } from 'lucide-react'

const AVATAR_COLORS = [
  'bg-violet-500', 'bg-blue-500', 'bg-green-500', 'bg-amber-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-orange-500', 'bg-teal-500',
  'bg-pink-500', 'bg-indigo-500',
]

function stringToColor(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

function initials(name: string): string {
  const p = name.trim().split(/\s+/)
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase()
}

interface Props {
  name: string
  avatarUrl?: string | null
  isGroup?: boolean
  online?: boolean
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

export function UserAvatar({ name, avatarUrl, isGroup, online, size = 'md' }: Props) {
  const sizes = {
    xs: 'h-6 w-6 text-[9px]',
    sm: 'h-8 w-8 text-[10px]',
    md: 'h-10 w-10 text-xs',
    lg: 'h-12 w-12 text-sm',
  }
  const dot = {
    xs: 'h-1.5 w-1.5',
    sm: 'h-2 w-2',
    md: 'h-2.5 w-2.5',
    lg: 'h-3 w-3',
  }
  return (
    <div className="relative shrink-0">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={name}
          className={cn(sizes[size], 'rounded-full object-cover')}
          onError={(e) => {
            e.currentTarget.style.display = 'none'
            const fb = e.currentTarget.parentElement?.querySelector('.avatar-fb') as HTMLElement
            if (fb) fb.style.display = 'flex'
          }}
        />
      ) : null}
      <div
        className={cn(
          'avatar-fb rounded-full items-center justify-center text-white font-semibold',
          sizes[size],
          stringToColor(name),
          avatarUrl ? 'hidden' : 'flex',
        )}
      >
        {isGroup ? <Users className="h-1/2 w-1/2" /> : initials(name)}
      </div>
      {online !== undefined && (
        <span
          className={cn(
            'absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-card',
            dot[size],
            online ? 'bg-emerald-500' : 'bg-gray-400',
          )}
          title={online ? 'Online' : 'Offline'}
        />
      )}
    </div>
  )
}

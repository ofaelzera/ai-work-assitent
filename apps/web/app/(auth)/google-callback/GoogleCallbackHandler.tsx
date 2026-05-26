'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { setAccessToken } from '@/lib/api'
import { useAuthStore } from '@/store/auth'
import { apiFetch } from '@/lib/api'
import { Bot } from 'lucide-react'

export default function GoogleCallbackHandler() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { setUser } = useAuthStore()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const accessToken = searchParams.get('access_token')
    const errorParam = searchParams.get('error')

    if (errorParam) {
      setError(decodeURIComponent(errorParam))
      return
    }

    if (!accessToken) {
      setError('Token de acesso não encontrado')
      return
    }

    // Clear token from URL immediately for security
    window.history.replaceState({}, '', '/auth/google-callback')

    const finalize = async () => {
      try {
        setAccessToken(accessToken)
        const me = await apiFetch<{ sub: string; workspaceId: string; role: 'ADMIN' | 'MEMBER' }>('/auth/me')
        setUser(me, accessToken)
        router.replace('/dashboard')
      } catch {
        setError('Não foi possível carregar o perfil. Tente novamente.')
      }
    }

    finalize()
  }, [])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="glass-card rounded-2xl p-8 space-y-4 w-full max-w-sm text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 mx-auto">
            <Bot className="h-6 w-6 text-destructive" />
          </div>
          <h1 className="text-lg font-bold">Erro no login com Google</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
          <button
            onClick={() => router.replace('/login')}
            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Voltar ao login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-3">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 animate-pulse">
          <Bot className="h-6 w-6 text-primary" />
        </div>
        <p className="text-sm text-muted-foreground">Entrando com Google...</p>
      </div>
    </div>
  )
}

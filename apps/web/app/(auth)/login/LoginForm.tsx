'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { LoginSchema, type LoginInput } from '@aiwa/shared'
import { login } from '@/lib/auth'
import { useAuthStore } from '@/store/auth'
import { apiFetch, getAccessToken } from '@/lib/api'
import { Bot } from 'lucide-react'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84Z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53Z" fill="#EA4335"/>
    </svg>
  )
}

/**
 * Form de login real. Carregado via dynamic({ ssr: false }) pra evitar
 * hydration mismatch causado por extensões de browser (1Password, LastPass,
 * tradutor, Grammarly, etc.) que injetam DOM dentro do form/inputs antes
 * do React hidratar.
 */
export default function LoginForm() {
  const router = useRouter()
  const { setUser } = useAuthStore()
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
  })

  const onSubmit = async (data: LoginInput) => {
    setLoading(true)
    try {
      await login(data)
      const me = await apiFetch<{ sub: string; workspaceId: string; role: 'ADMIN' | 'MEMBER' }>('/auth/me')
      setUser(me, getAccessToken())
      router.replace('/dashboard')
    } catch {
      toast.error('Email ou senha incorretos')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    setGoogleLoading(true)
    try {
      const { url } = await apiFetch<{ url: string }>('/auth/google', { skipAuth: true })
      window.location.href = url
    } catch {
      toast.error('Não foi possível iniciar o login com Google')
      setGoogleLoading(false)
    }
  }

  return (
    <div translate="no" className="relative min-h-screen flex items-center justify-center bg-background p-4 overflow-hidden">

      {/* Decorative Background Elements (Mesh Gradient feel) */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/20 blur-[120px] animate-pulse pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/20 blur-[120px] animate-pulse delay-1000 pointer-events-none" />

      {/* Main Login Card */}
      <div className="relative w-full max-w-md animate-slide-up">
        <div className="glass-card rounded-2xl p-8 space-y-8">

          <div className="text-center space-y-2">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 mb-2">
              <Bot className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">AI Work Assistant</h1>
            <p className="text-sm text-muted-foreground">Entre na sua conta para continuar</p>
          </div>

          {/* Google Login */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={googleLoading || loading}
            className="w-full flex items-center justify-center gap-3 rounded-lg border border-input/60 bg-background/60 px-4 py-2.5 text-sm font-medium shadow-sm transition-all hover:bg-background/90 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:pointer-events-none"
          >
            <GoogleIcon />
            {googleLoading ? 'Redirecionando...' : 'Entrar com Google'}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-border/50" />
            <span className="text-xs text-muted-foreground/70 select-none">ou</span>
            <div className="flex-1 border-t border-border/50" />
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium text-foreground">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                {...register('email')}
                className="w-full rounded-lg border border-input/50 bg-background/50 px-4 py-2.5 text-sm shadow-sm transition-colors hover:bg-background/80 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="voce@exemplo.com"
              />
              {errors.email && (
                <p className="text-xs text-destructive animate-fade-in">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium text-foreground">
                Senha
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                {...register('password')}
                className="w-full rounded-lg border border-input/50 bg-background/50 px-4 py-2.5 text-sm shadow-sm transition-colors hover:bg-background/80 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="••••••••"
              />
              {errors.password && (
                <p className="text-xs text-destructive animate-fade-in">{errors.password.message}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || googleLoading}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:bg-primary/90 hover:shadow-primary/40 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:pointer-events-none"
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          <p className="text-center text-xs text-muted-foreground/80 pt-2 border-t border-border/50">
            Conta padrão (dev): admin@aiwa.local / admin123456
          </p>
        </div>
      </div>
    </div>
  )
}

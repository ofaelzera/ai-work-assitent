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
              disabled={loading}
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

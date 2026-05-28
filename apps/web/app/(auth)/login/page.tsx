'use client'

import dynamic from 'next/dynamic'
import { Bot } from 'lucide-react'

/**
 * Renderiza o form de login só no client, sem SSR.
 * Evita hydration mismatch causado por extensões de browser
 * (1Password, LastPass, Grammarly, tradutor) que injetam DOM
 * dentro do form/inputs antes do React hidratar.
 *
 * Skeleton enquanto carrega mantém o layout estável (sem flash de blank).
 */
const LoginForm = dynamic(() => import('./LoginForm'), {
  ssr: false,
  loading: () => (
    <div translate="no" className="relative min-h-screen flex items-center justify-center bg-background p-4 overflow-hidden" suppressHydrationWarning>
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/20 blur-[120px] animate-pulse pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-secondary/30 blur-[120px] animate-pulse delay-1000 pointer-events-none" />
      <div className="relative w-full max-w-md">
        <div className="glass-card rounded-2xl p-8 space-y-8">
          <div className="text-center space-y-2">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 mb-2">
              <Bot className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">AI Work Assistant</h1>
            <p className="text-sm text-muted-foreground">Carregando...</p>
          </div>
          <div className="space-y-5">
            <div className="h-[72px]" />
            <div className="h-[72px]" />
            <div className="h-[42px] rounded-lg bg-primary/20 animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  ),
})

export default function LoginPage() {
  return <LoginForm />
}

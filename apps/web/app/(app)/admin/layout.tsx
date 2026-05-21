'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { ShieldAlert } from 'lucide-react'

/**
 * Guard de rota: bloqueia tudo dentro de /admin para usuários não-ADMIN.
 * Redireciona para o dashboard automaticamente.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const user = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'ADMIN'

  useEffect(() => {
    if (user && !isAdmin) {
      router.replace('/dashboard')
    }
  }, [user, isAdmin, router])

  if (!user) {
    return <div className="p-8 text-sm text-muted-foreground">Carregando...</div>
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <ShieldAlert className="h-12 w-12 text-muted-foreground mb-3" />
        <h1 className="text-lg font-semibold">Acesso restrito</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Esta área é exclusiva para administradores.
        </p>
      </div>
    )
  }

  return <>{children}</>
}

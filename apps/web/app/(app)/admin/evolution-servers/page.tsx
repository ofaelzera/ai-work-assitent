'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Movido para Configurações → aba "Servidores Evolution". */
export default function EvolutionServersRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/admin/settings?tab=evolution')
  }, [router])
  return <div className="p-6 text-sm text-muted-foreground">Redirecionando…</div>
}

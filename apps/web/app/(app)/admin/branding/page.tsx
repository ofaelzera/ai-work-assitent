'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Movido para Configurações → aba "Marca & White-label". */
export default function BrandingRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/admin/settings?tab=branding')
  }, [router])
  return <div className="p-6 text-sm text-muted-foreground">Redirecionando…</div>
}

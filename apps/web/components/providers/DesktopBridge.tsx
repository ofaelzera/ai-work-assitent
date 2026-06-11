'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isDesktop, onDeepLink } from '@/lib/desktop'

/**
 * Integração com o app desktop (Tauri): roteia deep links aiwa:// para as
 * rotas internas do Next. Não renderiza nada e é inerte no navegador.
 */
export function DesktopBridge() {
  const router = useRouter()

  useEffect(() => {
    if (!isDesktop()) return
    return onDeepLink((path) => {
      if (path.startsWith('/')) router.push(path)
    })
  }, [router])

  return null
}

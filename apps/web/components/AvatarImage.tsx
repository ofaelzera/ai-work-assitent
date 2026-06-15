'use client'

import { useState, useEffect } from 'react'

/**
 * <img> de avatar com fallback automático: se `src` for vazio OU a imagem
 * falhar ao carregar (URL expirada/quebrada — comum em fotos do WhatsApp),
 * renderiza o `fallback` (normalmente um círculo com iniciais) no lugar do
 * ícone de imagem quebrada do navegador.
 */
export function AvatarImage({ src, alt, title, className, fallback }: {
  src?: string | null
  alt?: string
  title?: string
  className?: string
  fallback: React.ReactNode
}) {
  const [error, setError] = useState(false)
  // Reseta o estado de erro quando a fonte muda (ex.: troca de contato).
  useEffect(() => { setError(false) }, [src])

  if (!src || error) return <>{fallback}</>
  return (
    <img
      src={src}
      alt={alt}
      title={title}
      className={className}
      onError={() => setError(true)}
    />
  )
}

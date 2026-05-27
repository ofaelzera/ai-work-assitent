import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { getServerApiUrl } from '@/lib/runtime-config'

const inter = Inter({ subsets: ['latin'] })

// URL pública que o browser deve usar pra falar com a API.
// Lida em runtime do .env. Se vazia, browser cai em window.location.origin
// (mesmo host do proxy reverso).
function getPublicApiUrl(): string {
  return process.env.PUBLIC_API_URL ?? ''
}

// Função para buscar configurações públicas de White-Label
async function getSystemSettings() {
  try {
    const res = await fetch(`${getServerApiUrl()}/system-settings/public`, {
      cache: 'no-store',
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/**
 * Converte hex (#RRGGBB) pro formato "H S% L%" que o Tailwind/shadcn espera
 * nas CSS vars (usadas como `hsl(var(--primary))`). Retorna null em hex inválido.
 */
function hexToHslString(hex: string | null | undefined): string | null {
  if (!hex) return null
  const m = /^#?([a-f\d]{6})$/i.exec(hex.trim())
  if (!m) return null
  const num = parseInt(m[1], 16)
  const r = ((num >> 16) & 255) / 255
  const g = ((num >> 8) & 255) / 255
  const b = (num & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break
      case g: h = ((b - r) / d + 2); break
      case b: h = ((r - g) / d + 4); break
    }
    h *= 60
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSystemSettings()
  
  return {
    title: settings?.systemTitle || 'AI Work Assistant',
    description: settings?.companyName ? `Desenvolvido por ${settings.companyName}` : 'Seu assistente inteligente de trabalho',
    icons: settings?.faviconUrl ? [{ rel: 'icon', url: settings.faviconUrl }] : undefined,
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSystemSettings()

  // CSS vars precisam estar no formato HSL space-separated (ex: "243 75% 59%")
  // porque o Tailwind faz `hsl(var(--primary))`. Aplicamos só quando o admin
  // configurou cores válidas; caso contrário caímos no default do globals.css.
  const primaryHsl = hexToHslString(settings?.primaryColor)
  const secondaryHsl = hexToHslString(settings?.secondaryColor)
  const customStyle: React.CSSProperties = {}
  if (primaryHsl) (customStyle as any)['--primary'] = primaryHsl
  if (secondaryHsl) (customStyle as any)['--secondary'] = secondaryHsl

  const publicApiUrl = getPublicApiUrl()

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__APP_CONFIG__=${JSON.stringify({ apiUrl: publicApiUrl })};`,
          }}
        />
      </head>
      <body className={inter.className} style={customStyle} suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}

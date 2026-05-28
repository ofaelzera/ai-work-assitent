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
 * Converte hex (#RRGGBB) pra { hslString, luminance }. Retorna null em hex inválido.
 * - `hslString`: "H S% L%" pro Tailwind/shadcn (usado como `hsl(var(--primary))`)
 * - `luminance`: 0..1 (relativa, perceptual aproximada) pra decidir foreground claro/escuro
 */
function parseHex(hex: string | null | undefined): { hslString: string; luminance: number } | null {
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
  // Luminância aproximada (sRGB ponderado) — boa o suficiente pra decidir contraste
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return {
    hslString: `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`,
    luminance,
  }
}

/** Foreground legível pra um fundo: branco se escuro, quase-preto se claro. */
function readableForeground(luminance: number): string {
  return luminance < 0.55 ? '0 0% 100%' : '222 47% 11%'
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
  // Também calculamos `*-foreground` automaticamente pra garantir contraste.
  const primary = parseHex(settings?.primaryColor)
  const secondary = parseHex(settings?.secondaryColor)
  const customStyle: React.CSSProperties = {}
  if (primary) {
    (customStyle as any)['--primary'] = primary.hslString
    ;(customStyle as any)['--primary-foreground'] = readableForeground(primary.luminance)
    ;(customStyle as any)['--ring'] = primary.hslString
  }
  if (secondary) {
    (customStyle as any)['--secondary'] = secondary.hslString
    ;(customStyle as any)['--secondary-foreground'] = readableForeground(secondary.luminance)
    ;(customStyle as any)['--accent'] = secondary.hslString
    ;(customStyle as any)['--accent-foreground'] = readableForeground(secondary.luminance)
  }

  const publicApiUrl = getPublicApiUrl()

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__APP_CONFIG__=${JSON.stringify({ apiUrl: publicApiUrl })};`,
          }}
        />
        <style dangerouslySetInnerHTML={{ __html: `
          :root {
            --chat-bg: ${settings?.chatBgColorLight || '#efeae2'};
          }
          .dark {
            --chat-bg: ${settings?.chatBgColorDark || '#0b141a'};
          }
        ` }} />
      </head>
      <body className={inter.className} style={customStyle} suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}

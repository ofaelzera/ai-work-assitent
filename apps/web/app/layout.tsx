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

  const customStyle = settings ? {
    '--primary': settings.primaryColor,
    '--secondary': settings.secondaryColor,
  } as React.CSSProperties : {}

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

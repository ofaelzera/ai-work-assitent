import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'

const inter = Inter({ subsets: ['latin'] })

// Função para buscar configurações públicas de White-Label
async function getSystemSettings() {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333'}/system-settings/public`, {
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

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={inter.className} style={customStyle} suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}

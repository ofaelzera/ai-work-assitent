declare global {
  interface Window {
    __APP_CONFIG__?: { apiUrl?: string }
  }
}

export function getApiUrl(): string {
  if (typeof window === 'undefined') {
    return (
      process.env.API_URL ??
      process.env.NEXT_PUBLIC_API_URL ??
      'http://localhost:3333'
    )
  }
  const fromWindow = window.__APP_CONFIG__?.apiUrl
  if (fromWindow) return fromWindow
  return window.location.origin
}

export function getServerApiUrl(): string {
  return (
    process.env.API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:3333'
  )
}

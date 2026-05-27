declare global {
  interface Window {
    __APP_CONFIG__?: { apiUrl?: string }
  }
}

/**
 * Resolve a URL da API em runtime.
 *
 * - **Server-side (Next Server Components):** lê `PUBLIC_API_URL` do `.env`
 *   (carregado em runtime pelo Next, sem rebuild necessário).
 * - **Client-side (browser):** lê de `window.__APP_CONFIG__.apiUrl` que é
 *   injetado pelo `layout.tsx`. Se vazio, cai pra `window.location.origin`
 *   (útil quando web e API estão no mesmo host atrás de reverse proxy).
 *
 * Pra trocar a URL: edite `PUBLIC_API_URL` no `.env`, reinicie o Next
 * (`pm2 restart aiwa-web`). Não precisa rebuild.
 */
export function getApiUrl(): string {
  if (typeof window === 'undefined') {
    return process.env.PUBLIC_API_URL ?? 'http://localhost:3333'
  }
  const fromWindow = window.__APP_CONFIG__?.apiUrl
  if (fromWindow) return fromWindow
  return window.location.origin
}

/** Versão pra usar exclusivamente em código server-side (Server Components, Route Handlers). */
export function getServerApiUrl(): string {
  return process.env.PUBLIC_API_URL ?? 'http://localhost:3333'
}

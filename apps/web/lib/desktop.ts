'use client'

/**
 * Ponte com o app desktop (Tauri). Quando o web app roda dentro do Aiwa Desktop,
 * `window.__TAURI__` é injetado pelo shell nativo (withGlobalTauri). No navegador
 * comum todas as funções são no-ops seguros.
 *
 * Nenhum pacote @tauri-apps/* é importado aqui de propósito — usamos o global
 * para não afetar o bundle/SSR do Next.
 */

type TauriGlobal = {
  core: {
    invoke: (
      cmd: string,
      args?: Record<string, unknown> | ArrayBuffer | Uint8Array,
      options?: { headers?: Record<string, string> },
    ) => Promise<any>
  }
  event: {
    listen: (
      event: string,
      handler: (event: { payload: any }) => void,
    ) => Promise<() => void>
  }
  notification?: {
    isPermissionGranted: () => Promise<boolean>
    requestPermission: () => Promise<string>
    sendNotification: (options: { title: string; body?: string }) => void
  }
}

function getTauri(): TauriGlobal | null {
  if (typeof window === 'undefined') return null
  return (window as any).__TAURI__ ?? null
}

export function isDesktop(): boolean {
  return getTauri() !== null
}

/** Notificação nativa do SO (a Notification API do webview não é confiável). */
export async function notifyNative(title: string, body?: string): Promise<boolean> {
  const tauri = getTauri()
  if (!tauri?.notification) return false
  try {
    let granted = await tauri.notification.isPermissionGranted()
    if (!granted) {
      granted = (await tauri.notification.requestPermission()) === 'granted'
    }
    if (!granted) return false
    tauri.notification.sendNotification({ title, body })
    return true
  } catch {
    return false
  }
}

/** Badge de não lidas no dock (macOS) / tooltip do tray. */
export async function setUnreadBadge(count: number): Promise<void> {
  const tauri = getTauri()
  if (!tauri) return
  try {
    await tauri.core.invoke('set_unread_badge', { count })
  } catch {
    // silencioso: badge é best-effort
  }
}

/**
 * Salva um blob na pasta Downloads via shell nativo. O WKWebView (macOS) ignora
 * `<a download>` com blob URLs, então no desktop os bytes vão pelo IPC.
 * Retorna o caminho salvo, ou null se não estiver no desktop / falhar.
 */
export async function saveBlobNative(blob: Blob, filename: string): Promise<string | null> {
  const tauri = getTauri()
  if (!tauri) return null
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const path = await tauri.core.invoke('save_download', bytes, {
      headers: { 'x-filename': encodeURIComponent(filename) },
    })
    return typeof path === 'string' ? path : null
  } catch {
    return null
  }
}

/**
 * Volta para a tela nativa de configuração do servidor (apenas no desktop).
 * O shell limpa a URL salva e navega a janela para o bootstrap local.
 */
export async function resetServer(): Promise<void> {
  const tauri = getTauri()
  if (!tauri) return
  try {
    await tauri.core.invoke('reset_server')
  } catch {
    // best-effort
  }
}

/**
 * Escuta deep links aiwa:// encaminhados pelo shell (evento `deep-link-navigate`,
 * payload é o path interno, ex.: "/inbox/abc123"). Retorna função de cleanup.
 * Também consome um deep link pendente de cold start.
 */
export function onDeepLink(handler: (path: string) => void): () => void {
  const tauri = getTauri()
  if (!tauri) return () => {}

  let unlisten: (() => void) | null = null
  let cancelled = false

  tauri.event
    .listen('deep-link-navigate', (event) => {
      if (typeof event.payload === 'string') handler(event.payload)
    })
    .then((fn) => {
      if (cancelled) fn()
      else unlisten = fn
    })
    .catch(() => {})

  tauri.core
    .invoke('take_pending_deep_link')
    .then((path) => {
      if (!cancelled && typeof path === 'string' && path) handler(path)
    })
    .catch(() => {})

  return () => {
    cancelled = true
    unlisten?.()
  }
}

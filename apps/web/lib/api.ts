const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333'

let accessToken: string | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function getAccessToken() {
  return accessToken
}

interface FetchOptions extends RequestInit {
  skipAuth?: boolean
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { skipAuth, ...rest } = options

  const isFormData = rest.body instanceof FormData
  const headers: Record<string, string> = {
    ...(rest.body !== undefined && !isFormData ? { 'Content-Type': 'application/json' } : {}),
    ...(rest.headers as Record<string, string>),
  }

  if (!skipAuth && accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers,
    credentials: 'include',
  })

  if (res.status === 401 && !skipAuth) {
    // Tentar refresh
    const refreshed = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
    if (refreshed.ok) {
      const data = await refreshed.json()
      setAccessToken(data.accessToken)
      headers['Authorization'] = `Bearer ${data.accessToken}`
      const retry = await fetch(`${API_URL}${path}`, { ...rest, headers, credentials: 'include' })
      if (!retry.ok) throw new ApiError(retry.status, await retry.text())
      return retry.json() as Promise<T>
    }
    // Refresh falhou — limpar token e redirecionar
    setAccessToken(null)
    if (typeof window !== 'undefined') window.location.href = '/login'
    throw new ApiError(401, 'Sessão expirada')
  }

  if (!res.ok) {
    const text = await res.text()
    // Extrai campo "message" do JSON de erro do Fastify/Zod e preserva o body completo
    let message = text
    let body: unknown = undefined
    try {
      const json = JSON.parse(text)
      message = json.message ?? json.error ?? text
      body = json
    } catch {}
    throw new ApiError(res.status, message, body)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

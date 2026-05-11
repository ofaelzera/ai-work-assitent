import { apiFetch, setAccessToken } from './api'
import type { LoginInput } from '@aiwa/shared'

export async function login(input: LoginInput): Promise<void> {
  const data = await apiFetch<{ accessToken: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
    skipAuth: true,
  })
  setAccessToken(data.accessToken)
}

export async function logout(): Promise<void> {
  await apiFetch('/auth/logout', { method: 'POST' }).catch(() => {})
  setAccessToken(null)
}

export async function refreshToken(): Promise<boolean> {
  try {
    const data = await apiFetch<{ accessToken: string }>('/auth/refresh', {
      method: 'POST',
      skipAuth: true,
    })
    setAccessToken(data.accessToken)
    return true
  } catch {
    return false
  }
}

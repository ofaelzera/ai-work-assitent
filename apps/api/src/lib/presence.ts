/**
 * Rastreio leve de presença de usuários conectados ao SSE.
 * In-memory: cada conexão /sse incrementa o contador; ao fechar, decrementa.
 * Usuário é considerado "online" se tem >=1 conexão ativa.
 *
 * Sem persistência — suficiente para um único processo Node. Para escalar
 * horizontalmente, trocar por Redis SET com TTL.
 */

const counts = new Map<string, number>()

export function trackOnline(userId: string): void {
  counts.set(userId, (counts.get(userId) ?? 0) + 1)
}

export function trackOffline(userId: string): void {
  const c = (counts.get(userId) ?? 0) - 1
  if (c <= 0) counts.delete(userId)
  else counts.set(userId, c)
}

export function isOnline(userId: string): boolean {
  return (counts.get(userId) ?? 0) > 0
}

export function listOnline(): string[] {
  return Array.from(counts.keys())
}

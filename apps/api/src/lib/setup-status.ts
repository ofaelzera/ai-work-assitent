import { prisma } from './prisma.js'

let cached: boolean | null = null

/**
 * Setup é considerado completo quando há ao menos um usuário ADMIN no DB.
 * Resultado é cacheado em memória. Use markSetupCompleted() depois do install
 * pra invalidar o cache sem precisar reiniciar o processo.
 */
export async function isSetupCompleted(): Promise<boolean> {
  if (cached !== null) return cached
  try {
    const admin = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
      select: { id: true },
    })
    cached = Boolean(admin)
  } catch {
    cached = false
  }
  return cached
}

export function markSetupCompleted(): void {
  cached = true
}

export function resetSetupStatusCache(): void {
  cached = null
}

import type { NotificationChannelProvider } from './provider.types.js'

/**
 * Registry de canais plugáveis. O NotificationService consulta este mapa por
 * chave de canal (in_app, email, whatsapp, …). Para adicionar um novo meio de
 * entrega, basta criar um provider e chamar registerProvider() no bootstrap.
 */
const providers = new Map<string, NotificationChannelProvider>()

export function registerProvider(provider: NotificationChannelProvider): void {
  providers.set(provider.key, provider)
}

export function getProvider(key: string): NotificationChannelProvider | undefined {
  return providers.get(key)
}

export function listProviderKeys(): string[] {
  return [...providers.keys()]
}

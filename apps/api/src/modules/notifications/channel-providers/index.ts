import { registerProvider } from './registry.js'
import { inAppProvider } from './inapp.provider.js'
import { emailProvider } from './email.provider.js'
import { whatsappProvider } from './whatsapp.provider.js'

let registered = false

/**
 * Registra os canais de notificação embutidos. Idempotente.
 * Novos canais (sms, push, slack…) são adicionados aqui — sem tocar no service.
 */
export function registerBuiltinProviders(): void {
  if (registered) return
  registerProvider(inAppProvider)
  registerProvider(emailProvider)
  registerProvider(whatsappProvider)
  registered = true
}

export { getProvider, listProviderKeys, registerProvider } from './registry.js'
export type { NotificationChannelProvider, ChannelSendContext } from './provider.types.js'

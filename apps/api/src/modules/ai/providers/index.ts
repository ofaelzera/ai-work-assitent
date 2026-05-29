import { GeminiProvider } from './gemini.provider.js'
import { OpenRouterProvider } from './openrouter.provider.js'
import { AnthropicProvider } from './anthropic.provider.js'
import { OpenAIProvider } from './openai.provider.js'
import { getProviderConfig } from './config.js'
import type { AIProvider } from './types.js'

export type { AIProvider, AIGenerateInput, AIGenerateOutput, AIMessage } from './types.js'
export { AI_PROVIDERS, invalidateProviderConfigCache, getProviderConfig, getDefaultModel } from './config.js'

export async function getProvider(name: string): Promise<AIProvider> {
  if (name !== 'gemini' && name !== 'openrouter' && name !== 'anthropic' && name !== 'openai') {
    throw new Error(`Provider desconhecido: ${name}`)
  }

  const cfg = await getProviderConfig(name)
  if (!cfg.apiKey) throw new Error(`API key do provider "${name}" não configurada`)

  switch (name) {
    case 'gemini':
      return new GeminiProvider(cfg.apiKey)
    case 'openrouter':
      return new OpenRouterProvider(cfg.apiKey, cfg.extra.siteUrl as string | undefined)
    case 'anthropic':
      return new AnthropicProvider(cfg.apiKey, cfg.extra.baseUrl as string | undefined)
    case 'openai':
      return new OpenAIProvider(cfg.apiKey, cfg.extra.baseUrl as string | undefined)
  }
}

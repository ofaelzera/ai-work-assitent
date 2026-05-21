import { GeminiProvider } from './gemini.provider.js'
import { OpenRouterProvider } from './openrouter.provider.js'
import { env } from '../../../config/env.js'
import type { AIProvider } from './types.js'

export type { AIProvider, AIGenerateInput, AIGenerateOutput, AIMessage } from './types.js'

export function getProvider(name: string): AIProvider {
  if (name === 'gemini') {
    if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada')
    return new GeminiProvider(env.GEMINI_API_KEY)
  }

  if (name === 'openrouter') {
    if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY não configurada')
    return new OpenRouterProvider(env.OPENROUTER_API_KEY, env.OPENROUTER_SITE_URL)
  }

  throw new Error(`Provider desconhecido: ${name}`)
}

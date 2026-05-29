import type { AIProvider, AIGenerateInput, AIGenerateOutput, AIMessage } from './types.js'
import { logger } from '../../../lib/logger.js'

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'
const MAX_RETRIES = 4

function retryDelay(attempt: number, retryAfter?: string | null): number {
  if (retryAfter) {
    const secs = parseFloat(retryAfter)
    if (!isNaN(secs)) return (secs + 1) * 1000
  }
  return Math.min(2 ** attempt * 1000, 30_000)
}

export class AnthropicProvider implements AIProvider {
  name = 'anthropic'
  private baseUrl: string

  constructor(private apiKey: string, baseUrl?: string) {
    this.baseUrl = baseUrl ?? DEFAULT_BASE_URL
  }

  async generate(input: AIGenerateInput): Promise<AIGenerateOutput> {
    // A Anthropic separa o system prompt do array de mensagens.
    const system = input.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')

    const messages = input.messages
      .filter((m): m is AIMessage & { role: 'user' | 'assistant' } => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }))

    let lastErr: unknown
    const maxRetries = input.maxRetries ?? MAX_RETRIES

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify({
          model: input.model,
          ...(system && { system }),
          messages,
          temperature: input.temperature ?? 0.4,
          max_tokens: input.maxTokens ?? 2048,
        }),
      })

      if (res.status === 429 || res.status === 503 || res.status === 500 || res.status === 529) {
        const retryAfter = res.headers.get('retry-after')
        const wait = retryDelay(attempt, retryAfter)
        lastErr = new Error(`Anthropic ${res.status}`)
        if (attempt < maxRetries) {
          logger.warn({ attempt, status: res.status, wait }, `Anthropic ${res.status} — aguardando ${wait}ms`)
          await new Promise((r) => setTimeout(r, wait))
          continue
        }
        throw lastErr
      }

      if (!res.ok) {
        const body = await res.text()
        throw new Error(`Anthropic ${res.status}: ${body}`)
      }

      const data = (await res.json()) as any

      const text: string = Array.isArray(data.content)
        ? data.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
        : ''
      const usage = data.usage ?? {}

      return {
        text,
        tokensIn: usage.input_tokens ?? 0,
        tokensOut: usage.output_tokens ?? 0,
        raw: data,
      }
    }

    throw lastErr
  }
}

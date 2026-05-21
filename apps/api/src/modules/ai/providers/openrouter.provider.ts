import type { AIProvider, AIGenerateInput, AIGenerateOutput } from './types.js'
import { logger } from '../../../lib/logger.js'

const BASE_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MAX_RETRIES = 4

function retryDelay(attempt: number, retryAfter?: string | null): number {
  if (retryAfter) {
    const secs = parseFloat(retryAfter)
    if (!isNaN(secs)) return (secs + 1) * 1000
  }
  return Math.min(2 ** attempt * 1000, 30_000)
}

export class OpenRouterProvider implements AIProvider {
  name = 'openrouter'

  constructor(private apiKey: string, private siteUrl?: string) {}

  async generate(input: AIGenerateInput): Promise<AIGenerateOutput> {
    let lastErr: unknown

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': this.siteUrl ?? 'http://localhost:3000',
          'X-Title': 'AI Work Assistant',
        },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages.map(m => ({ role: m.role, content: m.content })),
          temperature: input.temperature ?? 0.4,
          max_tokens: input.maxTokens ?? 2048,
          ...(input.responseFormat === 'json' && {
            response_format: { type: 'json_object' },
          }),
        }),
      })

      if (res.status === 429 || res.status === 503 || res.status === 500) {
        const retryAfter = res.headers.get('retry-after') ?? res.headers.get('x-ratelimit-reset-requests')
        const wait = retryDelay(attempt, retryAfter)
        lastErr = new Error(`OpenRouter ${res.status}`)
        if (attempt < MAX_RETRIES) {
          logger.warn({ attempt, status: res.status, wait }, `OpenRouter ${res.status} — aguardando ${wait}ms`)
          await new Promise(r => setTimeout(r, wait))
          continue
        }
        throw lastErr
      }

      if (!res.ok) {
        const body = await res.text()
        throw new Error(`OpenRouter ${res.status}: ${body}`)
      }

      const data = await res.json() as any

      const text: string = data.choices?.[0]?.message?.content ?? ''
      const usage = data.usage ?? {}

      return {
        text,
        tokensIn: usage.prompt_tokens ?? 0,
        tokensOut: usage.completion_tokens ?? 0,
        raw: data,
      }
    }

    throw lastErr
  }
}

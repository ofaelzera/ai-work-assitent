import type { AIProvider, AIGenerateInput, AIGenerateOutput } from './types.js'
import { logger } from '../../../lib/logger.js'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1/chat/completions'
const MAX_RETRIES = 4

function retryDelay(attempt: number, retryAfter?: string | null): number {
  if (retryAfter) {
    const secs = parseFloat(retryAfter)
    if (!isNaN(secs)) return (secs + 1) * 1000
  }
  return Math.min(2 ** attempt * 1000, 30_000)
}

export class OpenAIProvider implements AIProvider {
  name = 'openai'
  private baseUrl: string

  constructor(private apiKey: string, baseUrl?: string) {
    this.baseUrl = baseUrl ?? DEFAULT_BASE_URL
  }

  async generate(input: AIGenerateInput): Promise<AIGenerateOutput> {
    let lastErr: unknown
    const maxRetries = input.maxRetries ?? MAX_RETRIES

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: input.temperature ?? 0.4,
          max_tokens: input.maxTokens ?? 2048,
          ...(input.responseFormat === 'json' && {
            response_format: { type: 'json_object' },
          }),
        }),
      })

      if (res.status === 429 || res.status === 503 || res.status === 500) {
        const retryAfter = res.headers.get('retry-after')
        const wait = retryDelay(attempt, retryAfter)
        lastErr = new Error(`OpenAI ${res.status}`)
        if (attempt < maxRetries) {
          logger.warn({ attempt, status: res.status, wait }, `OpenAI ${res.status} — aguardando ${wait}ms`)
          await new Promise((r) => setTimeout(r, wait))
          continue
        }
        throw lastErr
      }

      if (!res.ok) {
        const body = await res.text()
        throw new Error(`OpenAI ${res.status}: ${body}`)
      }

      const data = (await res.json()) as any

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

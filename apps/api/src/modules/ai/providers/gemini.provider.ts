import { GoogleGenerativeAI } from '@google/generative-ai'
import type { AIProvider, AIGenerateInput, AIGenerateOutput } from './types.js'
import { logger } from '../../../lib/logger.js'

const RETRY_STATUS = new Set([429, 503, 500])
const MAX_RETRIES = 4

function extractHttpStatus(err: unknown): number | null {
  const msg = String((err as any)?.message ?? '')
  const m = msg.match(/\[(\d{3})\s/)
  return m ? parseInt(m[1]) : null
}

function retryDelay(attempt: number, err: unknown): number {
  // Tenta ler o retryDelay sugerido pelo Google (ex: "19s")
  const msg = String((err as any)?.message ?? '')
  const suggested = msg.match(/"retryDelay":"(\d+)s"/)
  if (suggested) return (parseInt(suggested[1]) + 2) * 1000

  // Exponential backoff: 2s, 4s, 8s, 16s
  return Math.min(2 ** attempt * 1000, 30_000)
}

export class GeminiProvider implements AIProvider {
  name = 'gemini'
  private client: GoogleGenerativeAI

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey)
  }

  async generate(input: AIGenerateInput): Promise<AIGenerateOutput> {
    let lastErr: unknown
    const maxRetries = input.maxRetries ?? MAX_RETRIES
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this._generate(input)
      } catch (err) {
        lastErr = err
        const status = extractHttpStatus(err)
        if (status && RETRY_STATUS.has(status) && attempt < maxRetries) {
          const wait = retryDelay(attempt, err)
          logger.warn({ attempt, status, wait }, `Gemini ${status} — aguardando ${wait}ms antes de retry`)
          await new Promise(r => setTimeout(r, wait))
          continue
        }
        throw err
      }
    }
    throw lastErr
  }

  private async _generate(input: AIGenerateInput): Promise<AIGenerateOutput> {
    const model = this.client.getGenerativeModel({
      model: input.model,
      generationConfig: {
        temperature: input.temperature ?? 0.4,
        maxOutputTokens: input.maxTokens ?? 2048,
        ...(input.responseFormat === 'json' && { responseMimeType: 'application/json' }),
      },
    })

    // Separa system prompt das mensagens de conversa
    const systemMsg = input.messages.find(m => m.role === 'system')
    const chatMessages = input.messages.filter(m => m.role !== 'system')

    // Converte para formato Gemini (user/model alternados)
    const geminiHistory = chatMessages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

    const lastMessage = chatMessages[chatMessages.length - 1]?.content ?? ''

    const chat = model.startChat({
      history: geminiHistory,
      ...(systemMsg && {
        systemInstruction: { role: 'user', parts: [{ text: systemMsg.content }] },
      }),
    })

    const result = await chat.sendMessage(lastMessage)
    const response = result.response
    const text = response.text()
    const usage = response.usageMetadata

    return {
      text,
      tokensIn: usage?.promptTokenCount ?? 0,
      tokensOut: usage?.candidatesTokenCount ?? 0,
      raw: response,
    }
  }
}

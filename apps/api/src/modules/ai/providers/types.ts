export interface AIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AIGenerateInput {
  model: string
  messages: AIMessage[]
  temperature?: number
  maxTokens?: number
  responseFormat?: 'text' | 'json'
}

export interface AIGenerateOutput {
  text: string
  tokensIn: number
  tokensOut: number
  raw?: unknown
}

export interface AIProvider {
  name: string
  generate(input: AIGenerateInput): Promise<AIGenerateOutput>
}

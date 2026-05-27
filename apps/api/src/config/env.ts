import { z } from 'zod'
import { config } from 'dotenv'
import path from 'path'
import url from 'url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

// Carrega o .env da raiz do projeto (onde o setup salva) e faz fallback para o local
config({ path: path.resolve(__dirname, '../../../../../.env') })
config()

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3333),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  VAULT_MASTER_KEY: z.string().length(64),

  EVOLUTION_SERVER_URL: z.string().url().optional(),
  EVOLUTION_API_KEY: z.string().optional(),
  EVOLUTION_WEBHOOK_URL: z.string().optional(),
  EVOLUTION_WEBHOOK_SECRET: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  GOOGLE_AUTH_REDIRECT_URI: z.string().optional(),
  WEB_URL: z.string().optional(),

  GEMINI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_SITE_URL: z.string().optional(),

  STORAGE_PATH: z.string().default('./storage'),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data

// Flag de setup agora vem do DB (checada em runtime). server.ts faz a checagem
// no boot e passa o resultado pra buildApp. Veja lib/setup-status.ts.


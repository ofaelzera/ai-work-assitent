import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { exec } from 'node:child_process'
import path from 'node:path'
import util from 'node:util'
import url from 'node:url'
import * as argon2 from 'argon2'
import { prisma } from '../../lib/prisma.js'
import { markSetupCompleted } from '../../lib/setup-status.js'

const execPromise = util.promisify(exec)
const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

// Roda `prisma migrate deploy` tentando várias formas (PM2 às vezes não tem
// pnpm no PATH). cwd = apps/api pra achar prisma/schema.prisma.
async function runMigrations(): Promise<{ ok: true } | { ok: false; error: string }> {
  // dist/modules/setup → apps/api
  const apiDir = path.resolve(__dirname, '../../..')
  const env = { ...process.env, PATH: process.env.PATH ?? '' }
  const attempts = [
    'npx --yes prisma migrate deploy',
    'pnpm exec prisma migrate deploy',
    'node ./node_modules/prisma/build/index.js migrate deploy',
    'pnpm --filter api prisma migrate deploy',
  ]
  let lastError = ''
  for (const cmd of attempts) {
    try {
      await execPromise(cmd, { cwd: apiDir, env, timeout: 120_000 })
      return { ok: true }
    } catch (err: any) {
      lastError = err?.stderr || err?.message || String(err)
    }
  }
  return { ok: false, error: lastError }
}

export async function setupRoutes(app: FastifyInstance) {
  app.get('/status', async () => {
    try {
      const admin = await prisma.user.findFirst({
        where: { role: 'ADMIN' },
        select: { id: true },
      })
      return { setup_completed: Boolean(admin) }
    } catch {
      // Tabela não existe ainda = migrations não rodaram = setup pendente
      return { setup_completed: false }
    }
  })

  app.post('/install', async (req, reply) => {
    const bodySchema = z.object({
      adminName: z.string().min(1),
      adminEmail: z.string().email(),
      adminPassword: z.string().min(6),
      systemTitle: z.string().default('AI Work Assistant'),
      companyName: z.string().default('My Company'),
      primaryColor: z.string().default('#6366f1'),
      secondaryColor: z.string().default('#4f46e5'),
    })

    const data = bodySchema.parse(req.body)

    try {
      // 1. Rodar migrations PRIMEIRO (antes de qualquer query Prisma)
      const migrate = await runMigrations()
      if (!migrate.ok) {
        app.log.error({ stderr: migrate.error }, 'migrate deploy falhou')
        return reply.status(500).send({
          success: false,
          error: `Falha ao aplicar migrations: ${migrate.error.slice(0, 500)}. Rode manualmente no servidor: cd apps/api && npx prisma migrate deploy`,
        })
      }

      // 2. Reexecução: se já existe admin, recusa
      const existingAdmin = await prisma.user.findFirst({
        where: { role: 'ADMIN' },
        select: { id: true },
      })
      if (existingAdmin) {
        return reply.status(409).send({
          success: false,
          error: 'Setup já foi executado. Já existe um administrador cadastrado.',
        })
      }

      // 2. Criar workspace default
      const workspace = await prisma.workspace.upsert({
        where: { id: 'default-workspace' },
        update: { name: data.companyName },
        create: { id: 'default-workspace', name: data.companyName },
      })

      // 3. Criar admin
      const passwordHash = await argon2.hash(data.adminPassword, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      })

      await prisma.user.create({
        data: {
          workspaceId: workspace.id,
          name: data.adminName,
          email: data.adminEmail,
          passwordHash,
          role: 'ADMIN',
        },
      })

      // 4. SystemSettings (white-label)
      await prisma.systemSettings.upsert({
        where: { id: 'default' },
        update: {
          systemTitle: data.systemTitle,
          companyName: data.companyName,
          primaryColor: data.primaryColor,
          secondaryColor: data.secondaryColor,
        },
        create: {
          id: 'default',
          systemTitle: data.systemTitle,
          companyName: data.companyName,
          primaryColor: data.primaryColor,
          secondaryColor: data.secondaryColor,
        },
      })

      markSetupCompleted()

      // Agenda restart pra registrar todas as rotas (workers, auth etc.)
      // PM2/docker sobe de novo automaticamente.
      setTimeout(() => process.exit(0), 1500)

      return reply.send({
        success: true,
        message: 'Instalação concluída! O servidor será reiniciado em instantes.',
      })
    } catch (err: any) {
      app.log.error(err)
      return reply.status(500).send({ success: false, error: err.message })
    }
  })
}

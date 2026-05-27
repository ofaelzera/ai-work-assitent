import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { exec } from 'node:child_process'
import util from 'node:util'
import * as argon2 from 'argon2'
import { prisma } from '../../lib/prisma.js'
import { markSetupCompleted } from '../../lib/setup-status.js'

const execPromise = util.promisify(exec)

export async function setupRoutes(app: FastifyInstance) {
  app.get('/status', async () => {
    const admin = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
      select: { id: true },
    })
    return { setup_completed: Boolean(admin) }
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

    // Bloqueia reexecução: se já existe admin, recusa
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

    try {
      // 1. Garantir migrations aplicadas (no-op se já estiverem)
      try {
        await execPromise('pnpm --filter api prisma migrate deploy')
      } catch (err: any) {
        app.log.warn({ err: err?.message }, 'migrate deploy falhou — seguindo (pode já estar aplicado)')
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

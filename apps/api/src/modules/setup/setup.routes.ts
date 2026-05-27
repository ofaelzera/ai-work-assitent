import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import * as argon2 from 'argon2'
import { prisma } from '../../lib/prisma.js'
import { markSetupCompleted } from '../../lib/setup-status.js'

/**
 * Detecta se as tabelas do schema já existem fazendo uma query barata.
 * Retorna false quando o erro for "table doesn't exist" (P2021).
 */
async function areTablesReady(): Promise<boolean> {
  try {
    await prisma.user.findFirst({ select: { id: true } })
    return true
  } catch (err: any) {
    if (err?.code === 'P2021') return false
    // Outros erros: assume que tabelas existem e deixa a query principal explodir
    return true
  }
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
      // 1. Garantir que as tabelas existem (migrations precisam ter sido aplicadas
      //    fora do setup — é parte do deploy).
      const ready = await areTablesReady()
      if (!ready) {
        return reply.status(412).send({
          success: false,
          error: 'As tabelas do banco ainda não foram criadas. Rode as migrations no servidor antes de continuar:\n\n  cd apps/api && npx prisma migrate deploy',
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

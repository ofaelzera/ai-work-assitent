import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { exec } from 'node:child_process'
import util from 'node:util'
import * as argon2 from 'argon2'

const execPromise = util.promisify(exec)

export async function setupRoutes(app: FastifyInstance) {
  app.post('/test-db', async (req, reply) => {
    const bodySchema = z.object({
      databaseUrl: z.string().url(),
    })
    const { databaseUrl } = bodySchema.parse(req.body)

    const tempPrisma = new PrismaClient({
      datasourceUrl: databaseUrl,
    })

    try {
      await tempPrisma.$connect()
      await tempPrisma.$queryRaw`SELECT 1`
      await tempPrisma.$disconnect()
      return reply.send({ success: true })
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message })
    }
  })

  app.post('/install', async (req, reply) => {
    const bodySchema = z.object({
      databaseUrl: z.string().url(),
      adminName: z.string(),
      adminEmail: z.string().email(),
      adminPassword: z.string().min(6),
      systemTitle: z.string().default('AI Work Assistant'),
      companyName: z.string().default('My Company'),
      primaryColor: z.string().default('#6366f1'),
      secondaryColor: z.string().default('#4f46e5'),
    })

    const data = bodySchema.parse(req.body)

    // 1. Gerar Segredos
    const jwtAccess = crypto.randomBytes(32).toString('hex')
    const jwtRefresh = crypto.randomBytes(32).toString('hex')
    const vaultKey = crypto.randomBytes(32).toString('hex') // 64 chars

    // 2. Escrever no .env raiz
    const envPath = path.resolve(process.cwd(), '../../.env')
    let envContent = ''
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf-8')
    }
    
    const setEnv = (key: string, value: string) => {
      const regex = new RegExp(`^${key}=.*`, 'm')
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}="${value}"`)
      } else {
        envContent += `\n${key}="${value}"`
      }
    }

    setEnv('DATABASE_URL', data.databaseUrl)
    setEnv('JWT_ACCESS_SECRET', jwtAccess)
    setEnv('JWT_REFRESH_SECRET', jwtRefresh)
    setEnv('VAULT_MASTER_KEY', vaultKey)

    // Redis assume-se redis://localhost:6379 ou redis://redis:6379 dependendo do docker
    // Se não tiver REDIS_URL, vamos por um padrão local
    if (!envContent.includes('REDIS_URL=')) {
      setEnv('REDIS_URL', 'redis://localhost:6379')
    }

    fs.writeFileSync(envPath, envContent.trim() + '\n')

    try {
      // 3. Rodar Migrations
      await execPromise('pnpm --filter api prisma migrate deploy')

      // 4. Instanciar Prisma e popular banco
      const prisma = new PrismaClient({ datasourceUrl: data.databaseUrl })
      await prisma.$connect()

      // Criar workspace default
      const workspace = await prisma.workspace.create({
        data: { name: 'Default Workspace' }
      })

      // Criar admin
      const passwordHash = await argon2.hash(data.adminPassword, {
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
        }
      })

      // Criar SystemSettings
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
        }
      })

      await prisma.$disconnect()

      return reply.send({ success: true, message: 'Instalação concluída! O servidor será reiniciado em breve para aplicar as variáveis de ambiente.' })
    } catch (err: any) {
      app.log.error(err)
      return reply.status(500).send({ success: false, error: err.message })
    }
  })
}

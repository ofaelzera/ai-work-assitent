import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'

export async function systemSettingsRoutes(app: FastifyInstance) {
  // Rota pública para injetar css vars e logo no front
  app.get('/public', async (req, reply) => {
    try {
      const settings = await prisma.systemSettings.findUnique({
        where: { id: 'default' },
        select: {
          systemTitle: true,
          companyName: true,
          logoUrl: true,
          logoDarkUrl: true,
          faviconUrl: true,
          primaryColor: true,
          secondaryColor: true,
        },
      })

      if (!settings) {
        return reply.send({
          systemTitle: 'AI Work Assistant',
          companyName: 'My Company',
          primaryColor: '#6366f1',
          secondaryColor: '#4f46e5',
        })
      }

      return reply.send(settings)
    } catch {
      return reply.send({
        systemTitle: 'AI Work Assistant',
        companyName: 'My Company',
        primaryColor: '#6366f1',
        secondaryColor: '#4f46e5',
      })
    }
  })

  // Rota privada (Admin) para atualizar config
  app.put('/', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    if (req.user.role !== 'ADMIN') return reply.unauthorized('Apenas admins')

    const bodySchema = z.object({
      systemTitle: z.string().optional(),
      companyName: z.string().optional(),
      logoUrl: z.string().nullable().optional(),
      logoDarkUrl: z.string().nullable().optional(),
      faviconUrl: z.string().nullable().optional(),
      primaryColor: z.string().optional(),
      secondaryColor: z.string().optional(),
      institutionalTexts: z.any().optional(),
      contactInfo: z.any().optional(),
      externalLinks: z.any().optional(),
      domainUrl: z.string().nullable().optional(),
    })

    const data = bodySchema.parse(req.body)

    const updated = await prisma.systemSettings.upsert({
      where: { id: 'default' },
      update: data,
      create: { id: 'default', ...data },
    })

    return reply.send(updated)
  })
}

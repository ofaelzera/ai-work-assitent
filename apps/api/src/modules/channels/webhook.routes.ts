import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { handleEvolutionEvent, ingestQueue } from './evolution.handler.js'

// Re-exporta a fila para compatibilidade com importações existentes
export { ingestQueue }

export const webhookRoutes: FastifyPluginAsyncZod = async (app) => {
  // Evolution API envia todos os eventos neste endpoint (produção / tunelamento)
  app.post('/webhooks/whatsapp', async (req, reply) => {
    // Processa de forma assíncrona — responde 200 imediatamente
    handleEvolutionEvent(req.body).catch((err) =>
      app.log.error({ err }, 'Erro ao processar evento Evolution (webhook)'),
    )
    return reply.code(200).send({ ok: true })
  })
}

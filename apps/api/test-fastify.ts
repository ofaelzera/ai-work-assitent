import Fastify from 'fastify'
import fastifySensible from '@fastify/sensible'

async function main() {
  const app = Fastify()
  await app.register(fastifySensible)

  app.decorate('authenticate', async (req, reply) => {
    try {
      throw new Error('Some JWT Error')
    } catch {
      reply.unauthorized('Token inválido ou expirado')
    }
  })

  app.get('/test', { onRequest: [app.authenticate as any] }, async () => {
    return { ok: true }
  })

  const res = await app.inject({
    method: 'GET',
    url: '/test'
  })

  console.log('Status code:', res.statusCode)
  console.log('Body:', res.body)
}

main()

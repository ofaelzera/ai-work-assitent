import { buildApp } from './app.js'
import { env } from './config/env.js'
import { prisma } from './lib/prisma.js'
import { redis } from './lib/redis.js'
import { startWorkers } from './workers/index.js'

async function main() {
  const app = await buildApp()

  try {
    await redis.connect()
    startWorkers()
    await app.listen({ port: env.PORT, host: env.HOST })
    console.log(`🚀 API rodando em http://${env.HOST}:${env.PORT}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }

  const graceful = async () => {
    await app.close()
    await prisma.$disconnect()
    await redis.quit()
    process.exit(0)
  }

  process.on('SIGTERM', graceful)
  process.on('SIGINT', graceful)
}

main()

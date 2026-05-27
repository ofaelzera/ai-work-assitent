import { Redis } from 'ioredis'
import { env } from '../config/env.js'

export const redis = new Redis(env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
  lazyConnect: true,
})

redis.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message)
})

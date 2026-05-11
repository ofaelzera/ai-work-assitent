import pino from 'pino'
import { env } from '../config/env.js'

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: ['*.password', '*.passwordHash', '*.token', '*.authorization', '*.apiKey'],
  ...(env.NODE_ENV !== 'production' && {
    transport: { target: 'pino-pretty', options: { colorize: true } },
  }),
})

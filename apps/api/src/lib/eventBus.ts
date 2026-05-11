import { EventEmitter } from 'node:events'
import { prisma } from './prisma.js'
import type { SSEEvent } from '@aiwa/shared'

class EventBus extends EventEmitter {
  async emitAndPersist(
    workspaceId: string,
    type: string,
    payload: unknown,
  ): Promise<void> {
    this.emit(type, { workspaceId, type, payload })
    this.emit('*', { workspaceId, type, payload } as SSEEvent)
    await prisma.eventLog.create({ data: { workspaceId, type, payload: payload as object } })
  }
}

export const eventBus = new EventBus()
eventBus.setMaxListeners(50)

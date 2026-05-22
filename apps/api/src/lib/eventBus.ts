import { EventEmitter } from 'node:events'
import { prisma } from './prisma.js'
import type { SSEEvent } from '@aiwa/shared'

export interface AuditOptions {
  actorUserId?: string | null
  targetType?: string | null
  targetId?: string | null
  payload?: Record<string, unknown>
}

class EventBus extends EventEmitter {
  /**
   * Legacy: emite SSE e persiste EventLog sem actor/target.
   * Prefira `audit()` pra novos call sites.
   */
  async emitAndPersist(
    workspaceId: string,
    type: string,
    payload: unknown,
  ): Promise<void> {
    this.emit(type, { workspaceId, type, payload })
    this.emit('*', { workspaceId, type, payload } as SSEEvent)
    await prisma.eventLog.create({ data: { workspaceId, type, payload: payload as object } })
  }

  /**
   * Emite SSE + persiste EventLog com actor (quem fez) e target (no que).
   * Use pra ações de usuário: claim, status_changed, card.created, etc.
   */
  async audit(
    workspaceId: string,
    type: string,
    opts: AuditOptions = {},
  ): Promise<void> {
    const payload = {
      ...(opts.payload ?? {}),
      ...(opts.actorUserId && { actorUserId: opts.actorUserId }),
      ...(opts.targetType && { targetType: opts.targetType, targetId: opts.targetId }),
    }
    this.emit(type, { workspaceId, type, payload })
    this.emit('*', { workspaceId, type, payload } as SSEEvent)
    await prisma.eventLog.create({
      data: {
        workspaceId,
        type,
        actorUserId: opts.actorUserId ?? null,
        targetType: opts.targetType ?? null,
        targetId: opts.targetId ?? null,
        payload: (opts.payload ?? {}) as object,
      },
    })
  }
}

export const eventBus = new EventBus()
eventBus.setMaxListeners(50)

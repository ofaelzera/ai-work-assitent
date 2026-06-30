import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { prisma } from '../../lib/prisma.js'
import { env } from '../../config/env.js'

const ALLOWED_MIME = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm'])
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB

export function isAllowedSoundMime(mime: string): boolean {
  return ALLOWED_MIME.has(mime)
}

export async function listSounds(workspaceId: string) {
  return prisma.notificationSound.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, label: true, category: true, mimeType: true, createdAt: true },
  })
}

export async function createSound(params: {
  workspaceId: string
  userId: string
  label: string
  category: string | null
  mimeType: string
  buffer: Buffer
  originalName: string
}) {
  if (params.buffer.length > MAX_BYTES) {
    throw new Error('Arquivo de som muito grande (máx 5 MB)')
  }
  const safeName = params.originalName.replace(/[^\w.\-]/g, '_')
  const storageKey = path.join(params.workspaceId, 'notification-sounds', `${randomUUID()}-${safeName}`)
  const fullPath = path.join(env.STORAGE_PATH, storageKey)
  await fs.mkdir(path.dirname(fullPath), { recursive: true })
  await fs.writeFile(fullPath, params.buffer)

  return prisma.notificationSound.create({
    data: {
      workspaceId: params.workspaceId,
      label: params.label,
      category: params.category,
      storageKey,
      mimeType: params.mimeType,
      createdById: params.userId,
    },
    select: { id: true, label: true, category: true, mimeType: true, createdAt: true },
  })
}

export async function getSoundFile(workspaceId: string, id: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const sound = await prisma.notificationSound.findFirst({
    where: { id, workspaceId },
    select: { storageKey: true, mimeType: true },
  })
  if (!sound) return null
  const fullPath = path.join(env.STORAGE_PATH, sound.storageKey)
  try {
    const buffer = await fs.readFile(fullPath)
    return { buffer, mimeType: sound.mimeType }
  } catch {
    return null
  }
}

export async function deleteSound(workspaceId: string, id: string): Promise<boolean> {
  const sound = await prisma.notificationSound.findFirst({
    where: { id, workspaceId },
    select: { id: true, storageKey: true },
  })
  if (!sound) return false
  // Solta referências antes de remover (FK não existe no banco, mas mantém consistência lógica).
  await prisma.notificationTriggerRule.updateMany({ where: { workspaceId, soundId: id }, data: { soundId: null } })
  await prisma.notification.updateMany({ where: { workspaceId, soundId: id }, data: { soundId: null } })
  await prisma.notificationSound.delete({ where: { id: sound.id } })
  try {
    await fs.unlink(path.join(env.STORAGE_PATH, sound.storageKey))
  } catch {
    /* arquivo já ausente — ignora */
  }
  return true
}

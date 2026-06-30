import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { env } from '../../config/env.js'
import { prisma } from '../../lib/prisma.js'
import { logger } from '../../lib/logger.js'

/**
 * Origens aceitas de anexo na API:
 *   - url:    baixa o arquivo de uma URL pública
 *   - base64: decodifica o conteúdo embutido
 *   - buffer: arquivo já recebido via multipart/form-data
 * Todas são normalizadas: o binário é gravado no storage local e vira um
 * registro `CommAttachment`. Os workers nunca trabalham com Base64/upload cru —
 * só com `storageKey` já persistido.
 */
export type AttachmentInput =
  | { tipo: 'url'; nome?: string; arquivo: string; mime_type?: string }
  | { tipo: 'base64'; nome: string; arquivo: string; mime_type?: string }
  | { tipo: 'buffer'; nome: string; buffer: Buffer; mime_type?: string }

export interface StoredAttachment {
  filename: string
  mimeType: string
  sizeBytes: number
  storageKey: string
}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024 // 25 MB por anexo

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'arquivo'
}

/** Grava um buffer no storage local e devolve os metadados normalizados. */
async function persist(workspaceId: string, filename: string, mimeType: string, buffer: Buffer): Promise<StoredAttachment> {
  if (buffer.byteLength === 0) {
    throw new Error(`Anexo "${filename}" está vazio`)
  }
  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Anexo "${filename}" excede o limite de 25 MB`)
  }
  const safeName = sanitizeName(filename)
  const storageDir = path.join(env.STORAGE_PATH, workspaceId, 'comms')
  await fs.mkdir(storageDir, { recursive: true })
  const storageKey = path.join(workspaceId, 'comms', `${randomUUID()}-${safeName}`)
  await fs.writeFile(path.join(env.STORAGE_PATH, storageKey), buffer)
  return { filename: safeName, mimeType, sizeBytes: buffer.byteLength, storageKey }
}

/** Normaliza uma única entrada de anexo para arquivo no storage. */
export async function normalizeAttachment(workspaceId: string, input: AttachmentInput): Promise<StoredAttachment> {
  if (input.tipo === 'url') {
    const res = await fetch(input.arquivo)
    if (!res.ok) throw new Error(`Falha ao baixar anexo (${res.status}): ${input.arquivo}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    const mimeType = input.mime_type ?? res.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream'
    const filename = input.nome ?? input.arquivo.split('/').pop()?.split('?')[0] ?? 'arquivo'
    return persist(workspaceId, filename, mimeType, buffer)
  }
  if (input.tipo === 'base64') {
    const buffer = Buffer.from(input.arquivo, 'base64')
    return persist(workspaceId, input.nome, input.mime_type ?? 'application/octet-stream', buffer)
  }
  // buffer (multipart)
  return persist(workspaceId, input.nome, input.mime_type ?? 'application/octet-stream', input.buffer)
}

/**
 * Normaliza uma lista de anexos e cria os registros `CommAttachment`
 * vinculados a uma campanha ou a uma mensagem da fila.
 */
export async function storeAttachments(
  workspaceId: string,
  inputs: AttachmentInput[],
  link: { campaignId?: string; commMessageId?: string },
): Promise<StoredAttachment[]> {
  const stored: StoredAttachment[] = []
  for (const input of inputs) {
    const s = await normalizeAttachment(workspaceId, input)
    await prisma.commAttachment.create({
      data: {
        workspaceId,
        campaignId: link.campaignId ?? null,
        commMessageId: link.commMessageId ?? null,
        filename: s.filename,
        mimeType: s.mimeType,
        sizeBytes: s.sizeBytes,
        storageKey: s.storageKey,
      },
    })
    stored.push(s)
  }
  return stored
}

/** Caminho absoluto de um anexo já armazenado (para os workers lerem). */
export function attachmentAbsolutePath(storageKey: string): string {
  return path.join(env.STORAGE_PATH, storageKey)
}

/** Lê o conteúdo de um anexo do storage. */
export async function readAttachment(storageKey: string): Promise<Buffer> {
  return fs.readFile(attachmentAbsolutePath(storageKey))
}

/** Remove o arquivo físico de um anexo (best-effort). */
export async function deleteAttachmentFile(storageKey: string): Promise<void> {
  try {
    await fs.unlink(attachmentAbsolutePath(storageKey))
  } catch (err: any) {
    logger.warn({ err: err?.message, storageKey }, 'Falha ao remover anexo do storage (ignorado)')
  }
}

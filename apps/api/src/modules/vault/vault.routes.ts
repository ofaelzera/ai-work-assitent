import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { eventBus } from '../../lib/eventBus.js'
import { encrypt, decrypt } from '../../lib/crypto.js'
import { Prisma } from '@prisma/client'

const vaultTypeEnum = z.enum(['password', 'ssh', 'ftp', 'db', 'api', 'note', 'file'])

export const vaultRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── Folders ───────────────────────────────────────────────────────────────

  // GET /vault/folders
  app.get(
    '/vault/folders',
    { onRequest: [app.authenticate] },
    async (req) => {
      const { workspaceId, sub: ownerId } = req.user

      return prisma.vaultFolder.findMany({
        where: { workspaceId, ownerId },
        orderBy: { createdAt: 'asc' },
      })
    },
  )

  // POST /vault/folders
  app.post(
    '/vault/folders',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          name: z.string().min(1),
          parentId: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId, sub: ownerId } = req.user
      const { name, parentId } = req.body

      const folder = await prisma.vaultFolder.create({
        data: {
          workspaceId,
          ownerId,
          name,
          ...(parentId && { parentId }),
        },
      })

      return reply.code(201).send(folder)
    },
  )

  // DELETE /vault/folders/:id
  app.delete(
    '/vault/folders/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId, sub: ownerId } = req.user

      const result = await prisma.vaultFolder.deleteMany({
        where: { id: req.params.id, workspaceId, ownerId },
      })

      if (!result.count) return reply.notFound()

      return reply.code(204).send()
    },
  )

  // ── Items ─────────────────────────────────────────────────────────────────

  // GET /vault/items?folderId=&type=&q=
  app.get(
    '/vault/items',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          folderId: z.string().optional(),
          type: vaultTypeEnum.optional(),
          q: z.string().optional(),
        }),
      },
    },
    async (req) => {
      const { workspaceId, sub: ownerId } = req.user
      const { folderId, type, q } = req.query

      const items = await prisma.vaultItem.findMany({
        where: {
          workspaceId,
          ownerId,
          deletedAt: null,
          ...(folderId !== undefined && { folderId }),
          ...(type !== undefined && { type }),
          ...(q && { title: { contains: q } }),
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          type: true,
          title: true,
          folderId: true,
          tags: true,
          favorite: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      // Return secret as null in list view for performance
      return items.map((item) => ({ ...item, secret: null }))
    },
  )

  // POST /vault/items
  app.post(
    '/vault/items',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          type: vaultTypeEnum,
          title: z.string().min(1),
          secret: z.string().min(1),
          metadata: z.record(z.unknown()).optional(),
          folderId: z.string().optional(),
          tags: z.array(z.string()).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId, sub: ownerId } = req.user
      const { type, title, secret, metadata, folderId, tags } = req.body

      const { ciphertext, iv, authTag } = encrypt(secret)

      const item = await prisma.vaultItem.create({
        data: {
          workspaceId,
          ownerId,
          type,
          title,
          ciphertext,
          iv,
          authTag,
          ...(metadata && { metadata: metadata as Prisma.InputJsonValue }),
          ...(folderId && { folderId }),
          ...(tags && { tags }),
        },
        select: {
          id: true,
          type: true,
          title: true,
          folderId: true,
          tags: true,
          favorite: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      return reply.code(201).send({ ...item, secret: null })
    },
  )

  // GET /vault/items/:id — full item with decrypted secret
  app.get(
    '/vault/items/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId, sub: ownerId } = req.user

      const item = await prisma.vaultItem.findFirst({
        where: { id: req.params.id, workspaceId, ownerId, deletedAt: null },
      })

      if (!item) return reply.notFound()

      const secret = decrypt(
        item.ciphertext as Buffer,
        item.iv as Buffer,
        item.authTag as Buffer,
      )

      // Log vault access (without the secret)
      await eventBus.emitAndPersist(workspaceId, 'vault.accessed', {
        itemId: item.id,
        userId: ownerId,
      })

      return {
        id: item.id,
        type: item.type,
        title: item.title,
        folderId: item.folderId,
        tags: item.tags,
        favorite: item.favorite,
        metadata: item.metadata,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        secret,
      }
    },
  )

  // PATCH /vault/items/:id
  app.patch(
    '/vault/items/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          title: z.string().min(1).optional(),
          type: vaultTypeEnum.optional(),
          secret: z.string().min(1).optional(),
          metadata: z.record(z.unknown()).nullable().optional(),
          folderId: z.string().nullable().optional(),
          tags: z.array(z.string()).nullable().optional(),
          favorite: z.boolean().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId, sub: ownerId } = req.user
      const { title, type, secret, metadata, folderId, tags, favorite } = req.body

      // Verify ownership first
      const existing = await prisma.vaultItem.findFirst({
        where: { id: req.params.id, workspaceId, ownerId, deletedAt: null },
        select: { id: true },
      })

      if (!existing) return reply.notFound()

      let encryptedFields: { ciphertext: Buffer; iv: Buffer; authTag: Buffer } | undefined
      if (secret !== undefined) {
        encryptedFields = encrypt(secret)
      }

      await prisma.vaultItem.update({
        where: { id: req.params.id },
        data: {
          ...(title !== undefined && { title }),
          ...(type !== undefined && { type }),
          ...(encryptedFields && {
            ciphertext: encryptedFields.ciphertext,
            iv: encryptedFields.iv,
            authTag: encryptedFields.authTag,
          }),
          ...(metadata !== undefined && {
            metadata: metadata != null ? (metadata as Prisma.InputJsonValue) : Prisma.DbNull,
          }),
          ...(folderId !== undefined && { folderId: folderId ?? null }),
          ...(tags !== undefined && {
            tags: tags != null ? (tags as Prisma.InputJsonValue) : Prisma.DbNull,
          }),
          ...(favorite !== undefined && { favorite }),
        },
      })

      return { ok: true }
    },
  )

  // DELETE /vault/items/:id — soft delete
  app.delete(
    '/vault/items/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId, sub: ownerId } = req.user

      const result = await prisma.vaultItem.updateMany({
        where: { id: req.params.id, workspaceId, ownerId, deletedAt: null },
        data: { deletedAt: new Date() },
      })

      if (!result.count) return reply.notFound()

      return reply.code(204).send()
    },
  )
}

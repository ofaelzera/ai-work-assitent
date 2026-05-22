import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { env } from '../../config/env.js'
import { logger } from '../../lib/logger.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { evolutionClient } from '../channels/evolution.client.js'
import { getChannelConfig } from '../channels/channels.service.js'
import type { MediaAttachment } from '../channels/media.utils.js'
import { hasPermission } from '../../lib/acl.js'
import type { JwtPayload } from '@aiwa/shared'

/**
 * "Posso mexer/deletar/compartilhar uma pasta/arquivo de outro?"
 * Dono passa sempre. Quem tem `storage.delete` (admin/supervisor) também.
 */
async function canManageOthers(user: JwtPayload, ownerId: string): Promise<boolean> {
  if (user.sub === ownerId) return true
  return hasPermission(user, 'storage.delete')
}

/**
 * Biblioteca de arquivos (estilo Drive):
 *   • Pastas privadas (só dono vê) ou públicas (todos do workspace)
 *   • Hierarquia: pasta → subpasta → arquivos
 *   • Visibilidade herdada pela pasta-raiz (subpasta segue a raiz)
 *   • Arquivos podem viver soltos (folderId=null, visibilidade própria) ou em pasta
 */
export const storageRoutes: FastifyPluginAsyncZod = async (app) => {
  // Helper: pasta acessível pelo usuário?
  // Regras: PUBLIC = todos; PRIVATE = só dono; SHARED = dono + usuários em StorageFolderShare.
  //
  // Herança: se a pasta-pai (ou qualquer ancestral) já é acessível, a filha também é.
  // Ou seja, basta dar acesso à pasta-raiz pra liberar todo o conteúdo dela em cascata.
  // Se o user quiser restringir um item específico, pode dar visibilidade PRIVATE a ele
  // — mas pra checagens de listagem usamos a herança (queremos abrir o conteúdo).
  async function canAccessFolder(folderId: string, userId: string, workspaceId: string): Promise<boolean> {
    let cursor: string | null = folderId
    const seen = new Set<string>()
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      const folder: { ownerId: string; visibility: 'PRIVATE' | 'SHARED' | 'PUBLIC'; parentId: string | null } | null =
        await prisma.storageFolder.findFirst({
          where: { id: cursor, workspaceId },
          select: { ownerId: true, visibility: true, parentId: true },
        })
      if (!folder) return false
      if (folder.visibility === 'PUBLIC') return true
      if (folder.ownerId === userId) return true
      if (folder.visibility === 'SHARED') {
        const share = await prisma.storageFolderShare.findUnique({
          where: { folderId_userId: { folderId: cursor, userId } },
        })
        if (share) return true
      }
      // Não passou aqui — tenta o pai
      cursor = folder.parentId
    }
    return false
  }

  /**
   * Conjunto de IDs de pastas "visíveis" para o user (devem aparecer em listagens):
   *  - tem acesso direto/herdado (PUBLIC, dono, SHARED), OU
   *  - é ANCESTRAL de algo acessível (subpasta ou arquivo compartilhado individualmente)
   *
   * Isso permite o caso "arquivo X dentro de pasta A (não compartilhada) é compartilhado
   * com o user" → user enxerga A na raiz, navega pra dentro e vê SÓ o arquivo X (não os outros).
   */
  async function getVisibleFolderIds(userId: string, workspaceId: string): Promise<Set<string>> {
    // 1) Pastas diretamente acessíveis
    const directlyAccessible = await prisma.storageFolder.findMany({
      where: {
        workspaceId,
        OR: [
          { visibility: 'PUBLIC' },
          { ownerId: userId },
          { visibility: 'SHARED', shares: { some: { userId } } },
        ],
      },
      select: { id: true },
    })
    const visible = new Set<string>(directlyAccessible.map(f => f.id))

    // 2) Pais de arquivos individualmente acessíveis (compartilhados com o user)
    const accessibleFiles = await prisma.attachment.findMany({
      where: {
        workspaceId,
        folderId: { not: null },
        OR: [
          { visibility: 'PUBLIC' },
          { uploadedBy: userId },
          { visibility: 'SHARED', shares: { some: { userId } } },
        ],
      },
      select: { folderId: true },
    })

    // 3) Mapa parentId pra subir a árvore eficientemente
    const allFolders = await prisma.storageFolder.findMany({
      where: { workspaceId },
      select: { id: true, parentId: true },
    })
    const parentMap = new Map<string, string | null>(allFolders.map(f => [f.id, f.parentId]))

    // Marca todos os ancestrais de uma pasta como visíveis
    const markAncestors = (startId: string | null) => {
      let cursor = startId
      while (cursor && parentMap.has(cursor)) {
        visible.add(cursor)
        cursor = parentMap.get(cursor) ?? null
      }
    }

    // Sobe ancestrais dos arquivos acessíveis (pra exibir o caminho até eles)
    for (const f of accessibleFiles) markAncestors(f.folderId)

    // Sobe ancestrais das pastas diretamente acessíveis (pra exibir o caminho)
    for (const id of [...visible]) markAncestors(parentMap.get(id) ?? null)

    return visible
  }

  // ── GET /storage/folders ─────────────────────────────────────────────────
  // Lista subpastas de um pai (null = raiz). Filtra por visibilidade.
  app.get(
    '/storage/folders',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          parentId: z.string().optional(),
        }),
      },
    },
    async (req) => {
      const { workspaceId, sub: userId } = req.user
      const { parentId } = req.query

      // storage.viewAll: vê pastas privadas de outros (bypass total)
      const canViewAll = await hasPermission(req.user, 'storage.viewAll')

      // Quem tem acesso direto/herdado à pasta-pai vê TUDO dentro dela (cascata).
      // Senão, mostra só as pastas "visíveis" (acessíveis OU ancestrais de algo acessível).
      const hasFullParentAccess = !parentId
        ? false  // raiz nunca tem "acesso total" — sempre filtra
        : await canAccessFolder(parentId, userId, workspaceId)

      let visibleSet: Set<string> | null = null
      if (!canViewAll && !hasFullParentAccess) {
        // Se pediu subpasta e nem visibleSet pode justificar, retorna vazio
        visibleSet = await getVisibleFolderIds(userId, workspaceId)
        if (parentId && !visibleSet.has(parentId)) return []
      }

      const folders = await prisma.storageFolder.findMany({
        where: {
          workspaceId,
          parentId: parentId ?? null,
          ...(visibleSet && { id: { in: [...visibleSet] } }),
        },
        orderBy: [{ visibility: 'asc' }, { name: 'asc' }],
        select: {
          id: true, name: true, visibility: true, parentId: true, ownerId: true,
          createdAt: true, updatedAt: true,
          _count: { select: { files: true, children: true, shares: true } },
        },
      })
      return folders
    },
  )

  // ── GET /storage/folders/:id/shares ──────────────────────────────────────
  // Lista usuários com acesso explícito à pasta (válido só pra SHARED)
  app.get(
    '/storage/folders/:id/shares',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const folder = await prisma.storageFolder.findFirst({
        where: { id: req.params.id, workspaceId },
        select: { ownerId: true },
      })
      if (!folder) return reply.notFound()
      if (!(await canManageOthers(req.user, folder.ownerId))) return reply.forbidden('Só o dono ou quem tem storage.delete')

      const shares = await prisma.storageFolderShare.findMany({
        where: { folderId: req.params.id },
        orderBy: { createdAt: 'asc' },
      })
      // Enriquecer com dados dos usuários
      const userIds = shares.map(s => s.userId)
      const users = userIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true },
          })
        : []
      const usersMap = new Map(users.map(u => [u.id, u]))
      return shares.map(s => ({
        id: s.id,
        userId: s.userId,
        user: usersMap.get(s.userId) ?? null,
        createdAt: s.createdAt,
      }))
    },
  )

  // ── POST /storage/folders/:id/shares ─────────────────────────────────────
  app.post(
    '/storage/folders/:id/shares',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ userId: z.string() }),
      },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const folder = await prisma.storageFolder.findFirst({
        where: { id: req.params.id, workspaceId },
        select: { ownerId: true, visibility: true },
      })
      if (!folder) return reply.notFound()
      if (!(await canManageOthers(req.user, folder.ownerId))) return reply.forbidden('Só o dono ou quem tem storage.delete')

      // Não compartilha consigo mesmo
      if (req.body.userId === folder.ownerId) {
        return reply.badRequest('Dono da pasta já tem acesso')
      }

      // Confere que o usuário pertence ao workspace
      const target = await prisma.user.findFirst({
        where: { id: req.body.userId, workspaceId },
        select: { id: true },
      })
      if (!target) return reply.notFound('Usuário não encontrado neste workspace')

      // Cria share (idempotente via unique)
      const share = await prisma.storageFolderShare.upsert({
        where: { folderId_userId: { folderId: req.params.id, userId: req.body.userId } },
        create: { folderId: req.params.id, userId: req.body.userId },
        update: {},
      })

      // Se a pasta estava PRIVATE, promove pra SHARED automaticamente
      if (folder.visibility === 'PRIVATE') {
        await prisma.storageFolder.update({
          where: { id: req.params.id },
          data: { visibility: 'SHARED' },
        })
      }

      return reply.code(201).send(share)
    },
  )

  // ── DELETE /storage/folders/:id/shares/:userId ───────────────────────────
  app.delete(
    '/storage/folders/:id/shares/:userId',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string(), userId: z.string() }),
      },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const folder = await prisma.storageFolder.findFirst({
        where: { id: req.params.id, workspaceId },
        select: { ownerId: true },
      })
      if (!folder) return reply.notFound()
      if (!(await canManageOthers(req.user, folder.ownerId))) return reply.forbidden('Só o dono ou quem tem storage.delete')

      await prisma.storageFolderShare.deleteMany({
        where: { folderId: req.params.id, userId: req.params.userId },
      })
      return reply.code(204).send()
    },
  )

  // ── POST /storage/folders ────────────────────────────────────────────────
  app.post(
    '/storage/folders',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          name: z.string().min(1).max(120),
          parentId: z.string().nullable().optional(),
          visibility: z.enum(['PRIVATE', 'PUBLIC']).default('PRIVATE'),
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const { name, parentId, visibility } = req.body

      if (parentId && !(await canAccessFolder(parentId, userId, workspaceId))) {
        return reply.forbidden('Sem acesso à pasta pai')
      }

      const folder = await prisma.storageFolder.create({
        data: {
          workspaceId,
          ownerId: userId,
          name: name.trim(),
          visibility,
          parentId: parentId ?? null,
        },
      })
      return reply.code(201).send(folder)
    },
  )

  // ── PATCH /storage/folders/:id ───────────────────────────────────────────
  app.patch(
    '/storage/folders/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().min(1).max(120).optional(),
          visibility: z.enum(['PRIVATE', 'SHARED', 'PUBLIC']).optional(),
          parentId: z.string().nullable().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const folder = await prisma.storageFolder.findFirst({
        where: { id: req.params.id, workspaceId },
      })
      if (!folder) return reply.notFound('Pasta não encontrada')
      if (!(await canManageOthers(req.user, folder.ownerId))) {
        return reply.forbidden('Só o dono ou quem tem storage.delete pode editar')
      }

      // Se mudar parent, valida acesso ao novo pai + previne ciclos
      if (req.body.parentId !== undefined && req.body.parentId !== null) {
        const newParent = req.body.parentId
        if (newParent === folder.id) return reply.badRequest('Pasta não pode ser pai de si mesma')
        if (!(await canAccessFolder(newParent, userId, workspaceId))) {
          return reply.forbidden('Sem acesso à pasta destino')
        }
        // Previne ciclo: subir a árvore do destino e ver se passa pela própria pasta
        let cursor: string | null = newParent
        const seen = new Set<string>()
        while (cursor && !seen.has(cursor)) {
          if (cursor === folder.id) {
            return reply.badRequest('Não é possível mover uma pasta para dentro dela mesma ou de uma subpasta sua')
          }
          seen.add(cursor)
          const p: { parentId: string | null } | null = await prisma.storageFolder.findUnique({
            where: { id: cursor },
            select: { parentId: true },
          })
          cursor = p?.parentId ?? null
        }
      }

      return prisma.storageFolder.update({
        where: { id: folder.id },
        data: {
          ...(req.body.name !== undefined && { name: req.body.name.trim() }),
          ...(req.body.visibility !== undefined && { visibility: req.body.visibility }),
          ...(req.body.parentId !== undefined && { parentId: req.body.parentId ?? null }),
        },
      })
    },
  )

  // ── GET /storage/folders/:id/deletion-impact ─────────────────────────────
  // Conta recursivamente tudo que será apagado se a pasta for removida em cascata.
  app.get(
    '/storage/folders/:id/deletion-impact',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const folder = await prisma.storageFolder.findFirst({
        where: { id: req.params.id, workspaceId },
        select: { id: true, name: true, ownerId: true },
      })
      if (!folder) return reply.notFound()
      if (!(await canManageOthers(req.user, folder.ownerId))) return reply.forbidden('Só o dono ou quem tem storage.delete')

      // Coleta IDs de todas as subpastas recursivamente (BFS)
      const allFolderIds = [folder.id]
      const queue = [folder.id]
      while (queue.length > 0) {
        const parentId = queue.shift()!
        const children = await prisma.storageFolder.findMany({
          where: { parentId, workspaceId },
          select: { id: true },
        })
        for (const c of children) {
          allFolderIds.push(c.id)
          queue.push(c.id)
        }
      }

      const filesAgg = await prisma.attachment.aggregate({
        where: { folderId: { in: allFolderIds }, workspaceId },
        _count: { _all: true },
        _sum: { sizeBytes: true },
      })

      return {
        folderName: folder.name,
        subfolders: allFolderIds.length - 1,  // não conta a própria
        files: filesAgg._count._all,
        totalBytes: filesAgg._sum.sizeBytes ?? 0,
      }
    },
  )

  // ── DELETE /storage/folders/:id ──────────────────────────────────────────
  // Impede se não estiver vazia (a menos que ?cascade=true)
  app.delete(
    '/storage/folders/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        querystring: z.object({ cascade: z.coerce.boolean().optional() }),
      },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const folder = await prisma.storageFolder.findFirst({
        where: { id: req.params.id, workspaceId },
        select: { id: true, ownerId: true, _count: { select: { files: true, children: true } } },
      })
      if (!folder) return reply.notFound()
      if (!(await canManageOthers(req.user, folder.ownerId))) {
        return reply.forbidden('Só o dono ou quem tem storage.delete pode deletar')
      }

      const isEmpty = folder._count.files === 0 && folder._count.children === 0
      if (!isEmpty && !req.query.cascade) {
        return reply.status(409).send({
          error: 'folderNotEmpty',
          message: 'Pasta não está vazia. Passe ?cascade=true para deletar com todo o conteúdo.',
          files: folder._count.files, children: folder._count.children,
        })
      }

      // Cascade: deletar arquivos físicos + registros + subpastas recursivo
      if (req.query.cascade) {
        await deleteRecursive(folder.id, workspaceId)
      }
      await prisma.storageFolder.delete({ where: { id: folder.id } })
      return reply.code(204).send()
    },
  )

  // ── GET /storage/files ───────────────────────────────────────────────────
  // Lista arquivos de uma pasta (ou raiz). Filtra visibilidade.
  app.get(
    '/storage/files',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          folderId: z.string().optional(),
          q: z.string().optional(),  // busca por nome
        }),
      },
    },
    async (req) => {
      const { workspaceId, sub: userId } = req.user
      const { folderId, q } = req.query

      // Regras de visibilidade de arquivos dentro de uma pasta:
      //  1) Tem acesso direto/herdado à pasta? Mostra TODOS os arquivos (cascata).
      //  2) Só "enxerga" a pasta porque um arquivo dentro foi compartilhado individualmente?
      //     → Mostra APENAS os arquivos com acesso individual (PUBLIC, dono, SHARED com user).
      //  3) Nenhum dos dois? → Pasta não é dele, retorna [].
      //
      // storage.viewAll: bypass total (vê tudo).
      const canViewAll = await hasPermission(req.user, 'storage.viewAll')

      const individualFilter = {
        OR: [
          { visibility: 'PUBLIC' as const },
          { uploadedBy: userId },
          { visibility: 'SHARED' as const, shares: { some: { userId } } },
        ],
      }

      let where: any
      if (folderId) {
        const hasFullAccess = canViewAll || await canAccessFolder(folderId, userId, workspaceId)
        if (hasFullAccess) {
          // Caso 1: acesso total — todos os arquivos
          where = {
            workspaceId, cardId: null, vaultItemId: null, folderId,
            ...(q && { filename: { contains: q } }),
          }
        } else {
          // Caso 2 ou 3: precisa que a pasta esteja no visibleSet (algum filho acessível)
          const visibleSet = await getVisibleFolderIds(userId, workspaceId)
          if (!visibleSet.has(folderId)) return []
          // Filtra só arquivos individualmente acessíveis
          where = {
            workspaceId, cardId: null, vaultItemId: null, folderId,
            ...individualFilter,
            ...(q && { filename: { contains: q } }),
          }
        }
      } else {
        // Raiz: respeita visibilidade do próprio arquivo (bypass se storage.viewAll)
        where = {
          workspaceId, cardId: null, vaultItemId: null, folderId: null,
          ...(!canViewAll && individualFilter),
          ...(q && { filename: { contains: q } }),
        }
      }

      const files = await prisma.attachment.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        select: {
          id: true, filename: true, mimeType: true, sizeBytes: true,
          folderId: true, uploadedBy: true, visibility: true, createdAt: true,
          _count: { select: { shares: true } },
        },
      })
      return files
    },
  )

  // ── GET /storage/files/:id/shares ────────────────────────────────────────
  app.get(
    '/storage/files/:id/shares',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const file = await prisma.attachment.findFirst({
        where: { id: req.params.id, workspaceId },
        select: { uploadedBy: true },
      })
      if (!file) return reply.notFound()
      if (!(await canManageOthers(req.user, file.uploadedBy))) return reply.forbidden('Só o dono ou quem tem storage.delete')

      const shares = await prisma.attachmentShare.findMany({
        where: { attachmentId: req.params.id },
        orderBy: { createdAt: 'asc' },
      })
      const userIds = shares.map(s => s.userId)
      const users = userIds.length
        ? await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true },
          })
        : []
      const usersMap = new Map(users.map(u => [u.id, u]))
      return shares.map(s => ({
        id: s.id, userId: s.userId,
        user: usersMap.get(s.userId) ?? null,
        createdAt: s.createdAt,
      }))
    },
  )

  // ── POST /storage/files/:id/shares ───────────────────────────────────────
  app.post(
    '/storage/files/:id/shares',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ userId: z.string() }),
      },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const file = await prisma.attachment.findFirst({
        where: { id: req.params.id, workspaceId },
        select: { uploadedBy: true, visibility: true },
      })
      if (!file) return reply.notFound()
      if (!(await canManageOthers(req.user, file.uploadedBy))) return reply.forbidden('Só o dono ou quem tem storage.delete')

      if (req.body.userId === file.uploadedBy) {
        return reply.badRequest('Dono do arquivo já tem acesso')
      }
      const target = await prisma.user.findFirst({
        where: { id: req.body.userId, workspaceId },
        select: { id: true },
      })
      if (!target) return reply.notFound('Usuário não encontrado neste workspace')

      const share = await prisma.attachmentShare.upsert({
        where: { attachmentId_userId: { attachmentId: req.params.id, userId: req.body.userId } },
        create: { attachmentId: req.params.id, userId: req.body.userId },
        update: {},
      })

      // Auto-promove PRIVATE → SHARED quando recebe o primeiro compartilhamento
      if (file.visibility === 'PRIVATE') {
        await prisma.attachment.update({
          where: { id: req.params.id },
          data: { visibility: 'SHARED' },
        })
      }
      return reply.code(201).send(share)
    },
  )

  // ── DELETE /storage/files/:id/shares/:userId ─────────────────────────────
  app.delete(
    '/storage/files/:id/shares/:userId',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string(), userId: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const file = await prisma.attachment.findFirst({
        where: { id: req.params.id, workspaceId },
        select: { uploadedBy: true },
      })
      if (!file) return reply.notFound()
      if (!(await canManageOthers(req.user, file.uploadedBy))) return reply.forbidden('Só o dono ou quem tem storage.delete')

      await prisma.attachmentShare.deleteMany({
        where: { attachmentId: req.params.id, userId: req.params.userId },
      })
      return reply.code(204).send()
    },
  )

  // ── POST /storage/files (upload) ─────────────────────────────────────────
  app.post(
    '/storage/files',
    { onRequest: [app.authenticate] },
    async (req: any, reply) => {
      const { workspaceId, sub: userId } = req.user
      const data = await req.file()
      if (!data) return reply.badRequest('Arquivo obrigatório')

      const folderId: string | null = data.fields?.folderId?.value ?? null
      const visibilityRaw: string = data.fields?.visibility?.value ?? 'PRIVATE'
      const visibility = visibilityRaw === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE'

      if (folderId && !(await canAccessFolder(folderId, userId, workspaceId))) {
        return reply.forbidden('Sem acesso à pasta destino')
      }

      const chunks: Buffer[] = []
      for await (const chunk of data.file) chunks.push(chunk)
      const buffer = Buffer.concat(chunks)

      if (buffer.length > 64 * 1024 * 1024) {
        return reply.badRequest('Arquivo muito grande (máx 64 MB)')
      }

      const ext = data.mimetype.split('/')[1]?.split(';')[0] ?? 'bin'
      const safeName = (data.filename ?? `file.${ext}`).replace(/[^\w.\-]/g, '_')
      const storageKey = path.join(workspaceId, 'library', `${randomUUID()}-${safeName}`)
      const fullPath = path.join(env.STORAGE_PATH, storageKey)
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, buffer)

      const record = await prisma.attachment.create({
        data: {
          workspaceId,
          uploadedBy: userId,
          filename: data.filename ?? safeName,
          mimeType: data.mimetype,
          sizeBytes: buffer.length,
          storageKey,
          folderId,
          visibility,
        },
      })

      return reply.code(201).send(record)
    },
  )

  // ── PATCH /storage/files/:id (renomear/mover/mudar visibilidade) ─────────
  app.patch(
    '/storage/files/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          filename: z.string().min(1).max(255).optional(),
          folderId: z.string().nullable().optional(),
          visibility: z.enum(['PRIVATE', 'SHARED', 'PUBLIC']).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const file = await prisma.attachment.findFirst({
        where: { id: req.params.id, workspaceId },
      })
      if (!file) return reply.notFound()
      if (!(await canManageOthers(req.user, file.uploadedBy))) {
        return reply.forbidden('Só quem subiu ou quem tem storage.delete pode editar')
      }

      if (req.body.folderId && !(await canAccessFolder(req.body.folderId, userId, workspaceId))) {
        return reply.forbidden('Sem acesso à pasta destino')
      }

      return prisma.attachment.update({
        where: { id: file.id },
        data: {
          ...(req.body.filename !== undefined && { filename: req.body.filename }),
          ...(req.body.folderId !== undefined && { folderId: req.body.folderId ?? null }),
          ...(req.body.visibility !== undefined && { visibility: req.body.visibility }),
        },
      })
    },
  )

  // ── DELETE /storage/files/:id ────────────────────────────────────────────
  app.delete(
    '/storage/files/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const file = await prisma.attachment.findFirst({
        where: { id: req.params.id, workspaceId },
      })
      if (!file) return reply.notFound()
      if (!(await canManageOthers(req.user, file.uploadedBy))) {
        return reply.forbidden('Só quem subiu ou quem tem storage.delete pode deletar')
      }

      // Tenta remover do disco (silencioso se não existir)
      try {
        await fs.unlink(path.join(env.STORAGE_PATH, file.storageKey))
      } catch { /* ignora */ }

      await prisma.attachment.delete({ where: { id: file.id } })
      return reply.code(204).send()
    },
  )

  // ── GET /storage/breadcrumb/:folderId ────────────────────────────────────
  // Caminho até a raiz (pra exibir "Pasta > Subpasta > ...")
  app.get(
    '/storage/breadcrumb/:folderId',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ folderId: z.string() }) },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user

      // Gate: precisa ter acesso direto/herdado OU a pasta estar no conjunto visível
      // (por causa de um arquivo compartilhado dentro dela)
      const canViewAll = await hasPermission(req.user, 'storage.viewAll')
      const hasDirectAccess = await canAccessFolder(req.params.folderId, userId, workspaceId)
      if (!canViewAll && !hasDirectAccess) {
        const visibleSet = await getVisibleFolderIds(userId, workspaceId)
        if (!visibleSet.has(req.params.folderId)) return reply.forbidden()
      }

      // Reconstrói o trail completo. Como a folha está acessível por herança,
      // todos os ancestrais podem ser exibidos como caminho.
      const trail: Array<{ id: string; name: string }> = []
      let currentId: string | null | undefined = req.params.folderId
      const seen = new Set<string>()
      while (currentId && !seen.has(currentId)) {
        const id: string = currentId
        seen.add(id)
        const f: { id: string; name: string; parentId: string | null } | null =
          await prisma.storageFolder.findFirst({
            where: { id, workspaceId },
            select: { id: true, name: true, parentId: true },
          })
        if (!f) break
        trail.unshift({ id: f.id, name: f.name })
        currentId = f.parentId
      }
      return trail
    },
  )

  // ── POST /storage/files/from-message ─────────────────────────────────────
  // Salva o anexo de uma mensagem WhatsApp na biblioteca pessoal do usuário.
  // Baixa o binário da Evolution e cria um novo Attachment (não copia do disco
  // porque mensagens podem ter sido só metadata sem download local).
  app.post(
    '/storage/files/from-message',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          messageId: z.string(),
          folderId: z.string().nullable().optional(),
          visibility: z.enum(['PRIVATE', 'SHARED', 'PUBLIC']).default('PRIVATE'),
          filename: z.string().optional(),  // permite renomear na hora de salvar
        }),
      },
    },
    async (req, reply) => {
      const { workspaceId, sub: userId } = req.user
      const { messageId, folderId, visibility, filename: customFilename } = req.body

      // Valida pasta destino
      if (folderId && !(await canAccessFolder(folderId, userId, workspaceId))) {
        return reply.forbidden('Sem acesso à pasta destino')
      }

      // Busca mensagem + anexo
      const message = await prisma.message.findFirst({
        where: { id: messageId, workspaceId },
        include: { conversation: { include: { channel: true } } },
      })
      if (!message) return reply.notFound('Mensagem não encontrada')

      const atts = message.attachments as MediaAttachment[] | null
      const att = atts?.[0]
      if (!att) return reply.badRequest('Mensagem sem anexo')

      // Baixa da Evolution
      const { instanceName } = await getChannelConfig(message.conversation.channelId)
      let base64: string
      let mimetype: string
      try {
        const result = await evolutionClient.getMediaBase64(instanceName, att.key)
        base64 = result.base64
        mimetype = result.mimetype ?? att.mimetype
      } catch (err: any) {
        const msg = String(err?.message ?? '')
        if (msg.includes('400') || msg.includes('expired') || msg.includes('Failed to fetch')) {
          return reply.status(410).send({ error: 'Mídia expirada no WhatsApp' })
        }
        throw err
      }

      // Salva no disco
      const ext = mimetype.split('/')[1]?.split(';')[0] ?? 'bin'
      const baseFilename = customFilename?.trim() || att.filename || `${att.type}-${Date.now()}.${ext}`
      const safeName = baseFilename.replace(/[^\w.\-]/g, '_')
      const storageKey = path.join(workspaceId, 'library', `${randomUUID()}-${safeName}`)
      const fullPath = path.join(env.STORAGE_PATH, storageKey)
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      const buffer = Buffer.from(base64, 'base64')
      await fs.writeFile(fullPath, buffer)

      const record = await prisma.attachment.create({
        data: {
          workspaceId,
          uploadedBy: userId,
          filename: baseFilename,
          mimeType: mimetype,
          sizeBytes: buffer.length,
          storageKey,
          folderId: folderId ?? null,
          visibility,
        },
      })

      return reply.code(201).send(record)
    },
  )

  // ─────────────────────────────────────────────────────────────────────────
  // Helper recursivo pra deletar pasta com conteúdo
  async function deleteRecursive(folderId: string, workspaceId: string): Promise<void> {
    const children = await prisma.storageFolder.findMany({
      where: { parentId: folderId, workspaceId },
      select: { id: true },
    })
    for (const c of children) await deleteRecursive(c.id, workspaceId)

    const files = await prisma.attachment.findMany({
      where: { folderId, workspaceId },
      select: { id: true, storageKey: true },
    })
    for (const f of files) {
      try { await fs.unlink(path.join(env.STORAGE_PATH, f.storageKey)) } catch { /* ignore */ }
    }
    if (files.length > 0) {
      await prisma.attachment.deleteMany({ where: { id: { in: files.map(f => f.id) } } })
    }
    await prisma.storageFolder.deleteMany({ where: { parentId: folderId, workspaceId } })
    logger.info({ folderId, workspaceId, files: files.length, subfolders: children.length }, 'Cascade delete')
  }
}

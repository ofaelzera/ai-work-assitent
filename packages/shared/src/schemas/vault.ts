import { z } from 'zod'

export const VaultItemTypeEnum = z.enum(['password', 'ssh', 'ftp', 'db', 'api', 'note', 'file'])

export const CreateVaultItemSchema = z.object({
  type: VaultItemTypeEnum,
  title: z.string().min(1).max(200),
  folderId: z.string().cuid().optional(),
  tags: z.array(z.string()).optional(),
  favorite: z.boolean().default(false),
  ciphertext: z.string(), // base64
  iv: z.string(),         // base64
  authTag: z.string(),    // base64
  metadata: z.record(z.string()).optional(),
})

export const CreateVaultFolderSchema = z.object({
  name: z.string().min(1).max(100),
  parentId: z.string().cuid().optional(),
})

export type CreateVaultItemInput = z.infer<typeof CreateVaultItemSchema>

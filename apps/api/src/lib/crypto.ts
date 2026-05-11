import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from '../config/env.js'

const KEY = Buffer.from(env.VAULT_MASTER_KEY, 'hex')

export function encrypt(plain: string): { ciphertext: Buffer; iv: Buffer; authTag: Buffer } {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', KEY, iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return { ciphertext, iv, authTag: cipher.getAuthTag() }
}

export function decrypt(ciphertext: Buffer, iv: Buffer, authTag: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', KEY, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

export function encryptJson(data: unknown): { ciphertext: Buffer; iv: Buffer; authTag: Buffer } {
  return encrypt(JSON.stringify(data))
}

export function decryptJson<T>(ciphertext: Buffer, iv: Buffer, authTag: Buffer): T {
  return JSON.parse(decrypt(ciphertext, iv, authTag)) as T
}

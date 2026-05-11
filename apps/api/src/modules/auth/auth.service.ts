import argon2 from 'argon2'
import jwt from 'jsonwebtoken'
import { prisma } from '../../lib/prisma.js'
import { env } from '../../config/env.js'
import type { FastifyInstance } from 'fastify'
import type { LoginInput, RegisterInput, Role } from '@aiwa/shared'

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS)
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password)
}

export async function loginUser(
  app: FastifyInstance,
  input: LoginInput,
): Promise<{ accessToken: string; refreshToken: string }> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { workspace: true },
  })

  if (!user || user.deletedAt) {
    throw app.httpErrors.unauthorized('Credenciais inválidas')
  }

  const valid = await verifyPassword(user.passwordHash, input.password)
  if (!valid) {
    throw app.httpErrors.unauthorized('Credenciais inválidas')
  }

  const payload = { sub: user.id, workspaceId: user.workspaceId, role: user.role }

  // Access token via @fastify/jwt
  const accessToken = app.jwt.sign(payload, { expiresIn: env.JWT_ACCESS_EXPIRES_IN })

  // Refresh token via jsonwebtoken com segredo separado
  const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  })

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await prisma.refreshToken.create({ data: { userId: user.id, token: refreshToken, expiresAt } })

  return { accessToken, refreshToken }
}

export async function refreshAccessToken(
  app: FastifyInstance,
  refreshToken: string,
): Promise<{ accessToken: string }> {
  let payload: { sub: string; workspaceId: string; role: Role }
  try {
    payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as typeof payload
  } catch {
    throw app.httpErrors.unauthorized('Refresh token inválido')
  }

  const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } })
  if (!stored || stored.expiresAt < new Date()) {
    throw app.httpErrors.unauthorized('Refresh token expirado')
  }

  const accessToken = app.jwt.sign(
    { sub: payload.sub, workspaceId: payload.workspaceId, role: payload.role },
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN },
  )

  return { accessToken }
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { token } })
}

export async function registerUser(input: RegisterInput & { workspaceId: string }) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } })
  if (existing) throw new Error('Email já cadastrado')

  const passwordHash = await hashPassword(input.password)
  return prisma.user.create({
    data: {
      workspaceId: input.workspaceId,
      email: input.email,
      name: input.name,
      passwordHash,
    },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  })
}

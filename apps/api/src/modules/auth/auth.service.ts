import argon2 from 'argon2'
import jwt from 'jsonwebtoken'
import { prisma } from '../../lib/prisma.js'
import { encryptJson } from '../../lib/crypto.js'
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

function issueTokens(app: FastifyInstance, payload: { sub: string; workspaceId: string; role: Role }) {
  const accessToken = app.jwt.sign(payload, { expiresIn: env.JWT_ACCESS_EXPIRES_IN })
  const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  })
  return { accessToken, refreshToken }
}

async function persistRefreshToken(userId: string, token: string) {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await prisma.refreshToken.create({ data: { userId, token, expiresAt } })
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

  if (!user.passwordHash) {
    throw app.httpErrors.unauthorized('Esta conta usa login com Google. Use o botão "Entrar com Google".')
  }

  const valid = await verifyPassword(user.passwordHash, input.password)
  if (!valid) {
    throw app.httpErrors.unauthorized('Credenciais inválidas')
  }

  const payload = { sub: user.id, workspaceId: user.workspaceId, role: user.role }
  const { accessToken, refreshToken } = issueTokens(app, payload)
  await persistRefreshToken(user.id, refreshToken)

  return { accessToken, refreshToken }
}

export interface GoogleTokensPayload {
  access_token: string
  refresh_token?: string
  expiry_date: number
  token_type: string
}

export async function loginOrLinkWithGoogle(
  app: FastifyInstance,
  googleProfile: { sub: string; email: string; name: string; picture?: string },
  tokens: GoogleTokensPayload,
): Promise<{ accessToken: string; refreshToken: string }> {
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { googleId: googleProfile.sub },
        { email: googleProfile.email },
      ],
    },
  })

  if (!user || user.deletedAt) {
    throw new Error('Conta não encontrada. Solicite acesso ao administrador.')
  }

  // Link googleId if not already set
  if (user.googleId !== googleProfile.sub) {
    await prisma.user.update({
      where: { id: user.id },
      data: { googleId: googleProfile.sub },
    })
  }

  // Upsert CalendarAccount so the Agenda works automatically
  if (tokens.refresh_token) {
    const encrypted = encryptJson(tokens)
    await prisma.calendarAccount.upsert({
      where: {
        workspaceId_userId_provider: {
          workspaceId: user.workspaceId,
          userId: user.id,
          provider: 'google',
        },
      },
      create: {
        workspaceId: user.workspaceId,
        userId: user.id,
        provider: 'google',
        email: googleProfile.email,
        tokens: {
          ciphertext: Array.from(encrypted.ciphertext),
          iv: Array.from(encrypted.iv),
          authTag: Array.from(encrypted.authTag),
        },
      },
      update: {
        email: googleProfile.email,
        tokens: {
          ciphertext: Array.from(encrypted.ciphertext),
          iv: Array.from(encrypted.iv),
          authTag: Array.from(encrypted.authTag),
        },
      },
    })
  }

  const payload = { sub: user.id, workspaceId: user.workspaceId, role: user.role }
  const { accessToken, refreshToken } = issueTokens(app, payload)
  await persistRefreshToken(user.id, refreshToken)

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

import { prisma } from '../../lib/prisma.js'

/**
 * Retorna IDs dos usuários elegíveis a aparecer como responsáveis em cards
 * deste board, respeitando a visibilidade:
 *  - PUBLIC  → todos do workspace.
 *  - SHARED  → dono + BoardShare.users + membros dos teams em BoardTeamShare.
 *  - PRIVATE → só o dono.
 * Sempre filtra deletados.
 */
export async function getBoardEligibleUserIds(boardId: string): Promise<string[]> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      workspaceId: true, ownerId: true, visibility: true,
      shares: { select: { userId: true } },
      teamShares: { select: { teamId: true } },
    },
  })
  if (!board) return []

  if (board.visibility === 'PUBLIC') {
    const all = await prisma.user.findMany({
      where: { workspaceId: board.workspaceId, deletedAt: null },
      select: { id: true },
    })
    return all.map(u => u.id)
  }

  const ids = new Set<string>()
  if (board.ownerId) ids.add(board.ownerId)
  if (board.visibility === 'SHARED') {
    board.shares.forEach(s => ids.add(s.userId))
    if (board.teamShares.length > 0) {
      const teamMembers = await prisma.teamMembership.findMany({
        where: { teamId: { in: board.teamShares.map(t => t.teamId) }, isActive: true },
        select: { userId: true },
      })
      teamMembers.forEach(m => ids.add(m.userId))
    }
  }

  // Filtra deletados
  if (ids.size === 0) return []
  const users = await prisma.user.findMany({
    where: { id: { in: Array.from(ids) }, workspaceId: board.workspaceId, deletedAt: null },
    select: { id: true },
  })
  return users.map(u => u.id)
}

/**
 * Verifica se o usuário pode GERENCIAR o board (criar coluna, deletar, mudar
 * visibility, gerenciar shares). Permitido para:
 *  - dono do board
 *  - admin com permissão boards.manage (já tratado por requirePerm em rotas legadas)
 *  - LEADER de algum team em BoardTeamShare
 */
export async function canManageBoard(boardId: string, userId: string): Promise<boolean> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { ownerId: true, teamShares: { select: { teamId: true } } },
  })
  if (!board) return false
  if (board.ownerId === userId) return true
  if (board.teamShares.length === 0) return false
  const lead = await prisma.teamMembership.findFirst({
    where: {
      userId,
      isActive: true,
      role: 'LEADER',
      teamId: { in: board.teamShares.map(t => t.teamId) },
    },
    select: { id: true },
  })
  return !!lead
}

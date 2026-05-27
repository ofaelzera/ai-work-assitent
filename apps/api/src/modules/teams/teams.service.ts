/**
 * teams.service.ts
 *
 * Lógica de negócio dos setores de atendimento (Suporte, Vendas, Financeiro, etc).
 *
 * Conceitos:
 *  - Team: setor com regras próprias de distribuição (all/fixed/round_robin/load_balanced)
 *  - TeamMembership: vínculo N:N user↔team, com role (LEADER/AGENT), isActive e capacity
 *  - Quando uma conv é roteada para um team:
 *      • teamId é setado em Conversation
 *      • eligibleAssigneeIds é populado conforme o distMode do team
 *      • assigneeId permanece null (atendente precisa Assumir)
 */
import { prisma } from '../../lib/prisma.js'

export type DistributionMode = 'all' | 'fixed' | 'round_robin' | 'load_balanced'

export interface ResolveEligibilityArgs {
  teamId: string
  /**
   * Quando true, NÃO avança o cursor de round-robin (útil pra peek/test).
   * Default: false (avança o cursor pra próxima atribuição).
   */
  dryRun?: boolean
}

export interface EligibilityResult {
  /** Lista de userIds elegíveis. Vazio = ninguém disponível (fallback pra overflow ou pública). */
  userIds: string[]
  distMode: DistributionMode
  /** True quando todos os membros estouraram capacity (load_balanced) ou time vazio. */
  overflowed: boolean
}

/**
 * Gera um slug ASCII a partir do nome. Não-único — chamadores devem garantir
 * unicidade no escopo do workspace consultando o DB se necessário.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'time'
}

/**
 * Garante unicidade do slug dentro do workspace, sufixando com -2, -3, ...
 */
export async function ensureUniqueSlug(workspaceId: string, base: string, ignoreId?: string): Promise<string> {
  let slug = base
  let attempt = 1
  while (true) {
    const existing = await prisma.team.findFirst({
      where: { workspaceId, slug, ...(ignoreId && { NOT: { id: ignoreId } }) },
      select: { id: true },
    })
    if (!existing) return slug
    attempt += 1
    slug = `${base}-${attempt}`
  }
}

/**
 * Resolve quem pode atender pra uma conv que entrou na fila do team `teamId`.
 *
 * Modos:
 *  • 'all'           → todos os membros ativos veem a fila do team
 *  • 'fixed'         → vai pra defaultAssigneeId (se inativo no team, fallback pra 'all')
 *  • 'round_robin'   → cursor sequencial; só membros ativos entram na rotação
 *  • 'load_balanced' → membro ativo com MENOS conversas OPEN (respeitando capacity)
 *
 * Se nada disponível e o team tiver overflowTeamId, devolve `overflowed=true`
 * pra que o caller possa re-rotear pro time de overflow.
 */
export async function resolveTeamEligibility(args: ResolveEligibilityArgs): Promise<EligibilityResult> {
  const { teamId, dryRun = false } = args

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      distributionMode: true,
      defaultAssigneeId: true,
      roundRobinUserIds: true,
      rrCursor: true,
    },
  })

  if (!team) {
    return { userIds: [], distMode: 'all', overflowed: true }
  }

  const distMode = (team.distributionMode as DistributionMode) ?? 'all'

  // Membros ativos do team (com user válido)
  const members = await prisma.teamMembership.findMany({
    where: { teamId, isActive: true, user: { deletedAt: null } },
    select: { userId: true, capacity: true },
  })
  const activeUserIds = members.map((m) => m.userId)

  if (activeUserIds.length === 0) {
    return { userIds: [], distMode, overflowed: true }
  }

  // FIXED
  if (distMode === 'fixed') {
    if (team.defaultAssigneeId && activeUserIds.includes(team.defaultAssigneeId)) {
      return { userIds: [team.defaultAssigneeId], distMode, overflowed: false }
    }
    // Fallback: defaultAssignee inativo no team → cai pra 'all'
    return { userIds: activeUserIds, distMode: 'all', overflowed: false }
  }

  // ROUND-ROBIN
  if (distMode === 'round_robin') {
    const pool = Array.isArray(team.roundRobinUserIds) && team.roundRobinUserIds.length > 0
      ? (team.roundRobinUserIds as string[]).filter((id) => activeUserIds.includes(id))
      : activeUserIds
    if (pool.length === 0) {
      return { userIds: [], distMode, overflowed: true }
    }
    const cursor = (team.rrCursor ?? 0) % pool.length
    const picked = pool[cursor]
    const nextCursor = (cursor + 1) % pool.length
    if (!dryRun) {
      await prisma.team.update({
        where: { id: teamId },
        data: { rrCursor: nextCursor },
      }).catch(() => {/* race com outra conv — ok, próxima ajusta */})
    }
    return { userIds: picked ? [picked] : [], distMode, overflowed: !picked }
  }

  // LOAD-BALANCED — pega quem tem menos conversas OPEN, respeitando capacity
  if (distMode === 'load_balanced') {
    const capacityByUser = new Map<string, number | null>()
    for (const m of members) capacityByUser.set(m.userId, m.capacity ?? null)

    // Conta OPEN por user (apenas dos membros ativos)
    const counts = await prisma.conversation.groupBy({
      by: ['assigneeId'],
      where: { assigneeId: { in: activeUserIds }, status: 'OPEN' },
      _count: { _all: true },
    })
    const countByUser = new Map<string, number>()
    for (const c of counts) {
      if (c.assigneeId) countByUser.set(c.assigneeId, c._count._all)
    }

    // Filtra quem ainda tem capacidade
    const eligible = activeUserIds.filter((uid) => {
      const cap = capacityByUser.get(uid)
      if (cap == null) return true
      return (countByUser.get(uid) ?? 0) < cap
    })

    if (eligible.length === 0) {
      // Todos lotados → overflowed (caller decide se vira fila pública ou transborda)
      return { userIds: [], distMode, overflowed: true }
    }

    // Escolhe o menos carregado; empate → tie-break pelo cursor (rotação justa)
    eligible.sort((a, b) => (countByUser.get(a) ?? 0) - (countByUser.get(b) ?? 0))
    const minLoad = countByUser.get(eligible[0]!) ?? 0
    const tied = eligible.filter((uid) => (countByUser.get(uid) ?? 0) === minLoad)
    const cursor = (team.rrCursor ?? 0) % tied.length
    const picked = tied[cursor]
    if (!dryRun) {
      await prisma.team.update({
        where: { id: teamId },
        data: { rrCursor: (cursor + 1) % Math.max(tied.length, 1) },
      }).catch(() => {})
    }
    return { userIds: picked ? [picked] : [], distMode, overflowed: false }
  }

  // ALL (default)
  return { userIds: activeUserIds, distMode: 'all', overflowed: false }
}

/**
 * Lista os teams onde o user é membro ativo. Útil pro filtro de inbox "meus times".
 */
export async function getUserTeamIds(userId: string): Promise<string[]> {
  const memberships = await prisma.teamMembership.findMany({
    where: { userId, isActive: true, team: { isActive: true, deletedAt: null } },
    select: { teamId: true },
  })
  return memberships.map((m) => m.teamId)
}

/**
 * Métricas por team — usadas em dashboards e na lista de teams do admin.
 */
export interface TeamStats {
  teamId: string
  open: number
  waiting: number
  resolved24h: number
  avgFirstResponseMin: number | null
  activeMembers: number
}

export async function getTeamStats(workspaceId: string, teamId: string): Promise<TeamStats> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [open, waiting, resolved24h, members, recent] = await Promise.all([
    prisma.conversation.count({ where: { workspaceId, teamId, status: 'OPEN' } }),
    prisma.conversation.count({ where: { workspaceId, teamId, status: 'WAITING' } }),
    prisma.conversation.count({
      where: { workspaceId, teamId, status: 'RESOLVED', resolvedAt: { gte: since24h } },
    }),
    prisma.teamMembership.count({ where: { teamId, isActive: true } }),
    prisma.conversation.findMany({
      where: {
        workspaceId,
        teamId,
        firstResponseAt: { not: null },
        createdAt: { gte: since24h },
      },
      select: { createdAt: true, firstResponseAt: true },
      take: 200,
    }),
  ])

  const avgMs = recent.length > 0
    ? recent.reduce((sum, c) => sum + (c.firstResponseAt!.getTime() - c.createdAt.getTime()), 0) / recent.length
    : null

  return {
    teamId,
    open,
    waiting,
    resolved24h,
    avgFirstResponseMin: avgMs ? Math.round(avgMs / 60_000) : null,
    activeMembers: members,
  }
}

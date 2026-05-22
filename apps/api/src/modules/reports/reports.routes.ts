import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { requirePerm } from '../../lib/acl.js'

const rangeSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
})

function parseRange(q: { from?: string; to?: string }) {
  const to = q.to ? new Date(q.to) : new Date()
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000)
  return { from, to }
}

function diffSec(a: Date | null | undefined, b: Date | null | undefined): number | null {
  if (!a || !b) return null
  return Math.max(0, Math.round((a.getTime() - b.getTime()) / 1000))
}

function avg(nums: (number | null)[]): number | null {
  const valid = nums.filter((n): n is number => typeof n === 'number')
  if (valid.length === 0) return null
  return Math.round(valid.reduce((s, n) => s + n, 0) / valid.length)
}

export const reportsRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── /reports/agents ────────────────────────────────────────────────────────
  app.get(
    '/reports/agents',
    {
      onRequest: [app.authenticate, requirePerm('reports.view')],
      schema: { querystring: rangeSchema },
    },
    async (req) => {
      const { workspaceId } = req.user
      const { from, to } = parseRange(req.query)

      const convs = await prisma.conversation.findMany({
        where: {
          workspaceId,
          assigneeId: { not: null },
          OR: [
            { createdAt: { gte: from, lte: to } },
            { resolvedAt: { gte: from, lte: to } },
          ],
        },
        select: {
          id: true,
          assigneeId: true,
          createdAt: true,
          claimedAt: true,
          firstResponseAt: true,
          resolvedAt: true,
          status: true,
        },
      })

      const byUser = new Map<string, typeof convs>()
      for (const c of convs) {
        if (!c.assigneeId) continue
        const arr = byUser.get(c.assigneeId) ?? []
        arr.push(c)
        byUser.set(c.assigneeId, arr)
      }

      const userIds = Array.from(byUser.keys())
      const users = userIds.length
        ? await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true },
          })
        : []
      const userMap = new Map(users.map((u) => [u.id, u]))

      // Mensagens enviadas pelos users no range
      const msgGroups = await prisma.message.groupBy({
        by: ['fromUserId'],
        where: {
          workspaceId,
          direction: 'OUTBOUND',
          fromUserId: { in: userIds.length ? userIds : ['__none__'] },
          sentAt: { gte: from, lte: to },
        },
        _count: { _all: true },
      })
      const msgMap = new Map(msgGroups.map((g) => [g.fromUserId, g._count._all]))

      const rows = userIds.map((uid) => {
        const userConvs = byUser.get(uid) ?? []
        const resolved = userConvs.filter((c) => c.status === 'RESOLVED' && c.resolvedAt)
        return {
          userId: uid,
          user: userMap.get(uid) ?? null,
          convCount: userConvs.length,
          resolvedCount: resolved.length,
          avgFirstResponseSec: avg(userConvs.map((c) => diffSec(c.firstResponseAt, c.createdAt))),
          avgResolveSec: avg(resolved.map((c) => diffSec(c.resolvedAt, c.createdAt))),
          avgClaimSec: avg(userConvs.map((c) => diffSec(c.claimedAt, c.createdAt))),
          messagesSent: msgMap.get(uid) ?? 0,
        }
      })

      rows.sort((a, b) => b.convCount - a.convCount)
      return { from, to, rows }
    },
  )

  // ── /reports/channels ──────────────────────────────────────────────────────
  app.get(
    '/reports/channels',
    {
      onRequest: [app.authenticate, requirePerm('reports.view')],
      schema: { querystring: rangeSchema },
    },
    async (req) => {
      const { workspaceId } = req.user
      const { from, to } = parseRange(req.query)

      const convGroups = await prisma.conversation.groupBy({
        by: ['channelId'],
        where: { workspaceId, createdAt: { gte: from, lte: to } },
        _count: { _all: true },
      })
      const msgGroups = await prisma.message.groupBy({
        by: ['conversationId'],
        where: { workspaceId, sentAt: { gte: from, lte: to } },
        _count: { _all: true },
      })

      // Mapeia conversationId → channelId
      const convs = await prisma.conversation.findMany({
        where: { id: { in: msgGroups.map((m) => m.conversationId) } },
        select: { id: true, channelId: true },
      })
      const convChannelMap = new Map(convs.map((c) => [c.id, c.channelId]))
      const msgByChannel = new Map<string, number>()
      for (const m of msgGroups) {
        const ch = convChannelMap.get(m.conversationId)
        if (!ch) continue
        msgByChannel.set(ch, (msgByChannel.get(ch) ?? 0) + m._count._all)
      }

      const channelIds = Array.from(new Set([...convGroups.map((g) => g.channelId), ...msgByChannel.keys()]))
      const channels = channelIds.length
        ? await prisma.channel.findMany({
            where: { id: { in: channelIds } },
            select: { id: true, type: true, label: true },
          })
        : []
      const channelMap = new Map(channels.map((c) => [c.id, c]))

      const rows = channelIds.map((cid) => ({
        channelId: cid,
        channel: channelMap.get(cid) ?? null,
        convCount: convGroups.find((g) => g.channelId === cid)?._count._all ?? 0,
        messages: msgByChannel.get(cid) ?? 0,
      }))
      rows.sort((a, b) => b.convCount - a.convCount)

      // Heatmap: matriz [dayOfWeek 0-6][hour 0-23] de inbound messages
      const inboundMsgs = await prisma.message.findMany({
        where: {
          workspaceId,
          direction: 'INBOUND',
          sentAt: { gte: from, lte: to },
        },
        select: { sentAt: true },
      })
      const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
      for (const m of inboundMsgs) {
        const d = m.sentAt
        heatmap[d.getDay()][d.getHours()] += 1
      }

      return { from, to, rows, heatmap }
    },
  )

  // ── /reports/queue ─────────────────────────────────────────────────────────
  app.get(
    '/reports/queue',
    {
      onRequest: [app.authenticate, requirePerm('reports.view')],
      schema: { querystring: rangeSchema },
    },
    async (req) => {
      const { workspaceId } = req.user
      const { from, to } = parseRange(req.query)

      const convs = await prisma.conversation.findMany({
        where: { workspaceId, createdAt: { gte: from, lte: to } },
        select: {
          id: true,
          createdAt: true,
          claimedAt: true,
          firstResponseAt: true,
          resolvedAt: true,
        },
      })

      const total = convs.length
      const claimed = convs.filter((c) => c.claimedAt)
      const responded = convs.filter((c) => c.firstResponseAt)
      const resolved = convs.filter((c) => c.resolvedAt)

      const queueWaits = claimed.map((c) => diffSec(c.claimedAt, c.createdAt))
      const responseSecs = responded.map((c) => diffSec(c.firstResponseAt, c.createdAt))

      const within = (sec: number) =>
        responseSecs.filter((s): s is number => typeof s === 'number' && s <= sec).length
      const sla2 = responseSecs.length ? Math.round((within(120) / responseSecs.length) * 100) : null
      const sla5 = responseSecs.length ? Math.round((within(300) / responseSecs.length) * 100) : null
      const sla15 = responseSecs.length ? Math.round((within(900) / responseSecs.length) * 100) : null

      return {
        from, to,
        total,
        claimedCount: claimed.length,
        respondedCount: responded.length,
        resolvedCount: resolved.length,
        abandonmentRate: total ? Math.round(((total - responded.length) / total) * 100) : null,
        avgQueueWaitSec: avg(queueWaits),
        avgFirstResponseSec: avg(responseSecs),
        avgResolveSec: avg(resolved.map((c) => diffSec(c.resolvedAt, c.createdAt))),
        sla: { within2min: sla2, within5min: sla5, within15min: sla15 },
      }
    },
  )

  // ── /reports/ai ────────────────────────────────────────────────────────────
  app.get(
    '/reports/ai',
    {
      onRequest: [app.authenticate, requirePerm('reports.view')],
      schema: { querystring: rangeSchema },
    },
    async (req) => {
      const { workspaceId } = req.user
      const { from, to } = parseRange(req.query)

      const logs = await prisma.aIExecutionLog.findMany({
        where: { workspaceId, createdAt: { gte: from, lte: to } },
        select: {
          agentId: true,
          tokensIn: true,
          tokensOut: true,
          latencyMs: true,
          error: true,
          createdAt: true,
        },
      })

      const byAgent = new Map<string, { runs: number; tokensIn: number; tokensOut: number; errors: number; latency: number[] }>()
      for (const l of logs) {
        const key = l.agentId ?? '__unknown__'
        const e = byAgent.get(key) ?? { runs: 0, tokensIn: 0, tokensOut: 0, errors: 0, latency: [] }
        e.runs += 1
        e.tokensIn += l.tokensIn ?? 0
        e.tokensOut += l.tokensOut ?? 0
        if (l.error) e.errors += 1
        if (l.latencyMs) e.latency.push(l.latencyMs)
        byAgent.set(key, e)
      }

      const agentIds = Array.from(byAgent.keys()).filter((k) => k !== '__unknown__')
      const agents = agentIds.length
        ? await prisma.agent.findMany({
            where: { id: { in: agentIds } },
            select: { id: true, name: true, provider: true, model: true },
          })
        : []
      const agentMap = new Map(agents.map((a) => [a.id, a]))

      const rows = Array.from(byAgent.entries()).map(([id, v]) => ({
        agentId: id === '__unknown__' ? null : id,
        agent: id === '__unknown__' ? null : agentMap.get(id) ?? null,
        runs: v.runs,
        tokensIn: v.tokensIn,
        tokensOut: v.tokensOut,
        errors: v.errors,
        errorRate: v.runs ? Math.round((v.errors / v.runs) * 100) : 0,
        avgLatencyMs: avg(v.latency),
      }))
      rows.sort((a, b) => b.runs - a.runs)

      // Tokens por dia (chart serie)
      const byDay = new Map<string, number>()
      for (const l of logs) {
        const key = l.createdAt.toISOString().slice(0, 10)
        byDay.set(key, (byDay.get(key) ?? 0) + (l.tokensIn ?? 0) + (l.tokensOut ?? 0))
      }
      const series = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, tokens]) => ({ date, tokens }))

      return {
        from, to,
        totalRuns: logs.length,
        totalErrors: logs.filter((l) => l.error).length,
        totalTokens: logs.reduce((s, l) => s + (l.tokensIn ?? 0) + (l.tokensOut ?? 0), 0),
        rows,
        series,
      }
    },
  )
}

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import {
  listChannels,
  createWhatsAppChannel,
  createSmtpChannel,
  getChannelQr,
  syncChannelStatus,
  deleteChannel,
  getChannelConfig,
  adoptExistingInstance,
  createMetaChannel,
} from './channels.service.js'
import { syncWhatsAppChannel, syncWhatsAppAvatars, syncImapChannel } from './sync.service.js'
import { handleMetaEvent } from './meta.handler.js'
import { testSmtpConnection, createImapFolder, listImapFolders } from './email.client.js'
import { getSmtpConfig } from './channels.service.js'
import { getClientForChannel } from '../evolution-servers/evolution-servers.service.js'
import { env } from '../../config/env.js'
import { addImapPoller, removeImapPoller } from './imap.poller.js'

export const channelsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/channels', { onRequest: [app.authenticate] }, async (req) => {
    return listChannels(req.user.workspaceId)
  })

  app.post(
    '/channels/whatsapp',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          label: z.string().min(1),
          evolutionServerId: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const channel = await createWhatsAppChannel(req.user.workspaceId, req.body.label, req.body.evolutionServerId)
      return reply.code(201).send(channel)
    },
  )

  // Adota uma instância Evolution já existente
  app.post(
    '/channels/whatsapp/adopt',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          label: z.string().min(1),
          evolutionServerId: z.string().min(1),
          instanceName: z.string().min(1),
        }),
      },
    },
    async (req, reply) => {
      try {
        const channel = await adoptExistingInstance(req.user.workspaceId, req.body)
        return reply.code(201).send(channel)
      } catch (err: any) {
        return reply.badRequest(err?.message ?? 'Erro ao adotar instância')
      }
    },
  )

  app.post(
    '/channels/meta',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          label: z.string().min(1),
          type: z.enum(['META_WHATSAPP', 'META_INSTAGRAM', 'META_MESSENGER']),
          systemUserToken: z.string().min(1),
          phoneNumberId: z.string().optional(),
          pageId: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { label, type, ...credentials } = req.body
      const channel = await createMetaChannel(req.user.workspaceId, label, type, credentials as any)
      return reply.code(201).send(channel)
    },
  )

  app.get('/webhooks/meta', async (req: any, reply) => {
    const mode = req.query['hub.mode']
    const token = req.query['hub.verify_token']
    const challenge = req.query['hub.challenge']

    if (mode === 'subscribe' && token === env.META_WEBHOOK_VERIFY_TOKEN) {
      return reply.code(200).send(challenge)
    }
    return reply.code(403).send()
  })

  app.post('/webhooks/meta', async (req: any, reply) => {
    reply.code(200).send('EVENT_RECEIVED')
    handleMetaEvent(req.body).catch((err) => {
      req.log.error({ err }, 'Erro ao processar webhook da Meta')
    })
  })

  app.get('/channels/:id/qr', { onRequest: [app.authenticate] }, async (req: any) => {
    return getChannelQr(req.params.id)
  })

  app.get('/channels/:id/status', { onRequest: [app.authenticate] }, async (req: any) => {
    return syncChannelStatus(req.params.id)
  })

  app.delete('/channels/:id', { onRequest: [app.authenticate] }, async (req: any, reply) => {
    // Para o poller IMAP antes de deletar (no-op se for canal WA)
    removeImapPoller(req.params.id)
    await deleteChannel(req.params.id)
    return reply.code(204).send()
  })

  // ── Regras / settings do canal ────────────────────────────────────────────
  app.get('/channels/:id/settings', { onRequest: [app.authenticate] }, async (req: any, reply) => {
    const channel = await prisma.channel.findFirst({
      where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
      select: { id: true, settings: true },
    })
    if (!channel) return reply.notFound()
    return (channel.settings as Record<string, unknown> | null) ?? {}
  })

  app.patch(
    '/channels/:id/settings',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          ignoreGroups: z.boolean().optional(),
          archiveGroups: z.boolean().optional(),
          autoResolveOnRead: z.boolean().optional(),
          prefixSenderName: z.boolean().optional(),
          distributionMode: z.enum(['all', 'fixed', 'round_robin']).optional(),
          defaultAssigneeId: z.string().nullable().optional(),
          roundRobinUserIds: z.array(z.string()).optional(),
          welcomeMessage: z.string().max(2000).nullable().optional(),
          closingMessage: z.string().max(2000).nullable().optional(),
          // Se true: também envia mensagem de finalização quando admin finaliza
          // sem ter assumido (atende direto da fila ou supervisiona). Default false:
          // evita mandar "obrigado pelo atendimento" quando ninguém atendeu de fato.
          sendClosingOnAdminFinalize: z.boolean().optional(),
        }),
      },
    },
    async (req: any, reply) => {
      const channel = await prisma.channel.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
        select: { id: true, settings: true },
      })
      if (!channel) return reply.notFound()
      const current = (channel.settings as Record<string, unknown> | null) ?? {}
      const updated = await prisma.channel.update({
        where: { id: req.params.id },
        data: { settings: { ...current, ...req.body } },
        select: { id: true, settings: true },
      })
      return (updated.settings as Record<string, unknown>) ?? {}
    },
  )

  // Salvar assinatura do canal
  app.patch(
    '/channels/:id/signature',
    {
      onRequest: [app.authenticate],
      schema: { body: z.object({ signature: z.string() }) },
    },
    async (req: any) => {
      const { workspaceId } = req.user
      return prisma.channel.update({
        where: { id: req.params.id, workspaceId },
        data: { signature: req.body.signature },
        select: { id: true, signature: true },
      })
    },
  )

  app.post(
    '/channels/:id/sync',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ importHistory: z.boolean().optional() }).nullish(),
      },
    },
    async (req: any) => {
      const channel = await prisma.channel.findUniqueOrThrow({ where: { id: req.params.id } })
      if (channel.type === 'IMAP_SMTP') return syncImapChannel(req.params.id)
      const importHistory = req.body?.importHistory === true

      const result = await syncWhatsAppChannel(req.params.id, { importHistory })

      // Marca em settings que o histórico já foi importado (pra não repetir o prompt)
      if (importHistory) {
        const current = (channel.settings as Record<string, unknown> | null) ?? {}
        await prisma.channel.update({
          where: { id: req.params.id },
          data: { settings: { ...current, historyImportedAt: new Date().toISOString() } },
        })
      }

      return result
    },
  )

  // Sincroniza fotos de perfil de todos os contatos do canal
  app.post('/channels/:id/sync-avatars', { onRequest: [app.authenticate] }, async (req: any) => {
    return syncWhatsAppAvatars(req.params.id)
  })

  // Atualiza webhook + websocket do canal WA (PRESENCE_UPDATE, MESSAGES_UPDATE etc.)
  app.post('/channels/:id/update-webhook', { onRequest: [app.authenticate] }, async (req: any, reply) => {
    const channel = await prisma.channel.findFirstOrThrow({
      where: { id: req.params.id, workspaceId: req.user.workspaceId },
      include: { evolutionServer: { select: { url: true } } },
    })
    if (channel.type !== 'WHATSAPP') return reply.badRequest('Apenas canais WhatsApp')
    const { instanceName } = await getChannelConfig(req.params.id)
    const client = await getClientForChannel(req.params.id)
    const serverUrl = channel.evolutionServer?.url ?? env.EVOLUTION_SERVER_URL ?? ''
    const webhookUrl = env.EVOLUTION_WEBHOOK_URL ?? `${serverUrl}/webhooks/whatsapp`
    await client.updateInstanceWebhook(instanceName, webhookUrl)
    await client.updateInstanceWebsocket(instanceName).catch(() => {})
    return { ok: true, instanceName }
  })

  // Criar canal SMTP/IMAP
  app.post(
    '/channels/smtp',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          label: z.string().min(1),
          smtpHost: z.string().min(1),
          smtpPort: z.coerce.number().default(587),
          smtpUser: z.string().min(1),
          smtpPass: z.string().min(1),
          imapHost: z.string().optional(),
          imapPort: z.coerce.number().optional(),
          fromName: z.string().optional(),
          fromEmail: z.string().email(),
          secure: z.boolean().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { label, ...cfg } = req.body
      // Testa a conexão antes de salvar
      const test = await testSmtpConnection(cfg as any)
      if (!test.ok) return reply.badRequest(test.error ?? 'Não foi possível conectar ao servidor SMTP.')
      const channel = await createSmtpChannel(req.user.workspaceId, label, cfg as any)
      // Polling IMAP desativado temporariamente
      // addImapPoller(channel.id)
      return reply.code(201).send(channel)
    },
  )

  // ── Listar pastas IMAP de um canal (refresh manual) ────────────────────────
  app.get(
    '/channels/:id/folders',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req: any, reply) => {
      const channel = await prisma.channel.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
      })
      if (!channel) return reply.notFound('Canal não encontrado')
      if (channel.type !== 'IMAP_SMTP' && channel.type !== 'GMAIL') {
        return reply.badRequest('Canal não é de email')
      }
      const settings = (channel.settings as Record<string, unknown> | null) ?? {}
      const cached = Array.isArray(settings.imapFolders) ? (settings.imapFolders as string[]) : null
      return { folders: cached ?? [] }
    },
  )

  // ── Reiniciar instância WhatsApp ──────────────────────────────────────────
  app.post('/channels/:id/restart', { onRequest: [app.authenticate] }, async (req: any, reply) => {
    const channel = await prisma.channel.findFirst({
      where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
    })
    if (!channel) return reply.notFound()
    if (channel.type !== 'WHATSAPP') return reply.badRequest('Apenas canais WhatsApp')
    const { instanceName } = await getChannelConfig(req.params.id)
    const client = await getClientForChannel(req.params.id)
    await client.restartInstance(instanceName)
    return { ok: true }
  })

  // ── Verificar se número tem WhatsApp ──────────────────────────────────────
  app.post(
    '/channels/:id/check-numbers',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ numbers: z.array(z.string().min(1)).min(1).max(20) }),
      },
    },
    async (req: any, reply) => {
      const channel = await prisma.channel.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
      })
      if (!channel) return reply.notFound()
      if (channel.type !== 'WHATSAPP') return reply.badRequest('Apenas canais WhatsApp')
      const { instanceName } = await getChannelConfig(req.params.id)
      const client = await getClientForChannel(req.params.id)
      return client.checkIsWhatsApp(instanceName, req.body.numbers)
    },
  )

  // ── Perfil do canal WhatsApp ──────────────────────────────────────────────
  app.get('/channels/:id/profile', { onRequest: [app.authenticate] }, async (req: any, reply) => {
    const channel = await prisma.channel.findFirst({
      where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
    })
    if (!channel) return reply.notFound()
    if (channel.type !== 'WHATSAPP') return reply.badRequest('Apenas canais WhatsApp')
    const { instanceName } = await getChannelConfig(req.params.id)
    const client = await getClientForChannel(req.params.id)
    // getInstance já retorna profileName e profilePictureUrl
    const instances = await client.getInstance(instanceName) as unknown as any[]
    const inst = Array.isArray(instances) ? instances[0] : instances
    return {
      name: (inst as any)?.profileName ?? (inst as any)?.instance?.profileName ?? null,
      picture: (inst as any)?.profilePictureUrl ?? (inst as any)?.instance?.profilePictureUrl ?? null,
    }
  })

  app.patch(
    '/channels/:id/profile',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().min(1).max(25).optional(),
          status: z.string().max(139).optional(),
        }),
      },
    },
    async (req: any, reply) => {
      const channel = await prisma.channel.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
      })
      if (!channel) return reply.notFound()
      if (channel.type !== 'WHATSAPP') return reply.badRequest('Apenas canais WhatsApp')
      const { instanceName } = await getChannelConfig(req.params.id)
      const client = await getClientForChannel(req.params.id)
      const { name, status } = req.body
      if (name) await client.updateProfileName(instanceName, name)
      if (status !== undefined) await client.updateProfileStatus(instanceName, status)
      // Atualiza o ownerProfileName armazenado nas settings do canal
      if (name) {
        const current = (channel.settings as Record<string, unknown> | null) ?? {}
        await prisma.channel.update({
          where: { id: req.params.id },
          data: { settings: { ...current, ownerProfileName: name } },
        })
      }
      return { ok: true }
    },
  )

  app.post('/channels/:id/profile/picture', { onRequest: [app.authenticate] }, async (req: any, reply) => {
    const channel = await prisma.channel.findFirst({
      where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
    })
    if (!channel) return reply.notFound()
    if (channel.type !== 'WHATSAPP') return reply.badRequest('Apenas canais WhatsApp')
    const { instanceName } = await getChannelConfig(req.params.id)
    const client = await getClientForChannel(req.params.id)
    const data = await req.file()
    if (!data) return reply.badRequest('Arquivo obrigatório')
    const chunks: Buffer[] = []
    for await (const chunk of data.file) chunks.push(chunk)
    const base64 = Buffer.concat(chunks).toString('base64')
    const mime: string = data.mimetype || 'image/jpeg'
    await client.updateProfilePicture(instanceName, `data:${mime};base64,${base64}`)
    return { ok: true }
  })

  app.delete('/channels/:id/profile/picture', { onRequest: [app.authenticate] }, async (req: any, reply) => {
    const channel = await prisma.channel.findFirst({
      where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
    })
    if (!channel) return reply.notFound()
    if (channel.type !== 'WHATSAPP') return reply.badRequest('Apenas canais WhatsApp')
    const { instanceName } = await getChannelConfig(req.params.id)
    const client = await getClientForChannel(req.params.id)
    await client.removeProfilePicture(instanceName)
    return { ok: true }
  })

  // ── Privacy settings ──────────────────────────────────────────────────────
  app.get('/channels/:id/privacy', { onRequest: [app.authenticate] }, async (req: any, reply) => {
    const channel = await prisma.channel.findFirst({
      where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
    })
    if (!channel) return reply.notFound()
    if (channel.type !== 'WHATSAPP') return reply.badRequest('Apenas canais WhatsApp')
    const { instanceName } = await getChannelConfig(req.params.id)
    const client = await getClientForChannel(req.params.id)
    return client.fetchPrivacySettings(instanceName)
  })

  app.patch(
    '/channels/:id/privacy',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          readreceipts: z.enum(['all', 'none']).optional(),
          profile: z.enum(['all', 'contacts', 'contact_blacklist', 'none']).optional(),
          status: z.enum(['all', 'contacts', 'contact_blacklist', 'none']).optional(),
          online: z.enum(['all', 'match_last_seen']).optional(),
          last: z.enum(['all', 'contacts', 'contact_blacklist', 'none']).optional(),
          groupadd: z.enum(['all', 'contacts', 'contact_blacklist']).optional(),
        }),
      },
    },
    async (req: any, reply) => {
      const channel = await prisma.channel.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
      })
      if (!channel) return reply.notFound()
      if (channel.type !== 'WHATSAPP') return reply.badRequest('Apenas canais WhatsApp')
      const { instanceName } = await getChannelConfig(req.params.id)
      const client = await getClientForChannel(req.params.id)
      await client.updatePrivacySettings(instanceName, req.body)
      return { ok: true }
    },
  )

  // ── Presença da instância ──────────────────────────────────────────────────
  app.patch(
    '/channels/:id/presence',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ presence: z.enum(['available', 'unavailable']) }),
      },
    },
    async (req: any, reply) => {
      const channel = await prisma.channel.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
      })
      if (!channel) return reply.notFound()
      if (channel.type !== 'WHATSAPP') return reply.badRequest('Apenas canais WhatsApp')
      const { instanceName } = await getChannelConfig(req.params.id)
      const client = await getClientForChannel(req.params.id)
      await client.setPresence(instanceName, req.body.presence)
      return { ok: true }
    },
  )

  // ── Criar nova pasta IMAP ──────────────────────────────────────────────────
  // Cria a pasta no servidor + atualiza a lista cacheada em channel.settings.imapFolders.
  app.post(
    '/channels/:id/folders',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ name: z.string().min(1).max(120) }),
      },
    },
    async (req: any, reply) => {
      const channel = await prisma.channel.findFirst({
        where: { id: req.params.id, workspaceId: req.user.workspaceId, deletedAt: null },
      })
      if (!channel) return reply.notFound('Canal não encontrado')
      if (channel.type !== 'IMAP_SMTP' && channel.type !== 'GMAIL') {
        return reply.badRequest('Canal não é de email')
      }

      const smtpCfg = await getSmtpConfig(channel.id)
      if (!smtpCfg) return reply.badRequest('Canal sem credenciais IMAP')

      // Cria no servidor
      try {
        await createImapFolder(smtpCfg, req.body.name)
      } catch (err: any) {
        return reply.badRequest(err?.message ?? 'Erro ao criar pasta no servidor IMAP')
      }

      // Re-lista pastas e atualiza cache (mais robusto que append manual — pega
      // path canônico do servidor, com prefixos do tipo "INBOX." aplicados)
      let folders: string[] = []
      try {
        folders = await listImapFolders(smtpCfg)
      } catch {
        // se falhar, fallback: append manual
        const settings = (channel.settings as Record<string, unknown> | null) ?? {}
        const current = Array.isArray(settings.imapFolders) ? (settings.imapFolders as string[]) : []
        folders = [...new Set([...current, req.body.name])]
      }

      const settings = (channel.settings as Record<string, unknown> | null) ?? {}
      await prisma.channel.update({
        where: { id: channel.id },
        data: { settings: { ...settings, imapFolders: folders } },
      })

      return reply.code(201).send({ folders })
    },
  )
}

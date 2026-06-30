import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { authenticateApiKeySecret } from './comm-api-keys.service.js'
import { enqueueMessage } from './communication.service.js'
import type { AttachmentInput } from './comm-attachments.service.js'
import { logger } from '../../lib/logger.js'

/**
 * API pública da Central de Comunicação para integração EXTERNA.
 * Autenticada por API key (header `X-Api-Key` ou `Authorization: Bearer <key>`).
 * Aceita JSON (anexos por url/base64) e multipart/form-data (anexos por upload).
 *
 *   POST /api/v1/messages
 *   { "canal": "whatsapp", "destinatario": "5511999999999", "mensagem": "...", "agendar_para": "2026-06-08 09:00:00" }
 *   → { "success": true, "message_id": "...", "status": "queued" }
 */

interface ApiAuth {
  workspaceId: string
  keyId: string
  scopes: string[]
}

function extractKey(req: FastifyRequest): string | null {
  const header = req.headers['x-api-key']
  if (typeof header === 'string' && header) return header
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  return null
}

async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<ApiAuth | null> {
  const secret = extractKey(req)
  if (!secret) {
    reply.code(401).send({ success: false, error: 'API key ausente (use header X-Api-Key)' })
    return null
  }
  const auth = await authenticateApiKeySecret(secret)
  if (!auth) {
    reply.code(401).send({ success: false, error: 'API key inválida, revogada ou expirada' })
    return null
  }
  if (!auth.scopes.includes('messages.send')) {
    reply.code(403).send({ success: false, error: 'API key sem escopo messages.send' })
    return null
  }
  return auth
}

const CHANNEL_MAP: Record<string, 'WHATSAPP' | 'EMAIL'> = {
  whatsapp: 'WHATSAPP',
  email: 'EMAIL',
  'e-mail': 'EMAIL',
}

/** Converte "2026-06-08 09:00:00" ou ISO em Date. */
function parseSchedule(value: unknown): Date | null {
  if (!value || typeof value !== 'string') return null
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const d = new Date(normalized)
  return isNaN(d.getTime()) ? null : d
}

export const commPublicApiRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/v1/messages', async (req: any, reply) => {
    const auth = await authenticate(req, reply)
    if (!auth) return

    let canal: string | undefined
    let canalId: string | undefined
    let destinatario: string | undefined
    let assunto: string | undefined
    let mensagem: string | undefined
    let agendarPara: string | undefined
    const attachments: AttachmentInput[] = []

    if (req.isMultipart()) {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          const chunks: Buffer[] = []
          for await (const chunk of part.file) chunks.push(chunk)
          const buffer = Buffer.concat(chunks)
          // Rejeita anexo vazio (ex.: referência de arquivo não resolvida no cliente).
          if (buffer.byteLength === 0) {
            return reply.code(400).send({ success: false, error: `Anexo "${part.filename ?? 'arquivo'}" está vazio — verifique se o arquivo foi enviado corretamente.` })
          }
          attachments.push({
            tipo: 'buffer',
            nome: part.filename ?? 'arquivo',
            buffer,
            mime_type: part.mimetype,
          })
        } else {
          const v = part.value as string
          switch (part.fieldname) {
            case 'canal': canal = v; break
            case 'canal_id': canalId = v; break
            case 'destinatario': destinatario = v; break
            case 'assunto': assunto = v; break
            case 'mensagem': mensagem = v; break
            case 'agendar_para': agendarPara = v; break
          }
        }
      }
    } else {
      const b = req.body ?? {}
      canal = b.canal
      canalId = b.canal_id ?? b.channelId
      destinatario = b.destinatario
      assunto = b.assunto
      mensagem = b.mensagem
      agendarPara = b.agendar_para
      if (Array.isArray(b.anexos)) {
        for (const a of b.anexos) {
          if (a?.tipo === 'url' && a.arquivo) attachments.push({ tipo: 'url', nome: a.nome, arquivo: a.arquivo, mime_type: a.mime_type })
          else if (a?.tipo === 'base64' && a.arquivo) attachments.push({ tipo: 'base64', nome: a.nome, arquivo: a.arquivo, mime_type: a.mime_type })
          else return reply.code(400).send({ success: false, error: 'Anexo inválido: informe "tipo" (url|base64) e "arquivo".' })
        }
      }
    }

    // Validação
    const channelType = canal ? CHANNEL_MAP[canal.toLowerCase()] : undefined
    if (!channelType) return reply.code(400).send({ success: false, error: 'Campo "canal" inválido (whatsapp|email)' })
    if (!destinatario) return reply.code(400).send({ success: false, error: 'Campo "destinatario" obrigatório' })
    if (!mensagem) return reply.code(400).send({ success: false, error: 'Campo "mensagem" obrigatório' })

    try {
      const result = await enqueueMessage({
        workspaceId: auth.workspaceId,
        channelType,
        channelId: canalId || null,
        to: destinatario,
        subject: assunto,
        body: mensagem,
        scheduledAt: parseSchedule(agendarPara),
        attachments: attachments.length > 0 ? attachments : undefined,
        contactId: null, // API aceita destinatário avulso
        source: 'api',
      })
      return reply.code(201).send({
        success: true,
        message_id: result.messageId,
        status: result.status === 'SCHEDULED' ? 'scheduled' : 'queued',
      })
    } catch (err: any) {
      logger.error({ err: err?.message, workspaceId: auth.workspaceId }, 'Falha ao enfileirar mensagem via API pública')
      return reply.code(500).send({ success: false, error: err?.message ?? 'Falha ao enfileirar mensagem' })
    }
  })
}

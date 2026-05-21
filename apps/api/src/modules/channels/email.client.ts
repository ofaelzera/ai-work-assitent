import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'

export interface SmtpConfig {
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPass: string
  imapHost?: string
  imapPort?: number
  fromName?: string
  fromEmail: string
  secure?: boolean // true = SSL/TLS, false = STARTTLS
}

export function createSmtpTransport(cfg: SmtpConfig) {
  return nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.secure ?? cfg.smtpPort === 465,
    auth: { user: cfg.smtpUser, pass: cfg.smtpPass },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 15_000,
  })
}

export async function sendEmail(
  cfg: SmtpConfig,
  to: string,
  subject: string,
  text: string,
  html?: string,
  inReplyTo?: string,
): Promise<string> {
  const transport = createSmtpTransport(cfg)
  const info = await transport.sendMail({
    from: cfg.fromName ? `"${cfg.fromName}" <${cfg.fromEmail}>` : cfg.fromEmail,
    to,
    subject,
    text,
    html,
    ...(inReplyTo && { inReplyTo, references: inReplyTo }),
  })
  return info.messageId
}

export async function testSmtpConnection(cfg: SmtpConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const transport = createSmtpTransport(cfg)
    await transport.verify()
    return { ok: true }
  } catch (err: any) {
    const msg: string = err?.message ?? String(err)
    // Traduz erros comuns para mensagens amigáveis
    if (msg.includes('Invalid login') || msg.includes('Username and Password') || msg.includes('535')) {
      return { ok: false, error: 'Usuário ou senha inválidos. Para Gmail, use uma Senha de App.' }
    }
    if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
      return { ok: false, error: `Servidor SMTP não encontrado: ${cfg.smtpHost}:${cfg.smtpPort}` }
    }
    if (msg.includes('ETIMEDOUT') || msg.includes('timeout')) {
      return { ok: false, error: `Timeout ao conectar em ${cfg.smtpHost}:${cfg.smtpPort}` }
    }
    return { ok: false, error: msg }
  }
}

/** Cria um cliente IMAP padrão (usado pelas funções abaixo) */
function createImapClient(cfg: SmtpConfig): ImapFlow {
  if (!cfg.imapHost) throw new Error('imapHost ausente — canal não suporta IMAP')
  return new ImapFlow({
    host: cfg.imapHost,
    port: cfg.imapPort ?? 993,
    secure: (cfg.imapPort ?? 993) === 993,
    auth: { user: cfg.smtpUser, pass: cfg.smtpPass },
    tls: { rejectUnauthorized: false },
    logger: false,
    connectionTimeout: 15_000,
  })
}

/**
 * Lista todas as pastas (mailboxes) disponíveis no servidor IMAP.
 * Retorna os caminhos exatos (case-sensitive) para uso em fetch/move.
 *
 * Filtra pastas marcadas como `\Noselect` (containers que não recebem mensagens).
 */
export async function listImapFolders(cfg: SmtpConfig): Promise<string[]> {
  if (!cfg.imapHost) return []

  const client = createImapClient(cfg)
  try {
    await client.connect()
    const list = await client.list()
    await client.logout()
    return list
      .filter((m) => !m.flags?.has('\\Noselect'))
      .map((m) => m.path)
  } catch (err) {
    try { await client.logout() } catch {}
    throw err
  }
}

/**
 * Cria uma nova pasta (mailbox) no servidor IMAP.
 * Aceita path com separador (`/` ou `.`) — o servidor usa o que ele entende.
 * Retorna `true` se criou, `false` se já existia.
 */
export async function createImapFolder(cfg: SmtpConfig, path: string): Promise<boolean> {
  if (!cfg.imapHost) throw new Error('imapHost ausente')
  const client = createImapClient(cfg)
  try {
    await client.connect()
    const result = await client.mailboxCreate(path)
    await client.logout()
    // ImapFlow retorna { path, mailboxId, created } — `created: true` se acabou de ser criada
    return result?.created !== false
  } catch (err: any) {
    try { await client.logout() } catch {}
    // Erro "Mailbox already exists" não é fatal — devolvemos false
    if (/already exist/i.test(err?.message ?? '')) return false
    throw err
  }
}

/**
 * Move uma mensagem de uma pasta IMAP para outra (RFC 6851 — UID MOVE).
 * Habilita o agente "spam-mover" da Fase 8.
 */
export async function moveImapMessage(
  cfg: SmtpConfig,
  uid: number,
  fromFolder: string,
  toFolder: string,
): Promise<void> {
  const client = createImapClient(cfg)
  try {
    await client.connect()
    const lock = await client.getMailboxLock(fromFolder)
    try {
      await client.messageMove(uid, toFolder, { uid: true })
    } finally {
      lock.release()
    }
    await client.logout()
  } catch (err) {
    try { await client.logout() } catch {}
    throw err
  }
}

/** Tipo retornado por `fetchImapMessages`. */
export interface ImapMessage {
  uid: number
  messageId: string
  from: string
  fromName: string
  subject: string
  text: string
  html?: string
  date: Date
  inReplyTo?: string
  folder: string
}

/**
 * Busca últimas mensagens de uma pasta IMAP (default: INBOX) com decodificação completa.
 * Cada mensagem retornada inclui a pasta de origem (`folder`).
 */
export async function fetchImapMessages(
  cfg: SmtpConfig,
  limit = 50,
  folder = 'INBOX',
): Promise<ImapMessage[]> {
  if (!cfg.imapHost) return []

  const client = createImapClient(cfg)
  const messages: ImapMessage[] = []

  try {
    await client.connect()
    const lock = await client.getMailboxLock(folder)
    try {
      const total = (client.mailbox as any)?.exists ?? 0
      if (total === 0) return []

      const from = Math.max(1, total - limit + 1)
      const range = `${from}:${total}`

      for await (const msg of client.fetch(range, { uid: true, source: true })) {
        try {
          if (!msg.source) continue

          // mailparser decodifica tudo: base64, quoted-printable, charsets, multipart
          const parsed = await simpleParser(msg.source)

          messages.push({
            uid: msg.uid,
            messageId: parsed.messageId ?? `uid-${msg.uid}`,
            from: parsed.from?.value?.[0]?.address ?? '',
            fromName: parsed.from?.value?.[0]?.name ?? '',
            subject: parsed.subject ?? '(sem assunto)',
            text: (parsed.text ?? '').trim(),
            html: typeof parsed.html === 'string' ? parsed.html : undefined,
            date: parsed.date ?? new Date(),
            inReplyTo: typeof parsed.inReplyTo === 'string' ? parsed.inReplyTo : undefined,
            folder,
          })
        } catch {
          // ignora mensagem com parse error
        }
      }
    } finally {
      lock.release()
    }
    await client.logout()
  } catch (err) {
    try { await client.logout() } catch {}
    throw err
  }

  return messages.reverse()
}

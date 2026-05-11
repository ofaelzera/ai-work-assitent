# AI Work Assistant — Plano Mestre

> Documento-fonte do projeto. Lido a cada nova tarefa para situar contexto, arquitetura e próximos passos.

---

## Context

**Por que existe**: centralizar comunicação (WhatsApp, Gmail, SMTP/IMAP) e organizar demandas automaticamente via IA, num único painel web, eliminando o custo cognitivo de pular entre apps e classificar manualmente o que vira tarefa.

**Estado atual**: diretório vazio em `/Users/malvadao/Dev/Projetos/assistente-pessoal`. Sem código, sem repositório git. Greenfield.

**Resultado pretendido do MVP**: validar a hipótese de que uma IA, dado um stream unificado de mensagens, consegue identificar demandas reais e gerar cards de Kanban acionáveis com taxa de acerto suficiente para reduzir trabalho manual.

**Princípios norteadores**:
1. Modularidade primeiro — cada domínio (whatsapp, email, ai, kanban, vault) é isolado e plugável.
2. Provider-agnóstico — IA, storage e canais de mensagem são interfaces, não implementações fixas.
3. Event-driven — toda mutação relevante emite evento; pipelines de IA são consumidores assíncronos.
4. Segurança "by default" — vault com cripto forte, segredos nunca em log, princípio do menor privilégio.
5. MVP enxuto — preferir uma feature funcionando ponta-a-ponta a dez pela metade.

---

## 1. Arquitetura de Alto Nível

```
┌──────────────────────────────────────────────────────────────────┐
│                       Next.js (App Router)                       │
│  Dashboard │ Inbox │ Kanban │ Calendar │ Vault │ Admin │ Agents  │
└────────────────────────────┬─────────────────────────────────────┘
                             │ REST + SSE/WebSocket
┌────────────────────────────┴─────────────────────────────────────┐
│                       API Fastify (Node.js)                      │
│  auth │ users │ messages │ tasks │ kanban │ ai │ vault │ events  │
└──┬──────────┬─────────────┬──────────────┬──────────────┬────────┘
   │          │             │              │              │
┌──┴──┐  ┌────┴────┐  ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐
│MySQL│  │  Redis  │  │ BullMQ    │  │ EventBus  │  │  Storage  │
│Prisma│ │ (cache, │  │ (workers) │  │ (in-proc  │  │ (local FS │
│     │  │  pub/sub)│ │           │  │  + Redis) │  │  → S3)    │
└─────┘  └─────────┘  └─────┬─────┘  └───────────┘  └───────────┘
                            │
                ┌───────────┴────────────┐
                │ Workers (BullMQ)       │
                │ • ingestor whatsapp    │
                │ • ingestor email       │
                │ • ai-classifier        │
                │ • ai-summarizer        │
                │ • ai-responder         │
                │ • calendar-sync        │
                │ • notifications        │
                └───────────┬────────────┘
                            │
        ┌───────────────────┼────────────────────┐
        │                   │                    │
┌───────┴────────┐  ┌───────┴────────┐  ┌────────┴──────────┐
│ Evolution API  │  │ Gmail/IMAP     │  │ AI Providers      │
│ (WhatsApp)     │  │ (OAuth/SMTP)   │  │ Gemini/OpenAI/... │
└────────────────┘  └────────────────┘  └───────────────────┘
```

**Comunicação tempo-real**: SSE do Fastify para o Next.js (chat e atualizações de cards). WebSocket fica em backlog (overhead extra; SSE atende o MVP).

**Multi-tenant futuramente**: todo modelo já carrega `workspaceId` (no MVP existe um workspace default). Não vamos implementar auth multi-org agora, mas a coluna existe — barato adicionar depois.

---

## 2. Stack Definitiva

| Camada       | Tecnologia                                |
|--------------|-------------------------------------------|
| API          | Node.js 20 + Fastify 4 + TypeScript       |
| ORM          | Prisma 5                                  |
| DB           | MySQL 8                                   |
| Cache/Pub-Sub| Redis 7                                   |
| Filas        | BullMQ                                    |
| Auth         | JWT (access curto) + refresh em cookie httpOnly; argon2id para hash de senhas |
| Frontend     | Next.js 14 (App Router) + React 18 + TS   |
| UI           | TailwindCSS + shadcn/ui + lucide-icons    |
| Estado       | Zustand (UI) + TanStack Query (server)    |
| Forms        | react-hook-form + zod                     |
| Validação    | zod (compartilhado entre back e front)    |
| WhatsApp     | Evolution API (webhooks → ingestor)       |
| Email        | googleapis (Gmail) + imapflow + nodemailer (SMTP/IMAP) |
| Calendar     | googleapis (Calendar v3)                  |
| IA           | Gemini (default) atrás de `AIProvider`    |
| Storage      | FS local (`/storage/<workspaceId>/...`); abstração `StorageProvider` para futuro S3 |
| Logs         | pino + pino-pretty (dev); pino → stdout (prod) |
| Testes       | vitest + supertest + Playwright (e2e mínimo) |
| Lint/Format  | eslint + prettier                         |
| Monorepo     | pnpm workspaces (apps/api, apps/web, packages/shared) |

---

## 3. Estrutura de Diretórios

```
assistente-pessoal/
├── PROJECT_PLAN.md
├── README.md
├── pnpm-workspace.yaml
├── docker-compose.yml           (mysql, redis, evolution-api)
├── .env.example
├── apps/
│   ├── api/
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   ├── src/
│   │   │   ├── server.ts        (bootstrap Fastify)
│   │   │   ├── app.ts           (registra plugins/rotas)
│   │   │   ├── config/          (env, secrets)
│   │   │   ├── lib/             (prisma, redis, logger, crypto, eventBus)
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── users/
│   │   │   │   ├── workspaces/
│   │   │   │   ├── channels/         (conexões whatsapp/gmail/imap)
│   │   │   │   ├── messages/         (inbox unificado)
│   │   │   │   ├── contacts/
│   │   │   │   ├── ai/
│   │   │   │   │   ├── providers/    (gemini, openai, claude, deepseek)
│   │   │   │   │   ├── agents/       (definições e execução)
│   │   │   │   │   ├── prompts/      (CRUD + versionamento)
│   │   │   │   │   └── memory/       (contexto e embeddings)
│   │   │   │   ├── kanban/           (boards, columns, cards, comments, checklists)
│   │   │   │   ├── tasks/            (lembretes, subtarefas, recorrências)
│   │   │   │   ├── calendar/
│   │   │   │   ├── vault/            (senhas, criptografia)
│   │   │   │   ├── storage/          (arquivos)
│   │   │   │   ├── events/           (eventos internos)
│   │   │   │   ├── automation/       (regras, triggers)
│   │   │   │   └── dashboard/
│   │   │   ├── workers/
│   │   │   │   ├── index.ts          (carrega todos workers)
│   │   │   │   ├── ingestWhatsapp.worker.ts
│   │   │   │   ├── ingestEmail.worker.ts
│   │   │   │   ├── classifyMessage.worker.ts
│   │   │   │   ├── summarize.worker.ts
│   │   │   │   ├── suggestReply.worker.ts
│   │   │   │   ├── calendarSync.worker.ts
│   │   │   │   └── notifications.worker.ts
│   │   │   └── routes/               (registro central de rotas)
│   │   └── tests/
│   └── web/
│       ├── app/
│       │   ├── (auth)/login/
│       │   ├── (app)/
│       │   │   ├── dashboard/
│       │   │   ├── inbox/[conversationId]/
│       │   │   ├── kanban/[boardId]/
│       │   │   ├── calendar/
│       │   │   ├── vault/
│       │   │   ├── storage/
│       │   │   └── admin/
│       │   │       ├── users/
│       │   │       ├── channels/
│       │   │       ├── agents/
│       │   │       ├── prompts/
│       │   │       ├── ai-logs/
│       │   │       ├── integrations/
│       │   │       └── settings/
│       │   └── api/                  (proxies/route handlers)
│       ├── components/
│       ├── lib/                      (api client, hooks)
│       └── store/                    (zustand)
└── packages/
    └── shared/
        ├── src/
        │   ├── schemas/              (zod schemas compartilhados)
        │   ├── types/
        │   └── constants/
```

---

## 4. Modelo de Dados (Prisma — visão essencial)

> Convenções: `id` cuid, `createdAt`/`updatedAt`, `workspaceId` em quase tudo, soft-delete via `deletedAt`.

```prisma
model Workspace {
  id        String   @id @default(cuid())
  name      String
  users     User[]
  createdAt DateTime @default(now())
}

model User {
  id           String   @id @default(cuid())
  workspaceId  String
  email        String   @unique
  passwordHash String
  name         String
  role         Role     @default(MEMBER)   // ADMIN | MEMBER
  twoFactor    Boolean  @default(false)
  workspace    Workspace @relation(fields: [workspaceId], references: [id])
  createdAt    DateTime @default(now())
}

model Channel {
  id          String   @id @default(cuid())
  workspaceId String
  type        ChannelType   // WHATSAPP | GMAIL | IMAP_SMTP
  label       String
  status      ChannelStatus // CONNECTED | DISCONNECTED | ERROR
  config      Json          // segredos cifrados via vault
  createdAt   DateTime @default(now())
}

model Contact {
  id          String   @id @default(cuid())
  workspaceId String
  name        String?
  phone       String?
  email       String?
  metadata    Json?
  @@index([workspaceId, phone])
  @@index([workspaceId, email])
}

model Conversation {
  id          String   @id @default(cuid())
  workspaceId String
  channelId   String
  contactId   String?
  externalId  String   // id no canal (chatId WA, threadId Gmail)
  subject     String?
  isGroup     Boolean  @default(false)
  lastMessageAt DateTime?
  unreadCount Int      @default(0)
  @@unique([channelId, externalId])
}

model Message {
  id              String   @id @default(cuid())
  workspaceId     String
  conversationId  String
  direction       MessageDirection // INBOUND | OUTBOUND
  externalId      String?
  fromContactId   String?
  fromUserId      String?
  body            String   @db.Text
  bodyHtml        String?  @db.LongText
  attachments     Json?
  sentAt          DateTime
  receivedAt      DateTime @default(now())
  aiClassification Json?   // { intent, priority, isDemand, summary, confidence }
  taskId          String?  // se virou demanda
  @@index([workspaceId, conversationId, sentAt])
}

model Board {
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  columns     Column[]
}

model Column {
  id       String  @id @default(cuid())
  boardId  String
  name     String
  position Int
  cards    Card[]
}

model Card {
  id          String   @id @default(cuid())
  workspaceId String
  columnId    String
  title       String
  description String?  @db.Text
  priority    Priority @default(MEDIUM)
  dueDate     DateTime?
  contactId   String?
  conversationId String?
  createdBy   CreatedBy @default(USER)   // USER | AI
  assigneeId  String?
  position    Int
  labels      Json?
  checklist   Json?
  history     CardHistory[]
  comments    CardComment[]
  attachments Attachment[]
}

model CardComment { id String @id @default(cuid()); cardId String; userId String?; body String @db.Text; createdAt DateTime @default(now()) }
model CardHistory { id String @id @default(cuid()); cardId String; action String; payload Json; createdAt DateTime @default(now()) }

model Task {            // subtarefas/lembretes independentes
  id String @id @default(cuid())
  workspaceId String
  cardId String?
  title String
  done Boolean @default(false)
  remindAt DateTime?
  recurrence String?
}

model Agent {
  id          String  @id @default(cuid())
  workspaceId String
  name        String
  description String?
  systemPrompt String  @db.Text
  model       String
  provider    String
  temperature Float    @default(0.4)
  tools       Json?    // ferramentas permitidas
  isActive    Boolean  @default(true)
}

model Prompt {
  id        String  @id @default(cuid())
  workspaceId String
  name      String
  body      String  @db.Text
  version   Int     @default(1)
  tags      Json?
}

model AIExecutionLog {
  id        String  @id @default(cuid())
  workspaceId String
  agentId   String?
  provider  String
  model     String
  input     Json
  output    Json?
  tokensIn  Int?
  tokensOut Int?
  costUsd   Decimal? @db.Decimal(10,6)
  latencyMs Int?
  error     String?
  createdAt DateTime @default(now())
}

model MemoryChunk {     // base para RAG futuramente
  id          String   @id @default(cuid())
  workspaceId String
  sourceType  String   // conversation | card | document
  sourceId    String
  content     String   @db.Text
  embedding   Bytes?   // vetor serializado; MVP pode ficar null
  createdAt   DateTime @default(now())
  @@index([workspaceId, sourceType, sourceId])
}

model CalendarAccount { id String @id @default(cuid()); workspaceId String; userId String; provider String; tokens Json; }
model CalendarEvent { id String @id @default(cuid()); workspaceId String; externalId String; title String; startAt DateTime; endAt DateTime; cardId String?; }

model VaultItem {
  id           String  @id @default(cuid())
  workspaceId  String
  ownerId      String
  type         String  // password | ssh | ftp | db | api | note | file
  title        String
  folderId     String?
  tags         Json?
  favorite     Boolean @default(false)
  ciphertext   Bytes   // AES-256-GCM
  iv           Bytes
  authTag      Bytes
  metadata     Json?   // url, username (não-secreto)
  createdAt    DateTime @default(now())
}

model VaultFolder { id String @id @default(cuid()); workspaceId String; ownerId String; name String; parentId String? }

model Attachment {
  id String @id @default(cuid())
  workspaceId String
  uploadedBy String
  filename String
  mimeType String
  sizeBytes Int
  storageKey String   // path no provider
  cardId String?
  vaultItemId String?
}

model EventLog {
  id        String  @id @default(cuid())
  workspaceId String
  type      String  // message.received, card.created, ai.executed, ...
  payload   Json
  createdAt DateTime @default(now())
  @@index([workspaceId, type, createdAt])
}

enum Role { ADMIN MEMBER }
enum ChannelType { WHATSAPP GMAIL IMAP_SMTP }
enum ChannelStatus { CONNECTED DISCONNECTED ERROR }
enum MessageDirection { INBOUND OUTBOUND }
enum Priority { LOW MEDIUM HIGH URGENT }
enum CreatedBy { USER AI }
```

---

## 5. Fluxos Principais

### 5.1 Ingestão de mensagem → Card (caminho feliz)

1. **Evolution API webhook** → `POST /webhooks/whatsapp` (Fastify).
2. Handler valida assinatura, enfileira `ingestWhatsapp` no BullMQ. Resposta HTTP 200 imediata.
3. Worker `ingestWhatsapp`:
   - upsert Contact, Conversation, Message
   - dispara evento `message.received`
4. Subscriber `classifyMessage` enfileira execução do agente de triagem.
5. Worker `classifyMessage`:
   - carrega últimas N mensagens da conversa (contexto)
   - chama `AIProvider.generate(...)` com prompt de classificação
   - escreve `message.aiClassification`
   - se `isDemand=true`: cria Card na coluna "Entrada" com título/descrição/prioridade sugeridos, vincula à conversa
   - emite `card.created` (origem=AI)
6. Front recebe via SSE e atualiza Inbox/Kanban em tempo real.

### 5.2 Sugestão de resposta

- Quando uma mensagem inbound é exibida, front pede `POST /ai/suggest-reply { messageId }`.
- API enfileira; resposta retorna por SSE quando pronto (ou síncrono se latência baixa).
- Usuário aprova/edita/envia. Envio passa pelo respectivo adapter (Evolution para WA, googleapis/SMTP para email).

### 5.3 Conexão de canal (Gmail OAuth)

- Front abre `/admin/channels/new` → "Conectar Gmail".
- API gera URL OAuth Google, redireciona.
- Callback recebe code, troca por tokens, cifra com chave do servidor, salva em `Channel.config`.
- Inicia polling/watch (Gmail Push via Pub/Sub no futuro; MVP polling a cada 60s).

### 5.4 Cofre

- Senha mestre fornecida no login do vault (não a senha de login do sistema).
- Derivação: `key = argon2id(masterPassword, perUserSalt)` em memória.
- Cripto: AES-256-GCM, `iv` aleatório por item, `authTag` armazenado.
- A `key` nunca persiste; vive na sessão do navegador (memória) e é descartada no timeout ou logout.
- Operações de leitura/escrita do vault exigem reautenticação se sessão > N min.

---

## 6. APIs (rotas-chave, REST)

```
POST   /auth/login                          → { accessToken } + refresh cookie
POST   /auth/refresh
POST   /auth/logout

GET    /channels
POST   /channels                            (whatsapp instance create / gmail oauth start)
DELETE /channels/:id
GET    /channels/:id/status

POST   /webhooks/whatsapp                   (Evolution)
POST   /webhooks/gmail                      (push, fase 2)

GET    /conversations?channelId=&q=
GET    /conversations/:id/messages?cursor=
POST   /conversations/:id/messages          (envio)
POST   /conversations/:id/summarize         (dispara agente resumo)

GET    /kanban/boards
POST   /kanban/boards
GET    /kanban/boards/:id
POST   /kanban/cards
PATCH  /kanban/cards/:id
POST   /kanban/cards/:id/move               { columnId, position }
POST   /kanban/cards/:id/comments
POST   /kanban/cards/:id/attachments

GET    /tasks
POST   /tasks
PATCH  /tasks/:id

GET    /calendar/events
POST   /calendar/events
POST   /calendar/sync

GET    /vault/items
POST   /vault/items                         (recebe payload já cifrado pelo client — ver §10)
GET    /vault/items/:id
DELETE /vault/items/:id
POST   /vault/folders

POST   /storage/upload                      (multipart)
GET    /storage/files/:id/download

GET    /ai/agents
POST   /ai/agents
PATCH  /ai/agents/:id
POST   /ai/agents/:id/run                   { input }    (debug)
GET    /ai/logs?agentId=&from=&to=

GET    /events?type=&from=                  (audit log)

GET    /dashboard/summary                   (cards abertos, mensagens não lidas, eventos hoje)

GET    /sse                                 (stream de eventos para o front)
```

---

## 7. Camada de IA

### 7.1 Interface `AIProvider`

```ts
export interface AIMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface AIGenerateInput {
  model: string
  messages: AIMessage[]
  temperature?: number
  maxTokens?: number
  responseFormat?: 'text' | 'json'
  tools?: AIToolDef[]
}

export interface AIGenerateOutput {
  text: string
  toolCalls?: AIToolCall[]
  tokensIn: number
  tokensOut: number
  raw: unknown
}

export interface AIProvider {
  name: string
  generate(input: AIGenerateInput): Promise<AIGenerateOutput>
  embed?(texts: string[]): Promise<number[][]>
}
```

Implementações: `GeminiProvider`, `OpenAIProvider`, `ClaudeProvider`, `DeepSeekProvider`. Selecionado por configuração do Agent (provider+model).

### 7.2 Agentes do MVP

| Agente              | Função                                                              |
|---------------------|---------------------------------------------------------------------|
| `triage`            | Classifica mensagem: intent, prioridade, isDemand, resumo curto.    |
| `card-builder`      | A partir de mensagem + contexto, gera title/description/checklist.  |
| `summarizer`        | Resumo de conversa longa ou de cluster de mensagens relacionadas.   |
| `reply-suggester`   | Gera 1-3 sugestões de resposta no tom do usuário.                   |
| `daily-digest`      | Resumo diário de agenda + tarefas (job cron 7h).                    |

Cada agente = registro em `Agent` (prompt + config) + função TS que orquestra entrada/saída e ferramentas.

### 7.3 Estrutura de saída (triage) — JSON forçado via prompt

```json
{
  "isDemand": true,
  "intent": "support|billing|sales|info|technical|other",
  "priority": "LOW|MEDIUM|HIGH|URGENT",
  "summary": "string curta",
  "suggestedTitle": "string",
  "checklist": ["item1", "item2"],
  "confidence": 0.0
}
```

### 7.4 Memória / contexto

- **MVP**: contexto = últimas N mensagens da conversa + perfil do contato (campos não-sensíveis). Sem embeddings.
- **Fase 2**: `MemoryChunk.embedding` populado por job de indexação. Busca via `pgvector` (se migrar Postgres) ou Qdrant/Chroma standalone. Manter MySQL como OLTP e usar Qdrant para vetorial é o caminho de menor resistência.

---

## 8. Sistema de Eventos

- Bus em duas camadas:
  - **In-process** (`mitt` ou EventEmitter) — entrega imediata a handlers locais.
  - **Persistente** — toda emissão também grava em `EventLog` (auditoria) e, quando deve cruzar processo, é publicada em Redis pub/sub.
- Workers são consumidores em filas BullMQ; o handler in-process enfileira o job correspondente.
- Tipos de evento (string `dominio.acao`): `message.received`, `message.classified`, `card.created`, `card.moved`, `ai.executed`, `channel.connected`, `vault.accessed`, `storage.uploaded`, `calendar.synced`, `error.raised`.

---

## 9. Frontend — Telas (MVP)

| Rota                          | O que tem                                                              |
|-------------------------------|------------------------------------------------------------------------|
| `/login`                      | email/senha; futuramente 2FA                                           |
| `/dashboard`                  | cards de KPIs (mensagens não lidas, demandas abertas, eventos hoje, execuções de IA) |
| `/inbox`                      | lista unificada de conversas; filtros por canal/contato                |
| `/inbox/[conversationId]`     | thread completa, painel lateral com classificação IA, botão "criar card", sugestões de resposta |
| `/kanban/[boardId]`           | board drag-and-drop; modal de card com comments/checklist/anexos       |
| `/calendar`                   | grid mensal/semanal; eventos do Google + tarefas com dueDate           |
| `/vault`                      | listar/criar itens; modal de unlock com master password                |
| `/storage`                    | navegador de pastas e arquivos                                         |
| `/admin/users`                | CRUD                                                                   |
| `/admin/channels`             | conectar/desconectar WA/Gmail/IMAP                                     |
| `/admin/agents`               | listar agentes, editar prompt/modelo/temperatura                       |
| `/admin/prompts`              | biblioteca de prompts                                                  |
| `/admin/ai-logs`              | tabela de execuções com filtros, ver input/output                      |
| `/admin/settings`             | configurações gerais                                                   |
| `/admin/events`               | timeline de eventos                                                    |

Padrões UI: shadcn/ui (Dialog, Sheet, Tabs, DataTable), TanStack Query para fetch, Zustand para estado de UI (drawer aberto, board selecionado).

---

## 10. Segurança e Vault — detalhes

- **Senhas de login**: argon2id (`memoryCost: 19456, timeCost: 2, parallelism: 1`).
- **Vault**:
  - Master password derivada no **cliente** com argon2-browser (params alinhados ao server) → chave AES-256.
  - Cifrar/decifrar no cliente sempre que possível; servidor armazena apenas ciphertext+iv+authTag.
  - Para itens "compartilhados" (fase 2): envelope encryption.
  - Logs de acesso (`vault.accessed`) sem expor conteúdo.
- **Tokens de canal** (OAuth Google, API key Evolution): cifrados em repouso com `VAULT_MASTER_KEY` do servidor (env var, idealmente em KMS futuramente).
- **Headers**: helmet, CORS estrito, rate-limit por IP e por user, CSRF para rotas mutativas no Next.
- **Inputs**: zod em todas as rotas; sanitização de HTML em corpo de email exibido.
- **Logs**: pino com redaction de campos sensíveis (`password`, `token`, `authorization`).
- **Webhooks**: validação de assinatura HMAC (Evolution) e verificação de origem.

---

## 11. Riscos Técnicos

1. **Evolution API instabilidade**: hospedagem própria exige cuidados (sessão WA cai, QR re-scan). Mitigação: healthcheck + reconciliação periódica + alertas.
2. **Custo/limites Gemini free**: monitorar `tokensIn/tokensOut` e ter circuit breaker (fallback para modelo mais barato ou pausa quando passar de N execuções/hora).
3. **Falsos positivos de "isDemand"**: começar conservador (`confidence > 0.7`); abaixo disso, classificar mas não criar card automaticamente — só sugerir.
4. **Race conditions de ingestão**: webhooks duplicados do WhatsApp. Usar `@@unique(channelId, externalId)` em Message para idempotência.
5. **PII em prompts**: redact PII opcionalmente antes de mandar para IA (email/telefone substituídos por placeholder). Configurável.
6. **Crescimento do EventLog/AIExecutionLog**: particionar por data e job de retenção (90 dias default).
7. **Master password do vault esquecida**: zero-knowledge é definitivo. Documentar e oferecer "reset destrutivo" claro.
8. **Latência de IA bloqueando UX**: tudo via fila + SSE; UI nunca espera síncronamente.
9. **Migração MySQL→Postgres se quiser pgvector**: manter SQL portátil (evitar features MySQL-only).
10. **Anexos grandes**: limite por upload, antivírus (clamav) no fluxo de upload em fase 2.

---

## 12. Roadmap

### Sprint 0 — Fundação (1 semana)
- Setup monorepo pnpm, ESLint/Prettier, docker-compose (mysql, redis, evolution-api).
- Prisma schema inicial + migrações.
- Fastify bootstrap + módulo auth + login funcional.
- Next.js bootstrap + layout + login.

### Sprint 1 — Canais e Inbox (2 semanas)
- Conectar Evolution API (webhook + envio).
- Conectar Gmail (OAuth + polling).
- Modelos Conversation/Message + ingestores.
- Tela `/inbox` listando conversas e mensagens em tempo real (SSE).
- Envio de mensagem outbound.

### Sprint 2 — Kanban manual (1 semana)
- Boards/colunas/cards + drag-and-drop (dnd-kit).
- Criação manual de cards vinculados a mensagem.

### Sprint 3 — Camada de IA (2 semanas)
- `AIProvider` + `GeminiProvider`.
- Agente `triage` em worker.
- Auto-criação de cards (com flag de confidence).
- `AIExecutionLog` + tela `/admin/ai-logs`.
- Sugestão de resposta.

### Sprint 4 — Calendário e Vault básico (2 semanas)
- Google Calendar OAuth + sync bidirecional simples (criar evento a partir de card).
- Vault: CRUD de senhas, criptografia client-side, telas.
- Upload de arquivos local.

### Sprint 5 — Polimento e Dashboard (1 semana)
- Dashboard com KPIs.
- Resumo diário (cron).
- Hardening de segurança, rate-limit, headers.
- README + docs internas.

### Pós-MVP
- Embeddings + busca semântica (Qdrant).
- Múltiplos providers de IA + roteamento por custo.
- Automações configuráveis (regras "se X então Y").
- 2FA TOTP.
- S3/MinIO no storage.
- Multi-tenant real + billing.
- App mobile (React Native ou PWA reforçada).
- Webhooks de saída para integrações (Zapier-like).
- Push notifications.
- Auditoria SOC2-friendly.

---

## 13. Exemplos de Código (referência rápida)

### 13.1 `AIProvider` — Gemini

```ts
// apps/api/src/modules/ai/providers/gemini.provider.ts
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { AIProvider, AIGenerateInput, AIGenerateOutput } from './types'

export class GeminiProvider implements AIProvider {
  name = 'gemini'
  private client: GoogleGenerativeAI
  constructor(apiKey: string) { this.client = new GoogleGenerativeAI(apiKey) }

  async generate(input: AIGenerateInput): Promise<AIGenerateOutput> {
    const model = this.client.getGenerativeModel({ model: input.model })
    const prompt = input.messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')
    const res = await model.generateContent(prompt)
    const text = res.response.text()
    return {
      text,
      tokensIn: res.response.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: res.response.usageMetadata?.candidatesTokenCount ?? 0,
      raw: res,
    }
  }
}
```

### 13.2 Worker de classificação (esqueleto)

```ts
// apps/api/src/workers/classifyMessage.worker.ts
import { Worker } from 'bullmq'
import { prisma } from '../lib/prisma'
import { redis } from '../lib/redis'
import { runAgent } from '../modules/ai/agents/runAgent'
import { eventBus } from '../lib/eventBus'

new Worker('classifyMessage', async (job) => {
  const { messageId } = job.data
  const message = await prisma.message.findUniqueOrThrow({
    where: { id: messageId },
    include: { conversation: true },
  })
  const context = await prisma.message.findMany({
    where: { conversationId: message.conversationId },
    orderBy: { sentAt: 'desc' },
    take: 20,
  })

  const result = await runAgent('triage', { message, context })
  await prisma.message.update({
    where: { id: messageId },
    data: { aiClassification: result },
  })

  if (result.isDemand && result.confidence > 0.7) {
    const card = await prisma.card.create({ data: { /* ...mapeamento... */ } })
    eventBus.emit('card.created', { cardId: card.id, origin: 'AI' })
  }
}, { connection: redis })
```

### 13.3 Criptografia do vault (server-side helper para tokens de canal)

```ts
// apps/api/src/lib/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const key = Buffer.from(process.env.VAULT_MASTER_KEY!, 'hex') // 32 bytes

export function encrypt(plain: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return { ciphertext: ct, iv, authTag: cipher.getAuthTag() }
}

export function decrypt(ciphertext: Buffer, iv: Buffer, authTag: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
```

---

## 14. Verificação (end-to-end do MVP)

- `docker compose up -d` sobe MySQL, Redis e Evolution API.
- `pnpm --filter api prisma migrate dev` aplica schema.
- `pnpm --filter api dev` e `pnpm --filter web dev` rodam back/front.
- **Cenário 1 — WhatsApp**: enviar mensagem ao número conectado → ver chegada em `/inbox` em <5s → classificação IA aparece em <15s → card surge em `/kanban` se for demanda.
- **Cenário 2 — Gmail**: enviar email para a caixa conectada → idem.
- **Cenário 3 — Manual**: criar card direto em `/kanban`, mover entre colunas, comentar, anexar arquivo.
- **Cenário 4 — Vault**: criar senha, fechar sessão, reabrir (deve pedir master password), conferir conteúdo decifrado.
- **Cenário 5 — Calendário**: criar evento a partir de card com dueDate → conferir no Google Calendar.
- **Cenário 6 — Resumo de conversa**: clicar "Resumir" em thread longa → resumo retorna em <10s.
- **Métricas a observar**: latência de classificação, taxa de cards aceitos (não-deletados) em 7 dias, custo de IA por dia.

---

## 15. Arquivos Críticos (quando começar a implementar)

- `apps/api/prisma/schema.prisma` — fonte da verdade do domínio.
- `apps/api/src/app.ts` — registro de plugins/rotas.
- `apps/api/src/modules/ai/providers/types.ts` — contrato `AIProvider`.
- `apps/api/src/modules/ai/agents/runAgent.ts` — orquestrador genérico de agente.
- `apps/api/src/lib/eventBus.ts` — bus interno.
- `apps/api/src/lib/crypto.ts` — utilitários de cripto.
- `apps/web/lib/api.ts` — client REST com interceptor de auth.
- `apps/web/lib/sse.ts` — hook `useEventStream`.
- `packages/shared/src/schemas/*.ts` — zod schemas (validar dos dois lados).

---

## 16. Próximo Passo Imediato

1. `git init` no diretório raiz + commit inicial com este plano.
2. Scaffolding do monorepo (Sprint 0): pnpm workspaces, docker-compose, Prisma, Fastify, Next.js, login funcional.
3. Após Sprint 0 verde, partir para Sprint 1 (canais e inbox).

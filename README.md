# AI Work Assistant (AIWA)

Plataforma de atendimento e produtividade interna com WhatsApp (Evolution + Meta), e-mail, agenda, kanban, base de conhecimento, IA generativa e chat interno entre operadores.

Stack: **pnpm workspaces** · **Node 20+** · **Fastify** · **Prisma + MySQL** · **Redis + BullMQ** · **Next.js 14 (App Router)** · **PM2**.

---

## Pré-requisitos

| | Versão | Como instalar (Ubuntu/Debian) |
|---|---|---|
| Node.js | 20+ | `curl -fsSL https://deb.nodesource.com/setup_20.x \| sudo -E bash -; sudo apt install -y nodejs` |
| pnpm | 9+ | `npm install -g pnpm@9` |
| MySQL | 8+ | `sudo apt install -y mysql-server` |
| Redis | 7+ | `sudo apt install -y redis-server` |
| PM2 | recente | `npm install -g pm2` |

---

## Instalação rápida

```bash
# 1. Clone
git clone <seu-repo> ai-work-assistant
cd ai-work-assistant

# 2. Configure o .env (raiz do projeto)
cp .env.example .env

# 2.1. Gere os segredos
echo "JWT_ACCESS_SECRET=$(openssl rand -hex 32)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
echo "VAULT_MASTER_KEY=$(openssl rand -hex 32)"
# Cole no .env os 3 valores

# 2.2. Edite o .env e preencha:
#   - DATABASE_URL (com user/senha do seu MySQL)
#   - REDIS_URL
#   - PUBLIC_API_URL (ex: https://api.seudominio.com)
#   - WEB_URL       (ex: https://app.seudominio.com)

# 3. Cria o banco (precisa existir vazio antes do db:push)
mysql -uroot -p -e "CREATE DATABASE IF NOT EXISTS aiwa_assistant CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 4. Instala dependências, sincroniza schema, roda seed e builda os 2 apps
pnpm install:all

# 5. Sobe via PM2
pnpm start

# 6. (Opcional) Faz o PM2 voltar sozinho depois de reboot
pm2 save && pm2 startup
```

Pronto. API em `http://localhost:3333`, Web em `http://localhost:3000`.

---

## Login padrão

```
email:  admin@aiwa.local
senha:  admin123456
```

⚠️ **Troque a senha imediatamente** após o primeiro login: vá em **Configurações → Perfil → Alterar senha**.

---

## Reverse proxy com nginx (produção)

Exemplo em [`nginx.example.conf`](./nginx.example.conf). Em resumo: dois `server` blocks — um pra `app.seudominio.com` (proxy pra `:3000`) e outro pra `api.seudominio.com` (proxy pra `:3333`). Use `certbot` pra SSL.

Depois de configurar:
- `PUBLIC_API_URL=https://api.seudominio.com` no `.env`
- `WEB_URL=https://app.seudominio.com` no `.env`
- `pm2 restart aiwa-web && pm2 restart aiwa-api`

---

## Variáveis de ambiente

Tudo vive num único `.env` na raiz do projeto, lido pela API e pelo Web.

### Obrigatórias

| Var | Descrição |
|---|---|
| `DATABASE_URL` | URL de conexão MySQL (`mysql://user:pass@host:3306/db`) |
| `REDIS_URL` | URL do Redis (`redis://127.0.0.1:6379`) |
| `JWT_ACCESS_SECRET` | Segredo do JWT access token (≥ 32 chars). Use `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | Segredo do JWT refresh token (≥ 32 chars) |
| `VAULT_MASTER_KEY` | Chave AES-256 (exatamente 64 chars hex). Use `openssl rand -hex 32` |

### URLs públicas (essenciais com reverse proxy)

| Var | Descrição |
|---|---|
| `PUBLIC_API_URL` | URL pública da API. Injetada no HTML em runtime. |
| `WEB_URL` | URL pública do frontend. Usada no CORS e nos redirects de OAuth. |
| `CORS_ALLOWED_ORIGINS` | (opcional) origens extras pro CORS, separadas por vírgula. |

### Opcionais

| Categoria | Vars |
|---|---|
| WhatsApp via Evolution | `EVOLUTION_SERVER_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_URL`, `EVOLUTION_WEBHOOK_SECRET` |
| WhatsApp via Meta | `META_WEBHOOK_VERIFY_TOKEN` |
| Provedores de IA | `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_SITE_URL` |
| Google OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_AUTH_REDIRECT_URI`, `GOOGLE_REDIRECT_URI` |
| Runtime | `NODE_ENV` (default `production`), `PORT` (3333), `HOST` (0.0.0.0), `STORAGE_PATH` (`./storage`) |
| JWT | `JWT_ACCESS_EXPIRES_IN` (15m), `JWT_REFRESH_EXPIRES_IN` (7d) |

---

## Comandos úteis

| Comando | Faz |
|---|---|
| `pnpm start` | Sobe API + Web via PM2 |
| `pnpm stop` | Para tudo |
| `pnpm restart` | Reinicia tudo |
| `pnpm logs` | Acompanha logs (tail) |
| `pnpm build` | Builda API + Web |
| `pnpm dev:api` | API em modo dev (hot reload via `tsx watch`) |
| `pnpm dev:web` | Web em modo dev (`next dev`) |
| `pnpm --filter api db:push` | Sincroniza `schema.prisma` no DB sem migrations |
| `pnpm --filter api db:seed` | Roda o seed (idempotente — pode rodar de novo) |
| `pnpm --filter api db:reset` | ⚠️ Drop + recria + seed. **Apaga tudo.** |
| `pnpm --filter api db:studio` | Abre o Prisma Studio (UI do banco) na 5555 |

---

## Estratégia de banco

Este projeto **não usa migrations versionadas do Prisma**. Em vez disso:

- O `schema.prisma` é a **fonte da verdade**.
- `pnpm --filter api db:push` aplica o schema diretamente no banco.
- Pra mudar o schema: edite `schema.prisma`, rode `db:push`, suba o código.

Trade-off: você perde o histórico de migrations, mas ganha simplicidade num produto com schema relativamente estável e sem múltiplos ambientes legados. Se quiser voltar pra migrations no futuro: `npx prisma migrate dev --create-only --name init` e a partir daí usa `migrate deploy`.

---

## Healthcheck

`GET /health` na API responde:

```json
{
  "status": "ok",
  "ts": 1779999999999,
  "checks": { "db": "ok", "redis": "ok" }
}
```

Retorna **503** se DB ou Redis estiverem fora. Use isso no seu reverse proxy ou no monitor (UptimeRobot/Healthchecks.io).

---

## Troubleshooting

**`window.__APP_CONFIG__` aparece vazio no browser**
→ `PUBLIC_API_URL` não foi carregado pelo Next. Confirme que está no `.env` da raiz (não em `apps/web/.env`) e dê `pm2 restart aiwa-web`.

**CORS bloqueando**
→ Em produção (`NODE_ENV=production`), CORS só libera `WEB_URL` e o que estiver em `CORS_ALLOWED_ORIGINS`. Confira o log: `pm2 logs aiwa-api` mostra "Origem não permitida pelo CORS".

**Browser pegando bundle antigo após deploy**
→ Limpe cache do navegador (Ctrl+Shift+R) ou abra em aba anônima. Se usa Cloudflare/CDN, purgue o cache de `/_next/static/`.

**`.env` não está sendo lido pela API**
→ A API loga "`.env carregado de: <path>`" se falhar a validação. Garanta que está em `<raiz-do-projeto>/.env` e o PM2 está com `cwd` na raiz (veja `ecosystem.config.cjs`).

**Erro de Prisma "table doesn't exist"**
→ Rode `pnpm --filter api db:push` pra sincronizar o schema.

**Erro de login mesmo com a senha correta**
→ Confira no banco que o usuário existe com senha hasheada:
```sql
SELECT email, role, LEFT(passwordHash, 20) AS hash FROM User;
```
Se vazio, rode `pnpm --filter api db:seed`.

---

## Arquitetura (resumo)

```
ai-work-assistant/
├── apps/
│   ├── api/      Fastify + Prisma + BullMQ workers
│   │   ├── src/
│   │   │   ├── modules/       cada feature em sua pasta
│   │   │   ├── workers/       jobs em background (BullMQ)
│   │   │   ├── lib/           prisma, redis, logger, seed
│   │   │   └── config/        env (Zod)
│   │   └── prisma/schema.prisma
│   └── web/      Next.js 14 App Router
│       ├── app/(app)/         rotas autenticadas
│       ├── app/login/         login (não autenticado)
│       └── lib/               api client, sse, runtime-config
├── packages/
│   └── shared/                tipos/enums compartilhados
├── ecosystem.config.cjs       PM2
├── docker-compose.yml         (opcional) MySQL/Redis/Evolution containers
├── .env                       (não versionado) configuração runtime
└── .env.example               template
```

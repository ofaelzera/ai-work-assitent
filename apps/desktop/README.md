# Aiwa Desktop

App desktop (macOS, Windows e Linux) construído com **Tauri 2**. É um shell nativo que carrega o web app Next.js hospedado e adiciona recursos do sistema operacional:

- **Notificações nativas** de novas mensagens (via SSE já existente no web app)
- **Bandeja (tray/menu bar)** com badge de não lidas — fechar a janela minimiza para a bandeja
- **Deep links** `aiwa://` (ex.: `aiwa://inbox/<conversationId>` abre direto a conversa)
- **Atalho global** `Cmd/Ctrl+Shift+A` para mostrar/esconder a janela
- **Auto-update** via GitHub Releases e **iniciar com o sistema** (toggle no menu da bandeja)
- **Servidor configurável**: na primeira execução o usuário informa a URL do servidor (HTTPS obrigatório; HTTP permitido apenas para localhost/rede privada). Trocar depois pelo menu da bandeja → "Trocar servidor…"

## Pré-requisitos

- Rust (https://rustup.rs)
- Node 20+ / pnpm 9+
- Linux: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`

## Desenvolvimento

```bash
# na raiz do monorepo, com api (3333) e web (3000) rodando:
pnpm dev:desktop
```

Na tela inicial, informe `http://localhost:3000`.

## Build local

```bash
pnpm build:desktop
```

Gera instaladores em `apps/desktop/src-tauri/target/release/bundle/` (`.dmg`, `.msi`/`.exe`, `.deb`, `.AppImage` conforme o SO).

## Release (CI)

O workflow `.github/workflows/desktop-release.yml` builda para macOS (arm64 + x64), Windows e Linux e publica um draft release no GitHub quando uma tag `desktop-v*` é criada:

```bash
git tag desktop-v0.1.0 && git push origin desktop-v0.1.0
```

### Secrets necessários no repositório

| Secret | Obrigatório | Descrição |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Sim (updater) | Conteúdo de `~/.tauri/aiwa-desktop.key` (gerada com `tauri signer generate`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Sim | Senha da chave (vazia se gerada sem senha) |
| `APPLE_CERTIFICATE` (+ `_PASSWORD`), `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Para distribuir no macOS | Developer ID + notarização; sem isso o Gatekeeper bloqueia o app |

A chave pública do updater está em `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). **Não perca a chave privada** — sem ela não é possível publicar atualizações.

## Arquitetura e segurança

- A janela nasce na página local `bootstrap/` (configuração do servidor). Após validar a URL, o Rust salva no `tauri-plugin-store` e navega para o servidor.
- O IPC para conteúdo remoto é liberado pela capability `src-tauri/capabilities/remote.json` com **permissões mínimas** (eventos + notificações). Nada de fs/shell/process é exposto ao conteúdo remoto.
- A navegação da janela é restrita em Rust (`on_navigation` em `lib.rs`) à origem do servidor configurado — qualquer outro link abre no navegador padrão.
- A integração no web app fica em `apps/web/lib/desktop.ts` (no-ops no browser) e `apps/web/components/providers/DesktopBridge.tsx`.

## Limitações conhecidas por plataforma

- **Badge de não lidas**: completo no macOS (dock + menu bar); no Windows/Linux apenas tooltip do tray.
- **Linux**: clique em notificação pode não focar a janela (depende do daemon de notificações); deep link via `.AppImage` exige integração do AppImage no sistema (prefira o `.deb`).
- **Windows sem assinatura**: o SmartScreen exibe aviso na instalação (aceitável para uso interno).
